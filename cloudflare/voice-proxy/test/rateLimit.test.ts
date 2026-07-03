import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../src/rateLimit';

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
});
