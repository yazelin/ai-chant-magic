import { describe, it, expect } from 'vitest';
import { LocalSession } from '../src/session/LocalSession';
import { mulberry32 } from '@acm/shared';

describe('LocalSession', () => {
  it('builds a solo world for the chosen class with one self player', () => {
    const s = new LocalSession('cryo');
    s.start();
    const w = s.getWorld();
    expect(w.players).toHaveLength(1);
    expect(w.players[0].id).toBe(s.getSelfId());
    expect(w.players[0].classId).toBe('cryo');
  });

  it('sendCast(爆裂魔法) for a pyro spawns a projectile after a chant charge', () => {
    const s = new LocalSession('pyro');
    s.start();
    s.getWorld().breakTimer = 999; // isolate from wave auto-spawn
    s.sendFace(0);
    s.sendCast('chant1');   // +1 爆裂 charge (no cooldown)
    s.sendCast('firestorm');
    s.tick(0.05);
    const w = s.getWorld();
    expect(w.projectiles.length).toBeGreaterThan(0);
    expect(w.projectiles[0].spell).toBe('firestorm');
    expect(w.projectiles[0].ownerId).toBe(s.getSelfId());
  });

  it('a cast can damage an enemy as ticks advance', () => {
    const s = new LocalSession('pyro');
    s.start();
    const w = s.getWorld();
    w.breakTimer = 999; // no new spawns
    const self = w.players[0];
    self.pos = { x: 100, y: 100 };
    // put an enemy straight ahead (to the right) within 爆裂 reach
    w.enemies.push({
      id: 9001, pos: { x: 220, y: 100 }, hp: 30, speed: 0,
      slowUntil: 0, radius: 12, targetId: null, element: 'normal',
    });
    const startHp = w.enemies[0].hp;
    s.sendFace(0); // face +x
    s.sendCast('chant1');   // charge then 爆裂
    s.sendCast('firestorm');
    for (let i = 0; i < 20; i++) s.tick(0.05); // let the projectile travel + explode
    // either the enemy took damage or was killed (removed) — both prove a hit
    const survivor = w.enemies.find((e) => e.id === 9001);
    expect(survivor === undefined || survivor.hp < startHp).toBe(true);
  });

  it('sendMove moves the self player', () => {
    const s = new LocalSession('pyro');
    s.start();
    const w = s.getWorld();
    w.breakTimer = 999;
    const before = { ...w.players[0].pos };
    s.sendMove({ x: 1, y: 0 });
    s.tick(0.05);
    expect(w.players[0].pos.x).toBeGreaterThan(before.x);
    expect(w.players[0].pos.y).toBeCloseTo(before.y);
  });

  it('respects per-class loadout via the shared sim (warden cannot cast fireball)', () => {
    const s = new LocalSession('warden');
    s.start();
    s.getWorld().breakTimer = 999;
    s.sendCast('fireball'); // not in warden loadout
    s.tick(0.05);
    expect(s.getWorld().projectiles).toHaveLength(0);
  });

  it('notifies onWorld subscribers each tick', () => {
    const s = new LocalSession('pyro');
    let calls = 0;
    s.onWorld(() => { calls += 1; });
    s.start();
    s.tick(0.05);
    s.tick(0.05);
    expect(calls).toBeGreaterThanOrEqual(3); // start + 2 ticks
  });

  it('enterEndless() flips a victory world back to playing with endless=true, preserving player hp', () => {
    const s = new LocalSession('pyro');
    s.start();
    const w = s.getWorld();
    w.status = 'victory';
    w.players[0].hp = 42;
    s.enterEndless();
    expect(w.status).toBe('playing');
    expect(w.endless).toBe(true);
    expect(w.players[0].hp).toBe(42);
  });

  it('endEndless() ends an active endless run like a wipe (status gameover)', () => {
    const s = new LocalSession('pyro');
    s.start();
    s.getWorld().status = 'victory';
    s.enterEndless();
    s.endEndless();
    expect(s.getWorld().status).toBe('gameover');
  });

  it('sendResonance() is inert solo (a single player can never reach 2 distinct callers)', () => {
    const s = new LocalSession('pyro');
    s.start();
    s.getWorld().breakTimer = 999;
    s.sendResonance();
    s.tick(0.05);
    s.sendResonance();
    s.tick(0.05);
    expect(s.getWorld().players[0].shieldUntil).toBe(0);
  });

  it('enterEndless()/endEndless() notify onWorld subscribers', () => {
    const s = new LocalSession('pyro');
    let calls = 0;
    s.onWorld(() => { calls += 1; });
    s.start();
    s.getWorld().status = 'victory';
    const before = calls;
    s.enterEndless();
    expect(calls).toBeGreaterThan(before);
    const afterEnter = calls;
    s.endEndless();
    expect(calls).toBeGreaterThan(afterEnter);
  });

  it('two sessions built with the same seeded rng spawn identical enemies (週挑戰 fairness)', () => {
    const s1 = new LocalSession('pyro', mulberry32(42));
    s1.start();
    for (let i = 0; i < 300; i++) s1.tick(0.05);

    const s2 = new LocalSession('pyro', mulberry32(42));
    s2.start();
    for (let i = 0; i < 300; i++) s2.tick(0.05);

    const summarize = (s: LocalSession) =>
      s.getWorld().enemies.map((e) => ({ x: e.pos.x, y: e.pos.y, element: e.element }));
    expect(summarize(s1)).toEqual(summarize(s2));
    expect(s1.getWorld().enemies.length).toBeGreaterThan(0); // sanity: something actually spawned
  });

  it('a different seed produces a different enemy layout (not a no-op parameter)', () => {
    const s1 = new LocalSession('pyro', mulberry32(1));
    s1.start();
    for (let i = 0; i < 300; i++) s1.tick(0.05);

    const s2 = new LocalSession('pyro', mulberry32(2));
    s2.start();
    for (let i = 0; i < 300; i++) s2.tick(0.05);

    const summarize = (s: LocalSession) => s.getWorld().enemies.map((e) => e.pos.x);
    expect(summarize(s1)).not.toEqual(summarize(s2));
  });

  it('defaults to Math.random when no rng is passed (backward compatible)', () => {
    const s = new LocalSession('pyro');
    s.start();
    expect(() => s.tick(0.05)).not.toThrow();
  });

  it('an optional startInEndless flag begins directly in endless mode (skips the campaign unlock gate)', () => {
    const s = new LocalSession('pyro', Math.random, true);
    s.start();
    const w = s.getWorld();
    expect(w.endless).toBe(true);
    expect(w.status).toBe('playing');
    expect(w.wave).toBe(0);
  });

  it('startInEndless also re-applies after restart() (週挑戰 retry stays in endless, not back to campaign)', () => {
    const s = new LocalSession('pyro', Math.random, true);
    s.start();
    s.restart('cryo');
    const w = s.getWorld();
    expect(w.endless).toBe(true);
    expect(w.players[0].classId).toBe('cryo');
  });

  it('without startInEndless (default), a fresh session/restart is the normal campaign', () => {
    const s = new LocalSession('pyro');
    s.start();
    expect(s.getWorld().endless).toBe(false);
  });
});
