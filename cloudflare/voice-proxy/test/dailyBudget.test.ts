import { describe, it, expect } from 'vitest';
import { checkDailyBudget } from '../src/dailyBudget';

function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe('checkDailyBudget', () => {
  it('allows requests under the daily limit', async () => {
    const kv = fakeKv();
    const now = new Date('2026-07-04T12:00:00Z');
    for (let i = 0; i < 3; i++) {
      expect(await checkDailyBudget(kv, 3, now)).toBe(true);
    }
  });

  it('rejects once the daily limit is reached', async () => {
    const kv = fakeKv();
    const now = new Date('2026-07-04T12:00:00Z');
    for (let i = 0; i < 3; i++) await checkDailyBudget(kv, 3, now);
    expect(await checkDailyBudget(kv, 3, now)).toBe(false);
  });

  it('resets on a new UTC day — a spent-out limit yesterday does not carry over', async () => {
    const kv = fakeKv();
    const day1 = new Date('2026-07-04T23:59:00Z');
    const day2 = new Date('2026-07-05T00:01:00Z');
    for (let i = 0; i < 3; i++) await checkDailyBudget(kv, 3, day1);
    expect(await checkDailyBudget(kv, 3, day1)).toBe(false); // day1 exhausted
    expect(await checkDailyBudget(kv, 3, day2)).toBe(true); // day2 is fresh
  });
});
