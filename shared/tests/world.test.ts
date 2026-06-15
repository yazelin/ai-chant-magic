// shared/tests/world.test.ts — multiplayer world (Task A4)
import { describe, it, expect } from 'vitest';
import { createWorld, createSoloWorld, step } from '../src/world';
import { CONFIG } from '../src/config';
import { CLASSES } from '../src/classes';
import { SPELLS } from '../src/spells';
import { Enemy, Player, World } from '../src/types';

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    id: 999, pos: { x: 0, y: 0 }, hp: 30, speed: 0,
    slowUntil: 0, radius: CONFIG.enemy.radius, targetId: null, ...over,
  };
}

function findPlayer(w: World, id: string): Player {
  const p = w.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`player ${id} not found`);
  return p;
}

describe('createWorld', () => {
  it('builds a Player per entry with playing status and empty arenas', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'warden' },
    ]);
    expect(w.status).toBe('playing');
    expect(w.players.length).toBe(2);
    expect(w.enemies).toEqual([]);
    expect(w.projectiles).toEqual([]);
    expect(w.effects).toEqual([]);
    expect(w.wave).toBe(0);
    expect(w.score).toBe(0);
    expect(w.time).toBe(0);
  });

  it('applies class hp modifier to maxHp and starts at full hp, alive, connected', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'warden' },
    ]);
    const ana = findPlayer(w, 'a');
    const bo = findPlayer(w, 'b');
    expect(ana.maxHp).toBe(CONFIG.player.maxHp * CLASSES.pyro.hpMod);
    expect(bo.maxHp).toBe(CONFIG.player.maxHp * CLASSES.warden.hpMod);
    expect(ana.hp).toBe(ana.maxHp);
    expect(bo.hp).toBe(bo.maxHp);
    for (const p of w.players) {
      expect(p.alive).toBe(true);
      expect(p.downed).toBe(false);
      expect(p.connected).toBe(true);
    }
  });

  it('gives every player distinct spawn positions and all spells off cooldown', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
      { id: 'c', name: 'Cy', classId: 'storm' },
    ]);
    const keys = w.players.map((p) => `${p.pos.x},${p.pos.y}`);
    expect(new Set(keys).size).toBe(w.players.length);
    for (const p of w.players) {
      for (const cd of Object.values(p.cooldowns)) expect(cd).toBe(0);
    }
  });

  it('createSoloWorld wraps a single pyro player by default', () => {
    const w = createSoloWorld();
    expect(w.players.length).toBe(1);
    expect(w.players[0].classId).toBe('pyro');
    expect(w.players[0].id).toBe('local');
    const wc = createSoloWorld('warden');
    expect(wc.players[0].classId).toBe('warden');
  });
});

describe('step — movement & facing', () => {
  it('moves the addressed player by speed * dt and sets facing', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    const aStart = a.pos.x;
    const bStart = b.pos.x;
    step(w, [
      { kind: 'move', playerId: 'a', dir: { x: 1, y: 0 } },
      { kind: 'face', playerId: 'a', angle: 1.23 },
    ], 0.5);
    expect(a.pos.x).toBeCloseTo(aStart + CONFIG.player.speed * 0.5);
    expect(a.facing).toBeCloseTo(1.23);
    expect(b.pos.x).toBeCloseTo(bStart); // unaddressed player did not move
  });

  it('ignores move/face for a downed player', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.downed = true;
    const startX = p.pos.x;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 0.5);
    expect(p.pos.x).toBeCloseTo(startX);
  });

  it('ignores move for a dead (!alive) player', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.alive = false;
    const startX = p.pos.x;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 0.5);
    expect(p.pos.x).toBeCloseTo(startX);
  });

  it('clamps the player inside the arena', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    for (let i = 0; i < 200; i++) {
      step(w, [{ kind: 'move', playerId: 'local', dir: { x: -1, y: 0 } }], 0.1);
    }
    expect(p.pos.x).toBeGreaterThanOrEqual(CONFIG.player.radius);
  });
});

describe('step — cooldown + class gating', () => {
  it('ignores a spell not in the player class loadout', () => {
    const w = createSoloWorld('warden'); // warden cannot cast fireball
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(0);
    expect(w.players[0].cooldowns.fireball).toBe(0); // never set
  });

  it('sets cooldown to time + def.cooldown and blocks an immediate repeat', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.players[0].cooldowns.fireball).toBeCloseTo(w.time + SPELLS.fireball.cooldown);
    expect(w.projectiles.length).toBe(1);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016); // still on cooldown
    expect(w.projectiles.length).toBe(1); // no second projectile
  });

  it('a downed player cannot cast', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].downed = true;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(0);
  });
});

describe('step — fireball, projectile update, no friendly fire', () => {
  it('spawns a projectile carrying ownerId travelling along facing', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].facing = 0; // +x
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].ownerId).toBe('local');
    expect(w.projectiles[0].vel.x).toBeGreaterThan(0);
  });

  it('damages an enemy in its path, scores the kill, and spawns a blast effect', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'fireball' }], 0.016);
    let sawBlast = false;
    for (let i = 0; i < 30; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) sawBlast = true;
    }
    expect(w.enemies.length).toBe(0);
    expect(w.score).toBe(1);
    expect(sawBlast).toBe(true); // a blast effect was spawned at the explosion
  });

  it('never damages allies caught in a fireball explosion (no friendly fire)', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.facing = 0;
    // ally stands inside the blast radius but NOT in contact with the enemy,
    // so any hp loss could only come from the explosion (which must not hurt allies)
    b.pos = { x: a.pos.x + 70, y: a.pos.y };
    const allyHp = b.hp;
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: a.pos.x + 30, y: a.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'fireball' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016);
    expect(w.enemies.length).toBe(0);   // enemy killed by the blast
    expect(b.hp).toBe(allyHp);          // ally completely unhurt by the explosion
  });
});

describe('step — frost (fan + slow) and holybolt (single projectile)', () => {
  it('frost spawns a fan of projectiles and slows + damages what it hits', () => {
    const w = createSoloWorld('cryo');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'frost' }], 0.016);
    expect(w.projectiles.length).toBe(CONFIG.frost.count);
    for (const proj of w.projectiles) expect(proj.ownerId).toBe('local');
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].slowUntil).toBeGreaterThan(w.time);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });

  it('holybolt spawns a single projectile that damages an enemy', () => {
    const w = createSoloWorld('warden');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'holybolt' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].spell).toBe('holybolt');
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });

  it('frost from one player never harms an ally standing in the line', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'cryo' },
      { id: 'b', name: 'Bo', classId: 'cryo' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.facing = 0;
    b.pos = { x: a.pos.x + 30, y: a.pos.y };
    const allyHp = b.hp;
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'frost' }], 0.016);
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(b.hp).toBe(allyHp);
  });
});

describe('step — firestorm (fuse: explode on contact OR ttl expiry)', () => {
  it('spawns a firestorm projectile carrying a fuse equal to its ttl', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].facing = 0;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    const proj = w.projectiles[0];
    expect(proj.spell).toBe('firestorm');
    expect(proj.fuse).toBeCloseTo(CONFIG.firestorm.ttl);
    expect(proj.ownerId).toBe('local');
  });

  it('explodes when ttl expires (no enemy contact) and damages enemies in radius', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    // Enemy placed beyond the projectile radius but inside the explosion radius
    // of the projectile's resting/expiry point — only ttl-expiry AoE can hit it.
    const landX = p.pos.x + CONFIG.firestorm.speed * CONFIG.firestorm.ttl;
    w.enemies.push(makeEnemy({ hp: 200, pos: { x: landX, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    let sawBlast = false;
    for (let i = 0; i < 120; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) sawBlast = true;
    }
    expect(w.projectiles.length).toBe(0);
    expect(w.enemies[0].hp).toBeLessThanOrEqual(200 - CONFIG.firestorm.explosionDamage);
    expect(sawBlast).toBe(true);
  });

  it('explodes on enemy contact, dealing AoE to nearby enemies', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    // Direct-contact enemy plus a second enemy nearby (within explosion radius).
    w.enemies.push(makeEnemy({ id: 1, hp: 200, pos: { x: p.pos.x + 30, y: p.pos.y } }));
    w.enemies.push(makeEnemy({ id: 2, hp: 200, pos: { x: p.pos.x + 60, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016);
    // Both enemies took explosion damage from the contact detonation.
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBeLessThanOrEqual(200 - CONFIG.firestorm.explosionDamage);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBeLessThanOrEqual(200 - CONFIG.firestorm.explosionDamage);
    expect(w.effects.some((e) => e.kind === 'blast')).toBe(false); // already decayed after 30 frames
  });

  it('never damages allies with a firestorm explosion (no friendly fire)', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.facing = 0;
    // Inside the explosion radius (120) but clear of enemy contact range, so any
    // hp loss could only come from the blast (which must not hurt allies).
    b.pos = { x: a.pos.x + 90, y: a.pos.y };
    const allyHp = b.hp;
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: a.pos.x + 30, y: a.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'firestorm' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016);
    expect(b.hp).toBe(allyHp);
  });
});

describe('step — frostnova (self-centred AoE slow + nova effect)', () => {
  it('damages and slows enemies within radius and spawns a nova effect', () => {
    const w = createSoloWorld('cryo');
    w.breakTimer = 999;
    const p = w.players[0];
    const near = makeEnemy({ id: 1, hp: 100, pos: { x: p.pos.x + CONFIG.frostnova.radius - 10, y: p.pos.y } });
    w.enemies.push(near);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'frostnova' }], 0.016);
    const e = w.enemies.find((x) => x.id === 1)!;
    expect(e.hp).toBe(100 - CONFIG.frostnova.damage);
    expect(e.slowUntil).toBeGreaterThan(w.time);
    expect(w.effects.some((eff) => eff.kind === 'nova')).toBe(true);
  });

  it('leaves enemies outside the radius untouched', () => {
    const w = createSoloWorld('cryo');
    w.breakTimer = 999;
    const p = w.players[0];
    const far = makeEnemy({ id: 2, hp: 100, pos: { x: p.pos.x + CONFIG.frostnova.radius + 50, y: p.pos.y } });
    w.enemies.push(far);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'frostnova' }], 0.016);
    const e = w.enemies.find((x) => x.id === 2)!;
    expect(e.hp).toBe(100);
    expect(e.slowUntil).toBe(0);
  });
});

describe('step — thunder (hitscan ray + beam effect)', () => {
  it('damages enemies along the facing ray and spawns a beam effect', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0; // +x
    const onRay = makeEnemy({ id: 1, hp: 100, pos: { x: p.pos.x + 120, y: p.pos.y } });
    const offRay = makeEnemy({ id: 2, hp: 100, pos: { x: p.pos.x + 120, y: p.pos.y + 200 } });
    w.enemies.push(onRay, offRay);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'thunder' }], 0.016);
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBe(100 - CONFIG.thunder.damage);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBe(100); // off the ray
    const beam = w.effects.find((e) => e.kind === 'beam');
    expect(beam).toBeTruthy();
    expect(beam!.b!.x).toBeCloseTo(p.pos.x + CONFIG.thunder.range);
    expect(beam!.b!.y).toBeCloseTo(p.pos.y);
  });

  it('ignores enemies behind the caster or beyond range', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    const behind = makeEnemy({ id: 1, hp: 100, pos: { x: p.pos.x - 80, y: p.pos.y } });
    const tooFar = makeEnemy({ id: 2, hp: 100, pos: { x: p.pos.x + CONFIG.thunder.range + 50, y: p.pos.y } });
    w.enemies.push(behind, tooFar);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'thunder' }], 0.016);
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBe(100);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBe(100);
  });
});

describe('step — chain (greedy nearest-unhit traversal)', () => {
  it('jumps along a line of enemies with decreasing damage, respecting maxJumps and visited', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.pos = { x: 200, y: 320 };
    // Three enemies spaced within jumpRange along +x; first within range of caster.
    const step1 = CONFIG.chain.jumpRange - 20;
    const e1 = makeEnemy({ id: 1, hp: 1000, pos: { x: p.pos.x + 100, y: p.pos.y } });
    const e2 = makeEnemy({ id: 2, hp: 1000, pos: { x: e1.pos.x + step1, y: p.pos.y } });
    const e3 = makeEnemy({ id: 3, hp: 1000, pos: { x: e2.pos.x + step1, y: p.pos.y } });
    w.enemies.push(e1, e2, e3);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chain' }], 0.016);
    const d = CONFIG.chain.damage;
    const f = CONFIG.chain.falloff;
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBeCloseTo(1000 - d);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBeCloseTo(1000 - d * f);
    expect(w.enemies.find((e) => e.id === 3)!.hp).toBeCloseTo(1000 - d * f * f);
    // one chain effect per segment: caster->e1, e1->e2, e2->e3 = 3
    expect(w.effects.filter((e) => e.kind === 'chain').length).toBe(3);
  });

  it('does not jump to an enemy beyond jumpRange', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.pos = { x: 200, y: 320 };
    const e1 = makeEnemy({ id: 1, hp: 1000, pos: { x: p.pos.x + 100, y: p.pos.y } });
    const e2 = makeEnemy({ id: 2, hp: 1000, pos: { x: e1.pos.x + CONFIG.chain.jumpRange + 50, y: p.pos.y } });
    w.enemies.push(e1, e2);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chain' }], 0.016);
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBeCloseTo(1000 - CONFIG.chain.damage);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBe(1000); // out of jump range
  });

  it('hits at most maxJumps enemies', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.pos = { x: 100, y: 320 };
    const gap = CONFIG.chain.jumpRange - 30;
    let x = p.pos.x + 80;
    for (let i = 1; i <= CONFIG.chain.maxJumps + 3; i++) {
      w.enemies.push(makeEnemy({ id: i, hp: 1000, pos: { x, y: p.pos.y } }));
      x += gap;
    }
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chain' }], 0.016);
    const hitCount = w.enemies.filter((e) => e.hp < 1000).length;
    expect(hitCount).toBe(CONFIG.chain.maxJumps);
  });

  it('does nothing (no effects) when no enemy is within range', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.pos = { x: 100, y: 320 };
    w.enemies.push(makeEnemy({ id: 1, hp: 1000, pos: { x: p.pos.x + CONFIG.chain.range + 100, y: p.pos.y } }));
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chain' }], 0.016);
    expect(w.enemies[0].hp).toBe(1000);
    expect(w.effects.filter((e) => e.kind === 'chain').length).toBe(0);
  });
});

describe('step — shield / aegis / heal (buff + heal allies, alive only)', () => {
  it('shield sets caster shieldUntil and spawns an aura effect', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'shield' }], 0.016);
    expect(p.shieldUntil).toBeCloseTo(w.time + CONFIG.shield.duration);
    expect(w.effects.some((e) => e.kind === 'aura')).toBe(true);
  });

  it('aegis shields alive allies in radius incl self, but skips out-of-range and downed allies', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'warden' },
      { id: 'b', name: 'Bo', classId: 'pyro' },     // in range, alive
      { id: 'c', name: 'Cy', classId: 'pyro' },     // out of range
      { id: 'd', name: 'Di', classId: 'pyro' },     // in range but downed
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    const c = findPlayer(w, 'c');
    const d = findPlayer(w, 'd');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + CONFIG.aegis.radius - 20, y: a.pos.y };
    c.pos = { x: a.pos.x + CONFIG.aegis.radius + 80, y: a.pos.y };
    d.pos = { x: a.pos.x + 10, y: a.pos.y };
    d.downed = true;
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'aegis' }], 0.016);
    expect(a.shieldUntil).toBeCloseTo(w.time + CONFIG.aegis.duration); // self
    expect(b.shieldUntil).toBeCloseTo(w.time + CONFIG.aegis.duration); // in range alive
    expect(c.shieldUntil).toBe(0); // out of range
    expect(d.shieldUntil).toBe(0); // downed -> skipped
    expect(w.effects.some((e) => e.kind === 'aura')).toBe(true);
  });

  it('heal restores alive allies in radius incl self, caps at maxHp, skips downed/dead', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'warden' },
      { id: 'b', name: 'Bo', classId: 'pyro' },   // in range, hurt
      { id: 'c', name: 'Cy', classId: 'pyro' },   // in range, downed
      { id: 'd', name: 'Di', classId: 'pyro' },   // in range, near-full (caps at maxHp)
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    const c = findPlayer(w, 'c');
    const d = findPlayer(w, 'd');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + 20, y: a.pos.y };
    c.pos = { x: a.pos.x + 30, y: a.pos.y };
    d.pos = { x: a.pos.x + 40, y: a.pos.y };
    a.hp = a.maxHp - 10;
    b.hp = 20;
    c.hp = 0; c.downed = true;
    d.hp = d.maxHp - 2; // would overflow without cap
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'heal' }], 0.016);
    expect(a.hp).toBeCloseTo(a.maxHp); // self healed (capped)
    expect(b.hp).toBeCloseTo(20 + CONFIG.heal.amount); // hurt ally healed
    expect(c.hp).toBe(0); // downed ally skipped
    expect(d.hp).toBe(d.maxHp); // capped at maxHp
    expect(w.effects.some((e) => e.kind === 'aura')).toBe(true);
  });
});

describe('step — transient effects decay', () => {
  it('decays effect ttl over time and removes expired effects', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'shield' }], 0.016);
    expect(w.effects.length).toBeGreaterThan(0);
    const ttl0 = w.effects[0].ttl;
    step(w, [], 0.05);
    if (w.effects.length > 0) expect(w.effects[0].ttl).toBeLessThan(ttl0);
    // step well past the longest effect ttl -> all gone
    for (let i = 0; i < 20; i++) step(w, [], 0.1);
    expect(w.effects.length).toBe(0);
  });
});

describe('step — gameover guard', () => {
  it('does not advance time once game over', () => {
    const w = createSoloWorld('pyro');
    w.status = 'gameover';
    const t = w.time;
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 1, y: 0 } }], 1);
    expect(w.time).toBe(t);
  });
});
