import { describe, it, expect, beforeEach } from 'vitest';
import { hasSeenVoiceHint, markVoiceHintSeen } from '../src/session/onboarding';

// vitest's client config runs under Node (no jsdom) — stub the minimal
// Storage surface this module uses (same pattern as endlessRecords.test.ts).
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

describe('onboarding voice hint', () => {
  it('has not been seen by default', () => {
    expect(hasSeenVoiceHint()).toBe(false);
  });

  it('is seen after marking it, and stays seen', () => {
    markVoiceHintSeen();
    expect(hasSeenVoiceHint()).toBe(true);
    expect(hasSeenVoiceHint()).toBe(true); // idempotent re-check
  });
});
