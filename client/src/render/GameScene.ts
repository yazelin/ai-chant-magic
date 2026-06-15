import Phaser from 'phaser';
import { World, Command, SpellId, createWorld, step, CONFIG } from '@acm/shared';
import { moveDirFromKeys, facingFromMouse } from '../input/controls';

export class GameScene extends Phaser.Scene {
  private world!: World;
  private gfx!: Phaser.GameObjects.Graphics;
  private keys = new Set<string>();
  private mouse: { x: number; y: number } = { x: CONFIG.arenaWidth, y: CONFIG.arenaHeight / 2 }; // default face right until first pointer move
  private pendingCasts: SpellId[] = [];
  private beam: { from: { x: number; y: number }; to: { x: number; y: number }; ttl: number } | null = null;

  constructor() {
    super('game');
  }

  create(): void {
    this.world = createWorld();
    this.gfx = this.add.graphics();

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.keys.add(e.key.toLowerCase()));
    this.input.keyboard!.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.mouse = { x: p.x, y: p.y };
    });
  }

  // called by main.ts when the voice layer recognizes a spell
  queueCast(spell: SpellId): void {
    this.pendingCasts.push(spell);
  }

  getWorld(): World {
    return this.world;
  }

  restart(): void {
    this.world = createWorld();
    this.beam = null;
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05); // clamp huge frames
    const facing = facingFromMouse(this.world.player.pos, this.mouse);
    const dir = moveDirFromKeys(this.keys);

    const commands: Command[] = [
      { kind: 'face', angle: facing },
      { kind: 'move', dir },
    ];
    for (const spell of this.pendingCasts) {
      commands.push({ kind: 'cast', spell });
      if (spell === 'thunder') {
        const d = { x: Math.cos(facing), y: Math.sin(facing) };
        this.beam = {
          from: { ...this.world.player.pos },
          to: { x: this.world.player.pos.x + d.x * CONFIG.thunder.range, y: this.world.player.pos.y + d.y * CONFIG.thunder.range },
          ttl: 0.12,
        };
      }
    }
    this.pendingCasts = [];

    step(this.world, commands, dt);
    if (this.beam) {
      this.beam.ttl -= dt;
      if (this.beam.ttl <= 0) this.beam = null;
    }
    this.draw();
  }

  private draw(): void {
    const g = this.gfx;
    g.clear();

    // enemies
    g.fillStyle(0xd64550, 1);
    for (const e of this.world.enemies) g.fillCircle(e.pos.x, e.pos.y, e.radius);

    // projectiles
    for (const p of this.world.projectiles) {
      g.fillStyle(p.spell === 'fireball' ? 0xff8c1a : 0x39c5e0, 1);
      g.fillCircle(p.pos.x, p.pos.y, p.radius);
    }

    // thunder beam
    if (this.beam) {
      g.lineStyle(4, 0xfff066, 1);
      g.beginPath();
      g.moveTo(this.beam.from.x, this.beam.from.y);
      g.lineTo(this.beam.to.x, this.beam.to.y);
      g.strokePath();
    }

    // player + facing + shield
    const pl = this.world.player;
    if (this.world.time < pl.shieldUntil) {
      g.lineStyle(2, 0x66ccff, 0.9);
      g.strokeCircle(pl.pos.x, pl.pos.y, CONFIG.player.radius + 6);
    }
    g.fillStyle(0x4f9dff, 1);
    g.fillCircle(pl.pos.x, pl.pos.y, CONFIG.player.radius);
    g.lineStyle(3, 0xffffff, 1);
    g.beginPath();
    g.moveTo(pl.pos.x, pl.pos.y);
    g.lineTo(pl.pos.x + Math.cos(pl.facing) * 22, pl.pos.y + Math.sin(pl.facing) * 22);
    g.strokePath();
  }
}
