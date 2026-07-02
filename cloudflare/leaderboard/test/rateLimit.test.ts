import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/rateLimit';

// A minimal in-memory KVNamespace stand-in — real Workers KV semantics
// (expirationTtl, get/put) aren't available outside a Miniflare/Workers
// runtime, so this fakes just the surface checkRateLimit actually uses.
function fakeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const kv = fakeKv();
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit(kv, 'ip:1.2.3.4', 5, 60)).toBe(true);
    }
  });

  it('rejects once the limit is reached within the window', async () => {
    const kv = fakeKv();
    for (let i = 0; i < 5; i++) await checkRateLimit(kv, 'ip:1.2.3.4', 5, 60);
    expect(await checkRateLimit(kv, 'ip:1.2.3.4', 5, 60)).toBe(false);
  });

  it('tracks different keys independently', async () => {
    const kv = fakeKv();
    for (let i = 0; i < 5; i++) await checkRateLimit(kv, 'ip:1.2.3.4', 5, 60);
    expect(await checkRateLimit(kv, 'ip:5.6.7.8', 5, 60)).toBe(true);
  });

  it('does not write to KV once already over the limit (no unbounded write growth under a flood)', async () => {
    const kv = fakeKv();
    let puts = 0;
    const counting = {
      get: (kv as unknown as { get: (k: string) => Promise<string | null> }).get,
      put: async (...args: unknown[]) => {
        puts++;
        return (kv as unknown as { put: (...a: unknown[]) => Promise<void> }).put(...(args as [string, string]));
      },
    } as unknown as KVNamespace;
    for (let i = 0; i < 5; i++) await checkRateLimit(counting, 'ip:1.2.3.4', 5, 60);
    expect(puts).toBe(5);
    await checkRateLimit(counting, 'ip:1.2.3.4', 5, 60);
    await checkRateLimit(counting, 'ip:1.2.3.4', 5, 60);
    expect(puts).toBe(5); // still 5 — the two over-limit calls wrote nothing
  });
});
