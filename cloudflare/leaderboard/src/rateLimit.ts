// Simple per-key fixed-window rate limit backed by the same KV namespace the
// leaderboard already uses — not anti-cheat (that's out of scope, see
// index.ts's own comment), just a floor against a flood script exhausting
// the free tier's daily KV write quota and silently breaking /submit for
// everyone else that day. Not perfectly atomic (KV has no read-modify-write
// transaction, same trade-off already accepted for the scores bucket itself)
// — under this endpoint's realistic traffic that's fine.
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
