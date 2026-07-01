import { describe, it, expect } from 'vitest';
import { isoWeekId, weekSeed, mulberry32 } from '../src/weekly';

describe('isoWeekId', () => {
  // Classic ISO-8601 week-numbering edge cases (Wikipedia's reference table) —
  // years where Jan 1 doesn't fall in week 1, or Dec 31 falls in the NEXT
  // year's week 1. Local dates (no UTC suffix) — the algorithm normalizes via
  // Date.UTC internally so it doesn't depend on the runner's own timezone.
  const cases: Array<[string, string]> = [
    ['2005-01-01', '2004-W53'], // Sat — still last week of 2004
    ['2005-01-02', '2004-W53'], // Sun — ditto
    ['2005-01-03', '2005-W01'], // Mon — first week of 2005
    ['2007-12-31', '2008-W01'], // Mon — already week 1 of 2008
    ['2008-12-29', '2009-W01'], // Mon — already week 1 of 2009
    ['2010-01-03', '2009-W53'], // Sun — still last week of 2009
    ['2026-01-01', '2026-W01'], // Thu — week 1 always contains Jan 1 when it's a Thu
  ];

  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      const [y, m, d] = input.split('-').map(Number);
      expect(isoWeekId(new Date(y, m - 1, d))).toBe(expected);
    });
  }

  it('pads single-digit week numbers to 2 digits', () => {
    expect(isoWeekId(new Date(2026, 0, 5))).toBe('2026-W02');
  });
});

describe('weekSeed', () => {
  it('is deterministic — same weekId always yields the same seed', () => {
    expect(weekSeed('2026-W27')).toBe(weekSeed('2026-W27'));
  });

  it('differs between different weekIds (no trivial collision on adjacent weeks)', () => {
    expect(weekSeed('2026-W27')).not.toBe(weekSeed('2026-W28'));
  });

  it('returns a non-negative integer', () => {
    const s = weekSeed('2026-W27');
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe('mulberry32', () => {
  it('is deterministic — same seed produces the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('stays within [0, 1) like Math.random, matching the step() rng contract', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
