import { describe, it, expect } from 'vitest';
import { normalize, levenshtein } from '../src/matcher';

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
import { matchSpell } from '../src/matcher';

describe('matchSpell — mueisho mode', () => {
  const opts = { mode: 'mueisho' as const, jumon: '我命汝顯現' };

  it('matches a chinese alias embedded in chatter', () => {
    expect(matchSpell('快放火球術啊', opts)).toBe('fireball');
  });
  it('matches an english alias', () => {
    expect(matchSpell('cast fireball now', opts)).toBe('fireball');
  });
  it('fuzzy-matches a one-char homophone error', () => {
    expect(matchSpell('火球树', opts)).toBe('fireball'); // 術→树
  });
  it('matches heal aliases', () => {
    expect(matchSpell('補血', opts)).toBe('heal');
    expect(matchSpell('please heal', opts)).toBe('heal');
  });
  it('returns null when no spell is present', () => {
    expect(matchSpell('今天天氣真好', opts)).toBeNull();
  });
});

describe('matchSpell — eisho mode', () => {
  const opts = { mode: 'eisho' as const, jumon: '我命汝顯現' };

  it('requires the jumon before the spell name', () => {
    expect(matchSpell('我命汝顯現火球術', opts)).toBe('fireball');
  });
  it('rejects a bare spell name without the jumon', () => {
    expect(matchSpell('火球術', opts)).toBeNull();
  });
  it('ignores a spell name that appears before the jumon', () => {
    // "火球術" before jumon must not trigger; only text after jumon counts
    expect(matchSpell('火球術 我命汝顯現 冰霜', opts)).toBe('frost');
  });
});
