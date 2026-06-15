import { describe, it, expect } from 'vitest';
import { LocalSession } from '../src/session/LocalSession';

describe('LocalSession', () => {
  it('builds a solo world for the chosen class with one self player', () => {
    const s = new LocalSession('cryo');
    s.start();
    const w = s.getWorld();
    expect(w.players).toHaveLength(1);
    expect(w.players[0].id).toBe(s.getSelfId());
    expect(w.players[0].classId).toBe('cryo');
  });

  it('sendCast(fireball) for a pyro spawns a projectile on the next tick', () => {
    const s = new LocalSession('pyro');
    s.start();
    s.getWorld().breakTimer = 999; // isolate from wave auto-spawn
    s.sendFace(0);
    s.sendCast('fireball');
    s.tick(0.05);
    const w = s.getWorld();
    expect(w.projectiles.length).toBeGreaterThan(0);
    expect(w.projectiles[0].spell).toBe('fireball');
    expect(w.projectiles[0].ownerId).toBe(s.getSelfId());
  });

  it('a cast can damage an enemy as ticks advance', () => {
    const s = new LocalSession('pyro');
    s.start();
    const w = s.getWorld();
    w.breakTimer = 999; // no new spawns
    const self = w.players[0];
    self.pos = { x: 100, y: 100 };
    // put an enemy straight ahead (to the right) within fireball reach
    w.enemies.push({
      id: 9001, pos: { x: 220, y: 100 }, hp: 30, speed: 0,
      slowUntil: 0, radius: 12, targetId: null,
    });
    const startHp = w.enemies[0].hp;
    s.sendFace(0); // face +x
    s.sendCast('fireball');
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
});
