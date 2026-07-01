// shared/tests/endless.test.ts — endless mode (post-campaign infinite waves).
// See shared/src/world.ts's enterEndlessMode/spawnElite/spawnEndlessEnemy and
// CONFIG.endless/CONFIG.elite for the mechanic this locks down.
import { describe, it, expect } from 'vitest';
import {
  createSoloWorld,
  createWorld,
  step,
  enterEndlessMode,
  endEndlessMode,
  enemyStatWaveHp,
  enemyStatWaveSpeed,
  endlessWraithShare,
  endlessMaxQueue,
  endlessMaxAlive,
  nextEliteInterval,
  MAX_LEVEL_ID,
} from '../src/world';
import { CONFIG } from '../src/config';
import type { World } from '../src/types';

// Zero rng: always "hits" any `rng() < share` branch, and always picks index 0
// out of any pool. One: always "misses" / picks the last pool index.
const ZERO = () => 0;
const ALMOST_ONE = () => 0.999;

describe('enterEndlessMode', () => {
  it('only makes sense after victory, but works from any status — resets battle/wave state', () => {
    const w = createSoloWorld('storm');
    w.status = 'victory';
    w.levelId = MAX_LEVEL_ID;
    w.wave = 5;
    w.spawnQueue = 7;
    w.spawnTimer = 0.3;
    w.breakTimer = 1;
    w.levelCleared = true;
    w.transitionTimer = 2;
    w.enemies = [{ id: 1, pos: { x: 0, y: 0 }, hp: 10, speed: 0, slowUntil: 0, radius: 12, targetId: null, element: 'normal' }];
    w.score = 66;

    enterEndlessMode(w);

    expect(w.status).toBe('playing');
    expect(w.endless).toBe(true);
    expect(w.wave).toBe(0);
    expect(w.spawnQueue).toBe(0);
    expect(w.spawnTimer).toBe(0);
    expect(w.breakTimer).toBe(0);
    expect(w.levelCleared).toBe(false);
    expect(w.transitionTimer).toBe(0);
    expect(w.enemies).toEqual([]);
    expect(w.nextEliteWave).toBe(5);
    expect(w.eliteWavesSoFar).toBe(0);
    expect(w.eliteQueue).toBe(0);
  });

  it('snapshots the entry score as endlessKillBase, but does not reset score itself', () => {
    const w = createSoloWorld('storm');
    w.score = 42;
    enterEndlessMode(w);
    expect(w.endlessKillBase).toBe(42);
    expect(w.score).toBe(42);
  });

  it('snapshots the entry time as endlessTimeBase (world.time never resets, unlike wave)', () => {
    const w = createSoloWorld('storm');
    w.time = 137.5;
    enterEndlessMode(w);
    expect(w.endlessTimeBase).toBe(137.5);
    expect(w.time).toBe(137.5);
  });

  it('preserves player hp/position/cooldowns (only battle/wave transients reset)', () => {
    const w = createSoloWorld('storm');
    const p = w.players[0];
    p.hp = 37;
    p.pos = { x: 555, y: 123 };
    p.cooldowns.thunder = 9.9;
    enterEndlessMode(w);
    expect(p.hp).toBe(37);
    expect(p.pos).toEqual({ x: 555, y: 123 });
    expect(p.cooldowns.thunder).toBe(9.9);
  });

  it('leaves levelId untouched (the world stays visually on the last campaign theme)', () => {
    const w = createSoloWorld('storm');
    w.levelId = MAX_LEVEL_ID;
    enterEndlessMode(w);
    expect(w.levelId).toBe(MAX_LEVEL_ID);
  });
});

describe('endEndlessMode', () => {
  it('ends the run the same way a campaign wipe does — reuses the gameover status', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    endEndlessMode(w);
    expect(w.status).toBe('gameover');
  });
});

describe('enemyStatWaveHp — campaign parity + endless soft cap', () => {
  it('matches the plain campaign formula when world.endless is false, at any wave', () => {
    const w = createSoloWorld('storm');
    for (const wave of [1, 5, 20, 100]) {
      w.wave = wave;
      expect(enemyStatWaveHp(w)).toBeCloseTo(CONFIG.enemy.baseHp + (wave - 1) * CONFIG.enemy.hpPerWave);
    }
  });

  it('matches the campaign formula exactly up to and including the cap wave (40)', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    for (const wave of [1, 10, 40]) {
      w.wave = wave;
      expect(enemyStatWaveHp(w)).toBeCloseTo(CONFIG.enemy.baseHp + (wave - 1) * CONFIG.enemy.hpPerWave);
    }
  });

  it('hits the exact anchor values past the cap wave (slope cut to 25%)', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    const anchors: Array<[number, number]> = [[40, 225], [70, 262.5], [100, 300], [150, 362.5], [200, 425]];
    for (const [wave, expected] of anchors) {
      w.wave = wave;
      expect(enemyStatWaveHp(w)).toBeCloseTo(expected);
    }
  });
});

describe('enemyStatWaveSpeed — hard cap at a fraction of player speed', () => {
  it('matches the plain campaign formula when world.endless is false', () => {
    const w = createSoloWorld('storm');
    w.wave = 100; // campaign never reaches this, but the formula itself must stay linear
    expect(enemyStatWaveSpeed(w)).toBeCloseTo(CONFIG.enemy.baseSpeed + 99 * CONFIG.enemy.speedPerWave);
  });

  it('is strictly below player speed for every wave from 1 to 500 once endless', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    for (let wave = 1; wave <= 500; wave++) {
      w.wave = wave;
      expect(enemyStatWaveSpeed(w)).toBeLessThan(CONFIG.player.speed);
    }
  });

  it('caps at exactly speedCapFrac * player.speed once the linear formula would exceed it', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    const cap = CONFIG.player.speed * CONFIG.endless.speedCapFrac;
    w.wave = 200;
    expect(enemyStatWaveSpeed(w)).toBeCloseTo(cap);
  });
});

describe('endlessWraithShare — ramp from 0 to wraithShareMax', () => {
  it('is 0 before wraithShareStartWave', () => {
    expect(endlessWraithShare(1)).toBe(0);
    expect(endlessWraithShare(CONFIG.endless.wraithShareStartWave - 1)).toBe(0);
  });

  it('hits the documented midpoint and cap anchor values', () => {
    expect(endlessWraithShare(6)).toBeCloseTo(0);
    expect(endlessWraithShare(11)).toBeCloseTo(0.15);
    expect(endlessWraithShare(16)).toBeCloseTo(0.30);
  });

  it('stays capped at wraithShareMax for any wave beyond wraithShareMaxWave', () => {
    expect(endlessWraithShare(50)).toBeCloseTo(CONFIG.endless.wraithShareMax);
    expect(endlessWraithShare(500)).toBeCloseTo(CONFIG.endless.wraithShareMax);
  });
});

describe('endlessMaxQueue / endlessMaxAlive — party-size scaling', () => {
  it('scales linearly per extra player from the documented base', () => {
    expect(endlessMaxQueue(1)).toBe(60);
    expect(endlessMaxQueue(4)).toBe(105);
    expect(endlessMaxAlive(1)).toBe(40);
    expect(endlessMaxAlive(4)).toBe(70);
  });
});

describe('nextEliteInterval — cadence tightens over the run', () => {
  it('is 5 early, 4 from wave 20, 3 from wave 50', () => {
    expect(nextEliteInterval(5)).toBe(5);
    expect(nextEliteInterval(19)).toBe(5);
    expect(nextEliteInterval(20)).toBe(4);
    expect(nextEliteInterval(49)).toBe(4);
    expect(nextEliteInterval(50)).toBe(3);
  });

  it('reproduces the documented trigger sequence 5,10,15,20,24,28,32,36,40,44,48,52,55,58,61', () => {
    let wave = 5;
    const seq = [5];
    for (let i = 0; i < 14; i++) {
      wave += nextEliteInterval(wave);
      seq.push(wave);
    }
    expect(seq).toEqual([5, 10, 15, 20, 24, 28, 32, 36, 40, 44, 48, 52, 55, 58, 61]);
  });
});

// --- integration: driving the actual sim via step() -------------------------

// Force straight into a specific endless wave without waiting through breaks:
// jump world.wave to wave-1, arm breakTimer so the next step() calls beginWave().
function forceEndlessWave(w: World, wave: number, rng: () => number = Math.random): void {
  w.wave = wave - 1;
  w.breakTimer = 0.01;
  w.spawnQueue = 0;
  w.eliteQueue = 0;
  w.enemies = [];
  step(w, [], 0.02, rng);
}

// Drain the whole spawn queue for the current wave by ticking spawnTimer down
// (deterministic rng so the test doesn't depend on real randomness).
function drainSpawns(w: World, ticks: number, rng: () => number = Math.random): void {
  for (let i = 0; i < ticks; i++) step(w, [], w.spawnCadence + 0.01, rng);
}

// Walk to whatever wave is next due for an elite trigger, using the world's
// OWN current nextEliteWave (unlike forceEndlessWave, which jumps to an
// arbitrary wave and would desync nextEliteWave if used to hop through a
// sequence of triggers).
function advanceToNextEliteTrigger(w: World, rng: () => number = Math.random): void {
  w.wave = w.nextEliteWave - 1;
  w.breakTimer = 0.01;
  w.spawnQueue = 0;
  w.eliteQueue = 0;
  w.enemies = [];
  step(w, [], 0.02, rng);
}

describe('endless spawn tick — wraith mix-in via injected rng', () => {
  it('never spawns a wraith before wraithShareStartWave, even with rng always "hitting"', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 2, ZERO);
    drainSpawns(w, 6, ZERO);
    expect(w.enemies.some((e) => e.wraith)).toBe(false);
  });

  it('spawns only wraiths once past the ramp with rng forced to always "hit"', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 16, ZERO); // wraithShare capped at 0.30 here, but rng()=0 always < any positive share
    drainSpawns(w, 6, ZERO);
    expect(w.enemies.length).toBeGreaterThan(0);
    expect(w.enemies.every((e) => e.wraith === true)).toBe(true);
  });

  it('spawns no wraiths when rng is forced to always "miss", regardless of wave', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 16, ALMOST_ONE);
    drainSpawns(w, 6, ALMOST_ONE);
    expect(w.enemies.length).toBeGreaterThan(0);
    expect(w.enemies.every((e) => !e.wraith)).toBe(true);
  });
});

describe('endless elite cadence', () => {
  it('queues exactly 1 elite on the first trigger (wave 5)', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 5, ZERO);
    expect(w.eliteWavesSoFar).toBe(1);
    expect(w.eliteQueue).toBe(1);
    expect(w.nextEliteWave).toBe(10);
  });

  it('spawns an elite (not a boss) before regular swarm on a trigger wave', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 5, ZERO);
    drainSpawns(w, 1, ZERO);
    const elite = w.enemies.find((e) => e.elite);
    expect(elite).toBeTruthy();
    expect(elite!.boss).toBeFalsy();
  });

  it('does not queue an elite on a non-trigger wave', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    forceEndlessWave(w, 7, ZERO);
    expect(w.eliteQueue).toBe(0);
  });

  it('ramps up to 2 elites per trigger in the second rotation (wave 24), 3 in the third (wave 40)', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    for (let i = 0; i < 5; i++) advanceToNextEliteTrigger(w, ZERO); // 5,10,15,20,24
    expect(w.wave).toBe(24);
    expect(w.eliteWavesSoFar).toBe(5);
    expect(w.eliteQueue).toBe(2);

    for (let i = 0; i < 4; i++) advanceToNextEliteTrigger(w, ZERO); // 28,32,36,40
    expect(w.wave).toBe(40);
    expect(w.eliteWavesSoFar).toBe(9);
    expect(w.eliteQueue).toBe(3);
  });

  it('an elite killed never sets levelCleared/transitionTimer/victory, even at MAX_LEVEL_ID', () => {
    const w = createSoloWorld('storm');
    w.levelId = MAX_LEVEL_ID;
    enterEndlessMode(w);
    forceEndlessWave(w, 5, ZERO);
    drainSpawns(w, 1, ZERO);
    const elite = w.enemies.find((e) => e.elite)!;
    expect(elite).toBeTruthy();
    elite.hp = 0;
    step(w, [], 0.05);
    expect(w.levelCleared).toBe(false);
    expect(w.transitionTimer).toBe(0);
    expect(w.status).toBe('playing');
  });

  it('elite identity rotates through BOSS_ELEMENT (normal/ice/storm/holy) round-robin', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    const elements: string[] = [];
    for (let i = 0; i < 4; i++) {
      advanceToNextEliteTrigger(w, ZERO); // 5,10,15,20 in turn
      drainSpawns(w, 1, ZERO);
      elements.push(w.enemies.find((e) => e.elite)!.element);
    }
    expect(elements).toEqual(['normal', 'ice', 'storm', 'holy']);
  });

  it('elite never dashes even when its rotation lands on the storm identity', () => {
    const w = createSoloWorld('storm');
    enterEndlessMode(w);
    for (let i = 0; i < 3; i++) advanceToNextEliteTrigger(w, ZERO); // 5,10,15 -> 3rd trigger = storm identity
    drainSpawns(w, 1, ZERO);
    const elite = w.enemies.find((e) => e.elite)!;
    expect(elite.element).toBe('storm');
    for (let i = 0; i < 20; i++) step(w, [], 0.05, ZERO);
    // stormMove() is the only code path that ever sets these fields; if an
    // elite went through it despite element==='storm', they'd be populated.
    const after = w.enemies.find((e) => e.id === elite.id)!;
    expect(after.telegraphUntil).toBeUndefined();
    expect(after.dashUntil).toBeUndefined();
    expect(after.dashDir).toBeUndefined();
  });
});

describe('endless safety caps under simulation', () => {
  it('never exceeds endlessMaxAlive(partyCount) after many waves, across party sizes', () => {
    for (const partySize of [1, 2, 4]) {
      const seeds = Array.from({ length: partySize }, (_, i) => ({
        id: `p${i}`, name: `P${i}`, classId: 'storm' as const,
      }));
      const w = createWorld(seeds);
      w.players.forEach((p) => { p.maxHp = 1_000_000; p.hp = 1_000_000; }); // survive the whole sweep
      enterEndlessMode(w);
      const cap = endlessMaxAlive(partySize);
      for (let wave = 2; wave <= 60; wave += 2) {
        forceEndlessWave(w, wave, Math.random);
        drainSpawns(w, 40, Math.random);
        expect(w.enemies.length).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('clamps spawnQueue to endlessMaxQueue(partyCount) even at very high waves in a 4-player room', () => {
    const seeds = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, classId: 'storm' as const }));
    const w = createWorld(seeds);
    enterEndlessMode(w);
    forceEndlessWave(w, 100, Math.random);
    expect(w.spawnQueue).toBeLessThanOrEqual(endlessMaxQueue(4));
  });
});
