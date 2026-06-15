import { describe, it, expect } from 'vitest';
import { normalize, levenshtein } from '../../src/voice/matcher';

describe('normalize', () => {
  it('lowercases and strips spaces and punctuation', () => {
    expect(normalize('  Fire Ball! ')).toBe('fireball');
  });
  it('strips chinese/japanese punctuation but keeps han chars', () => {
    expect(normalize('火球，術。')).toBe('火球術');
  });
  it('converts fullwidth latin to halfwidth', () => {
    expect(normalize('ＦＩＲＥ')).toBe('fire');
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('fire', 'fire')).toBe(0);
  });
  it('counts single substitutions', () => {
    expect(levenshtein('火球術', '火球树')).toBe(1);
  });
  it('counts insert/delete', () => {
    expect(levenshtein('fire', 'fires')).toBe(1);
  });
});
