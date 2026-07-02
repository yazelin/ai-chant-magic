// 週挑戰 leaderboard Worker (Cloudflare KV — see README for why not D1: the
// account's D1 database quota was already used up by other projects, and KV
// suits this data shape fine — read-heavy, write-light, no cross-row queries
// needed). Two endpoints:
//   POST /submit  — upserts the caller's personal-best (weekId, classId, clientId)
//   GET  /top?week=X&class=Y — top 20 for that bucket, ordered by wave then kills
//
// This is a client-authoritative solo game mode (LocalSession runs entirely in
// the browser, same trust level solo play has always had) — there is no
// server-side simulation to check submissions against. parseSubmitPayload's
// validation is a sanity backstop against malformed data, not anti-cheat.
import { parseSubmitPayload, isValidWeekId, isValidClassId } from './validate';
import { checkRateLimit } from './rateLimit';

export interface Env {
  LEADERBOARD: KVNamespace;
  ALLOWED_ORIGINS?: string;
}

interface ScoreRow {
  clientId: string;
  name: string;
  wave: number;
  kills: number;
  submittedAt: number;
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://yazelin.github.io',
  'http://localhost:5173',
];

// Cap the STORED bucket well above the public top-20 so a slower-climbing
// player can still see roughly where they'd rank without the value blowing up
// unboundedly over a busy week.
const MAX_STORED_ENTRIES = 200;
const TOP_N = 20;

function bucketKey(weekId: string, classId: string): string {
  return `scores:${weekId}:${classId}`;
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ALLOWED_ORIGINS)
    .map((o) => o.trim());
  const origin = req.headers.get('origin') ?? '';
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

// Generous enough for real use (retrying after a run, several people behind
// the same NAT) while still stopping a flood script from silently burning
// through the free tier's daily KV write quota (shared with other projects
// on this account) in well under a minute.
const SUBMIT_RATE_LIMIT = 20;
const SUBMIT_RATE_WINDOW_SEC = 60;

async function handleSubmit(req: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const allowed = await checkRateLimit(env.LEADERBOARD, `ratelimit:submit:${ip}`, SUBMIT_RATE_LIMIT, SUBMIT_RATE_WINDOW_SEC);
  if (!allowed) return json({ error: 'rate limited' }, 429, headers);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400, headers);
  }
  const parsed = parseSubmitPayload(body, new Date());
  if ('error' in parsed) return json(parsed, 400, headers);

  const { weekId, classId, clientId, name, wave, kills } = parsed;
  const key = bucketKey(weekId, classId);
  // NOTE: KV has no read-modify-write transaction — under simultaneous
  // submissions to the SAME (weekId, classId) bucket within the same second,
  // one could clobber the other (last-write-wins). Accepted trade-off for a
  // casual, low-traffic leaderboard; not worth a stronger-consistency store
  // for this use case (see README).
  const existing = (await env.LEADERBOARD.get<ScoreRow[]>(key, 'json')) ?? [];
  const others = existing.filter((r) => r.clientId !== clientId);
  const prior = existing.find((r) => r.clientId === clientId);
  const best = prior && prior.wave >= wave ? prior : { clientId, name, wave, kills, submittedAt: Date.now() };
  const updated = [...others, best]
    .sort((a, b) => b.wave - a.wave || b.kills - a.kills)
    .slice(0, MAX_STORED_ENTRIES);

  await env.LEADERBOARD.put(key, JSON.stringify(updated));
  return json({ ok: true }, 200, headers);
}

async function handleTop(req: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const week = url.searchParams.get('week');
  const classId = url.searchParams.get('class');
  if (!isValidWeekId(week)) return json({ error: 'invalid week' }, 400, headers);
  if (!isValidClassId(classId)) return json({ error: 'invalid class' }, 400, headers);

  const rows = (await env.LEADERBOARD.get<ScoreRow[]>(bucketKey(week, classId), 'json')) ?? [];
  const entries = rows
    .slice(0, TOP_N)
    .map(({ name, wave, kills, submittedAt }) => ({ name, wave, kills, submittedAt }));
  return json({ entries }, 200, headers);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/submit') return handleSubmit(req, env, headers);
    if (req.method === 'GET' && url.pathname === '/top') return handleTop(req, env, headers);
    return json({ error: 'not found' }, 404, headers);
  },
};
