import { World, Command, Vec2, SpellId, Projectile, Enemy, Player, ClassId, TransientEffect } from './types';
import { CONFIG } from './config';
import { SPELLS } from './spells';
import { CLASSES, classSpellSet } from './classes';
import { dist, sub, len, scale } from './vec';

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------

export interface PlayerSeed {
  id: string;
  name: string;
  classId: ClassId;
}

function zeroCooldowns(): Record<SpellId, number> {
  return {
    fireball: 0, firestorm: 0, frost: 0, frostnova: 0,
    thunder: 0, chain: 0, shield: 0, aegis: 0, heal: 0, holybolt: 0,
  };
}

// Spread player spawns on a small ring near arena centre so they start distinct.
function spawnPos(index: number, count: number): Vec2 {
  const cx = CONFIG.arenaWidth / 2;
  const cy = CONFIG.arenaHeight / 2;
  if (count <= 1) return { x: cx, y: cy };
  const ring = 60;
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring };
}

export function createWorld(seeds: PlayerSeed[]): World {
  const players: Player[] = seeds.map((s, i) => {
    const def = CLASSES[s.classId];
    const maxHp = CONFIG.player.maxHp * def.hpMod;
    return {
      id: s.id,
      name: s.name,
      classId: s.classId,
      pos: spawnPos(i, seeds.length),
      facing: 0,
      hp: maxHp,
      maxHp,
      alive: true,
      downed: false,
      bleedoutAt: 0,
      reviveProgress: 0,
      respawnAtWave: 0,
      shieldUntil: 0,
      cooldowns: zeroCooldowns(),
      connected: true,
    };
  });

  return {
    time: 0,
    status: 'playing',
    players,
    enemies: [],
    projectiles: [],
    effects: [],
    nextEntityId: 1,
    wave: 0,
    score: 0,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: CONFIG.wave.baseCadence,
    breakTimer: 0,
  };
}

export function createSoloWorld(classId: ClassId = 'pyro'): World {
  return createWorld([{ id: 'local', name: 'You', classId }]);
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id);
}

function canAct(p: Player): boolean {
  return p.alive && !p.downed;
}

export function step(
  world: World,
  commands: Command[],
  dt: number,
  rng: () => number = Math.random
): World {
  if (world.status === 'gameover') return world;
  world.time += dt;

  // Latest move per player; cast queue processes every cast.
  const moveDirs = new Map<string, Vec2>();
  for (const cmd of commands) {
    const p = findPlayer(world, cmd.playerId);
    if (!p || !canAct(p)) continue;
    if (cmd.kind === 'move') moveDirs.set(p.id, cmd.dir);
    else if (cmd.kind === 'face') p.facing = cmd.angle;
    else if (cmd.kind === 'cast') castSpell(world, p, cmd.spell);
  }

  movePlayers(world, moveDirs, dt);
  updateWaves(world, dt, rng);
  updateEnemies(world, dt);
  updateRevives(world, dt);
  updateProjectiles(world, dt);
  decayEffects(world, dt);

  if (world.players.length > 0 && world.players.every((p) => !p.alive)) {
    world.status = 'gameover';
  }
  return world;
}

function movePlayers(world: World, moveDirs: Map<string, Vec2>, dt: number): void {
  const r = CONFIG.player.radius;
  for (const p of world.players) {
    if (!canAct(p)) continue;
    const dir = moveDirs.get(p.id);
    if (!dir) continue;
    const speed = CONFIG.player.speed * CLASSES[p.classId].speedMod;
    p.pos.x += dir.x * speed * dt;
    p.pos.y += dir.y * speed * dt;
    p.pos.x = clamp(p.pos.x, r, CONFIG.arenaWidth - r);
    p.pos.y = clamp(p.pos.y, r, CONFIG.arenaHeight - r);
  }
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

function castSpell(world: World, caster: Player, spell: SpellId): void {
  if (world.time < caster.cooldowns[spell]) return;          // on cooldown
  if (!classSpellSet(caster.classId).has(spell)) return;     // not in loadout
  caster.cooldowns[spell] = world.time + SPELLS[spell].cooldown;

  switch (spell) {
    case 'fireball':
      spawnFacingProjectile(world, caster, 'fireball',
        CONFIG.fireball.speed, 0, CONFIG.fireball.radius, CONFIG.fireball.ttl);
      break;
    case 'holybolt':
      spawnFacingProjectile(world, caster, 'holybolt',
        CONFIG.holybolt.speed, CONFIG.holybolt.damage, CONFIG.holybolt.radius, CONFIG.holybolt.ttl);
      break;
    case 'frost': {
      const count = CONFIG.frost.count;
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * CONFIG.frost.spread;
        const a = caster.facing + offset;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        spawnProjectile(world, caster, 'frost', dir,
          CONFIG.frost.speed, CONFIG.frost.damage, CONFIG.frost.radius, CONFIG.frost.ttl);
      }
      break;
    }
    // firestorm / frostnova / thunder / chain / shield / aegis / heal: Task A5.
    default:
      break;
  }
}

function spawnFacingProjectile(
  world: World, caster: Player, spell: SpellId,
  speed: number, damage: number, radius: number, ttl: number
): void {
  const dir = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
  spawnProjectile(world, caster, spell, dir, speed, damage, radius, ttl);
}

function spawnProjectile(
  world: World, caster: Player, spell: SpellId, dir: Vec2,
  speed: number, damage: number, radius: number, ttl: number
): void {
  world.projectiles.push({
    id: world.nextEntityId++,
    spell,
    ownerId: caster.id,
    pos: { x: caster.pos.x, y: caster.pos.y },
    vel: { x: dir.x * speed, y: dir.y * speed },
    damage, radius, ttl,
  });
}

// ---------------------------------------------------------------------------
// Projectiles (collide with enemies only — never allies)
// ---------------------------------------------------------------------------

function inBounds(p: Vec2): boolean {
  return p.x >= 0 && p.x <= CONFIG.arenaWidth && p.y >= 0 && p.y <= CONFIG.arenaHeight;
}

function pushEffect(world: World, e: Omit<TransientEffect, 'id'>): void {
  world.effects.push({ id: world.nextEntityId++, ...e });
}

function onProjectileHit(world: World, proj: Projectile, hit: Enemy): void {
  switch (proj.spell) {
    case 'fireball': {
      // AoE explosion — damages enemies only, no friendly fire.
      for (const e of world.enemies) {
        if (dist(proj.pos, e.pos) <= CONFIG.fireball.explosionRadius + e.radius) {
          e.hp -= CONFIG.fireball.explosionDamage;
        }
      }
      pushEffect(world, {
        kind: 'blast', ownerId: proj.ownerId,
        a: { x: proj.pos.x, y: proj.pos.y },
        radius: CONFIG.fireball.explosionRadius,
        ttl: CONFIG.effectTtl.blast, colorHint: CLASSES.pyro.color,
      });
      break;
    }
    case 'frost':
      hit.hp -= proj.damage;
      hit.slowUntil = world.time + CONFIG.frost.slowDuration;
      break;
    default:
      // holybolt and other direct-hit projectiles
      hit.hp -= proj.damage;
      break;
  }
}

function removeDeadEnemies(world: World): void {
  const survivors = world.enemies.filter((e) => e.hp > 0);
  world.score += world.enemies.length - survivors.length;
  world.enemies = survivors;
}

function updateProjectiles(world: World, dt: number): void {
  for (const proj of world.projectiles) {
    proj.pos.x += proj.vel.x * dt;
    proj.pos.y += proj.vel.y * dt;
    proj.ttl -= dt;
  }
  for (const proj of world.projectiles) {
    if (proj.ttl <= 0) continue;
    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      if (dist(proj.pos, e.pos) <= proj.radius + e.radius) {
        onProjectileHit(world, proj, e);
        proj.ttl = 0; // consumed
        break;
      }
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.ttl > 0 && inBounds(p.pos));
  removeDeadEnemies(world);
}

function decayEffects(world: World, dt: number): void {
  for (const e of world.effects) e.ttl -= dt;
  world.effects = world.effects.filter((e) => e.ttl > 0);
}

// ---------------------------------------------------------------------------
// Enemies (target nearest alive player; contact damage; downed transition)
// ---------------------------------------------------------------------------

function nearestAlivePlayer(world: World, from: Vec2): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of world.players) {
    if (!canAct(p)) continue;
    const d = dist(from, p.pos);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function enterDowned(world: World, p: Player): void {
  p.downed = true;
  p.hp = 0;
  p.bleedoutAt = world.time + CONFIG.bleedout.time;
  p.reviveProgress = 0;
}

function updateEnemies(world: World, dt: number): void {
  for (const e of world.enemies) {
    const target = nearestAlivePlayer(world, e.pos);
    e.targetId = target ? target.id : null;
    if (!target) continue;
    const toP = sub(target.pos, e.pos);
    const d = len(toP);
    const speed = world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
    if (d > 1) {
      const move = scale(toP, (speed * dt) / d);
      e.pos.x += move.x;
      e.pos.y += move.y;
    }
    if (d <= e.radius + CONFIG.player.radius && world.time >= target.shieldUntil) {
      target.hp -= CONFIG.contactDps * dt;
      if (target.hp <= 0) enterDowned(world, target);
    }
  }
}

// ---------------------------------------------------------------------------
// Revive (auto-proximity) — full algorithm in Task A6; inert scaffold for now.
// ---------------------------------------------------------------------------

function updateRevives(_world: World, _dt: number): void {
  // Task A6 implements downed/revive/bleedout/respawn here.
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

function beginWave(world: World): void {
  world.wave += 1;
  world.spawnQueue = CONFIG.wave.baseCount + (world.wave - 1) * CONFIG.wave.perWave;
  world.spawnCadence = Math.max(
    CONFIG.wave.minCadence,
    CONFIG.wave.baseCadence - (world.wave - 1) * CONFIG.wave.cadenceDecay
  );
  world.spawnTimer = 0; // spawn first enemy immediately
}

function spawnEnemy(world: World, rng: () => number): void {
  const W = CONFIG.arenaWidth;
  const H = CONFIG.arenaHeight;
  const edge = Math.floor(rng() * 4) % 4;
  let pos;
  if (edge === 0) pos = { x: rng() * W, y: 0 };
  else if (edge === 1) pos = { x: rng() * W, y: H };
  else if (edge === 2) pos = { x: 0, y: rng() * H };
  else pos = { x: W, y: rng() * H };
  world.enemies.push({
    id: world.nextEntityId++,
    pos,
    hp: CONFIG.enemy.baseHp + (world.wave - 1) * CONFIG.enemy.hpPerWave,
    speed: CONFIG.enemy.baseSpeed + (world.wave - 1) * CONFIG.enemy.speedPerWave,
    slowUntil: 0,
    radius: CONFIG.enemy.radius,
    targetId: null,
  });
}

function updateWaves(world: World, dt: number, rng: () => number): void {
  if (world.breakTimer > 0) {
    world.breakTimer -= dt;
    if (world.breakTimer <= 0) {
      world.breakTimer = 0;
      beginWave(world);
    }
    return;
  }
  if (world.wave === 0 && world.spawnQueue === 0) beginWave(world);

  if (world.spawnQueue > 0) {
    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      spawnEnemy(world, rng);
      world.spawnQueue -= 1;
      world.spawnTimer = world.spawnCadence;
    }
  }

  if (world.spawnQueue === 0 && world.enemies.length === 0) {
    world.breakTimer = CONFIG.wave.breakTime;
  }
}
