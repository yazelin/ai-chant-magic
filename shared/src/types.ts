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
export type GameStatus = 'lobby' | 'playing' | 'gameover';

export interface Player {
  id: string; name: string; classId: ClassId;
  pos: Vec2; facing: number;
  hp: number; maxHp: number;
  alive: boolean; downed: boolean;
  bleedoutAt: number; reviveProgress: number; respawnAtWave: number;
  shieldUntil: number;
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
}

export interface Projectile {
  id: number; spell: SpellId; ownerId: string;
  pos: Vec2; vel: Vec2; damage: number; radius: number; ttl: number; fuse?: number;
  // Per-cast explosion params (firestorm scales these with 爆裂 charge). Sim-only.
  explosionDamage?: number; explosionRadius?: number;
}

export type EffectKind = 'beam' | 'chain' | 'nova' | 'blast' | 'aura';

export interface TransientEffect {
  id: number; kind: EffectKind; ownerId?: string;
  a: Vec2; b?: Vec2; radius?: number; ttl: number; colorHint: string;
  // Which spell produced this effect (lets the renderer play a per-skill SFX).
  spell?: SpellId;
}

export interface World {
  time: number; status: GameStatus;
  players: Player[]; enemies: Enemy[]; projectiles: Projectile[]; effects: TransientEffect[];
  nextEntityId: number; wave: number; score: number;
  spawnQueue: number; spawnTimer: number; spawnCadence: number; breakTimer: number;
}

export interface MoveCommand { kind: 'move'; playerId: string; dir: Vec2; }
export interface FaceCommand { kind: 'face'; playerId: string; angle: number; }
export interface CastCommand { kind: 'cast'; playerId: string; spell: SpellId; }
export type Command = MoveCommand | FaceCommand | CastCommand;
