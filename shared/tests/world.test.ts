// shared/tests/world.test.ts — multiplayer world (Task A4)
import { describe, it, expect } from 'vitest';
import { createWorld, createSoloWorld, step } from '../src/world';
import { CONFIG } from '../src/config';
import { CLASSES } from '../src/classes';
import { SPELLS } from '../src/spells';
import { Enemy, Player, World } from '../src/types';

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    id: 999, pos: { x: 0, y: 0 }, hp: 30, speed: 0,
    slowUntil: 0, radius: CONFIG.enemy.radius, targetId: null, ...over,
  };
}

function findPlayer(w: World, id: string): Player {
  const p = w.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`player ${id} not found`);
  return p;
}

describe('createWorld', () => {
  it('builds a Player per entry with playing status and empty arenas', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'warden' },
    ]);
    expect(w.status).toBe('playing');
    expect(w.players.length).toBe(2);
    expect(w.enemies).toEqual([]);
    expect(w.projectiles).toEqual([]);
    expect(w.effects).toEqual([]);
    expect(w.wave).toBe(0);
    expect(w.score).toBe(0);
    expect(w.time).toBe(0);
  });

  it('applies class hp modifier to maxHp and starts at full hp, alive, connected', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'warden' },
    ]);
    const ana = findPlayer(w, 'a');
    const bo = findPlayer(w, 'b');
    expect(ana.maxHp).toBe(CONFIG.player.maxHp * CLASSES.pyro.hpMod);
    expect(bo.maxHp).toBe(CONFIG.player.maxHp * CLASSES.warden.hpMod);
    expect(ana.hp).toBe(ana.maxHp);
    expect(bo.hp).toBe(bo.maxHp);
    for (const p of w.players) {
      expect(p.alive).toBe(true);
      expect(p.downed).toBe(false);
      expect(p.connected).toBe(true);
    }
  });

  it('gives every player distinct spawn positions and all spells off cooldown', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
      { id: 'c', name: 'Cy', classId: 'storm' },
    ]);
    const keys = w.players.map((p) => `${p.pos.x},${p.pos.y}`);
    expect(new Set(keys).size).toBe(w.players.length);
    for (const p of w.players) {
      for (const cd of Object.values(p.cooldowns)) expect(cd).toBe(0);
    }
  });

  it('createSoloWorld wraps a single pyro player by default', () => {
    const w = createSoloWorld();
    expect(w.players.length).toBe(1);
    expect(w.players[0].classId).toBe('pyro');
    expect(w.players[0].id).toBe('local');
    const wc = createSoloWorld('warden');
    expect(wc.players[0].classId).toBe('warden');
  });
});

describe('step — movement & facing', () => {
  it('moves the addressed player by speed * dt and sets facing', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    const aStart = a.pos.x;
    const bStart = b.pos.x;
    step(w, [
      { kind: 'move', playerId: 'a', dir: { x: 1, y: 0 } },
      { kind: 'face', playerId: 'a', angle: 1.23 },
    ], 0.5);
    expect(a.pos.x).toBeCloseTo(aStart + CONFIG.player.speed * 0.5);
    expect(a.facing).toBeCloseTo(1.23);
    expect(b.pos.x).toBeCloseTo(bStart); // unaddressed player did not move
  });

  it('ignores move/face for a downed player', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.downed = true;
    const startX = p.pos.x;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 0.5);
    expect(p.pos.x).toBeCloseTo(startX);
  });

  it('ignores move for a dead (!alive) player', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.alive = false;
    const startX = p.pos.x;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 0.5);
    expect(p.pos.x).toBeCloseTo(startX);
  });

  it('clamps the player inside the arena', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    for (let i = 0; i < 200; i++) {
      step(w, [{ kind: 'move', playerId: 'local', dir: { x: -1, y: 0 } }], 0.1);
    }
    expect(p.pos.x).toBeGreaterThanOrEqual(CONFIG.player.radius);
  });
});

describe('step — cooldown + class gating', () => {
  it('ignores a spell not in the player class loadout', () => {
    const w = createSoloWorld('warden'); // warden cannot cast fireball
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(0);
    expect(w.players[0].cooldowns.fireball).toBe(0); // never set
  });

  it('sets cooldown to time + def.cooldown and blocks an immediate repeat', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.players[0].cooldowns.fireball).toBeCloseTo(w.time + SPELLS.fireball.cooldown);
    expect(w.projectiles.length).toBe(1);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016); // still on cooldown
    expect(w.projectiles.length).toBe(1); // no second projectile
  });

  it('a downed player cannot cast', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].downed = true;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(0);
  });
});

describe('step — fireball, projectile update, no friendly fire', () => {
  it('spawns a projectile carrying ownerId travelling along facing', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].facing = 0; // +x
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].ownerId).toBe('local');
    expect(w.projectiles[0].vel.x).toBeGreaterThan(0);
  });

  it('damages an enemy in its path, scores the kill, and spawns a blast effect', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    let sawBlast = false;
    for (let i = 0; i < 30; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) sawBlast = true;
    }
    expect(w.enemies.length).toBe(0);
    expect(w.score).toBe(1);
    expect(sawBlast).toBe(true); // a blast effect was spawned at the explosion
  });

  it('never damages allies caught in a fireball explosion (no friendly fire)', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.facing = 0;
    // ally stands inside the blast radius but NOT in contact with the enemy,
    // so any hp loss could only come from the explosion (which must not hurt allies)
    b.pos = { x: a.pos.x + 70, y: a.pos.y };
    const allyHp = b.hp;
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: a.pos.x + 30, y: a.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'fireball' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016);
    expect(w.enemies.length).toBe(0);   // enemy killed by the blast
    expect(b.hp).toBe(allyHp);          // ally completely unhurt by the explosion
  });
});

describe('step — frost (fan + slow) and holybolt (single projectile)', () => {
  it('frost spawns a fan of projectiles and slows + damages what it hits', () => {
    const w = createSoloWorld('cryo');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'frost' }], 0.016);
    expect(w.projectiles.length).toBe(CONFIG.frost.count);
    for (const proj of w.projectiles) expect(proj.ownerId).toBe('local');
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].slowUntil).toBeGreaterThan(w.time);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });

  it('holybolt spawns a single projectile that damages an enemy', () => {
    const w = createSoloWorld('warden');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'holybolt' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].spell).toBe('holybolt');
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });

  it('frost from one player never harms an ally standing in the line', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'cryo' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.facing = 0;
    b.pos = { x: a.pos.x + 30, y: a.pos.y };
    const allyHp = b.hp;
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'frost' }], 0.016);
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(b.hp).toBe(allyHp);
  });
});

describe('step — gameover guard', () => {
  it('does not advance time once game over', () => {
    const w = createSoloWorld('pyro');
    w.status = 'gameover';
    const t = w.time;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 1);
    expect(w.time).toBe(t);
  });
});
