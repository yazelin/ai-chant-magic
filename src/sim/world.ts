import { World, Command, Vec2, SpellId, Projectile, Enemy } from './types';
import { CONFIG } from './config';
import { SPELLS } from './spells';
import { dist } from './vec';

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
  _rng: () => number = Math.random
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
  // waves (Task 12), enemies (Task 11) added later.
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
    case 'thunder':
      // hitscan added in Task 11
      break;
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
