// Groq-backed voice fallback proxy — used when a browser's own Web Speech
// API is unsupported or non-functional (see client/src/voice/recognizer.ts's
// give-up heuristic). NOT used for offline play — this, like Web Speech API
// itself, requires network; there is no offline voice path, only offline
// button/keyboard casting (see client/src/ui/skillbar.ts).
//
// GROQ_API_KEY is a Worker secret (wrangler secret put), never checked into
// any file. Two layers of cost protection since Groq bills per request
// (unlike the leaderboard's free-tier KV writes): per-IP rate limiting AND a
// global daily request budget (protects against distributed abuse that
// per-IP limiting alone can't).
import { checkRateLimit } from './rateLimit';
import { checkDailyBudget } from './dailyBudget';
import { isValidAudioSize, sanitizePrompt, MAX_AUDIO_BYTES } from './validate';
import { traditionalize } from './traditionalize';

export interface Env {
  GROQ_API_KEY: string;
  VOICE_KV: KVNamespace;
  ALLOWED_ORIGINS?: string;
}

const DEFAULT_ALLOWED_ORIGINS = ['https://yazelin.github.io', 'http://localhost:5173'];

// Generous for real use (a chatty player casting often) while capping
// worst-case abuse cost per IP to a trivial amount.
const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_SEC = 60;
// ~2500 requests/day * ~$0.000111/request (Groq's 10s-minimum billing on
// whisper-large-v3-turbo's $0.04/hour) ≈ $0.28/day worst case — comfortably
// under a $1/day ceiling even under sustained abuse, while legitimate use
// (most players have working Web Speech API and never hit this endpoint at
// all) has enormous headroom under this.
const DAILY_BUDGET = 2500;

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : DEFAULT_ALLOWED_ORIGINS).map((o) =>
    o.trim(),
  );
  const origin = req.headers.get('origin') ?? '';
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

async function handleTranscribe(req: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const withinIpLimit = await checkRateLimit(
    env.VOICE_KV,
    `voiceproxy:ratelimit:${ip}`,
    IP_RATE_LIMIT,
    IP_RATE_WINDOW_SEC,
  );
  if (!withinIpLimit) return json({ error: 'rate limited' }, 429, headers);

  const withinDailyBudget = await checkDailyBudget(env.VOICE_KV, DAILY_BUDGET, new Date());
  if (!withinDailyBudget) return json({ error: 'daily budget exhausted' }, 503, headers);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: 'invalid form data' }, 400, headers);
  }

  // The installed @cloudflare/workers-types version types FormData.get() as
  // string | null only (no File/Blob overload), even though a real uploaded
  // part is a Blob at runtime and FormData.append() itself accepts Blob —
  // an asymmetric/incomplete declaration, not a real runtime restriction.
  // Recast to what's actually there rather than fight the stale types.
  const audio = form.get('audio') as unknown as Blob | string | null;
  if (audio === null || typeof audio === 'string' || !isValidAudioSize(audio.size)) {
    return json({ error: `audio missing or exceeds ${MAX_AUDIO_BYTES} bytes` }, 400, headers);
  }
  // Client-supplied vocabulary hint (the local player's current class's chant
  // words, default + custom) — passed to Groq as `prompt` to bias
  // recognition toward these specific short phrases, and toward Traditional
  // script generally (the hint text is itself already Traditional).
  const prompt = sanitizePrompt(form.get('prompt') as string | null);

  const groqForm = new FormData();
  groqForm.append('file', audio, 'audio.webm');
  groqForm.append('model', 'whisper-large-v3-turbo');
  groqForm.append('language', 'zh');
  if (prompt) groqForm.append('prompt', prompt);

  let groqRes: Response;
  try {
    groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: groqForm,
    });
  } catch {
    return json({ error: 'transcription service unreachable' }, 502, headers);
  }
  if (!groqRes.ok) {
    return json({ error: 'transcription failed' }, 502, headers);
  }
  const result = (await groqRes.json()) as { text?: string };
  const text = traditionalize((result.text ?? '').trim());
  return json({ text }, 200, headers);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/transcribe') return handleTranscribe(req, env, headers);
    return json({ error: 'not found' }, 404, headers);
  },
};
