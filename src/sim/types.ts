import { Vec2 } from './vec';

export type SpellId = 'fireball' | 'frost' | 'thunder' | 'shield' | 'heal';

export type GameStatus = 'playing' | 'gameover';

export interface Player {
  pos: Vec2;
  facing: number;               // radians
  hp: number;
  maxHp: number;
  shieldUntil: number;          // world time (s) shield is active until; 0 = none
  cooldowns: Record<SpellId, number>; // world time (s) each spell becomes ready again
}

export interface Enemy {
  id: number;
  pos: Vec2;
  hp: number;
  speed: number;                // px/s
  slowUntil: number;            // world time (s) the enemy is slowed until
  radius: number;
}

export interface Projectile {
  id: number;
  spell: SpellId;               // 'fireball' | 'frost'
  pos: Vec2;
  vel: Vec2;                    // px/s
  damage: number;
  radius: number;
  ttl: number;                  // seconds remaining
}

export interface World {
  time: number;                 // seconds elapsed
  status: GameStatus;
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  nextEntityId: number;
  wave: number;                 // 0 before first wave starts
  score: number;                // total kills
  spawnQueue: number;           // enemies remaining to spawn this wave
  spawnTimer: number;           // seconds until next spawn
  spawnCadence: number;         // seconds between spawns this wave
  breakTimer: number;           // seconds remaining in between-wave break
}

export interface MoveCommand { kind: 'move'; dir: Vec2; }   // dir is unit length or {0,0}
export interface FaceCommand { kind: 'face'; angle: number; }
export interface CastCommand { kind: 'cast'; spell: SpellId; }
export type Command = MoveCommand | FaceCommand | CastCommand;
