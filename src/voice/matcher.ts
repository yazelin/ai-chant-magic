// Normalize transcript and aliases to a comparable form:
// fullwidth→halfwidth, lowercase, strip everything except letters/digits/CJK.
export function normalize(text: string): string {
  const halfWidth = text.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  return halfWidth
    .toLowerCase()
    .replace(/[^0-9a-z一-鿿]/g, '');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

import { SpellId } from '../sim/types';
import { SPELLS } from '../sim/spells';

export type CastMode = 'mueisho' | 'eisho';

export interface MatchOptions {
  mode: CastMode;
  jumon: string;
}

// True if `needle` occurs in `hay` as a substring, or a same-length window of
// `hay` is within Levenshtein distance 1 of `needle` (only for needle length >= 3).
function containsFuzzy(hay: string, needle: string): boolean {
  if (needle.length === 0) return false;
  if (hay.includes(needle)) return true;
  if (needle.length < 3) return false;
  const L = needle.length;
  for (let i = 0; i + L <= hay.length; i++) {
    if (levenshtein(hay.slice(i, i + L), needle) <= 1) return true;
  }
  return false;
}

// Returns the index just past the end of a fuzzy jumon occurrence, or -1.
function jumonEndIndex(hay: string, jumon: string): number {
  const j = normalize(jumon);
  if (j.length === 0) return -1;
  const direct = hay.indexOf(j);
  if (direct >= 0) return direct + j.length;
  if (j.length < 3) return -1;
  for (let i = 0; i + j.length <= hay.length; i++) {
    if (levenshtein(hay.slice(i, i + j.length), j) <= 1) return i + j.length;
  }
  return -1;
}

export function matchSpell(transcript: string, opts: MatchOptions): SpellId | null {
  let hay = normalize(transcript);

  if (opts.mode === 'eisho') {
    const end = jumonEndIndex(hay, opts.jumon);
    if (end < 0) return null;
    hay = hay.slice(end); // only match the spell name after the jumon
  }

  for (const def of Object.values(SPELLS)) {
    for (const alias of def.aliases) {
      if (containsFuzzy(hay, normalize(alias))) return def.id;
    }
  }
  return null;
}
