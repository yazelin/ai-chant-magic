import type { Vec2 } from './vec';
export type { Vec2 } from './vec';

export type SpellId =
  | 'fireball' | 'firestorm' | 'frost' | 'frostnova'
  | 'thunder' | 'chain' | 'shield' | 'aegis' | 'heal' | 'holybolt';
export type ClassId = 'pyro' | 'cryo' | 'storm' | 'warden';
export type GameStatus = 'lobby' | 'playing' | 'gameover';

export interface Player {
  id: string; name: string; classId: ClassId;
  pos: Vec2; facing: number;
  hp: number; maxHp: number;
  alive: boolean; downed: boolean;
  bleedoutAt: number; reviveProgress: number; respawnAtWave: number;
  shieldUntil: number;
  // Heal-over-time (治療術) active until this sim time. Sim-only — not in the
  // snapshot; the regen is applied server-side, so the client sees hp rise.
  healUntil?: number;
  cooldowns: Record<SpellId, number>;
  connected: boolean;
}

export interface Enemy {
  id: number; pos: Vec2; hp: number; speed: number;
  slowUntil: number; radius: number; targetId: string | null;
  // Fully stopped until this sim time (frostnova/「冰結」). Sim-only — not in the
  // net snapshot; positions are server-authoritative, so the client renders the
  // freeze via the stalled positions (and the existing slowUntil blue tint).
  frozenUntil?: number;
}

export interface Projectile {
  id: number; spell: SpellId; ownerId: string;
  pos: Vec2; vel: Vec2; damage: number; radius: number; ttl: number; fuse?: number;
}

export type EffectKind = 'beam' | 'chain' | 'nova' | 'blast' | 'aura';

export interface TransientEffect {
  id: number; kind: EffectKind; ownerId?: string;
  a: Vec2; b?: Vec2; radius?: number; ttl: number; colorHint: string;
}

export interface World {
  time: number; status: GameStatus;
  players: Player[]; enemies: Enemy[]; projectiles: Projectile[]; effects: TransientEffect[];
  nextEntityId: number; wave: number; score: number;
  spawnQueue: number; spawnTimer: number; spawnCadence: number; breakTimer: number;
}

export interface MoveCommand { kind: 'move'; playerId: string; dir: Vec2; }
export interface FaceCommand { kind: 'face'; playerId: string; angle: number; }
export interface CastCommand { kind: 'cast'; playerId: string; spell: SpellId; }
export type Command = MoveCommand | FaceCommand | CastCommand;
