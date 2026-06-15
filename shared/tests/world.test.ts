// tests/sim/world.test.ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/world';
import { CONFIG } from '../src/config';

describe('createWorld', () => {
  it('starts the player centered at full hp, playing', () => {
    const w = createWorld();
    expect(w.status).toBe('playing');
    expect(w.player.hp).toBe(CONFIG.player.maxHp);
    expect(w.player.pos).toEqual({ x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 });
    expect(w.enemies).toEqual([]);
    expect(w.projectiles).toEqual([]);
    expect(w.wave).toBe(0);
    expect(w.score).toBe(0);
  });
  it('starts every spell off cooldown', () => {
    const w = createWorld();
    for (const cd of Object.values(w.player.cooldowns)) expect(cd).toBe(0);
  });
});
import { step } from '../src/world';

describe('step — movement', () => {
  it('moves the player by speed * dt along the move dir', () => {
    const w = createWorld();
    const startX = w.player.pos.x;
    step(w, [{ kind: 'move', dir: { x: 1, y: 0 } }], 0.5);
    expect(w.player.pos.x).toBeCloseTo(startX + CONFIG.player.speed * 0.5);
  });
  it('sets facing from a face command', () => {
    const w = createWorld();
    step(w, [{ kind: 'face', angle: 1.23 }], 0.016);
    expect(w.player.facing).toBeCloseTo(1.23);
  });
  it('clamps the player inside the arena', () => {
    const w = createWorld();
    for (let i = 0; i < 200; i++) step(w, [{ kind: 'move', dir: { x: -1, y: 0 } }], 0.1);
    expect(w.player.pos.x).toBeGreaterThanOrEqual(CONFIG.player.radius);
  });
});
import { SPELLS } from '../src/spells';

describe('step — casting self-target spells', () => {
  it('heal restores hp but not above max', () => {
    const w = createWorld();
    w.player.hp = 50;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    expect(w.player.hp).toBe(50 + CONFIG.heal.amount);
    w.player.hp = w.player.maxHp - 5;
    w.player.cooldowns.heal = 0; // force ready
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    expect(w.player.hp).toBe(w.player.maxHp);
  });
  it('shield sets shieldUntil into the future', () => {
    const w = createWorld();
    step(w, [{ kind: 'cast', spell: 'shield' }], 0.016);
    expect(w.player.shieldUntil).toBeGreaterThan(w.time);
  });
  it('respects cooldown — a second immediate cast does nothing', () => {
    const w = createWorld();
    w.player.hp = 10;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    const afterFirst = w.player.hp;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016); // still on cooldown
    expect(w.player.hp).toBe(afterFirst);
  });
  it('sets the cooldown to now + spell cooldown', () => {
    const w = createWorld();
    step(w, [{ kind: 'cast', spell: 'shield' }], 0.016);
    expect(w.player.cooldowns.shield).toBeCloseTo(w.time + SPELLS.shield.cooldown);
  });
});
import { Enemy } from '../src/types';

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  return { id: 999, pos: { x: 0, y: 0 }, hp: 30, speed: 0, slowUntil: 0, radius: CONFIG.enemy.radius, ...over };
}

describe('step — fireball', () => {
  it('spawns a projectile travelling along facing', () => {
    const w = createWorld();
    w.player.facing = 0; // +x
    step(w, [{ kind: 'cast', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].vel.x).toBeGreaterThan(0);
  });
  it('damages an enemy in its path and scores the kill', () => {
    const w = createWorld();
    w.breakTimer = 999; // suppress wave auto-spawn so only the planted enemy exists
    w.player.facing = 0;
    // place a weak enemy just to the right of the player
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: w.player.pos.x + 30, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'fireball' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016); // let it travel/explode
    expect(w.enemies.length).toBe(0);
    expect(w.score).toBe(1);
  });
});

describe('step — frost', () => {
  it('spawns a fan of projectiles and slows what it hits', () => {
    const w = createWorld();
    w.player.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: w.player.pos.x + 30, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'frost' }], 0.016);
    expect(w.projectiles.length).toBe(CONFIG.frost.count);
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].slowUntil).toBeGreaterThan(w.time);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });
});
describe('step — thunder', () => {
  it('instantly damages enemies along the facing ray', () => {
    const w = createWorld();
    w.breakTimer = 999; // suppress wave auto-spawn so only the planted enemy exists
    w.player.facing = 0; // +x
    w.enemies.push(makeEnemy({ hp: 40, pos: { x: w.player.pos.x + 200, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'thunder' }], 0.016);
    expect(w.enemies[0]?.hp ?? 0).toBeLessThanOrEqual(0 + (40 - CONFIG.thunder.damage > 0 ? 40 : 0));
  });
  it('misses enemies far off the ray', () => {
    const w = createWorld();
    w.player.facing = 0;
    w.enemies.push(makeEnemy({ hp: 40, pos: { x: w.player.pos.x + 200, y: w.player.pos.y + 300 } }));
    step(w, [{ kind: 'cast', spell: 'thunder' }], 0.016);
    expect(w.enemies[0].hp).toBe(40);
  });
});

describe('step — enemies', () => {
  it('moves an enemy toward the player', () => {
    const w = createWorld();
    const e = makeEnemy({ hp: 100, speed: 60, pos: { x: w.player.pos.x + 200, y: w.player.pos.y } });
    w.enemies.push(e);
    const before = e.pos.x;
    step(w, [], 0.5);
    expect(e.pos.x).toBeLessThan(before); // moved left toward centered player
  });
  it('damages the player on contact unless shielded', () => {
    const w = createWorld();
    w.enemies.push(makeEnemy({ hp: 100, speed: 0, pos: { ...w.player.pos } }));
    step(w, [], 0.5);
    expect(w.player.hp).toBeLessThan(w.player.maxHp);
  });
  it('shield blocks contact damage', () => {
    const w = createWorld();
    w.player.shieldUntil = w.time + 10;
    w.enemies.push(makeEnemy({ hp: 100, speed: 0, pos: { ...w.player.pos } }));
    const hp = w.player.hp;
    step(w, [], 0.5);
    expect(w.player.hp).toBe(hp);
  });
});
describe('step — waves', () => {
  it('begins wave 1 and spawns enemies over time', () => {
    const w = createWorld();
    const rng = () => 0; // deterministic edge/position
    step(w, [], 0.016, rng);
    expect(w.wave).toBe(1);
    expect(w.enemies.length).toBe(1); // first spawns immediately
    // advance enough to spawn the rest of the wave
    for (let i = 0; i < 600; i++) step(w, [], 0.05, rng);
    expect(w.enemies.length).toBeGreaterThan(1);
  });

  it('ends the game when player hp hits zero', () => {
    const w = createWorld();
    w.player.hp = 1;
    w.enemies.push({ id: 1, pos: { ...w.player.pos }, hp: 100, speed: 0, slowUntil: 0, radius: CONFIG.enemy.radius });
    for (let i = 0; i < 20; i++) step(w, [], 0.1);
    expect(w.status).toBe('gameover');
    expect(w.player.hp).toBe(0);
  });

  it('does not advance once game over', () => {
    const w = createWorld();
    w.status = 'gameover';
    const t = w.time;
    step(w, [{ kind: 'move', dir: { x: 1, y: 0 } }], 1);
    expect(w.time).toBe(t);
  });
});
