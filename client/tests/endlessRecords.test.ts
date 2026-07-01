import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRecord,
  saveRecordIfBetter,
  isEndlessUnlocked,
  markEndlessUnlocked,
} from '../src/session/endlessRecords';

// vitest's client config runs under Node (no jsdom), which has no global
// localStorage — stub the minimal Storage surface this module uses.
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

describe('endlessRecords', () => {
  it('loadRecord returns null when nothing has been saved yet', () => {
    expect(loadRecord('pyro', 'solo')).toBeNull();
  });

  it('the first save is always a new record', () => {
    expect(saveRecordIfBetter('pyro', 'solo', { wave: 12, score: 300 })).toBe(true);
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 12, score: 300 });
  });

  it('a lower wave does not overwrite, even with a much higher score', () => {
    saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 100 });
    const saved = saveRecordIfBetter('pyro', 'solo', { wave: 10, score: 9999 });
    expect(saved).toBe(false);
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 20, score: 100 });
  });

  it('a tied wave with a higher score does overwrite', () => {
    saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 100 });
    const saved = saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 150 });
    expect(saved).toBe(true);
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 20, score: 150 });
  });

  it('a tied wave with a lower or equal score does not overwrite', () => {
    saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 100 });
    expect(saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 100 })).toBe(false);
    expect(saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 50 })).toBe(false);
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 20, score: 100 });
  });

  it('a higher wave does overwrite, regardless of score', () => {
    saveRecordIfBetter('pyro', 'solo', { wave: 20, score: 500 });
    expect(saveRecordIfBetter('pyro', 'solo', { wave: 21, score: 1 })).toBe(true);
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 21, score: 1 });
  });

  it('different classId and bucket combinations are tracked independently', () => {
    saveRecordIfBetter('pyro', 'solo', { wave: 10, score: 10 });
    saveRecordIfBetter('cryo', 'solo', { wave: 30, score: 30 });
    saveRecordIfBetter('pyro', 'party', { wave: 50, score: 50 });
    expect(loadRecord('pyro', 'solo')).toEqual({ wave: 10, score: 10 });
    expect(loadRecord('cryo', 'solo')).toEqual({ wave: 30, score: 30 });
    expect(loadRecord('pyro', 'party')).toEqual({ wave: 50, score: 50 });
    expect(loadRecord('cryo', 'party')).toBeNull();
  });

  it('isEndlessUnlocked/markEndlessUnlocked are idempotent', () => {
    expect(isEndlessUnlocked()).toBe(false);
    markEndlessUnlocked();
    expect(isEndlessUnlocked()).toBe(true);
    markEndlessUnlocked(); // calling again must not throw or change the outcome
    expect(isEndlessUnlocked()).toBe(true);
  });
});
