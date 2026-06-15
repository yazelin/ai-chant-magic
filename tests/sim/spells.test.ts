import { describe, it, expect } from 'vitest';
import { SPELLS, JUMON } from '../../src/sim/spells';

describe('spells', () => {
  it('defines exactly the five MVP spells', () => {
    expect(Object.keys(SPELLS).sort()).toEqual(
      ['fireball', 'frost', 'heal', 'shield', 'thunder'].sort()
    );
  });
  it('every spell has at least one chinese and one english alias', () => {
    for (const def of Object.values(SPELLS)) {
      expect(def.aliases.length).toBeGreaterThanOrEqual(2);
      expect(def.cooldown).toBeGreaterThan(0);
      expect(def.displayName.length).toBeGreaterThan(0);
    }
  });
  it('marks directional vs self-target correctly', () => {
    expect(SPELLS.fireball.directional).toBe(true);
    expect(SPELLS.frost.directional).toBe(true);
    expect(SPELLS.thunder.directional).toBe(true);
    expect(SPELLS.shield.directional).toBe(false);
    expect(SPELLS.heal.directional).toBe(false);
  });
  it('exposes a non-empty default jumon', () => {
    expect(JUMON.length).toBeGreaterThan(0);
  });
});
