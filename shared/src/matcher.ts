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

import { SpellId } from './types';
import { SPELLS } from './spells';

export interface MatchOptions {
  // When provided, only spells in this set may be returned (the caster's class
  // loadout). A matched-but-disallowed spell is skipped and scanning continues,
  // so the result is the first *allowed* match or null. Omit for legacy behavior.
  allowed?: Set<SpellId>;
  // Player-customized chant phrases, additive to each spell's built-in aliases
  // (the original names still work). Same first-match-wins/longest-alias rules.
  extra?: Partial<Record<SpellId, string[]>>;
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

export function matchSpell(transcript: string, opts: MatchOptions = {}): SpellId | null {
  const hay = normalize(transcript);

  // Pick the spell whose matched alias is the LONGEST (most specific). This
  // prevents a short generic alias of one spell from shadowing a longer, more
  // specific name of another — e.g. fireball's 'fire' is a substring of
  // 'firestorm', but 'firestorm' (len 9) must win over 'fire' (len 4). Ties
  // resolve to the first spell in iteration order.
  let best: SpellId | null = null;
  let bestLen = 0;
  for (const def of Object.values(SPELLS)) {
    if (opts.allowed && !opts.allowed.has(def.id)) continue; // skip disallowed spells, keep scanning
    const extra = opts.extra?.[def.id];
    const aliases = extra ? [...def.aliases, ...extra] : def.aliases;
    for (const alias of aliases) {
      const n = normalize(alias);
      if (n.length > bestLen && containsFuzzy(hay, n)) {
        best = def.id;
        bestLen = n.length;
      }
    }
  }
  return best;
}
