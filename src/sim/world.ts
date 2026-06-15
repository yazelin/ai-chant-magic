import { World, Command, Vec2, SpellId, Projectile, Enemy } from './types';
import { CONFIG } from './config';
import { SPELLS } from './spells';
import { dist, sub, len, scale } from './vec';

export function createWorld(): World {
  return {
    time: 0,
    status: 'playing',
    player: {
      pos: { x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 },
      facing: 0,
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      shieldUntil: 0,
      cooldowns: { fireball: 0, frost: 0, thunder: 0, shield: 0, heal: 0 },
    },
    enemies: [],
    projectiles: [],
    nextEntityId: 1,
    wave: 0,
    score: 0,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: CONFIG.wave.baseCadence,
    breakTimer: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function movePlayer(world: World, dir: Vec2, dt: number): void {
  const p = world.player;
  p.pos.x += dir.x * CONFIG.player.speed * dt;
  p.pos.y += dir.y * CONFIG.player.speed * dt;
  const r = CONFIG.player.radius;
  p.pos.x = clamp(p.pos.x, r, CONFIG.arenaWidth - r);
  p.pos.y = clamp(p.pos.y, r, CONFIG.arenaHeight - r);
}

export function step(
  world: World,
  commands: Command[],
  dt: number,
  rng: () => number = Math.random
): World {
  if (world.status === 'gameover') return world;
  world.time += dt;

  let moveDir: Vec2 = { x: 0, y: 0 };
  for (const cmd of commands) {
    if (cmd.kind === 'move') moveDir = cmd.dir;
    else if (cmd.kind === 'face') world.player.facing = cmd.angle;
    else if (cmd.kind === 'cast') castSpell(world, cmd.spell);
  }

  movePlayer(world, moveDir, dt);
  updateWaves(world, dt, rng);
  updateEnemies(world, dt);
  updateProjectiles(world, dt);

  if (world.player.hp <= 0) {
    world.player.hp = 0;
    world.status = 'gameover';
  }
  return world;
}

function castSpell(world: World, spell: SpellId): void {
  const p = world.player;
  if (world.time < p.cooldowns[spell]) return; // on cooldown
  p.cooldowns[spell] = world.time + SPELLS[spell].cooldown;

  switch (spell) {
    case 'shield':
      p.shieldUntil = world.time + CONFIG.shield.duration;
      break;
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.heal.amount);
      break;
    case 'fireball': {
      const dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      spawnProjectile(world, 'fireball', dir, CONFIG.fireball.speed, CONFIG.fireball.damage, CONFIG.fireball.radius, CONFIG.fireball.ttl);
      break;
    }
    case 'frost': {
      for (let i = 0; i < CONFIG.frost.count; i++) {
        const offset = (i - (CONFIG.frost.count - 1) / 2) * CONFIG.frost.spread;
        const a = p.facing + offset;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        spawnProjectile(world, 'frost', dir, CONFIG.frost.speed, CONFIG.frost.damage, CONFIG.frost.radius, CONFIG.frost.ttl);
      }
      break;
    }
    case 'thunder': {
      const dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      castThunder(world, dir);
      break;
    }
  }
}

function spawnProjectile(world: World, spell: SpellId, dir: Vec2, speed: number, damage: number, radius: number, ttl: number): void {
  world.projectiles.push({
    id: world.nextEntityId++,
    spell,
    pos: { x: world.player.pos.x, y: world.player.pos.y },
    vel: { x: dir.x * speed, y: dir.y * speed },
    damage, radius, ttl,
  });
}

function inBounds(p: Vec2): boolean {
  return p.x >= 0 && p.x <= CONFIG.arenaWidth && p.y >= 0 && p.y <= CONFIG.arenaHeight;
}

function onProjectileHit(world: World, proj: Projectile, hit: Enemy): void {
  if (proj.spell === 'fireball') {
    for (const e of world.enemies) {
      if (dist(proj.pos, e.pos) <= CONFIG.fireball.explosionRadius + e.radius) {
        e.hp -= CONFIG.fireball.explosionDamage;
      }
    }
  } else {
    // frost
    hit.hp -= proj.damage;
    hit.slowUntil = world.time + CONFIG.frost.slowDuration;
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

function castThunder(world: World, dir: Vec2): void {
  const o = world.player.pos;
  for (const e of world.enemies) {
    const rel = sub(e.pos, o);
    const along = rel.x * dir.x + rel.y * dir.y;       // distance along the ray
    if (along < 0 || along > CONFIG.thunder.range) continue;
    const perp = Math.abs(rel.x * -dir.y + rel.y * dir.x); // perpendicular offset
    if (perp <= CONFIG.thunder.width + e.radius) e.hp -= CONFIG.thunder.damage;
  }
  removeDeadEnemies(world);
}

function updateEnemies(world: World, dt: number): void {
  const p = world.player;
  for (const e of world.enemies) {
    const toP = sub(p.pos, e.pos);
    const d = len(toP);
    const speed = world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
    if (d > 1) {
      const move = scale(toP, (speed * dt) / d);
      e.pos.x += move.x;
      e.pos.y += move.y;
    }
    if (d <= e.radius + CONFIG.player.radius && world.time >= p.shieldUntil) {
      p.hp -= CONFIG.contactDps * dt;
    }
  }
}

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
