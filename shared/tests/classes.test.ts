import { describe, it, expect } from 'vitest';
import { CLASSES, classSpellSet, CLASS_BONDS, activeClassBonds } from '../src/classes';
import { SPELLS } from '../src/spells';
import type { ClassId, SpellId } from '../src/types';

const ALL_CLASS_IDS: ClassId[] = ['pyro', 'cryo', 'storm', 'warden'];

describe('classes', () => {
  it('defines exactly the four classes', () => {
    expect(Object.keys(CLASSES).sort()).toEqual([...ALL_CLASS_IDS].sort());
  });

  it('keys match each definition id', () => {
    for (const [key, def] of Object.entries(CLASSES)) {
      expect(def.id).toBe(key);
    }
  });

  it('each class has exactly three spells', () => {
    for (const def of Object.values(CLASSES)) {
      expect(def.spells.length).toBe(3);
    }
  });

  it('all class spells exist in SPELLS', () => {
    const spellKeys = new Set<SpellId>(Object.keys(SPELLS) as SpellId[]);
    for (const def of Object.values(CLASSES)) {
      for (const spell of def.spells) {
        expect(spellKeys.has(spell)).toBe(true);
      }
    }
  });

  it('warden has heal + aegis + holybolt', () => {
    expect(new Set(CLASSES.warden.spells)).toEqual(
      new Set<SpellId>(['heal', 'aegis', 'holybolt'])
    );
  });

  it('gives each class its expected loadout', () => {
    expect(new Set(CLASSES.pyro.spells)).toEqual(new Set<SpellId>(['chant1', 'chant2', 'firestorm']));
    expect(new Set(CLASSES.cryo.spells)).toEqual(new Set<SpellId>(['frost', 'frostnova', 'mend']));
    expect(new Set(CLASSES.storm.spells)).toEqual(new Set<SpellId>(['thunder', 'chain', 'repulse']));
  });

  it('has distinct shapes and colors per class', () => {
    const shapes = Object.values(CLASSES).map((c) => c.shape);
    const colors = Object.values(CLASSES).map((c) => c.color);
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('gives every class a positive hp and speed modifier and a display name', () => {
    for (const def of Object.values(CLASSES)) {
      expect(def.hpMod).toBeGreaterThan(0);
      expect(def.speedMod).toBeGreaterThan(0);
      expect(def.displayName.length).toBeGreaterThan(0);
    }
  });

  it('classSpellSet returns the loadout as a Set', () => {
    for (const id of ALL_CLASS_IDS) {
      const set = classSpellSet(id);
      expect(set).toBeInstanceOf(Set);
      expect([...set].sort()).toEqual([...CLASSES[id].spells].sort());
    }
  });
});

describe('CLASS_BONDS / activeClassBonds (職業搭配羈絆)', () => {
  it('covers exactly the 6 unique unordered pairs among the 4 classes, each with a name', () => {
    expect(CLASS_BONDS).toHaveLength(6);
    const seen = new Set<string>();
    for (const b of CLASS_BONDS) {
      expect(b.pair[0]).not.toBe(b.pair[1]);
      expect(b.name.length).toBeGreaterThan(0);
      const key = [...b.pair].sort().join('+');
      expect(seen.has(key)).toBe(false); // no duplicate pair
      seen.add(key);
    }
    // every unordered pair among the 4 classes is covered exactly once
    for (let i = 0; i < ALL_CLASS_IDS.length; i++) {
      for (let j = i + 1; j < ALL_CLASS_IDS.length; j++) {
        const key = [ALL_CLASS_IDS[i], ALL_CLASS_IDS[j]].sort().join('+');
        expect(seen.has(key)).toBe(true);
      }
    }
  });

  it('no bonds active with zero or one class present', () => {
    expect(activeClassBonds(new Set())).toHaveLength(0);
    expect(activeClassBonds(new Set(['pyro']))).toHaveLength(0);
  });

  it('exactly one bond active for a specific pair', () => {
    const active = activeClassBonds(new Set(['pyro', 'cryo']));
    expect(active).toHaveLength(1);
    expect(active[0].pair.includes('pyro')).toBe(true);
    expect(active[0].pair.includes('cryo')).toBe(true);
  });

  it('3 distinct classes present activates all 3 pairs among them (not the ones involving the 4th)', () => {
    const active = activeClassBonds(new Set(['pyro', 'cryo', 'storm']));
    expect(active).toHaveLength(3);
    expect(active.every((b) => !b.pair.includes('warden'))).toBe(true);
  });

  it('all 4 classes present activates all 6 bonds', () => {
    expect(activeClassBonds(new Set(ALL_CLASS_IDS))).toHaveLength(6);
  });
});
