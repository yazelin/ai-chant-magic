import { describe, it, expect } from 'vitest';
import {
  interpolate,
  SnapshotBuffer,
  RENDER_DELAY_MS,
  Snapshot,
} from '../src/net/interp';

// Minimal synthetic snapshot builder. Positions are what we assert on; the rest
// is filler that must pass through unchanged.
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    time: 0,
    status: 'playing',
    wave: 1,
    score: 0,
    levelId: 0,
    levelCleared: false,
    endless: false,
    endlessKillBase: 0,
    endlessTimeBase: 0,
    reactionCount: 0,
    players: [],
    enemies: [],
    projectiles: [],
    effects: [],
    ...over,
  };
}

function player(id: string, x: number, y: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    classId: 'pyro' as const,
    pos: { x, y },
    facing: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    downed: false,
    reviveProgress: 0,
    shieldUntil: 0,
    ...over,
  };
}

function enemy(id: number, x: number, y: number, over: Record<string, unknown> = {}) {
  return { id, pos: { x, y }, hp: 30, slowUntil: 0, radius: 12, ...over };
}

describe('interpolate', () => {
  it('lerps player position to the midpoint at alpha=0.5', () => {
    const prev = snap({ players: [player('a', 0, 0)] });
    const next = snap({ players: [player('a', 100, 40)] });
    const w = interpolate(prev, next, 0.5);
    expect(w.players).toHaveLength(1);
    expect(w.players[0].pos.x).toBeCloseTo(50);
    expect(w.players[0].pos.y).toBeCloseTo(20);
  });

  it('clamps alpha into [0,1]', () => {
    const prev = snap({ players: [player('a', 0, 0)] });
    const next = snap({ players: [player('a', 100, 0)] });
    expect(interpolate(prev, next, -1).players[0].pos.x).toBeCloseTo(0);
    expect(interpolate(prev, next, 2).players[0].pos.x).toBeCloseTo(100);
  });

  it('matches entities by id and lerps each independently', () => {
    const prev = snap({
      enemies: [enemy(1, 0, 0), enemy(2, 200, 200)],
    });
    const next = snap({
      enemies: [enemy(1, 40, 0), enemy(2, 100, 200)],
    });
    const w = interpolate(prev, next, 0.5);
    const e1 = w.enemies.find((e) => e.id === 1)!;
    const e2 = w.enemies.find((e) => e.id === 2)!;
    expect(e1.pos.x).toBeCloseTo(20);
    expect(e2.pos.x).toBeCloseTo(150);
  });

  it('drops entities missing in the newer snapshot', () => {
    const prev = snap({ enemies: [enemy(1, 0, 0), enemy(2, 0, 0)] });
    const next = snap({ enemies: [enemy(1, 50, 0)] });
    const w = interpolate(prev, next, 0.5);
    expect(w.enemies.map((e) => e.id)).toEqual([1]);
  });

  it('pops in new entities at their next position (no prev to lerp from)', () => {
    const prev = snap({ enemies: [enemy(1, 0, 0)] });
    const next = snap({ enemies: [enemy(1, 50, 0), enemy(9, 300, 300)] });
    const w = interpolate(prev, next, 0.5);
    const fresh = w.enemies.find((e) => e.id === 9)!;
    expect(fresh.pos.x).toBeCloseTo(300);
    expect(fresh.pos.y).toBeCloseTo(300);
  });

  it('passes through levelId from the newer snapshot (not lerped)', () => {
    const prev = snap({ levelId: 0 });
    const next = snap({ levelId: 1 });
    expect(interpolate(prev, next, 0.5).levelId).toBe(1);
  });

  it('passes through levelCleared from the newer snapshot', () => {
    const prev = snap({ levelCleared: false });
    const next = snap({ levelCleared: true });
    expect(interpolate(prev, next, 0.5).levelCleared).toBe(true);
  });

  it('passes through endless + endlessKillBase + endlessTimeBase from the newer snapshot', () => {
    const prev = snap({ endless: false, endlessKillBase: 0, endlessTimeBase: 0 });
    const next = snap({ endless: true, endlessKillBase: 66, endlessTimeBase: 180 });
    const w = interpolate(prev, next, 0.5);
    expect(w.endless).toBe(true);
    expect(w.endlessKillBase).toBe(66);
    expect(w.endlessTimeBase).toBe(180);
  });

  it('passes through hp/status/wave/score/effects from the newer snapshot', () => {
    const prev = snap({ wave: 1, score: 0, players: [player('a', 0, 0, { hp: 80 })] });
    const next = snap({
      wave: 3,
      score: 42,
      status: 'gameover',
      players: [player('a', 100, 0, { hp: 50 })],
      effects: [{ id: 7, kind: 'nova', a: { x: 5, y: 5 }, ttl: 0.3, colorHint: '#fff' }],
    });
    const w = interpolate(prev, next, 0.5);
    expect(w.wave).toBe(3);
    expect(w.score).toBe(42);
    expect(w.status).toBe('gameover');
    expect(w.players[0].hp).toBe(50); // hp is not lerped — taken from next
    expect(w.effects).toHaveLength(1);
    expect(w.effects[0].id).toBe(7);
  });

  it('passes through reactionCount from the newer snapshot', () => {
    const prev = snap({ reactionCount: 2 });
    const next = snap({ reactionCount: 5 });
    expect(interpolate(prev, next, 0.5).reactionCount).toBe(5);
  });

  it('carries an enemy\'s auraElement/auraUntil through (multiplayer reaction-ring tell)', () => {
    const prev = snap({ enemies: [enemy(1, 0, 0)] });
    const next = snap({ enemies: [enemy(1, 40, 0, { auraElement: 'fire', auraUntil: 12.5 })] });
    const w = interpolate(prev, next, 0.5);
    expect(w.enemies[0].auraElement).toBe('fire');
    expect(w.enemies[0].auraUntil).toBeCloseTo(12.5);
  });

  it('passes a reaction effect\'s reactionName through', () => {
    const prev = snap();
    const next = snap({
      effects: [{ id: 9, kind: 'reaction', a: { x: 1, y: 1 }, ttl: 0.3, colorHint: '#ffb27a', reactionName: '沸騰' }],
    });
    const w = interpolate(prev, next, 0.5);
    expect(w.effects[0].reactionName).toBe('沸騰');
  });
});

describe('SnapshotBuffer.sample (injected clock)', () => {
  it('returns an empty world before any snapshot', () => {
    const buf = new SnapshotBuffer(() => 1000);
    const w = buf.sample();
    expect(w.players).toHaveLength(0);
    expect(w.enemies).toHaveLength(0);
  });

  it('carries levelId through when only one snapshot is buffered', () => {
    const buf = new SnapshotBuffer(() => 1000);
    buf.push(snap({ levelId: 1 }), 500);
    expect(buf.sample().levelId).toBe(1);
  });

  it('returns the only snapshot directly when just one is buffered', () => {
    const buf = new SnapshotBuffer(() => 1000);
    buf.push(snap({ enemies: [enemy(1, 10, 10)] }), 500);
    const w = buf.sample();
    expect(w.enemies[0].pos.x).toBeCloseTo(10);
  });

  it('interpolates at the midpoint between two straddling snapshots', () => {
    let clock = 0;
    const buf = new SnapshotBuffer(() => clock);
    // snapshot received at t=0 and t=100; render time = now - 100ms
    buf.push(snap({ enemies: [enemy(1, 0, 0)] }), 0);
    buf.push(snap({ enemies: [enemy(1, 100, 0)] }), 100);
    // pick now so that renderTime = now - 100 = 50 (the midpoint of [0,100])
    clock = 150;
    expect(clock - RENDER_DELAY_MS).toBe(50);
    const w = buf.sample();
    expect(w.enemies[0].pos.x).toBeCloseTo(50);
  });

  it('interpolates a quarter of the way for the right straddling pair', () => {
    const buf = new SnapshotBuffer(() => 0);
    buf.push(snap({ enemies: [enemy(1, 0, 0)] }), 0);
    buf.push(snap({ enemies: [enemy(1, 40, 0)] }), 200);
    // explicit render time at 25% of [0,200]
    const w = buf.sample(50);
    expect(w.enemies[0].pos.x).toBeCloseTo(10);
  });

  it('selects the correct adjacent pair among three snapshots', () => {
    const buf = new SnapshotBuffer(() => 0);
    buf.push(snap({ enemies: [enemy(1, 0, 0)] }), 0);
    buf.push(snap({ enemies: [enemy(1, 100, 0)] }), 100);
    buf.push(snap({ enemies: [enemy(1, 300, 0)] }), 200);
    // render time 150 lies in [100,200] -> midpoint of 100..300 = 200
    const w = buf.sample(150);
    expect(w.enemies[0].pos.x).toBeCloseTo(200);
  });

  it('clamps to the oldest snapshot when render time precedes the buffer', () => {
    const buf = new SnapshotBuffer(() => 0);
    buf.push(snap({ enemies: [enemy(1, 5, 0)] }), 1000);
    buf.push(snap({ enemies: [enemy(1, 99, 0)] }), 1100);
    const w = buf.sample(0); // way before 1000
    expect(w.enemies[0].pos.x).toBeCloseTo(5);
  });

  it('holds on the latest snapshot when render time is past the newest', () => {
    const buf = new SnapshotBuffer(() => 0);
    buf.push(snap({ enemies: [enemy(1, 5, 0)] }), 0);
    buf.push(snap({ enemies: [enemy(1, 99, 0)] }), 100);
    const w = buf.sample(9999); // past the newest -> hold latest
    expect(w.enemies[0].pos.x).toBeCloseTo(99);
  });

  it('keeps at most ~3 snapshots (drops the oldest)', () => {
    const buf = new SnapshotBuffer(() => 0, 3);
    for (let i = 0; i < 5; i++) buf.push(snap(), i * 10);
    expect(buf.size()).toBe(3);
  });

  it('carries reactionCount and an enemy aura through snapshotToWorld (single-snapshot path — the exact path a real multiplayer client uses before a second snapshot arrives)', () => {
    const buf = new SnapshotBuffer(() => 1000);
    buf.push(snap({
      reactionCount: 3,
      enemies: [enemy(1, 10, 10, { auraElement: 'ice', auraUntil: 9.1 })],
    }), 500);
    const w = buf.sample();
    expect(w.reactionCount).toBe(3);
    expect(w.enemies[0].auraElement).toBe('ice');
    expect(w.enemies[0].auraUntil).toBeCloseTo(9.1);
  });
});
