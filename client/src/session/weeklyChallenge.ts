// 週挑戰: client-side weekly-seed helpers + the leaderboard HTTP client
// (Cloudflare Worker + D1 — see cloudflare/leaderboard/). Kept dependency-free
// from GameSession/LocalSession so it's plain fetch/localStorage logic,
// easy to reason about independent of the sim.
import { isoWeekId, weekSeed, mulberry32, ClassId } from '@acm/shared';

const CLIENT_ID_KEY = 'acm.weeklyChallenge.clientId';

// A random per-browser id (not an account) — lets a repeat submission from the
// same person UPDATE their personal-best row instead of spamming duplicates.
// Not an anti-cheat measure (this is a client-authoritative solo mode, same
// trust level solo play has always had); just de-dupes honest resubmissions.
export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function currentWeekId(): string {
  return isoWeekId(new Date());
}

// Calendar days until the next ISO week boundary (Monday 00:00 UTC) — lets
// the UI show "本週還剩 N 天" instead of currentWeekId() being computed but
// never surfaced anywhere a player would notice a reset is coming.
export function daysUntilWeeklyReset(now: Date = new Date()): number {
  const day = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return 7 - day;
}

// A fresh PRNG seeded from THIS week's id — every player who starts the
// challenge this week gets the identical enemy-spawn sequence (see
// shared/src/weekly.ts).
export function weeklyRng(): () => number {
  return mulberry32(weekSeed(currentWeekId()));
}

// Resolution order mirrors resolveServerUrl() in net/NetClient.ts:
// ?leaderboard= query param > VITE_LEADERBOARD_URL (baked in at build time) >
// '' (no leaderboard configured — submit/fetch become silent no-ops, so local
// dev without the Worker running still plays fine).
export function resolveLeaderboardUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const q = new URLSearchParams(window.location.search).get('leaderboard');
    if (q) return q;
  }
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  if (env && env.VITE_LEADERBOARD_URL) return env.VITE_LEADERBOARD_URL;
  return '';
}

export interface ScoreSubmission {
  classId: ClassId;
  name: string;
  wave: number;
  kills: number;
}

export interface LeaderboardEntry {
  name: string;
  wave: number;
  kills: number;
  submittedAt: number;
}

// Best-effort: a failed/unreachable submission must never break the
// game-over screen, so every error is swallowed here.
export async function submitScore(payload: ScoreSubmission): Promise<void> {
  const url = resolveLeaderboardUrl();
  if (!url) return;
  try {
    await fetch(`${url}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        weekId: currentWeekId(),
        classId: payload.classId,
        clientId: getClientId(),
        name: payload.name,
        wave: payload.wave,
        kills: payload.kills,
      }),
    });
  } catch {
    /* ignore — best effort */
  }
}

export async function fetchLeaderboard(classId: ClassId): Promise<LeaderboardEntry[]> {
  const url = resolveLeaderboardUrl();
  if (!url) return [];
  try {
    const res = await fetch(`${url}/top?week=${encodeURIComponent(currentWeekId())}&class=${classId}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { entries?: LeaderboardEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}
