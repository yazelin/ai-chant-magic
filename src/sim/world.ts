import { World } from './types';
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
