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
