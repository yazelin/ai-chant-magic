import Phaser from 'phaser';
import {
  World,
  Player,
  Enemy,
  TransientEffect,
  SpellId,
  ClassId,
  CONFIG,
  CLASSES,
} from '@acm/shared';
import { moveDirFromKeys, facingFromMouse } from '../input/controls';
import { GameSession } from '../session/GameSession';

// Pixel-art sprite textures. Keys for the four mages are their ClassId so a
// player's texture is just `player.classId`; enemies share one 'enemy' key.
// Vite rewrites these URLs at build time so the PNGs are hashed + bundled.
const SPRITES: Array<{ key: string; url: string }> = [
  { key: 'pyro', url: new URL('../assets/pyro.png', import.meta.url).href },
  { key: 'cryo', url: new URL('../assets/cryo.png', import.meta.url).href },
  { key: 'storm', url: new URL('../assets/storm.png', import.meta.url).href },
  { key: 'warden', url: new URL('../assets/warden.png', import.meta.url).href },
  { key: 'enemy', url: new URL('../assets/enemy.png', import.meta.url).href },
  // Anime pyro pilot: two procedurally-driven frames (face RIGHT by default).
  { key: 'pyro-idle', url: new URL('../assets/pyro-idle.png', import.meta.url).href },
  { key: 'pyro-cast', url: new URL('../assets/pyro-cast.png', import.meta.url).href },
];

// Per-class frame map. The pyro pilot swaps idle<->cast; everyone else still
// renders their single legacy texture (keyed by classId).
type FrameSet = { idle: string; cast?: string };
const CLASS_FRAMES: Partial<Record<ClassId, FrameSet>> = {
  pyro: { idle: 'pyro-idle', cast: 'pyro-cast' },
};
function framesFor(classId: ClassId): FrameSet {
  return CLASS_FRAMES[classId] ?? { idle: classId };
}

// Target on-screen heights for the upright sprites (px). The scale is derived
// from each texture's real pixel height so source art can be any size. The
// anime full-body pyro reads better a bit taller than the legacy chibi sprites.
const ENEMY_SPRITE_H = CONFIG.enemy.radius * 2.8; // ≈ 34px
const PLAYER_SPRITE_H_DEFAULT = CONFIG.player.radius * 3; // ≈ 42px
const PLAYER_SPRITE_H_PYRO = 64; // anime full-body
function playerSpriteH(classId: ClassId): number {
  return classId === 'pyro' ? PLAYER_SPRITE_H_PYRO : PLAYER_SPRITE_H_DEFAULT;
}

const DEPTH_ENEMY = 5;
const DEPTH_PLAYER = 10;
const DEPTH_VFX = 8; // glow images sit above enemies, below players
const DEPTH_TRAIL = 7; // ember trails just under the projectile core

const CAST_POSE_SECS = 0.3; // how long the cast frame + punch lasts

// Parse the '#rrggbb' color strings on CLASSES / effect.colorHint into the
// 0xRRGGBB integers Phaser's Graphics API wants.
function hexColor(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

// Per-player procedural-animation state. Lives in a Map keyed by player id and
// is created lazily on first sight (alongside the pooled sprite).
interface PlayerAnimState {
  bobPhase: number; // advances faster while moving
  castUntil: number; // scene-clock time the cast pose/punch ends
  lastX: number; // previous position, for speed/movement detection
  lastY: number;
}

// Pooled fireball visual: an additive glow halo + bright core + ember trail.
interface FireVfx {
  halo: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class GameScene extends Phaser.Scene {
  private session: GameSession;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  // Pooled sprites, keyed by entity id. Created on first sight, repositioned
  // each frame, and destroyed when the entity leaves the world (mirrors the
  // name-label pooling). Never recreated per frame.
  private playerSprites = new Map<string, Phaser.GameObjects.Image>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  // Pyro pilot procedural anim state, keyed by player id.
  private playerAnim = new Map<string, PlayerAnimState>();
  // Pooled fireball/firestorm glow visuals, keyed by projectile id.
  private fireVfx = new Map<number, FireVfx>();
  // Cast-detection bookkeeping: ids whose appearance we've already reacted to.
  private seenProj = new Set<number>();
  private seenFx = new Set<number>();
  // Scene clock (seconds), accumulated from dt. Drives bob/pulse/cast timing.
  private t = 0;

  private keys = new Set<string>();
  // default face right until first pointer move
  private mouse: { x: number; y: number } = { x: CONFIG.arenaWidth, y: CONFIG.arenaHeight / 2 };

  // GameScene is session-agnostic: it renders whatever World the injected
  // GameSession exposes (LocalSession runs the sim locally; NetSession returns
  // an interpolated snapshot world). It never touches `step` itself.
  constructor(session: GameSession) {
    super('game');
    this.session = session;
  }

  preload(): void {
    for (const s of SPRITES) this.load.image(s.key, s.url);
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.makeVfxTextures();
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

  // Generate two soft radial textures at runtime so the VFX need no PNG assets:
  //  - 'glow'  : 64px soft white disc (concentric translucent circles)
  //  - 'spark' : 16px soft white dot (used by the ember trail/burst emitters)
  private makeVfxTextures(): void {
    if (!this.textures.exists('glow')) {
      const g = this.add.graphics();
      const steps = 16;
      for (let i = steps; i >= 1; i--) {
        const r = (i / steps) * 32;
        const a = (1 - i / steps) * 0.12 + 0.02;
        g.fillStyle(0xffffff, a);
        g.fillCircle(32, 32, r);
      }
      g.generateTexture('glow', 64, 64);
      g.destroy();
    }
    if (!this.textures.exists('spark')) {
      const g = this.add.graphics();
      const steps = 8;
      for (let i = steps; i >= 1; i--) {
        const r = (i / steps) * 8;
        const a = (1 - i / steps) * 0.18 + 0.04;
        g.fillStyle(0xffffff, a);
        g.fillCircle(8, 8, r);
      }
      g.generateTexture('spark', 16, 16);
      g.destroy();
    }
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
    this.t += dt;
    const self = this.self();
    if (self) {
      this.session.sendFace(facingFromMouse(self.pos, this.mouse));
      this.session.sendMove(moveDirFromKeys(this.keys));
    }

    this.session.tick(dt);
    this.draw(dt);
  }

  private draw(dt: number): void {
    const w = this.session.getWorld();
    const g = this.gfx;
    g.clear();

    // Cast detection runs before drawing players so the caster snaps to the
    // cast pose on the same frame their spell first appears.
    this.detectCasts(w);

    this.drawEffects(w);

    // enemies — pooled upright sprites (texture 'enemy'), below players
    const liveEnemies = new Set<number>();
    for (const e of w.enemies) {
      this.drawEnemy(w, e);
      liveEnemies.add(e.id);
    }
    for (const [id, sprite] of this.enemySprites) {
      if (!liveEnemies.has(id)) {
        sprite.destroy();
        this.enemySprites.delete(id);
      }
    }

    // projectiles: fire spells get the additive glow + ember trail; the others
    // keep the flat fill circle for now (pilot focuses on fire).
    const liveProj = new Set<number>();
    for (const p of w.projectiles) {
      liveProj.add(p.id);
      if (p.spell === 'fireball' || p.spell === 'firestorm') {
        this.drawFireProjectile(p);
      } else {
        const c =
          p.spell === 'frost'
            ? 0x39c5e0
            : p.spell === 'holybolt'
              ? 0xffd24d
              : 0xffffff;
        g.fillStyle(c, 1);
        g.fillCircle(p.pos.x, p.pos.y, p.radius);
      }
    }
    // tear down glow visuals for projectiles that have left the world
    for (const [id, vfx] of this.fireVfx) {
      if (!liveProj.has(id)) {
        this.destroyFireVfx(vfx);
        this.fireVfx.delete(id);
      }
    }

    const live = new Set<string>();
    for (const pl of w.players) {
      if (!pl.connected) continue;
      this.drawPlayer(w, pl, dt);
      live.add(pl.id);
    }
    // drop labels + sprites + anim state for players no longer present
    for (const [id, label] of this.labels) {
      if (!live.has(id)) {
        label.destroy();
        this.labels.delete(id);
      }
    }
    for (const [id, sprite] of this.playerSprites) {
      if (!live.has(id)) {
        sprite.destroy();
        this.playerSprites.delete(id);
        this.playerAnim.delete(id);
      }
    }

    // Prune seen-id sets to the ids currently in the world so they never grow
    // unbounded across a long session.
    this.pruneSeen(this.seenProj, liveProj);
    const liveFxIds = new Set<number>();
    for (const fx of w.effects) liveFxIds.add(fx.id);
    this.pruneSeen(this.seenFx, liveFxIds);
  }

  private pruneSeen(seen: Set<number>, live: Set<number>): void {
    for (const id of seen) if (!live.has(id)) seen.delete(id);
  }

  // CAST DETECTION + impact reactions. For every NEW projectile or effect id
  // owned by a player, flip that player into the cast pose. Blast effects also
  // trigger a one-shot ember burst + subtle camera flash/shake on first sight.
  private detectCasts(w: World): void {
    const byId = new Map<string, PlayerAnimState>();
    for (const [id, s] of this.playerAnim) byId.set(id, s);

    for (const p of w.projectiles) {
      if (this.seenProj.has(p.id)) continue;
      this.seenProj.add(p.id);
      const st = byId.get(p.ownerId);
      if (st) st.castUntil = this.t + CAST_POSE_SECS;
    }
    for (const fx of w.effects) {
      if (this.seenFx.has(fx.id)) {
        // already reacted to this effect id
      } else {
        this.seenFx.add(fx.id);
        if (fx.ownerId) {
          const st = byId.get(fx.ownerId);
          if (st) st.castUntil = this.t + CAST_POSE_SECS;
        }
        if (fx.kind === 'blast') this.onBlast(fx);
      }
    }
  }

  // One-shot fireball impact: radial ember burst + brief orange flash + tiny
  // shake. Kept subtle so it reads as punchy, not nauseating.
  private onBlast(fx: TransientEffect): void {
    const burst = this.add.particles(fx.a.x, fx.a.y, 'spark', {
      lifespan: 360,
      speed: { min: 60, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xfff0a0, 0xff8c1a, 0xd63a1a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    burst.setDepth(DEPTH_VFX);
    burst.explode(24);
    // self-destruct once every particle has faded
    this.time.delayedCall(450, () => burst.destroy());

    this.cameras.main.flash(120, 255, 140, 40, false);
    this.cameras.main.shake(120, 0.004);
  }

  // Lazily create (or fetch) a pooled Image for `key` at `id`. Sizing is owned
  // by the caller now (player sizing depends on idle/cast frame + cast punch),
  // so this only guarantees the Image exists with the right base texture.
  private spriteFor(
    pool: Map<string | number, Phaser.GameObjects.Image>,
    id: string | number,
    key: string,
    targetH: number,
  ): Phaser.GameObjects.Image {
    let sprite = pool.get(id);
    if (!sprite) {
      sprite = this.add.image(0, 0, key);
      const texH = sprite.height || targetH;
      sprite.setScale(targetH / texH);
      pool.set(id, sprite);
    }
    return sprite;
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

  // --- fireball/firestorm: pooled additive glow + bright core + ember trail ---
  private drawFireProjectile(p: { id: number; pos: { x: number; y: number }; radius: number }): void {
    let vfx = this.fireVfx.get(p.id);
    if (!vfx) {
      const halo = this.add.image(p.pos.x, p.pos.y, 'glow');
      halo.setBlendMode(Phaser.BlendModes.ADD).setTint(0xff8c1a).setDepth(DEPTH_VFX);
      const core = this.add.image(p.pos.x, p.pos.y, 'glow');
      core.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe08a).setDepth(DEPTH_VFX);
      const trail = this.add.particles(p.pos.x, p.pos.y, 'spark', {
        lifespan: 300,
        frequency: 35, // ~28/s
        quantity: 1,
        speed: { min: 0, max: 30 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xff8c1a, 0xd63a1a],
        blendMode: Phaser.BlendModes.ADD,
      });
      trail.setDepth(DEPTH_TRAIL);
      vfx = { halo, core, trail };
      this.fireVfx.set(p.id, vfx);
    }

    // gentle pulse so the orb feels alive
    const pulse = 1 + 0.15 * Math.sin(this.t * 20);
    // 'glow' is a 64px texture whose visible disc is ~32px radius; size the halo
    // so it reads ~2.5x the projectile radius.
    const haloScale = ((p.radius * 2.5) / 32) * pulse;
    const coreScale = ((p.radius * 1.1) / 32) * pulse;
    vfx.halo.setPosition(p.pos.x, p.pos.y).setScale(haloScale);
    vfx.core.setPosition(p.pos.x, p.pos.y).setScale(coreScale);
    vfx.trail.setPosition(p.pos.x, p.pos.y);
  }

  private destroyFireVfx(vfx: FireVfx): void {
    vfx.halo.destroy();
    vfx.core.destroy();
    vfx.trail.destroy();
  }

  // --- enemies: pooled 'enemy' sprite, upright, below players -----------------
  private drawEnemy(w: World, e: Enemy): void {
    const sprite = this.spriteFor(
      this.enemySprites as Map<string | number, Phaser.GameObjects.Image>,
      e.id,
      'enemy',
      ENEMY_SPRITE_H,
    );
    sprite.setPosition(e.pos.x, e.pos.y); // upright — never rotated
    sprite.setDepth(DEPTH_ENEMY);
    // subtle frost tint while slowed, else normal
    if (w.time < e.slowUntil) sprite.setTint(0x9fd8ff);
    else sprite.clearTint();
  }

  // --- players: flip L/R + procedural bob + cast pose/punch (NO rotation) -----
  private drawPlayer(w: World, pl: Player, dt: number): void {
    const g = this.gfx;
    const def = CLASSES[pl.classId];
    const color = hexColor(def.color);
    const r = CONFIG.player.radius;
    const x = pl.pos.x;
    const y = pl.pos.y;
    const baseH = playerSpriteH(pl.classId);
    const frames = framesFor(pl.classId);

    // anim state (lazy)
    let st = this.playerAnim.get(pl.id);
    if (!st) {
      st = { bobPhase: Math.random() * Math.PI * 2, castUntil: 0, lastX: x, lastY: y };
      this.playerAnim.set(pl.id, st);
    }

    const casting = this.t < st.castUntil;
    // pyro swaps idle<->cast; everyone else only has 'idle' (== legacy texture)
    const wantKey = casting && frames.cast ? frames.cast : frames.idle;

    // pooled image. The pool's stored base scale is stale once we swap textures
    // or apply the cast punch, so we recompute display height every frame.
    const sprite = this.spriteFor(
      this.playerSprites as Map<string | number, Phaser.GameObjects.Image>,
      pl.id,
      wantKey,
      baseH,
    );
    if (sprite.texture.key !== wantKey) sprite.setTexture(wantKey);
    sprite.setDepth(DEPTH_PLAYER);
    sprite.setAlpha(pl.downed ? 0.4 : 1);

    if (pl.downed) {
      // downed: no bob/cast, keep the legacy dim+cross marker. Normalize size.
      sprite.setScale(baseH / sprite.height);
      sprite.setFlipX(false);
      sprite.setPosition(x, y);
      this.drawDowned(pl, color);
      this.drawLabel(pl, x, y - r - 14, 0x9aa0b5);
      return;
    }

    // face the aim's horizontal side (sprites face right by default).
    sprite.setFlipX(Math.cos(pl.facing) < 0);

    // movement detection from frame-to-frame displacement
    const dx = x - st.lastX;
    const dy = y - st.lastY;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    const moving = speed > 20;
    st.lastX = x;
    st.lastY = y;

    // bob: faster + bigger while moving
    st.bobPhase += dt * (moving ? 10 : 3.5);
    const yOffset = Math.sin(st.bobPhase) * (moving ? 5 : 2.5);

    // base uniform scale to render the current texture at `baseH` px tall
    const baseScale = baseH / sprite.height;
    // cast punch: a quick scale-up that decays over CAST_POSE_SECS
    const punch = casting ? 1 + 0.15 * ((st.castUntil - this.t) / CAST_POSE_SECS) : 1;
    // subtle idle "breathing" on scaleY when not moving/casting
    const breathe = !moving && !casting ? 1 + 0.03 * Math.sin(st.bobPhase) : 1;

    sprite.setScale(baseScale * punch, baseScale * punch * breathe);
    sprite.setPosition(x, y + yOffset);

    // active shield ring
    if (w.time < pl.shieldUntil) {
      g.lineStyle(2, 0x9fd8ff, 0.9);
      g.strokeCircle(x, y, r + 7);
    }

    // facing line
    g.lineStyle(3, 0xffffff, 1);
    g.lineBetween(x, y, x + Math.cos(pl.facing) * (r + 8), y + Math.sin(pl.facing) * (r + 8));

    this.drawLabel(pl, x, y - r - 14, color);
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
