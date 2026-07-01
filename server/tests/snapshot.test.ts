import { describe, it, expect } from 'vitest';
import { createWorld, step, type World } from '@acm/shared';
import { toSnapshot } from '../src/snapshot';

function pyroSolo(): World {
  return createWorld([{ id: 'p1', name: 'Alice', classId: 'pyro' }]);
}

describe('toSnapshot', () => {
  it('carries top-level world fields', () => {
    const w = pyroSolo();
    w.time = 12.5;
    w.wave = 3;
    w.score = 420;
    const snap = toSnapshot(w);
    expect(snap.time).toBe(12.5);
    expect(snap.wave).toBe(3);
    expect(snap.score).toBe(420);
    expect(snap.status).toBe('playing');
  });

  it('carries levelId (which level/world the room is on)', () => {
    const w = pyroSolo();
    w.levelId = 1;
    expect(toSnapshot(w).levelId).toBe(1);
  });

  it('serializes player gameplay fields including class/downed/revive/shield', () => {
    const w = pyroSolo();
    const p = w.players[0];
    p.classId = 'warden';
    p.downed = true;
    p.reviveProgress = 0.42;
    p.shieldUntil = 9.9;
    p.facing = 1.23;
    p.hp = 37;
    const snap = toSnapshot(w);
    expect(snap.players).toHaveLength(1);
    const sp = snap.players[0];
    expect(sp.id).toBe('p1');
    expect(sp.name).toBe('Alice');
    expect(sp.classId).toBe('warden');
    expect(sp.pos).toEqual(p.pos);
    expect(sp.facing).toBe(1.23);
    expect(sp.hp).toBe(37);
    expect(sp.maxHp).toBe(p.maxHp);
    expect(sp.alive).toBe(true);
    expect(sp.downed).toBe(true);
    expect(sp.reviveProgress).toBeCloseTo(0.42);
    expect(sp.shieldUntil).toBeCloseTo(9.9);
  });

  it('omits server-only player fields (connected, bleedout, respawn)', () => {
    const w = pyroSolo();
    const sp = toSnapshot(w).players[0];
    expect(sp).not.toHaveProperty('connected');
    expect(sp).not.toHaveProperty('bleedoutAt');
    expect(sp).not.toHaveProperty('respawnAtWave');
  });

  it('includes per-player cooldowns (for skill-cooldown HUD)', () => {
    const w = pyroSolo();
    const sp = toSnapshot(w).players[0];
    expect(sp).toHaveProperty('cooldowns');
    expect(typeof sp.cooldowns).toBe('object');
  });

  it('serializes enemies with id/pos/hp/slowUntil/radius', () => {
    const w = pyroSolo();
    w.enemies.push({
      id: 5, pos: { x: 10, y: 20 }, hp: 30, speed: 60,
      slowUntil: 4.5, radius: 12, targetId: 'p1', element: 'normal',
    });
    const se = toSnapshot(w).enemies[0];
    expect(se.id).toBe(5);
    expect(se.pos).toEqual({ x: 10, y: 20 });
    expect(se.hp).toBe(30);
    expect(se.slowUntil).toBe(4.5);
    expect(se.radius).toBe(12);
  });

  it('serializes projectiles with id/spell/pos (and radius)', () => {
    const w = pyroSolo();
    w.projectiles.push({
      id: 9, spell: 'fireball', ownerId: 'p1',
      pos: { x: 100, y: 200 }, vel: { x: 1, y: 0 },
      damage: 30, radius: 8, ttl: 1.5,
    });
    const sp = toSnapshot(w).projectiles[0];
    expect(sp.id).toBe(9);
    expect(sp.spell).toBe('fireball');
    expect(sp.pos).toEqual({ x: 100, y: 200 });
    expect(sp.radius).toBe(8);
  });

  it('passes effects through', () => {
    const w = pyroSolo();
    w.effects.push({
      id: 1, kind: 'blast', a: { x: 5, y: 5 }, radius: 60,
      ttl: 0.3, colorHint: '#ff8c1a',
    });
    const snap = toSnapshot(w);
    expect(snap.effects).toHaveLength(1);
    expect(snap.effects[0].kind).toBe('blast');
    expect(snap.effects[0].colorHint).toBe('#ff8c1a');
  });

  it('is a structural clone that survives JSON round-trip (no functions/refs)', () => {
    const w = createWorld([
      { id: 'p1', name: 'Alice', classId: 'pyro' },
      { id: 'p2', name: 'Bob', classId: 'warden' },
    ]);
    step(w, [{ kind: 'cast', playerId: 'p1', spell: 'fireball' }], 0.05, () => 0);
    const snap = toSnapshot(w);
    const round = JSON.parse(JSON.stringify(snap));
    expect(round).toEqual(snap);
    expect(round.players).toHaveLength(2);
  });
});
