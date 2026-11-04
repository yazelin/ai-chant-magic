import { describe, it, expect } from 'vitest';
import { PartySession, cleanName } from './PartySession';

describe('PartySession（等待模式）', () => {
  it('沒人時不會被判定全滅，也不生怪', () => {
    const s = new PartySession(() => 0.5);
    for (let i = 0; i < 200; i++) s.tick(0.05);
    expect(s.getWorld().status).toBe('playing');
    expect(s.getWorld().enemies.length).toBe(0);
  });

  it('隨時加入、離開，換職業只重建自己', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', '亞澤', 'cryo');
    s.join('b', '', 'storm');
    expect(s.playerCount()).toBe(2);
    expect(s.getWorld().players.find((p) => p.id === 'b')!.name).toBe('勇者');
    s.join('a', '亞澤', 'warden');
    expect(s.playerCount()).toBe(2);
    expect(s.getWorld().players.find((p) => p.id === 'a')!.classId).toBe('warden');
    s.leave('b');
    expect(s.playerCount()).toBe(1);
  });

  it('不是自己職業的招式放不出來', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'cryo');
    s.tick(0.05);
    s.cast('a', 'firestorm');
    s.cast('a', 'frostnova');
    s.tick(0.05);
    const p = s.getWorld().players[0];
    expect(p.cooldowns.firestorm).toBe(0);
    expect(p.cooldowns.frostnova).toBeGreaterThan(0);
  });

  it('全滅後幾秒原地重來，玩家留著', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'pyro');
    s.join('b', 'y', 'cryo');
    s.getWorld().status = 'gameover';
    for (let i = 0; i < 100; i++) s.tick(0.05);
    expect(s.getWorld().status).toBe('playing');
    expect(s.playerCount()).toBe(2);
  });

  it('名字過濾控制字元與角括號，最多 8 個字', () => {
    expect(cleanName('<b>一二三四五六七八九</b>')).toBe('b一二三四五六七');
    expect(cleanName('   ')).toBe('勇者');
  });
});
