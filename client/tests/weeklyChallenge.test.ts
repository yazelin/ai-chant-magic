import { describe, it, expect, beforeEach } from 'vitest';
import { getClientId, currentWeekId, weeklyRng, daysUntilWeeklyReset } from '../src/session/weeklyChallenge';

// vitest's client config runs under Node (no jsdom) — stub the minimal
// Storage surface getClientId() uses (same pattern as endlessRecords.test.ts).
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

beforeEach(() => {
  installFakeLocalStorage();
});

describe('getClientId', () => {
  it('generates an id on first call and persists it across later calls', () => {
    const first = getClientId();
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
    expect(getClientId()).toBe(first);
  });

  it('different browsers (fresh storage) get different ids', () => {
    const a = getClientId();
    installFakeLocalStorage(); // simulates a different browser/profile
    const b = getClientId();
    expect(a).not.toBe(b);
  });
});

describe('currentWeekId', () => {
  it('matches the ISO week-id shape (YYYY-Wnn)', () => {
    expect(currentWeekId()).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe('daysUntilWeeklyReset', () => {
  // ISO weeks reset Monday 00:00 UTC — days remaining counts calendar days
  // until that next boundary (7 on a Monday itself, 1 on a Sunday).
  it('is 7 on a Monday (the reset day itself — a full week until the next one)', () => {
    expect(daysUntilWeeklyReset(new Date('2026-06-29T12:00:00Z'))).toBe(7); // a Monday
  });

  it('is 1 on a Sunday (resets tomorrow)', () => {
    expect(daysUntilWeeklyReset(new Date('2026-07-05T23:00:00Z'))).toBe(1); // a Sunday
  });

  it('is 4 on a Thursday', () => {
    expect(daysUntilWeeklyReset(new Date('2026-07-02T00:00:00Z'))).toBe(4); // a Thursday
  });
});

describe('weeklyRng', () => {
  it('is deterministic — two independently-built weekly rngs (same week) produce the same sequence', () => {
    const a = weeklyRng();
    const b = weeklyRng();
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1) like Math.random', () => {
    const rng = weeklyRng();
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
