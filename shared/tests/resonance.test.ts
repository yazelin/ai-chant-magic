// shared/tests/resonance.test.ts — 共鳴詠唱: 2+ distinct players calling
// "resonance" within a short sync window grant the whole party a shield +
// heal-over-time burst. Solo has only one player, so it can never trigger
// there — this is deliberately a multiplayer-only coordination reward.
// See shared/src/world.ts's updateResonance()/CONFIG.resonance.
import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/world';
import { CONFIG } from '../src/config';
import type { World, Command } from '../src/types';

// breakTimer=999 isolates from wave auto-spawn (established pattern elsewhere
// in this test suite) — without it, idling many ticks lets real enemies
// spawn and down/kill the players, which would confound these assertions.
function twoPlayerWorld(): World {
  const w = createWorld([
    { id: 'a', name: 'A', classId: 'pyro' },
    { id: 'b', name: 'B', classId: 'cryo' },
  ]);
  w.breakTimer = 999;
  return w;
}

function call(playerId: string): Command {
  return { kind: 'resonance', playerId };
}

describe('resonance — sync window + party buff', () => {
  it('a single caller alone does not trigger the buff', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
    expect(w.players[0].healUntil ?? 0).toBe(0);
  });

  it('two DIFFERENT players calling within the sync window triggers the buff for the whole party', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    for (const p of w.players) {
      expect(p.shieldUntil).toBeGreaterThan(w.time);
      expect(p.healUntil ?? 0).toBeGreaterThan(w.time);
      expect(p.healRate).toBe(CONFIG.resonance.healRate);
    }
  });

  it('the same player calling twice does not count as two distinct callers', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('a')], 0.05);
    step(w, [call('a')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
  });

  it('pushes a resonance TransientEffect when it triggers', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    expect(w.effects.some((e) => e.kind === 'resonance')).toBe(true);
  });

  it('shieldUntil/healUntil are set exactly CONFIG.resonance durations ahead of world.time', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    const expectedShield = w.time + CONFIG.resonance.shieldDuration;
    const expectedHeal = w.time + CONFIG.resonance.healDuration;
    expect(w.players[0].shieldUntil).toBeCloseTo(expectedShield, 5);
    expect(w.players[0].healUntil ?? 0).toBeCloseTo(expectedHeal, 5);
  });

  it('a call that falls outside the sync window does not combine with a stale earlier call', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    // Advance world.time well past the sync window with no more calls.
    const idleSteps = Math.ceil((CONFIG.resonance.windowSec + 0.5) / 0.05);
    for (let i = 0; i < idleSteps; i++) step(w, [], 0.05);
    step(w, [call('b')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
  });

  it('after a successful trigger, immediate re-calls are blocked by the cooldown', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    const firstShieldUntil = w.players[0].shieldUntil;
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    // Still on cooldown — the buff must not have been re-applied/extended.
    expect(w.players[0].shieldUntil).toBe(firstShieldUntil);
  });

  it('resonance is available again once the cooldown has fully elapsed', () => {
    const w = twoPlayerWorld();
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    const cooldownSteps = Math.ceil((CONFIG.resonance.cooldownSec + 0.5) / 0.05);
    for (let i = 0; i < cooldownSteps; i++) step(w, [], 0.05);
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    expect(w.players[0].shieldUntil).toBeGreaterThan(w.time);
  });

  it('a downed player calling resonance is ignored (matches move/face/cast gating)', () => {
    const w = twoPlayerWorld();
    w.players[1].downed = true;
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
  });

  it('a disconnected player calling resonance is ignored', () => {
    const w = twoPlayerWorld();
    w.players[1].connected = false;
    step(w, [call('a')], 0.05);
    step(w, [call('b')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
  });

  it('solo (one player) can never trigger resonance regardless of how many times they call', () => {
    const w = createWorld([{ id: 'solo', name: 'Solo', classId: 'pyro' }]);
    for (let i = 0; i < 5; i++) step(w, [call('solo')], 0.05);
    expect(w.players[0].shieldUntil).toBe(0);
  });
});
