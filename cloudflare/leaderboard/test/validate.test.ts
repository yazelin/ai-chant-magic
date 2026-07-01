import { describe, it, expect } from 'vitest';
import {
  isValidClassId,
  isValidWeekId,
  isoWeekId,
  isCurrentWeek,
  sanitizeName,
  isValidWave,
  isValidKills,
  isValidClientId,
  parseSubmitPayload,
} from '../src/validate';

describe('isValidClassId', () => {
  it('accepts the 4 known classes', () => {
    for (const c of ['pyro', 'cryo', 'storm', 'warden']) expect(isValidClassId(c)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isValidClassId('mage')).toBe(false);
    expect(isValidClassId('')).toBe(false);
    expect(isValidClassId(123)).toBe(false);
    expect(isValidClassId(undefined)).toBe(false);
  });
});

describe('isValidWeekId', () => {
  it('accepts the YYYY-Wnn shape', () => {
    expect(isValidWeekId('2026-W27')).toBe(true);
    expect(isValidWeekId('2026-W01')).toBe(true);
  });
  it('rejects malformed shapes', () => {
    expect(isValidWeekId('2026-27')).toBe(false);
    expect(isValidWeekId('2026-W1')).toBe(false);
    expect(isValidWeekId('26-W27')).toBe(false);
    expect(isValidWeekId(2026)).toBe(false);
    expect(isValidWeekId(null)).toBe(false);
  });
});

describe('isoWeekId (must match shared/src/weekly.ts exactly — deliberately duplicated)', () => {
  const cases: Array<[string, string]> = [
    ['2005-01-01', '2004-W53'],
    ['2005-01-03', '2005-W01'],
    ['2007-12-31', '2008-W01'],
    ['2026-01-01', '2026-W01'],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      const [y, m, d] = input.split('-').map(Number);
      expect(isoWeekId(new Date(y, m - 1, d))).toBe(expected);
    });
  }
});

describe('isCurrentWeek', () => {
  it('true when the weekId matches now', () => {
    const now = new Date(2026, 0, 1); // Thu, week 2026-W01
    expect(isCurrentWeek('2026-W01', now)).toBe(true);
  });
  it('false for a stale or future week', () => {
    const now = new Date(2026, 0, 1);
    expect(isCurrentWeek('2026-W02', now)).toBe(false);
    expect(isCurrentWeek('2025-W52', now)).toBe(false);
  });
});

describe('sanitizeName', () => {
  it('trims whitespace', () => {
    expect(sanitizeName('  Ana  ')).toBe('Ana');
  });
  it('caps length at 20', () => {
    expect(sanitizeName('a'.repeat(50))).toBe('a'.repeat(20));
  });
  it('rejects empty/whitespace-only names', () => {
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName('')).toBeNull();
  });
  it('rejects non-strings', () => {
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName(null)).toBeNull();
  });
});

describe('isValidWave / isValidKills', () => {
  it('accepts non-negative integers within the ceiling', () => {
    expect(isValidWave(0)).toBe(true);
    expect(isValidWave(37)).toBe(true);
    expect(isValidKills(0)).toBe(true);
    expect(isValidKills(999)).toBe(true);
  });
  it('rejects negatives, non-integers, and absurd outliers', () => {
    expect(isValidWave(-1)).toBe(false);
    expect(isValidWave(1.5)).toBe(false);
    expect(isValidWave(999999)).toBe(false);
    expect(isValidWave(NaN)).toBe(false);
    expect(isValidKills(-1)).toBe(false);
    expect(isValidKills(1e9)).toBe(false);
  });
});

describe('isValidClientId', () => {
  it('accepts a plausible uuid-shaped string', () => {
    expect(isValidClientId('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
  });
  it('rejects empty or absurdly long strings, and non-strings', () => {
    expect(isValidClientId('')).toBe(false);
    expect(isValidClientId('x'.repeat(100))).toBe(false);
    expect(isValidClientId(123)).toBe(false);
  });
});

describe('parseSubmitPayload', () => {
  const now = new Date(2026, 0, 1); // 2026-W01

  it('accepts a fully valid payload', () => {
    const result = parseSubmitPayload(
      { weekId: '2026-W01', classId: 'pyro', clientId: 'abc-123', name: '惠惠', wave: 12, kills: 340 },
      now,
    );
    expect(result).toEqual({
      weekId: '2026-W01', classId: 'pyro', clientId: 'abc-123', name: '惠惠', wave: 12, kills: 340,
    });
  });

  it('rejects a stale weekId even if everything else is valid', () => {
    const result = parseSubmitPayload(
      { weekId: '2025-W52', classId: 'pyro', clientId: 'abc-123', name: '惠惠', wave: 12, kills: 340 },
      now,
    );
    expect(result).toEqual({ error: 'weekId is not the current week' });
  });

  it('rejects an invalid classId', () => {
    const result = parseSubmitPayload(
      { weekId: '2026-W01', classId: 'ninja', clientId: 'abc-123', name: '惠惠', wave: 12, kills: 340 },
      now,
    );
    expect(result).toEqual({ error: 'invalid classId' });
  });

  it('rejects a missing/empty name', () => {
    const result = parseSubmitPayload(
      { weekId: '2026-W01', classId: 'pyro', clientId: 'abc-123', name: '  ', wave: 12, kills: 340 },
      now,
    );
    expect(result).toEqual({ error: 'invalid name' });
  });

  it('rejects a non-object body', () => {
    expect(parseSubmitPayload(null, now)).toEqual({ error: 'invalid body' });
    expect(parseSubmitPayload('nope', now)).toEqual({ error: 'invalid body' });
  });

  it('rejects an implausible wave value', () => {
    const result = parseSubmitPayload(
      { weekId: '2026-W01', classId: 'pyro', clientId: 'abc-123', name: '惠惠', wave: -5, kills: 340 },
      now,
    );
    expect(result).toEqual({ error: 'invalid wave' });
  });
});
