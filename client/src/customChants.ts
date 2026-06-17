import { SpellId } from '@acm/shared';

// Player-customized chant phrases, persisted in localStorage. Additive to the
// built-in spell aliases (the original names keep working). Used by both the
// lobby practice and the in-game caster so a custom phrase works everywhere.
const KEY = 'acm:chants';

type ChantMap = Partial<Record<SpellId, string>>;

export function getChants(): ChantMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as ChantMap;
  } catch {
    return {};
  }
}

export function setChant(id: SpellId, phrase: string): void {
  const m = getChants();
  const p = phrase.trim();
  if (p) m[id] = p;
  else delete m[id]; // empty → revert to default name
  localStorage.setItem(KEY, JSON.stringify(m));
}

// The phrase to display/say for a spell: the custom one, or `fallback` default.
export function chantFor(id: SpellId, fallback: string): string {
  return getChants()[id] ?? fallback;
}

// Shape the custom phrases for matchSpell's `extra` option.
export function chantsAsExtra(): Partial<Record<SpellId, string[]>> {
  const m = getChants();
  const out: Partial<Record<SpellId, string[]>> = {};
  for (const k of Object.keys(m) as SpellId[]) out[k] = [m[k]!];
  return out;
}
