// 週挑戰 (weekly seeded challenge): every player who starts this week's
// challenge gets the IDENTICAL enemy-spawn sequence (same seed fed into
// step()'s existing injectable `rng` parameter — see shared/world.ts), so
// "how far did you get" is actually comparable across different players'
// runs, not just against your own past self (unlike regular endless mode's
// unseeded Math.random()).

// ISO-8601 week id, e.g. "2026-W27". Computed via Date.UTC so it doesn't
// depend on the caller's local timezone; only the calendar date (Y/M/D) of
// `date` is used, not its time-of-day or original tz offset.
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // shift to this week's Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// Deterministic 32-bit hash (FNV-1a) of the weekId string -> a PRNG seed.
// Not cryptographic — just needs to spread different weekIds across the seed
// space so adjacent weeks don't produce near-identical runs.
export function weekSeed(weekId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < weekId.length; i++) {
    h ^= weekId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — a small, fast, deterministic PRNG. Returns a `() => number` in
// [0, 1), matching Math.random()'s contract exactly, so it drops straight
// into step()'s existing `rng` parameter with no changes to the simulation.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
