import {
  Vec2,
  World,
  Command,
  SpellId,
  ClassId,
  createSoloWorld,
  step,
} from '@acm/shared';
import { GameSession } from './GameSession';

// Single-player session. Owns a solo World built for the chosen class and runs
// the shared `step` locally. Input is accumulated between ticks: the latest
// move/face wins, casts queue up and are each emitted as a command on the next
// tick. GameScene drives time by calling `tick(dt)` from its Phaser update.
export class LocalSession implements GameSession {
  private readonly selfId = 'local';
  private world: World;
  private latestMove: Vec2 = { x: 0, y: 0 };
  private latestFace = 0;
  private queuedCasts: SpellId[] = [];
  private worldCb: (w: World) => void = () => {};

  constructor(classId: ClassId = 'pyro') {
    this.world = createSoloWorld(classId);
  }

  start(): void {
    // Nothing to connect for local play; world already exists.
    this.worldCb(this.world);
  }

  sendMove(dir: Vec2): void {
    this.latestMove = dir;
  }

  sendFace(angle: number): void {
    this.latestFace = angle;
  }

  sendCast(spell: SpellId): void {
    this.queuedCasts.push(spell);
  }

  getWorld(): World {
    return this.world;
  }

  getSelfId(): string {
    return this.selfId;
  }

  onWorld(cb: (w: World) => void): void {
    this.worldCb = cb;
  }

  // Advance the simulation by dt seconds using the accumulated input. Called by
  // GameScene every Phaser frame; the server would call its own tick in Phase B.
  tick(dt: number): void {
    const commands: Command[] = [
      { kind: 'face', playerId: this.selfId, angle: this.latestFace },
      { kind: 'move', playerId: this.selfId, dir: this.latestMove },
    ];
    for (const spell of this.queuedCasts) {
      commands.push({ kind: 'cast', playerId: this.selfId, spell });
    }
    this.queuedCasts = [];

    step(this.world, commands, dt);
    this.worldCb(this.world);
  }

  // Build a fresh world for the same class (used by the restart key).
  restart(classId: ClassId): void {
    this.world = createSoloWorld(classId);
    this.latestMove = { x: 0, y: 0 };
    this.latestFace = 0;
    this.queuedCasts = [];
    this.worldCb(this.world);
  }
}
