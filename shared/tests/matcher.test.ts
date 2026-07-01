import { describe, it, expect } from 'vitest';
import { normalize, levenshtein, matchesAny } from '../src/matcher';

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
import { classSpellSet } from '../src/classes';

describe('matchSpell — direct name / chant matching', () => {
  it('matches a chinese alias embedded in chatter', () => {
    expect(matchSpell('快放火球術啊')).toBe('fireball');
  });
  it('matches an english alias', () => {
    expect(matchSpell('cast fireball now')).toBe('fireball');
  });
  it('fuzzy-matches a one-char homophone error', () => {
    expect(matchSpell('火球树')).toBe('fireball'); // 術→树
  });
  it('matches heal aliases', () => {
    expect(matchSpell('補血')).toBe('heal');
    expect(matchSpell('please heal')).toBe('heal');
  });
  it('returns null when no spell is present', () => {
    expect(matchSpell('今天天氣真好')).toBeNull();
  });
});

describe('matchSpell — per-class allowed filtering', () => {
  it('rejects a spell outside the caster class loadout (warden + 火球術 → null)', () => {
    expect(matchSpell('火球術', { allowed: classSpellSet('warden') })).toBeNull();
  });

  it('matches a spell inside the caster class loadout (warden + 治療術 → heal)', () => {
    expect(matchSpell('治療術', { allowed: classSpellSet('warden') })).toBe('heal');
  });

  it('matches a spell inside the pyro loadout (pyro + 爆裂魔法 → firestorm)', () => {
    expect(matchSpell('爆裂魔法', { allowed: classSpellSet('pyro') })).toBe('firestorm');
  });

  it('keeps scanning past a disallowed alias to the first allowed match', () => {
    // text mentions fireball (not allowed) then heal (allowed); should return heal
    expect(
      matchSpell('火球術然後治療術', { allowed: classSpellSet('warden') })
    ).toBe('heal');
  });

  it('falls back to scanning all spells when no allowed set is given', () => {
    expect(matchSpell('火球術')).toBe('fireball');
    expect(matchSpell('治療術')).toBe('heal');
  });
});

describe('matchSpell — broadened firestorm / shield aliases', () => {
  const pyro = { allowed: classSpellSet('pyro') };

  it('matches firestorm via easier-to-recognize variants', () => {
    for (const t of ['火海', '火焰', '烈焰', '大火', '火燄', 'firestorm', 'flame']) {
      expect(matchSpell(t, pyro)).toBe('firestorm');
    }
  });

  // shield + fireball are no longer in any class loadout (kept as defined spells);
  // test their aliases on the no-allowed path.
  it('matches shield via multi-char variants (no-loadout)', () => {
    for (const t of ['護盾', '護盾術', '盾牌', '護罩', '防護罩', '結界', 'shield']) {
      expect(matchSpell(t)).toBe('shield');
    }
  });

  it('still distinguishes fireball from firestorm by longest alias', () => {
    expect(matchSpell('火球')).toBe('fireball');
    expect(matchSpell('火球術')).toBe('fireball');
    expect(matchSpell('火海')).toBe('firestorm');
  });

  it('does not let shield aliases swallow aegis (聖盾 → aegis for warden)', () => {
    expect(matchSpell('聖盾', { allowed: classSpellSet('warden') })).toBe('aegis');
    // even on the no-allowed path, 聖盾 must not match shield now that
    // bare '盾' was dropped from shield's aliases
    expect(matchSpell('聖盾')).toBe('aegis');
  });
});

describe('matchesAny', () => {
  it('matches any alias in the list, fuzzily like matchSpell', () => {
    expect(matchesAny('共鳴', ['共鳴', '同心協力', 'resonance'])).toBe(true);
    expect(matchesAny('大家一起共鳴詠唱吧', ['共鳴'])).toBe(true);
    expect(matchesAny('resonance now', ['resonance'])).toBe(true);
  });

  it('returns false when nothing in the transcript matches any alias', () => {
    expect(matchesAny('火球術', ['共鳴', 'resonance'])).toBe(false);
  });

  it('is not confused by an unrelated spell-cast phrase', () => {
    expect(matchesAny('護盾術', ['共鳴', 'resonance', 'echo'])).toBe(false);
  });
});
