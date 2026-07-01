// Pure world -> Snapshot serializer (spec §8, plan Task B1 Step 3).
//
// A Snapshot is the wire-facing projection of a World: it keeps the fields the
// client renders (player gameplay state incl. alive/downed/reviveProgress/
// shieldUntil/classId, enemies, projectiles, transient effects, wave, score,
// status, time) and DROPS server-only fields (player cooldowns / connected /
// bleedoutAt / respawnAtWave, enemy targetId/speed, projectile owner/vel/etc,
// world spawn bookkeeping). It is a plain structural clone — JSON-safe.

import type {
  World,
  Vec2,
  ClassId,
  SpellId,
  GameStatus,
  EffectKind,
  EnemyElement,
  ReactionElement,
} from '@acm/shared';

export interface SnapshotPlayer {
  id: string;
  name: string;
  classId: ClassId;
  pos: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  downed: boolean;
  reviveProgress: number;
  shieldUntil: number;
  pyroCharge: number;
  // Cooldown ready-times (sim time) per spell, so clients can show each player's
  // skill cooldowns (HUD ring/countdown). Small map, fine at snapshot rate.
  cooldowns: Record<SpellId, number>;
}

export interface SnapshotEnemy {
  id: number;
  pos: Vec2;
  hp: number;
  slowUntil: number;
  radius: number;
  element: EnemyElement;
  boss?: boolean;
  elite?: boolean; // endless-mode-only: a demoted boss mixed into the swarm
  // Active elemental-reaction residue (see shared world.ts's applyElementalHit)
  // — needs a continuous per-frame client tell (a pulsing ring), unlike
  // frozenUntil/telegraphUntil which ride on the positions/effects alone.
  auraElement?: ReactionElement;
  auraUntil?: number;
}

export interface SnapshotProjectile {
  id: number;
  spell: SpellId;
  pos: Vec2;
  radius: number;
}

export interface SnapshotEffect {
  id: number;
  kind: EffectKind;
  ownerId?: string;
  a: Vec2;
  b?: Vec2;
  radius?: number;
  ttl: number;
  colorHint: string;
  spell?: SpellId;
  reactionName?: string;
}

export interface Snapshot {
  time: number;
  status: GameStatus;
  wave: number;
  score: number;
  levelId: number;
  levelCleared: boolean;
  endless: boolean;
  endlessKillBase: number; // "this run's kills" on the client = score - endlessKillBase
  endlessTimeBase: number; // "this run's survival time" = time - endlessTimeBase
  breakTimer: number; // >0 = countdown to next wave
  spawnQueue: number; // enemies left to spawn this wave (for within-wave progress)
  reactionCount: number; // running total of elemental reactions triggered this run
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  projectiles: SnapshotProjectile[];
  effects: SnapshotEffect[];
}

function cloneVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function toSnapshot(world: World): Snapshot {
  return {
    time: world.time,
    status: world.status,
    wave: world.wave,
    score: world.score,
    levelId: world.levelId,
    levelCleared: world.levelCleared,
    endless: world.endless,
    endlessKillBase: world.endlessKillBase,
    endlessTimeBase: world.endlessTimeBase,
    breakTimer: world.breakTimer,
    spawnQueue: world.spawnQueue,
    reactionCount: world.reactionCount,
    players: world.players.map((p) => ({
      id: p.id,
      name: p.name,
      classId: p.classId,
      pos: cloneVec(p.pos),
      facing: p.facing,
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      downed: p.downed,
      reviveProgress: p.reviveProgress,
      shieldUntil: p.shieldUntil,
      pyroCharge: p.pyroCharge ?? 0,
      cooldowns: { ...p.cooldowns },
    })),
    enemies: world.enemies.map((e) => ({
      id: e.id,
      pos: cloneVec(e.pos),
      hp: e.hp,
      slowUntil: e.slowUntil,
      radius: e.radius,
      element: e.element,
      boss: e.boss,
      elite: e.elite,
      auraElement: e.auraElement,
      auraUntil: e.auraUntil,
    })),
    projectiles: world.projectiles.map((pr) => ({
      id: pr.id,
      spell: pr.spell,
      pos: cloneVec(pr.pos),
      radius: pr.radius,
    })),
    effects: world.effects.map((fx) => {
      const out: SnapshotEffect = {
        id: fx.id,
        kind: fx.kind,
        a: cloneVec(fx.a),
        ttl: fx.ttl,
        colorHint: fx.colorHint,
      };
      if (fx.ownerId !== undefined) out.ownerId = fx.ownerId;
      if (fx.b !== undefined) out.b = cloneVec(fx.b);
      if (fx.radius !== undefined) out.radius = fx.radius;
      if (fx.spell !== undefined) out.spell = fx.spell;
      if (fx.reactionName !== undefined) out.reactionName = fx.reactionName;
      return out;
    }),
  };
}
