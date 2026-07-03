import { describe, it, expect } from 'vitest';
import { traditionalize } from '../src/traditionalize';

describe('traditionalize', () => {
  it('leaves already-Traditional text unchanged', () => {
    expect(traditionalize('黑暗')).toBe('黑暗');
    expect(traditionalize('爆裂魔法')).toBe('爆裂魔法');
  });

  it('converts Simplified game-vocabulary characters to Traditional', () => {
    expect(traditionalize('深渊')).toBe('深淵'); // 渊→淵
    expect(traditionalize('冻锁')).toBe('凍鎖'); // 冻→凍, 锁→鎖
    expect(traditionalize('电击')).toBe('電擊'); // 电→電, 击→擊
    expect(traditionalize('铁剑')).toBe('鐵劍'); // 铁→鐵, 剑→劍
  });

  it('is a no-op on non-CJK text (numbers, latin, punctuation)', () => {
    expect(traditionalize('abc123!?')).toBe('abc123!?');
  });

  it('handles mixed Traditional+Simplified within the same string', () => {
    expect(traditionalize('深渊詠唱')).toBe('深淵詠唱');
  });
});
