import { World, Command, Vec2 } from './types';
import { CONFIG } from './config';

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
    // 'cast' handled in Task 9
  }

  movePlayer(world, moveDir, dt);
  // waves (Task 12), enemies (Task 11), projectiles (Task 10) added later.

  if (world.player.hp <= 0) {
    world.player.hp = 0;
    world.status = 'gameover';
  }
  return world;
}
