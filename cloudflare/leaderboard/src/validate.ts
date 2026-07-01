// Pure validation/helpers for the 週挑戰 leaderboard Worker — no Cloudflare
// runtime bindings here, so this half is plain-vitest testable.

export const VALID_CLASS_IDS = ['pyro', 'cryo', 'storm', 'warden'] as const;
export type ClassId = (typeof VALID_CLASS_IDS)[number];

export function isValidClassId(v: unknown): v is ClassId {
  return typeof v === 'string' && (VALID_CLASS_IDS as readonly string[]).includes(v);
}

export function isValidWeekId(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-W\d{2}$/.test(v);
}

// Intentionally duplicated from ai-chant-magic/shared/src/weekly.ts's
// isoWeekId — this Worker is a separate deployable (its own runtime/tooling,
// not an npm workspace member), and this ~10-line pure function is stable
// enough that copying it once is simpler than wiring a cross-package import
// through Wrangler's bundler. Keep both in sync if the week-numbering rule
// ever changes (it won't — ISO 8601 is a fixed standard).
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Reject stale/future-week submissions — the Worker's own clock is the
// authority on "what week is it", independent of a client's possibly-skewed
// system clock. A tiny bit of slack (yesterday/tomorrow's week id would still
// just fail this check, by design — a client mid-run when the week rolls
// over simply can't submit that run to the new week).
export function isCurrentWeek(weekId: string, now: Date): boolean {
  return weekId === isoWeekId(now);
}

export function sanitizeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}

// Generous but real ceilings — not anti-cheat (this is a client-authoritative
// solo mode; a determined cheater can already fake any POST body), just a
// backstop against obviously-malformed or wildly implausible values landing
// in the table (e.g. a negative number, a 1e20 float, NaN).
export function isValidWave(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5000;
}

export function isValidKills(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 200000;
}

export function isValidClientId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

export interface SubmitPayload {
  weekId: string;
  classId: ClassId;
  clientId: string;
  name: string;
  wave: number;
  kills: number;
}

// Validates + normalizes a raw parsed JSON body into a SubmitPayload, or
// returns an error string naming the first thing that failed.
export function parseSubmitPayload(body: unknown, now: Date): SubmitPayload | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  if (!isValidWeekId(b.weekId)) return { error: 'invalid weekId' };
  if (!isCurrentWeek(b.weekId, now)) return { error: 'weekId is not the current week' };
  if (!isValidClassId(b.classId)) return { error: 'invalid classId' };
  if (!isValidClientId(b.clientId)) return { error: 'invalid clientId' };
  const name = sanitizeName(b.name);
  if (!name) return { error: 'invalid name' };
  if (!isValidWave(b.wave)) return { error: 'invalid wave' };
  if (!isValidKills(b.kills)) return { error: 'invalid kills' };
  return { weekId: b.weekId, classId: b.classId, clientId: b.clientId, name, wave: b.wave, kills: b.kills };
}
