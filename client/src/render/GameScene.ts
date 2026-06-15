import Phaser from 'phaser';
import {
  World,
  Player,
  TransientEffect,
  SpellId,
  ClassId,
  CONFIG,
  CLASSES,
} from '@acm/shared';
import { moveDirFromKeys, facingFromMouse } from '../input/controls';
import { LocalSession } from '../session/LocalSession';

// Parse the '#rrggbb' color strings on CLASSES / effect.colorHint into the
// 0xRRGGBB integers Phaser's Graphics API wants.
function hexColor(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

export class GameScene extends Phaser.Scene {
  private session: LocalSession;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private keys = new Set<string>();
  // default face right until first pointer move
  private mouse: { x: number; y: number } = { x: CONFIG.arenaWidth, y: CONFIG.arenaHeight / 2 };

  constructor(session: LocalSession) {
    super('game');
    this.session = session;
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.session.start();

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      // Test keys 1/2/3 cast the self class's three spells (no mic needed).
      if (k === '1' || k === '2' || k === '3') {
        const spell = this.selfSpell(Number(k) - 1);
        if (spell) this.session.sendCast(spell);
      }
    });
    this.input.keyboard!.on('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.mouse = { x: p.x, y: p.y };
    });
  }

  // Recognized voice / number keys route through here.
  queueCast(spell: SpellId): void {
    this.session.sendCast(spell);
  }

  getWorld(): World {
    return this.session.getWorld();
  }

  selfClassId(): ClassId {
    const self = this.self();
    return self ? self.classId : 'pyro';
  }

  restart(): void {
    this.session.restart(this.selfClassId());
  }

  private self(): Player | undefined {
    const w = this.session.getWorld();
    return w.players.find((p) => p.id === this.session.getSelfId());
  }

  private selfSpell(index: number): SpellId | undefined {
    return CLASSES[this.selfClassId()].spells[index];
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05); // clamp huge frames
    const self = this.self();
    if (self) {
      this.session.sendFace(facingFromMouse(self.pos, this.mouse));
      this.session.sendMove(moveDirFromKeys(this.keys));
    }

    this.session.tick(dt);
    this.draw();
  }

  private draw(): void {
    const w = this.session.getWorld();
    const g = this.gfx;
    g.clear();

    this.drawEffects(w);

    // enemies
    g.fillStyle(0xd64550, 1);
    for (const e of w.enemies) g.fillCircle(e.pos.x, e.pos.y, e.radius);

    // projectiles (use the spell's class color where obvious, else white)
    for (const p of w.projectiles) {
      const c =
        p.spell === 'fireball' || p.spell === 'firestorm'
          ? 0xff8c1a
          : p.spell === 'frost'
            ? 0x39c5e0
            : p.spell === 'holybolt'
              ? 0xffd24d
              : 0xffffff;
      g.fillStyle(c, 1);
      g.fillCircle(p.pos.x, p.pos.y, p.radius);
    }

    const live = new Set<string>();
    for (const pl of w.players) {
      if (!pl.connected) continue;
      this.drawPlayer(w, pl);
      live.add(pl.id);
    }
    // drop labels for players no longer present/connected
    for (const [id, label] of this.labels) {
      if (!live.has(id)) {
        label.destroy();
        this.labels.delete(id);
      }
    }
  }

  // --- effects: neon lines (beam/chain) + glow circles (nova/blast/aura) ------
  private drawEffects(w: World): void {
    const g = this.gfx;
    for (const fx of w.effects) {
      const color = hexColor(fx.colorHint);
      // fade with remaining ttl for a soft pop-out
      const alpha = Math.max(0.15, Math.min(1, fx.ttl * 3));
      if (fx.kind === 'beam' || fx.kind === 'chain') {
        this.drawGlowLine(fx, color, alpha);
      } else {
        this.drawGlowCircle(fx, color, alpha);
      }
    }
    g.lineStyle(0, 0, 0);
  }

  private drawGlowLine(fx: TransientEffect, color: number, alpha: number): void {
    const g = this.gfx;
    const b = fx.b ?? fx.a;
    // outer soft halo then a bright core
    g.lineStyle(fx.kind === 'beam' ? 12 : 8, color, alpha * 0.3);
    g.lineBetween(fx.a.x, fx.a.y, b.x, b.y);
    g.lineStyle(fx.kind === 'beam' ? 4 : 3, color, alpha);
    g.lineBetween(fx.a.x, fx.a.y, b.x, b.y);
  }

  private drawGlowCircle(fx: TransientEffect, color: number, alpha: number): void {
    const g = this.gfx;
    const r = fx.radius ?? 40;
    g.fillStyle(color, alpha * 0.18);
    g.fillCircle(fx.a.x, fx.a.y, r);
    g.lineStyle(2, color, alpha * 0.9);
    g.strokeCircle(fx.a.x, fx.a.y, r);
  }

  // --- players: class shape + neon glow + facing + label + downed/revive ------
  private drawPlayer(w: World, pl: Player): void {
    const g = this.gfx;
    const def = CLASSES[pl.classId];
    const color = hexColor(def.color);
    const r = CONFIG.player.radius;
    const x = pl.pos.x;
    const y = pl.pos.y;

    if (pl.downed) {
      this.drawDowned(pl, color);
      this.drawLabel(pl, x, y - r - 14, 0x9aa0b5);
      return;
    }

    // active shield ring
    if (w.time < pl.shieldUntil) {
      g.lineStyle(2, 0x9fd8ff, 0.9);
      g.strokeCircle(x, y, r + 7);
    }

    // neon glow halo behind the shape
    g.fillStyle(color, 0.22);
    g.fillCircle(x, y, r + 8);

    // class shape
    g.fillStyle(color, 1);
    g.lineStyle(2, 0xffffff, 0.85);
    this.drawShape(def.shape, x, y, r);

    // facing line
    g.lineStyle(3, 0xffffff, 1);
    g.lineBetween(x, y, x + Math.cos(pl.facing) * (r + 8), y + Math.sin(pl.facing) * (r + 8));

    this.drawLabel(pl, x, y - r - 14, color);
  }

  private drawShape(shape: string, x: number, y: number, r: number): void {
    const g = this.gfx;
    if (shape === 'circle') {
      g.fillCircle(x, y, r);
      g.strokeCircle(x, y, r);
      return;
    }
    const sides = shape === 'triangle' ? 3 : shape === 'diamond' ? 4 : 6;
    // diamond = square rotated 45deg; triangle points up; hexagon flat-ish
    const rot = shape === 'triangle' ? -Math.PI / 2 : shape === 'diamond' ? -Math.PI / 2 : 0;
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      pts.push(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
    }
    g.fillPoints(this.toPoints(pts), true);
    g.strokePoints(this.toPoints(pts), true);
  }

  private toPoints(flat: number[]): Phaser.Geom.Point[] {
    const out: Phaser.Geom.Point[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push(new Phaser.Geom.Point(flat[i], flat[i + 1]));
    return out;
  }

  private drawDowned(pl: Player, color: number): void {
    const g = this.gfx;
    const r = CONFIG.player.radius;
    const x = pl.pos.x;
    const y = pl.pos.y;
    // dim grey marker (a cross) for a downed ally
    g.lineStyle(3, 0x6a6f85, 0.9);
    g.lineBetween(x - r, y - r, x + r, y + r);
    g.lineBetween(x - r, y + r, x + r, y - r);
    // revive progress ring (0..1 -> arc) in the class color
    const prog = Math.max(0, Math.min(1, pl.reviveProgress));
    if (prog > 0) {
      g.lineStyle(4, color, 0.95);
      g.beginPath();
      g.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2, false);
      g.strokePath();
    } else {
      g.lineStyle(2, 0x44485c, 0.7);
      g.strokeCircle(x, y, r + 6);
    }
  }

  private drawLabel(pl: Player, x: number, y: number, color: number): void {
    let label = this.labels.get(pl.id);
    const css = '#' + color.toString(16).padStart(6, '0');
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '12px' })
        .setOrigin(0.5, 1);
      this.labels.set(pl.id, label);
    }
    label.setText(pl.name);
    label.setColor(css);
    label.setPosition(x, y);
  }
}
