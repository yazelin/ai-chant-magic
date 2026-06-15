// Pure snapshot-interpolation buffer (spec §15.1: no client prediction — ALL
// entities, including self, are rendered from a buffer ~100ms behind the most
// recent snapshot). Kept dependency-free (no Phaser, no ws) so it is unit
// testable with synthetic snapshots + an injected clock.
//
// The wire `Snapshot` shape is mirrored here structurally (the server defines
// the source of truth in server/src/snapshot.ts; the client must speak the same
// JSON but must not import across the server workspace boundary). The buffer
// turns sampled snapshots into a `World`-shaped object so GameScene / Hud — both
// written against `World` — can consume the interpolated result unchanged.

import {
  Vec2,
  World,
  Player,
  Enemy,
  Projectile,
  TransientEffect,
  ClassId,
  SpellId,
  EffectKind,
  GameStatus,
} from '@acm/shared';

// --- wire shape (must match server/src/snapshot.ts exactly) -----------------

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
}

export interface SnapshotEnemy {
  id: number;
  pos: Vec2;
  hp: number;
  slowUntil: number;
  radius: number;
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
}

export interface Snapshot {
  time: number;
  status: GameStatus;
  wave: number;
  score: number;
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  projectiles: SnapshotProjectile[];
  effects: SnapshotEffect[];
}

// How far behind the newest snapshot we render (ms). Two 50ms snapshots back.
export const RENDER_DELAY_MS = 100;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// Build the parts of a `World` Player that the renderer/HUD read. The wire
// Snapshot omits server-only fields (cooldowns/connected/bleedoutAt/
// respawnAtWave); fill them with renderer-safe defaults. `connected: true`
// because any player present in a snapshot should be drawn.
function toWorldPlayer(sp: SnapshotPlayer, pos: Vec2, facing: number): Player {
  return {
    id: sp.id,
    name: sp.name,
    classId: sp.classId,
    pos,
    facing,
    hp: sp.hp,
    maxHp: sp.maxHp,
    alive: sp.alive,
    downed: sp.downed,
    bleedoutAt: 0,
    reviveProgress: sp.reviveProgress,
    respawnAtWave: 0,
    shieldUntil: sp.shieldUntil,
    cooldowns: {} as Record<SpellId, number>,
    connected: true,
  };
}

function toWorldEnemy(se: SnapshotEnemy, pos: Vec2): Enemy {
  return {
    id: se.id,
    pos,
    hp: se.hp,
    speed: 0,
    slowUntil: se.slowUntil,
    radius: se.radius,
    targetId: null,
  };
}

function toWorldProjectile(spr: SnapshotProjectile, pos: Vec2): Projectile {
  return {
    id: spr.id,
    spell: spr.spell,
    ownerId: '',
    pos,
    vel: { x: 0, y: 0 },
    damage: 0,
    radius: spr.radius,
    ttl: 0,
  };
}

function toWorldEffect(fx: SnapshotEffect): TransientEffect {
  const out: TransientEffect = {
    id: fx.id,
    kind: fx.kind,
    a: { x: fx.a.x, y: fx.a.y },
    ttl: fx.ttl,
    colorHint: fx.colorHint,
  };
  if (fx.ownerId !== undefined) out.ownerId = fx.ownerId;
  if (fx.b !== undefined) out.b = { x: fx.b.x, y: fx.b.y };
  if (fx.radius !== undefined) out.radius = fx.radius;
  return out;
}

// Empty world skeleton (used when the buffer has nothing yet). Renderer-safe.
export function emptyWorld(): World {
  return {
    time: 0,
    status: 'lobby',
    players: [],
    enemies: [],
    projectiles: [],
    effects: [],
    nextEntityId: 0,
    wave: 0,
    score: 0,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: 0,
    breakTimer: 0,
  };
}

function snapshotToWorld(s: Snapshot): World {
  return {
    time: s.time,
    status: s.status,
    players: s.players.map((p) => toWorldPlayer(p, { x: p.pos.x, y: p.pos.y }, p.facing)),
    enemies: s.enemies.map((e) => toWorldEnemy(e, { x: e.pos.x, y: e.pos.y })),
    projectiles: s.projectiles.map((pr) => toWorldProjectile(pr, { x: pr.pos.x, y: pr.pos.y })),
    effects: s.effects.map(toWorldEffect),
    nextEntityId: 0,
    wave: s.wave,
    score: s.score,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: 0,
    breakTimer: 0,
  };
}

// Pure positional interpolation between two snapshots at fraction `alpha` (0..1).
// Positions (players/enemies/projectiles) lerp; everything else (effects, hp,
// status, wave, score, facing/down/shield etc.) passes through from `next`.
// Entities are matched by id: an entity missing from `next` is dropped; an
// entity new in `next` pops in (rendered at its `next` position).
export function interpolate(prev: Snapshot, next: Snapshot, alpha: number): World {
  const t = Math.max(0, Math.min(1, alpha));

  const prevPlayers = new Map(prev.players.map((p) => [p.id, p]));
  const players = next.players.map((np) => {
    const pp = prevPlayers.get(np.id);
    const pos = pp ? lerpVec(pp.pos, np.pos, t) : { x: np.pos.x, y: np.pos.y };
    return toWorldPlayer(np, pos, np.facing);
  });

  const prevEnemies = new Map(prev.enemies.map((e) => [e.id, e]));
  const enemies = next.enemies.map((ne) => {
    const pe = prevEnemies.get(ne.id);
    const pos = pe ? lerpVec(pe.pos, ne.pos, t) : { x: ne.pos.x, y: ne.pos.y };
    return toWorldEnemy(ne, pos);
  });

  const prevProj = new Map(prev.projectiles.map((p) => [p.id, p]));
  const projectiles = next.projectiles.map((npr) => {
    const ppr = prevProj.get(npr.id);
    const pos = ppr ? lerpVec(ppr.pos, npr.pos, t) : { x: npr.pos.x, y: npr.pos.y };
    return toWorldProjectile(npr, pos);
  });

  return {
    time: lerp(prev.time, next.time, t),
    status: next.status,
    players,
    enemies,
    projectiles,
    effects: next.effects.map(toWorldEffect),
    nextEntityId: 0,
    wave: next.wave,
    score: next.score,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: 0,
    breakTimer: 0,
  };
}

interface Stamped {
  recvMs: number;
  snap: Snapshot;
}

// Rolling buffer of the most recent snapshots, each stamped with its local
// receive time. `sample(renderTimeMs)` finds the two snapshots straddling the
// render time (= now - RENDER_DELAY_MS) and returns the interpolated World.
export class SnapshotBuffer {
  private buf: Stamped[] = [];
  private readonly max: number;

  constructor(private now: () => number = () => Date.now(), max = 3) {
    this.max = Math.max(2, max);
  }

  push(snap: Snapshot, recvMs: number = this.now()): void {
    this.buf.push({ recvMs, snap });
    while (this.buf.length > this.max) this.buf.shift();
  }

  size(): number {
    return this.buf.length;
  }

  latest(): Snapshot | null {
    return this.buf.length ? this.buf[this.buf.length - 1].snap : null;
  }

  // Interpolated World at the given local render time (defaults to now).
  sample(renderTimeMs: number = this.now() - RENDER_DELAY_MS): World {
    if (this.buf.length === 0) return emptyWorld();
    if (this.buf.length === 1) return snapshotToWorld(this.buf[0].snap);

    // Find the adjacent pair [prev, next] whose receive times straddle render.
    for (let i = 0; i < this.buf.length - 1; i++) {
      const a = this.buf[i];
      const b = this.buf[i + 1];
      if (renderTimeMs >= a.recvMs && renderTimeMs <= b.recvMs) {
        const span = b.recvMs - a.recvMs;
        const alpha = span > 0 ? (renderTimeMs - a.recvMs) / span : 1;
        return interpolate(a.snap, b.snap, alpha);
      }
    }

    // Render time before the oldest buffered snapshot: clamp to oldest.
    if (renderTimeMs < this.buf[0].recvMs) {
      return snapshotToWorld(this.buf[0].snap);
    }
    // Render time past the newest (we have not received a newer one yet): hold
    // on the latest snapshot rather than extrapolate.
    return snapshotToWorld(this.buf[this.buf.length - 1].snap);
  }
}
