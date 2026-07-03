// Simple per-key fixed-window rate limit — copied from cloudflare/leaderboard's
// module of the same name (this Worker is independently deployed, no shared
// package between the two). Not atomic (KV has no read-modify-write
// transaction) — fine for this use case, same trade-off already accepted
// there.
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: windowSec });
  return true;
}
