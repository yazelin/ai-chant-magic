// tests/sim/world.test.ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim/world';
import { CONFIG } from '../../src/sim/config';

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
import { step } from '../../src/sim/world';

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
import { SPELLS } from '../../src/sim/spells';

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
