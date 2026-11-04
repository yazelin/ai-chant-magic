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

  it('全滅從同一關重來，擊倒數保留；無盡全滅回最後一關', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'pyro');
    const w = s.getWorld();
    w.levelId = 2; w.players[0].kills = 7; w.status = 'gameover';
    for (let i = 0; i < 100; i++) s.tick(0.05);
    expect(s.getWorld().levelId).toBe(2);
    expect(s.getWorld().players[0].kills).toBe(7);
    const w2 = s.getWorld();
    w2.endless = true; w2.status = 'gameover';
    for (let i = 0; i < 100; i++) s.tick(0.05);
    expect(s.getWorld().levelId).toBe(3);
    expect(s.getWorld().endless).toBe(false);
  });

  it('最後一擊算擊倒', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'warden');
    const w = s.getWorld();
    const me = w.players[0];
    w.enemies.push({ id: 999, pos: { x: me.pos.x + 20, y: me.pos.y }, hp: 1, speed: 0, slowUntil: 0, radius: 16, targetId: null, element: 'normal' });
    s.tick(0.05);
    s.cast('a', 'holybolt');
    s.tick(0.05);
    expect(s.getWorld().players[0].kills).toBe(1);
  });

  it('20 人第 1 波不會出幾百隻，且大約 30 秒內出完', () => {
    const s = new PartySession(() => 0.5);
    for (let i = 0; i < 20; i++) s.join('p' + i, 'x', 'cryo');
    s.tick(0.05);
    const w = s.getWorld();
    expect(w.wave).toBe(1);
    expect(w.spawnQueue).toBeLessThan(100);
    expect(w.spawnQueue * w.spawnCadence).toBeLessThanOrEqual(31);
  });

  it('斷線先標離線，90 秒內回來接回同一個角色與擊倒數，超過才移除', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'cryo');
    s.join('b', 'y', 'storm');
    s.getWorld().players[0].kills = 5;
    s.away('a');
    expect(s.connectedCount()).toBe(1);
    expect(s.playerCount()).toBe(2);
    for (let i = 0; i < 200; i++) s.tick(0.05); // 10 秒
    s.join('a', 'x', 'cryo');
    expect(s.connectedCount()).toBe(2);
    expect(s.getWorld().players.find((p) => p.id === 'a')!.kills).toBe(5);
    s.away('b');
    for (let i = 0; i < 2000; i++) s.tick(0.05); // 100 秒
    expect(s.playerCount()).toBe(1);
  });

  it('大招真的放出來才發條幅事件，冷卻中按不算', () => {
    const s = new PartySession(() => 0.5);
    const got: string[] = [];
    s.onUlt = (e) => got.push(`${e.name}:${e.spell}`);
    s.join('a', '亞澤', 'cryo');
    s.tick(0.05);
    s.cast('a', 'frostnova'); s.tick(0.05);
    s.cast('a', 'frostnova'); s.tick(0.05);
    s.cast('a', 'frost'); s.tick(0.05);
    expect(got).toEqual(['亞澤:frostnova']);
  });

  it('格莉奇自己會打怪：四個職業都能在 60 秒內擊倒魔物且活著', () => {
    for (const cls of ['pyro', 'cryo', 'storm', 'warden'] as const) {
      let seed = 7;
      const s = new PartySession(() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
      s.setNpc(cls);
      for (let i = 0; i < 1200; i++) s.tick(0.05);
      const g = s.getWorld().players.find((p) => p.name === '格莉奇')!;
      expect(g.classId).toBe(cls);
      expect(g.kills ?? 0, cls).toBeGreaterThan(3);
    }
  });

  it('格莉奇可以關掉、換職業時擊倒數保留', () => {
    const s = new PartySession(() => 0.5);
    s.setNpc('cryo');
    s.getWorld().players[0].kills = 9;
    s.setNpc('storm');
    expect(s.npcClass()).toBe('storm');
    expect(s.getWorld().players[0].kills).toBe(9);
    s.setNpc(null);
    expect(s.playerCount()).toBe(0);
  });

  it('死掉 8 秒後自己復活，不用等下一波（魔王波也一樣）', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'cryo');
    s.join('b', 'y', 'storm');
    s.tick(0.05);
    const w = s.getWorld();
    const b = w.players.find((p) => p.id === 'b')!;
    b.alive = false; b.downed = false; b.hp = 0; b.respawnAtWave = w.wave + 1;
    for (let i = 0; i < 100; i++) s.tick(0.05); // 5 秒
    expect(s.getWorld().players.find((p) => p.id === 'b')!.alive).toBe(false);
    for (let i = 0; i < 80; i++) s.tick(0.05); // 再 4 秒
    const b2 = s.getWorld().players.find((p) => p.id === 'b')!;
    expect(b2.alive).toBe(true);
    expect(b2.hp).toBe(b2.maxHp);
  });

  it('只有一個人加格莉奇也能放共鳴（她會跟著喊）', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'pyro');
    s.setNpc('warden');
    s.tick(0.05);
    s.resonate('a');
    s.tick(0.05);
    expect(s.getWorld().resonanceCooldownUntil).toBeGreaterThan(s.getWorld().time);
  });

  it('重置：人留著，擊倒數、今晚最遠、關卡、反應次數歸零', () => {
    const s = new PartySession(() => 0.5);
    s.join('a', 'x', 'pyro');
    s.setNpc('cryo');
    for (let i = 0; i < 200; i++) s.tick(0.05);
    const w = s.getWorld();
    w.levelId = 2; w.score = 99; w.reactionCount = 5; w.players[0].kills = 30;
    s.tick(0.05);
    expect(s.bestLabel()).toContain('第 3 關');
    s.resetAll();
    const r = s.getWorld();
    expect(r.players.length).toBe(2);
    expect(r.levelId).toBe(0);
    expect(r.score).toBe(0);
    expect(r.reactionCount).toBe(0);
    expect(r.players.every((p) => (p.kills ?? 0) === 0)).toBe(true);
    expect(s.bestLabel()).toBe('');
    expect(s.npcClass()).toBe('cryo');
  });

  it('名字過濾控制字元與角括號，最多 8 個字', () => {
    expect(cleanName('<b>一二三四五六七八九</b>')).toBe('b一二三四五六七');
    expect(cleanName('   ')).toBe('勇者');
  });
});
