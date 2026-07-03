// A global (not per-IP) daily request counter — the hard ceiling on worst-case
// Groq spend. Unlike per-IP rate limiting, this also stops a DISTRIBUTED abuse
// attempt (many IPs), which per-IP limits alone can't. Keyed by UTC calendar
// date so it naturally resets at midnight UTC; expirationTtl cleans up the
// previous day's counter key instead of it lingering in KV forever.
const TTL_SEC = 2 * 24 * 60 * 60; // 2 days — generous buffer past the key's own day

function dateKey(now: Date): string {
  return `voiceproxy:budget:${now.toISOString().slice(0, 10)}`; // YYYY-MM-DD (UTC)
}

export async function checkDailyBudget(kv: KVNamespace, limit: number, now: Date): Promise<boolean> {
  const key = dateKey(now);
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: TTL_SEC });
  return true;
}
