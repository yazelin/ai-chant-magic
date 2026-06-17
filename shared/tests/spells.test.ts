import { describe, it, expect } from 'vitest';
import { SPELLS, JUMON } from '../src/spells';
import { CLASSES } from '../src/classes';
import type { SpellId } from '../src/types';

const ALL_SPELL_IDS: SpellId[] = [
  'fireball', 'firestorm', 'frost', 'frostnova',
  'thunder', 'chain', 'shield', 'aegis', 'heal', 'holybolt',
];

describe('spells', () => {
  it('defines exactly the ten spells', () => {
    expect(Object.keys(SPELLS).sort()).toEqual([...ALL_SPELL_IDS].sort());
  });

  it('keys match each definition id', () => {
    for (const [key, def] of Object.entries(SPELLS)) {
      expect(def.id).toBe(key);
    }
  });

  it('every spell has at least two aliases (zh + en), a positive cooldown and a name', () => {
    for (const def of Object.values(SPELLS)) {
      expect(def.aliases.length).toBeGreaterThanOrEqual(2);
      expect(def.cooldown).toBeGreaterThan(0);
      expect(def.displayName.length).toBeGreaterThan(0);
    }
  });

  it('uses the exact cooldowns from the plan', () => {
    const expected: Record<SpellId, number> = {
      fireball: 1.2, firestorm: 7, frost: 1.5, frostnova: 5,
      thunder: 2.5, chain: 3, shield: 6, aegis: 9, heal: 7, holybolt: 1.0,
    };
    for (const id of ALL_SPELL_IDS) {
      expect(SPELLS[id].cooldown).toBe(expected[id]);
    }
  });

  it('marks directional vs self/ally-target correctly', () => {
    expect(SPELLS.fireball.directional).toBe(true);
    expect(SPELLS.firestorm.directional).toBe(true);
    expect(SPELLS.frost.directional).toBe(true);
    expect(SPELLS.thunder.directional).toBe(true);
    expect(SPELLS.chain.directional).toBe(false);
    expect(SPELLS.holybolt.directional).toBe(false);
    expect(SPELLS.frostnova.directional).toBe(false);
    expect(SPELLS.shield.directional).toBe(false);
    expect(SPELLS.aegis.directional).toBe(false);
    expect(SPELLS.heal.directional).toBe(false);
  });

  it('declares a kind for every spell', () => {
    const kinds = new Set([
      'projectile', 'aoe-self', 'hitscan', 'chain',
      'buff-self', 'buff-allies', 'heal-allies',
    ]);
    for (const def of Object.values(SPELLS)) {
      expect(kinds.has(def.kind)).toBe(true);
    }
  });

  it('every class loadout is a subset of SPELLS keys', () => {
    const keys = new Set<SpellId>(Object.keys(SPELLS) as SpellId[]);
    for (const cls of Object.values(CLASSES)) {
      for (const spell of cls.spells) {
        expect(keys.has(spell)).toBe(true);
      }
    }
  });

  it('exposes a non-empty default jumon', () => {
    expect(JUMON.length).toBeGreaterThan(0);
  });
});
