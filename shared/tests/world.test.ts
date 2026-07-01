// shared/tests/world.test.ts — multiplayer world (Task A4)
import { describe, it, expect } from 'vitest';
import { createWorld, createSoloWorld, step } from '../src/world';
import { CONFIG } from '../src/config';
import { CLASSES } from '../src/classes';
import { Enemy, Player, World } from '../src/types';

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  return {
    id: 999, pos: { x: 0, y: 0 }, hp: 30, speed: 0,
    slowUntil: 0, radius: CONFIG.enemy.radius, targetId: null, element: 'normal', ...over,
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
    expect(w.levelId).toBe(0);
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

  it('clamps a non-unit move dir to at most speed*dt of travel', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    const p = w.players[0];
    p.pos = { x: 480, y: 320 }; // centre, far from arena walls
    const startX = p.pos.x;
    // Client supplies an over-long dir {x:5,y:0}. Without clamping this would move
    // 5x the intended distance; with clamping it must move by at most speed*dt.
    step(w, [{ kind: 'move', playerId: 'local', dir: { x: 5, y: 0 } }], 0.1);
    const speed = CONFIG.player.speed * CLASSES.pyro.speedMod;
    expect(p.pos.x - startX).toBeCloseTo(speed * 0.1); // exactly one unit-length step
    expect(p.pos.x - startX).toBeLessThanOrEqual(speed * 0.1 + 1e-6);
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

  it('sets a dynamic 爆裂 cooldown (base + charge) and blocks an immediate repeat', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    // chant once → 1 charge, then 爆裂魔法
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    expect(w.players[0].cooldowns.firestorm).toBeCloseTo(w.time + CONFIG.firestorm.baseCd + 1 * CONFIG.firestorm.cdPerCharge);
    expect(w.projectiles.length).toBe(1);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016); // on cooldown + 0 charge
    expect(w.projectiles.length).toBe(1); // no second projectile
  });

  it('a downed player cannot cast', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].downed = true;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    expect(w.projectiles.length).toBe(0);
    expect(w.players[0].pyroCharge ?? 0).toBe(0); // chant ignored too
  });
});

describe('step — 爆裂 projectile update, no friendly fire', () => {
  // pyro's only projectile is now 爆裂魔法 (firestorm), which needs ≥1 chant charge.
  it('spawns a projectile carrying ownerId travelling along facing', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    w.players[0].facing = 0; // +x
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
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
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    let sawBlast = false;
    for (let i = 0; i < 30; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) sawBlast = true;
    }
    expect(w.enemies.length).toBe(0);
    expect(w.score).toBe(1);
    expect(sawBlast).toBe(true); // a blast effect was spawned at the explosion
  });

  it('never damages allies caught in the explosion (no friendly fire)', () => {
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
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'chant1' }], 0.016);
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'firestorm' }], 0.016);
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

  it('holybolt is a self-centred burst that damages a nearby enemy', () => {
    const w = createSoloWorld('warden');
    w.breakTimer = 999;
    const p = w.players[0];
    const near = makeEnemy({ id: 1, hp: 100, pos: { x: p.pos.x + 30, y: p.pos.y } });
    const far = makeEnemy({ id: 2, hp: 100, pos: { x: p.pos.x + CONFIG.holybolt.radius + 80, y: p.pos.y } });
    w.enemies.push(near, far);
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'holybolt' }], 0.016);
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBe(100 - CONFIG.holybolt.damage); // in radius
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBe(100); // out of radius
    expect(w.effects.some((e) => e.kind === 'nova')).toBe(true);
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
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016); // 1 charge
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
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016); // 1 charge
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    let sawBlast = false;
    for (let i = 0; i < 120; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) sawBlast = true;
    }
    expect(w.projectiles.length).toBe(0);
    // 1 charge → damage = baseDamage + perChargeDamage*1
    expect(w.enemies[0].hp).toBeLessThanOrEqual(200 - (CONFIG.firestorm.baseDamage + CONFIG.firestorm.perChargeDamage));
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
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016); // 1 charge
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'firestorm' }], 0.016);
    // Step until the firestorm detonates on contact, capturing the blast effect on
    // the very frame it spawns (before it decays away).
    let sawBlastImmediately = false;
    for (let i = 0; i < 30; i++) {
      step(w, [], 0.016);
      if (w.effects.some((e) => e.kind === 'blast')) { sawBlastImmediately = true; break; }
    }
    // A 'blast' effect EXISTS immediately after the detonation frame.
    expect(sawBlastImmediately).toBe(true);
    // Both enemies took explosion damage from the contact detonation (1 charge).
    const fsDmg1 = CONFIG.firestorm.baseDamage + CONFIG.firestorm.perChargeDamage;
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBeLessThanOrEqual(200 - fsDmg1);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBeLessThanOrEqual(200 - fsDmg1);
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
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'chant1' }], 0.016); // 1 charge
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
    // The beam now reflects off the arena walls: firing +x with range > the
    // distance to the right wall, the first segment ends AT the wall (x=arenaWidth).
    const beam = w.effects.find((e) => e.kind === 'beam');
    expect(beam).toBeTruthy();
    expect(beam!.b!.x).toBeCloseTo(CONFIG.arenaWidth);
    expect(beam!.b!.y).toBeCloseTo(p.pos.y);
  });

  it('ignores enemies behind the caster or beyond range', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    p.facing = 0;
    // Off the beam axis (the reflected segment now travels back along y=p.pos.y,
    // so "behind" must also be off-axis to be a clean "not on any segment" check).
    const behind = makeEnemy({ id: 1, hp: 100, pos: { x: p.pos.x - 80, y: p.pos.y + 250 } });
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
    expect(a.aegisUntil).toBeCloseTo(w.time + CONFIG.aegis.duration); // self power buff marker
    expect(b.shieldUntil).toBeCloseTo(w.time + CONFIG.aegis.duration); // in range alive
    expect(b.aegisUntil).toBeCloseTo(w.time + CONFIG.aegis.duration);
    expect(c.shieldUntil).toBe(0); // out of range
    expect(c.aegisUntil).toBeUndefined();
    expect(d.shieldUntil).toBe(0); // downed -> skipped
    expect(d.aegisUntil).toBeUndefined();
    expect(w.effects.some((e) => e.kind === 'aura')).toBe(true);
  });

  it('aegis doubles skill damage while active, then damage returns to normal after it expires', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'warden' },
      { id: 'b', name: 'Bo', classId: 'storm' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + 20, y: a.pos.y };
    b.facing = 0;

    w.enemies.push(makeEnemy({ id: 1, hp: 200, pos: { x: b.pos.x + 120, y: b.pos.y } }));
    step(w, [
      { kind: 'cast', playerId: 'a', spell: 'aegis' },
      { kind: 'cast', playerId: 'b', spell: 'thunder' },
    ], 0);
    expect(w.enemies.find((e) => e.id === 1)!.hp).toBe(200 - CONFIG.thunder.damage * 2);

    step(w, [], CONFIG.aegis.duration + 0.01);
    b.cooldowns.thunder = 0;
    w.enemies = [makeEnemy({ id: 2, hp: 200, pos: { x: b.pos.x + 120, y: b.pos.y } })];
    step(w, [{ kind: 'cast', playerId: 'b', spell: 'thunder' }], 0);
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBe(200 - CONFIG.thunder.damage);
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
    step(w, [{ kind: 'cast', playerId: 'a', spell: 'heal' }], 0.016); // grants HoT to a/b/d
    expect(w.effects.some((e) => e.kind === 'aura')).toBe(true);
    // tick past the full heal duration so the regen lands
    for (let i = 0; i < 270; i++) step(w, [], 0.016);
    expect(a.hp).toBe(a.maxHp); // self regenerated, capped
    expect(b.hp).toBeGreaterThanOrEqual(20 + CONFIG.heal.rate * CONFIG.heal.duration - 1); // ~+40 over time
    expect(b.hp).toBeLessThanOrEqual(b.maxHp);
    expect(c.hp).toBe(0); // downed ally skipped (never got the HoT)
    expect(d.hp).toBe(d.maxHp); // capped at maxHp
  });

  it('aegis doubles healing ticks while active', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'warden' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + 20, y: a.pos.y };
    b.hp = 20;
    step(w, [
      { kind: 'cast', playerId: 'a', spell: 'aegis' },
      { kind: 'cast', playerId: 'a', spell: 'heal' },
    ], 0);

    step(w, [], 1);
    expect(b.hp).toBeCloseTo(20 + CONFIG.heal.rate * 2);
  });
});

describe('step — transient effects decay', () => {
  it('decays effect ttl over time and removes expired effects', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999;
    step(w, [{ kind: 'cast', playerId: 'local', spell: 'chant1' }], 0.016); // spawns an aura fx
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

// ---------------------------------------------------------------------------
// Task A6 — downed / revive / bleedout / respawn / scaling / gameover
// ---------------------------------------------------------------------------

// Park an enemy on top of a player to grind it into the downed state.
function downViaContact(w: World, target: Player): void {
  // Place an enemy in contact and step until hp drains to downed.
  w.enemies.push(makeEnemy({ id: 5000, hp: 100000, pos: { x: target.pos.x, y: target.pos.y } }));
  for (let i = 0; i < 200 && !target.downed && target.alive; i++) {
    step(w, [], 0.05);
  }
  // Remove the grinder so it does not interfere with subsequent assertions.
  w.enemies = w.enemies.filter((e) => e.id !== 5000);
}

describe('step — downed transition', () => {
  it('a lone player reaching hp<=0 enters downed (not dead, not gameover yet)', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999; // isolate from auto-spawn
    const p = w.players[0];
    downViaContact(w, p);
    expect(p.downed).toBe(true);
    expect(p.alive).toBe(true);          // downed is NOT dead
    expect(p.hp).toBe(0);
    expect(p.bleedoutAt).toBeGreaterThan(w.time);
    expect(p.reviveProgress).toBe(0);
    expect(w.status).toBe('playing');    // not gameover while still downed (alive)
  });
});

describe('step — revive (auto-proximity)', () => {
  it('an alive ally within revive radius revives a downed player to revive hp', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + CONFIG.revive.radius - 10, y: a.pos.y }; // within revive radius
    // Put 'a' down manually (avoid an enemy chasing 'b' mid-test).
    a.downed = true; a.hp = 0; a.bleedoutAt = w.time + CONFIG.bleedout.time; a.reviveProgress = 0;
    // Channel long enough to exceed revive.time.
    for (let i = 0; i < 100 && a.downed; i++) step(w, [], 0.05);
    expect(a.downed).toBe(false);
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(CONFIG.revive.hp);
  });

  it('a warden reviver channels faster (1.5x) than a non-warden reviver', () => {
    function ticksToRevive(reviverClass: 'pyro' | 'warden'): number {
      const w = createWorld([
        { id: 'a', name: 'Ana', classId: 'pyro' },        // downed
        { id: 'b', name: 'Bo', classId: reviverClass },   // reviver
      ]);
      w.breakTimer = 999;
      const a = findPlayer(w, 'a');
      const b = findPlayer(w, 'b');
      a.pos = { x: 480, y: 320 };
      b.pos = { x: a.pos.x + 10, y: a.pos.y };
      a.downed = true; a.hp = 0; a.bleedoutAt = w.time + 999; a.reviveProgress = 0;
      let ticks = 0;
      for (let i = 0; i < 500 && a.downed; i++) { step(w, [], 0.05); ticks++; }
      expect(a.downed).toBe(false);
      return ticks;
    }
    const pyroTicks = ticksToRevive('pyro');
    const wardenTicks = ticksToRevive('warden');
    expect(wardenTicks).toBeLessThan(pyroTicks);
  });

  it('with no ally near, revive progress decays and the player bleeds out', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 100, y: 100 };
    b.pos = { x: 900, y: 600 }; // far away, well beyond revive radius
    a.downed = true; a.hp = 0; a.bleedoutAt = w.time + CONFIG.bleedout.time; a.reviveProgress = 0.4;
    // First tick with no ally near: progress must decay (not climb).
    step(w, [], 0.05);
    expect(a.reviveProgress).toBeLessThan(0.4);
    // Eventually bleeds out (alive=false), never revived.
    for (let i = 0; i < 400 && a.alive; i++) step(w, [], 0.05);
    expect(a.alive).toBe(false);
    expect(a.downed).toBe(false);
    expect(a.reviveProgress).toBeGreaterThanOrEqual(0); // decayed, never negative
  });
});

describe('step — connected flag (disconnected = no chase / no revive / no command)', () => {
  it('a downed player with only a disconnected ally near gains NO revive progress', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' }, // downed
      { id: 'b', name: 'Bo', classId: 'pyro' },  // alive but disconnected
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 480, y: 320 };
    b.pos = { x: a.pos.x + 10, y: a.pos.y }; // well within revive radius
    b.connected = false;                      // disconnected -> not a valid reviver
    a.downed = true; a.hp = 0; a.bleedoutAt = w.time + CONFIG.bleedout.time; a.reviveProgress = 0;
    // Channel: a disconnected ally must NOT accrue any revive progress.
    for (let i = 0; i < 5; i++) step(w, [], 0.05);
    expect(a.reviveProgress).toBe(0);
    expect(a.downed).toBe(true); // never revived by the disconnected ally
  });

  it('enemies ignore a disconnected alive player and target the connected one', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' }, // connected
      { id: 'b', name: 'Bo', classId: 'pyro' },  // disconnected
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    // Put the disconnected player MUCH closer to the enemy than the connected one.
    a.pos = { x: 600, y: 320 };
    b.pos = { x: 120, y: 320 };
    b.connected = false;
    const bHp = b.hp;
    const bStart = { x: b.pos.x, y: b.pos.y };
    // Enemy sits right next to the disconnected player — would chase/damage it if
    // the connected flag were ignored.
    const enemy = makeEnemy({ id: 7, hp: 100000, speed: 100, pos: { x: b.pos.x + 5, y: b.pos.y } });
    w.enemies.push(enemy);
    for (let i = 0; i < 5; i++) step(w, [], 0.05);
    // Enemy must target the connected player, not the disconnected one.
    expect(enemy.targetId).toBe('a');
    // The disconnected player is neither approached nor damaged.
    expect(b.hp).toBe(bHp);
    expect(b.pos).toEqual(bStart);
    // Enemy moved toward the connected player (to the right of its start).
    expect(enemy.pos.x).toBeGreaterThan(b.pos.x + 5);
  });

  it('a disconnected player does not consume move/face/cast commands', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    a.connected = false;
    const startX = a.pos.x;
    const startFacing = a.facing;
    step(w, [
      { kind: 'move', playerId: 'a', dir: { x: 1, y: 0 } },
      { kind: 'face', playerId: 'a', angle: 1.23 },
      { kind: 'cast', playerId: 'a', spell: 'fireball' },
    ], 0.1);
    expect(a.pos.x).toBeCloseTo(startX);   // did not move
    expect(a.facing).toBe(startFacing);     // did not turn
    expect(w.projectiles.length).toBe(0);   // did not cast
  });
});

describe('step — bleedout -> dead -> respawn next wave', () => {
  it('a downed player with no rescuer past bleedout becomes !alive and is scheduled for the next wave', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' }, // alive so the team is not gameover
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.pos = { x: 100, y: 100 };
    b.pos = { x: 900, y: 600 }; // far, never revives 'a'
    w.wave = 3;
    a.downed = true; a.hp = 0; a.bleedoutAt = w.time + CONFIG.bleedout.time; a.reviveProgress = 0;
    for (let i = 0; i < 400 && a.alive; i++) step(w, [], 0.05);
    expect(a.alive).toBe(false);
    expect(a.downed).toBe(false);
    expect(a.respawnAtWave).toBe(w.wave + 1);
  });

  it('does not respawn a dead player before their respawnAtWave', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    const a = findPlayer(w, 'a');
    // Dead and scheduled to respawn two waves out, but the next beginWave is sooner.
    a.alive = false; a.downed = false; a.hp = 0;
    a.respawnAtWave = w.wave + 2;
    // Drive a single wave boundary (only +1 wave).
    w.spawnQueue = 0;
    w.enemies = [];
    w.breakTimer = 0;
    const startWave = w.wave;
    for (let i = 0; i < 200 && w.wave === startWave; i++) step(w, [], 0.1);
    expect(w.wave).toBe(startWave + 1);
    // wave (startWave+1) < respawnAtWave (startWave+2) -> still dead.
    expect(a.alive).toBe(false);
    expect(a.hp).toBe(0);
  });

  it('beginWave respawns a dead player at full hp', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    const a = findPlayer(w, 'a');
    a.alive = false; a.downed = false; a.hp = 0; a.respawnAtWave = w.wave + 1;
    // Drive a wave boundary: clear current spawn and let the break->beginWave fire.
    w.spawnQueue = 0;
    w.enemies = [];
    w.breakTimer = 0;
    const startWave = w.wave;
    for (let i = 0; i < 200 && w.wave === startWave; i++) step(w, [], 0.1);
    expect(w.wave).toBeGreaterThan(startWave);
    expect(a.alive).toBe(true);
    expect(a.downed).toBe(false);
    expect(a.hp).toBe(a.maxHp);
  });
});

describe('step — player-count scaling (super-linear)', () => {
  it('spawns more enemies for 3 players than for 1 (super-linear via scaleExp)', () => {
    function totalSpawnForWave1(playerCount: number): number {
      const seeds = Array.from({ length: playerCount }, (_, i) => ({
        id: `p${i}`, name: `P${i}`, classId: 'pyro' as const,
      }));
      const w = createWorld(seeds);
      // rng=()=>0 so spawn edge/positions are deterministic.
      step(w, [], 0.016, () => 0);
      // At wave 1, total spawn = enemies already spawned + remaining queue.
      return w.spawnQueue + w.enemies.length;
    }
    const solo = totalSpawnForWave1(1);
    const trio = totalSpawnForWave1(3);
    // Solo == baseCount (scale factor 1). Trio is super-linear: > 3x base would be
    // linear; assert it exceeds the linear projection from solo.
    expect(trio).toBeGreaterThan(solo * 3);
    expect(solo).toBe(CONFIG.wave.baseCount);
  });
});

describe('step — gameover', () => {
  it('marks gameover when every player is !alive', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    for (const p of w.players) { p.alive = false; p.downed = false; }
    step(w, [], 0.016);
    expect(w.status).toBe('gameover');
  });

  it('solo path: lone player downed with no rescuer bleeds out into gameover', () => {
    const w = createSoloWorld('pyro');
    w.breakTimer = 999; // isolate from auto-spawn
    const p = w.players[0];
    p.downed = true; p.hp = 0; p.bleedoutAt = w.time + CONFIG.bleedout.time; p.reviveProgress = 0;
    for (let i = 0; i < 400 && w.status === 'playing'; i++) step(w, [], 0.05);
    expect(p.alive).toBe(false);
    expect(w.status).toBe('gameover');
  });

  it('ignores a disconnected-but-alive player: gameover when every CONNECTED player is !alive', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' }, // disconnected, still alive
      { id: 'b', name: 'Bo', classId: 'pyro' },  // connected, will die
    ]);
    w.breakTimer = 999;
    const a = findPlayer(w, 'a');
    const b = findPlayer(w, 'b');
    a.connected = false; // disconnected but alive — must NOT keep the game alive
    a.alive = true;
    // Drive the connected player into death via the bleedout sim path.
    b.downed = true; b.hp = 0; b.bleedoutAt = w.time + CONFIG.bleedout.time; b.reviveProgress = 0;
    for (let i = 0; i < 400 && w.status === 'playing'; i++) step(w, [], 0.05);
    expect(b.alive).toBe(false);
    expect(a.alive).toBe(true); // the disconnected player is still nominally alive
    expect(w.status).toBe('gameover'); // but the only CONNECTED player is dead -> gameover
  });

  it('a fully-disconnected world does not false-trigger gameover', () => {
    const w = createWorld([
      { id: 'a', name: 'Ana', classId: 'pyro' },
      { id: 'b', name: 'Bo', classId: 'pyro' },
    ]);
    w.breakTimer = 999;
    // Everyone disconnected (still alive). No CONNECTED players exist, so the
    // gameover guard must not fire (the room reaper handles abandonment instead).
    for (const p of w.players) p.connected = false;
    step(w, [], 0.05);
    expect(w.status).toBe('playing');
  });
});

describe('step — slime elements (phase 2 behaviour)', () => {
  it('ice slime slows the player on contact', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    w.enemies.push(makeEnemy({ id: 1, hp: 9999, element: 'ice', pos: { x: p.pos.x, y: p.pos.y } }));
    step(w, [], 0.05);
    expect((p.slowUntil ?? 0)).toBeGreaterThan(w.time);
  });

  it('fire slime explodes on death, hurting a nearby (non-contact) player', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    const hp0 = p.hp;
    // within explode radius (85) but beyond contact range (~26) so only the blast hits
    w.enemies.push(makeEnemy({ id: 1, hp: 0, element: 'fire', pos: { x: p.pos.x + 55, y: p.pos.y } }));
    step(w, [], 0.05);
    expect(p.hp).toBe(hp0 - CONFIG.slime.fire.explodeDamage);
    // the dead fire slime is gone and left a blast effect
    expect(w.enemies.find((e) => e.id === 1)).toBeUndefined();
    expect(w.effects.some((e) => e.kind === 'blast')).toBe(true);
  });

  it('holy slime heals a damaged nearby slime over time', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    const spot = { x: p.pos.x - 200, y: p.pos.y };
    w.enemies.push(makeEnemy({ id: 1, hp: 9999, element: 'holy', pos: { ...spot } }));
    const patient = makeEnemy({ id: 2, hp: 5, maxHp: 30, element: 'normal', pos: { ...spot } });
    w.enemies.push(patient);
    for (let i = 0; i < 40; i++) step(w, [], 0.05); // > healInterval
    expect(w.enemies.find((e) => e.id === 2)!.hp).toBeGreaterThan(5);
  });

  it('storm slime winds up (telegraph) then lunges further than a walk', () => {
    const w = createSoloWorld('storm');
    w.breakTimer = 999;
    const p = w.players[0];
    const startX = p.pos.x - 300;
    const slime = makeEnemy({ id: 1, hp: 9999, element: 'storm', speed: 81, pos: { x: startX, y: p.pos.y }, nextDashAt: 0 });
    w.enemies.push(slime);
    step(w, [], 0.05); // enters telegraph: locks dir, holds still
    const s = w.enemies.find((e) => e.id === 1)!;
    expect(s.telegraphUntil ?? 0).toBeGreaterThan(w.time);
    expect(s.dashDir).toBeTruthy();
    for (let i = 0; i < 16; i++) step(w, [], 0.05); // through telegraph + dash
    // dashed toward the player (+x) by more than a plain 0.8s walk would manage
    expect(w.enemies.find((e) => e.id === 1)!.pos.x - startX).toBeGreaterThan(90);
  });
});

describe('step — 史萊姆王 boss', () => {
  it('spawns a boss on a boss wave (wave % every === 0)', () => {
    const w = createSoloWorld('storm');
    w.wave = CONFIG.boss.every - 1;
    w.breakTimer = 0.02; // about to roll into the next wave
    w.spawnQueue = 0;
    w.enemies = [];
    step(w, [], 0.05); // breakTimer → 0 → beginWave → boss wave
    expect(w.wave).toBe(CONFIG.boss.every);
    expect(w.enemies.some((e) => e.boss === true)).toBe(true);
  });

  it('boss summons minions on its interval', () => {
    const w = createSoloWorld('storm');
    w.wave = CONFIG.boss.every - 1;
    w.breakTimer = 0.02;
    w.spawnQueue = 0;
    w.enemies = [];
    step(w, [], 0.05);
    const boss = w.enemies.find((e) => e.boss === true)!;
    expect(boss).toBeTruthy();
    w.spawnQueue = 0; // isolate from the regular swarm drip
    boss.nextSummonAt = w.time; // due immediately
    const before = w.enemies.length;
    step(w, [], 0.05);
    expect(w.enemies.length).toBe(before + CONFIG.boss.summonCount);
  });
});
