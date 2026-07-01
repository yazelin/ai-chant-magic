import type { Vec2 } from './vec';
export type { Vec2 } from './vec';

export type SpellId =
  | 'fireball' | 'firestorm' | 'frost' | 'frostnova'
  | 'thunder' | 'chain' | 'shield' | 'aegis' | 'heal' | 'holybolt'
  | 'chant1' | 'chant2' | 'mend' | 'repulse';
export type ClassId = 'pyro' | 'cryo' | 'storm' | 'warden';
// Slime enemy attribute. Phase 1: drives colour + look only. Phase 2 will give
// each its signature behaviour (fire=死亡爆炸, ice=減速, storm=突進, holy=補血).
export type EnemyElement = 'normal' | 'fire' | 'ice' | 'storm' | 'holy';
// The 4 elements a player spell can leave as reaction residue on an enemy —
// reuses EnemyElement's non-'normal' members rather than a separate vocabulary
// for "the element of a spell" vs "the element of a slime species".
export type ReactionElement = Exclude<EnemyElement, 'normal'>;
// 'victory' = cleared the last implemented level (see world.ts's MAX_LEVEL_ID),
// as distinct from 'gameover' (the party wiped). Both freeze the sim (see step()).
export type GameStatus = 'lobby' | 'playing' | 'gameover' | 'victory';

export interface Player {
  id: string; name: string; classId: ClassId;
  pos: Vec2; facing: number;
  hp: number; maxHp: number;
  alive: boolean; downed: boolean;
  bleedoutAt: number; reviveProgress: number; respawnAtWave: number;
  shieldUntil: number;
  // Sim-only marker for Jeanne's 聖盾. Unlike shieldUntil, this is used for the
  // team power buff, so generic shields do not accidentally double skill output.
  aegisUntil?: number;
  // Brief invincibility after taking a contact hit (i-frames): no contact damage
  // applies until this sim time. Stops swarms from melting you frame-by-frame.
  // Sim-only (not serialized; the client reads hp from snapshots).
  invulnUntil?: number;
  // Movement slow from an ice slime hit (sim-only; server applies the slow to
  // movement, client just sees the slower positions).
  slowUntil?: number;
  // Heal-over-time active until this sim time, regenerating healRate/sec.
  healUntil?: number;
  healRate?: number;
  // 惠惠's 爆裂 charge: each 詠唱 adds 1, 爆裂魔法 consumes all. Serialized so the
  // HUD can show the current stack count.
  pyroCharge?: number;
  cooldowns: Record<SpellId, number>;
  connected: boolean;
}

export interface Enemy {
  id: number; pos: Vec2; hp: number; speed: number;
  slowUntil: number; radius: number; targetId: string | null;
  element: EnemyElement;
  // Sim-only per-element behaviour state (not serialized; visuals ride on effects):
  maxHp?: number;                                  // heal cap (holy), set at spawn
  telegraphUntil?: number; dashUntil?: number;     // storm dash wind-up / lunge windows
  nextDashAt?: number; dashDir?: Vec2;             // storm dash schedule + locked direction
  nextHealAt?: number;                             // holy heal-pulse schedule
  boss?: boolean; nextSummonAt?: number;           // 史萊姆王:旗標 + 召喚小史萊姆排程
  // Fully stopped until this sim time (frostnova/「冰結」). Sim-only — not in the
  // net snapshot; positions are server-authoritative, so the client renders the
  // freeze via the stalled positions (and the existing slowUntil blue tint).
  frozenUntil?: number;
  // 世界2(frostvale)signature enemy: holds still, then blinks CONFIG.wraith.blinkDist
  // toward its target every blinkInterval, instead of walking. Sim-only schedule.
  wraith?: boolean; nextBlinkAt?: number;
  // Endless-mode-only: a former campaign boss demoted to an "elite" mob mixed
  // into the swarm (see CONFIG.elite). Mutually exclusive with `boss` — an
  // elite must NEVER set boss:true, since removeDeadEnemies() reads that flag
  // to trigger levelCleared/campaign transitions.
  elite?: boolean;
  // Elemental-reaction residue: the element of the last damaging hit that
  // didn't itself trigger a reaction, held until auraUntil. A hit of a
  // DIFFERENT element while active triggers a reaction (see triggerReaction in
  // world.ts), consuming both. A same-element hit only refreshes auraUntil.
  // Entirely separate from `element` (the enemy's permanent species/behaviour)
  // — an ice-native enemy is NOT pre-seeded with an ice aura; see
  // applyElementalHit's doc comment for why. Serialized (needs a continuous
  // per-frame tell, unlike frozenUntil's one-shot convention).
  auraElement?: ReactionElement;
  auraUntil?: number;
  // Per-enemy reaction throttle: world.time must reach this before a
  // mismatched hit can trigger another reaction on THIS enemy (bounds proc
  // frequency under focus-fire). Sim-only — no continuous visual rides on it.
  reactionReadyAt?: number;
}

export interface Projectile {
  id: number; spell: SpellId; ownerId: string;
  pos: Vec2; vel: Vec2; damage: number; radius: number; ttl: number; fuse?: number;
  // Per-cast explosion params (firestorm scales these with 爆裂 charge). Sim-only.
  explosionDamage?: number; explosionRadius?: number;
}

export type EffectKind = 'beam' | 'chain' | 'nova' | 'blast' | 'aura' | 'resonance' | 'reaction';

export interface TransientEffect {
  id: number; kind: EffectKind; ownerId?: string;
  a: Vec2; b?: Vec2; radius?: number; ttl: number; colorHint: string;
  // Which spell produced this effect (lets the renderer play a per-skill SFX).
  spell?: SpellId;
  // Which elemental reaction produced this effect (kind:'reaction' only) —
  // lets the renderer show a flavour label + pick the matching SFX.
  reactionName?: string;
}

export interface World {
  time: number; status: GameStatus;
  players: Player[]; enemies: Enemy[]; projectiles: Projectile[]; effects: TransientEffect[];
  nextEntityId: number; wave: number; score: number;
  // Which world/level the room is on (0-based, index into the client's per-level
  // theme table).
  levelId: number;
  // True once the current level's boss has been killed. Freezes wave spawning
  // (see updateWaves) — existing enemies can still be fought, but no more waves
  // roll in until transitionTimer runs out.
  levelCleared: boolean;
  // Counts down (once levelCleared) to the level-clear toast finishing, at which
  // point updateWaves either advances to the next level or — on the last
  // implemented level — ends the game with status 'victory'.
  transitionTimer: number;
  spawnQueue: number; spawnTimer: number; spawnCadence: number; breakTimer: number;
  // Endless mode (unlocked after a 'victory'): the same World continues past
  // the campaign, status flips back to 'playing' with this flag set. wave
  // restarts from 0 (see enterEndlessMode); levelId stays frozen at whatever
  // it was (the last world's visuals/BOSS_ELEMENT keep being read where still
  // relevant, but spawn composition switches to spawnEndlessEnemy/spawnElite).
  endless: boolean;
  // world.score/time at the moment endless mode was entered — world.time never
  // resets (unlike wave), so the client shows "this run's kills/survival time"
  // as score - endlessKillBase / time - endlessTimeBase, without new counters.
  endlessKillBase: number;
  endlessTimeBase: number;
  // Elite-mob (demoted boss) spawn schedule — see spawnElite()/beginWave().
  nextEliteWave: number; eliteWavesSoFar: number; eliteQueue: number;
  // 共鳴詠唱: rolling buffer of recent resonance calls (sim-only — not
  // serialized; the client never needs this bookkeeping, only the resulting
  // effect/buff). Trimmed to CONFIG.resonance.windowSec each step; ≥2 DISTINCT
  // callers within that window triggers the party buff (see updateResonance).
  resonanceCalls: { playerId: string; at: number }[];
  resonanceCooldownUntil: number;
  // Running total of elemental reactions triggered this run (never reset by
  // enterEndlessMode, same persistence rule as score) — a positive-feedback
  // counter, shown in the HUD like the kill count.
  reactionCount: number;
}

export interface MoveCommand { kind: 'move'; playerId: string; dir: Vec2; }
export interface FaceCommand { kind: 'face'; playerId: string; angle: number; }
export interface CastCommand { kind: 'cast'; playerId: string; spell: SpellId; }
// A player calling out for the group's shared "共鳴" (resonance) coordination
// buff — distinct from a spell cast (no SpellId/cooldown/class loadout;
// available to every class, and inert with only one player in the room).
export interface ResonanceCommand { kind: 'resonance'; playerId: string; }
export type Command = MoveCommand | FaceCommand | CastCommand | ResonanceCommand;
