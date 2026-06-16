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
import { initAudio, sfxCast, sfxFireball, sfxExplosion } from '../audio/sfx';

// Pixel-art sprite textures. Keys for the four mages are their ClassId so a
// player's texture is just `player.classId`; enemies share one 'enemy' key.
// Vite rewrites these URLs at build time so the PNGs are hashed + bundled.
const SPRITES: Array<{ key: string; url: string }> = [
  { key: 'pyro', url: new URL('../assets/pyro.png', import.meta.url).href },
  { key: 'cryo', url: new URL('../assets/cryo.png', import.meta.url).href },
  { key: 'storm', url: new URL('../assets/storm.png', import.meta.url).href },
  { key: 'warden', url: new URL('../assets/warden.png', import.meta.url).href },
  { key: 'enemy', url: new URL('../assets/enemy.png', import.meta.url).href },
];

// Anime chibi pyro: a real walk-cycle spritesheet plus single idle/cast frames.
// All three are 249x170 cells, side-view facing RIGHT, bottom-center aligned.
const CHIBI_PYRO_WALK = new URL('../assets/chibi-pyro-walk.png', import.meta.url).href;
const CHIBI_PYRO_IDLE = new URL('../assets/chibi-pyro-idle.png', import.meta.url).href;
const CHIBI_PYRO_CAST = new URL('../assets/chibi-pyro-cast.png', import.meta.url).href;
const CHIBI_PYRO_FRAME = { width: 249, height: 170 };
const PYRO_WALK_ANIM = 'pyro-walk';

// Target on-screen heights for the upright sprites (px). The scale is derived
// from each texture's real pixel height so source art can be any size.
const ENEMY_SPRITE_H = CONFIG.enemy.radius * 2.8; // ≈ 34px
const PLAYER_SPRITE_H_DEFAULT = CONFIG.player.radius * 3; // ≈ 42px

// Chibi pyro: the 170px cell is mostly filled by the character, so a fixed
// scale that lands the on-screen height around ~70px reads right.
const PYRO_TARGET_H = 70;
const PYRO_SCALE = PYRO_TARGET_H / CHIBI_PYRO_FRAME.height; // ≈ 0.412
// Feet sit near the bottom of the cell; origin-y near the bottom + a tiny world
// offset so the chibi looks grounded at its world pos (like the old centered
// sprites). Higher origin-y = the art's feet land closer to the world pos.
const PYRO_ORIGIN_Y = 0.82;
// Small downward nudge so the feet read as planted at the player pos rather than
// slightly above it (tune by eyeball alongside PYRO_ORIGIN_Y).
const PYRO_GROUND_OFFSET = 6;

const DEPTH_ENEMY = 5;
const DEPTH_PLAYER = 10;
const DEPTH_VFX = 8; // glow images sit above enemies, below players
const DEPTH_TRAIL = 7; // ember trails just under the projectile core

const CAST_POSE_SECS = 0.3; // how long the cast frame + punch lasts

// A 'blast' effect at/above this radius is treated as a firestorm explosion
// (bigger spectacle + sound). Sits between fireball's 60 and firestorm's 120
// explosionRadius in CONFIG.
const FIRESTORM_BLAST_RADIUS = 90;

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

// Pooled fire-projectile visual: an additive glow halo + bright core + ember
// trail. Firestorm also carries a second darker "smoke" ember layer so the
// roiling mass reads denser than a clean fireball orb.
interface FireVfx {
  halo: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  smoke?: Phaser.GameObjects.Particles.ParticleEmitter; // firestorm only
  storm: boolean; // which kind this pooled visual was built for
}

export class GameScene extends Phaser.Scene {
  private session: GameSession;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  // Pooled sprites, keyed by entity id. Created on first sight, repositioned
  // each frame, and destroyed when the entity leaves the world (mirrors the
  // name-label pooling). Never recreated per frame.
  // Players are Sprites (not Images) so the pyro chibi can play its walk-cycle
  // animation; a Sprite renders a static texture fine for the other classes too.
  private playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private enemySprites = new Map<number, Phaser.GameObjects.Image>();
  // Pyro pilot procedural anim state, keyed by player id.
  private playerAnim = new Map<string, PlayerAnimState>();
  // Pooled fireball/firestorm glow visuals, keyed by projectile id.
  private fireVfx = new Map<number, FireVfx>();
  // Cast-detection bookkeeping: ids whose appearance we've already reacted to.
  private seenProj = new Set<number>();
  private seenFx = new Set<number>();
  // Per-frame SFX throttle: at most one explosion sound per frame even if many
  // blasts land at once. Reset at the top of each detectCasts pass.
  private explosionPlayedThisFrame = false;
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
    // Chibi pyro: walk-cycle spritesheet (7 frames of 249x170) + idle/cast.
    this.load.spritesheet('chibi-pyro-walk', CHIBI_PYRO_WALK, {
      frameWidth: CHIBI_PYRO_FRAME.width,
      frameHeight: CHIBI_PYRO_FRAME.height,
    });
    this.load.image('chibi-pyro-idle', CHIBI_PYRO_IDLE);
    this.load.image('chibi-pyro-cast', CHIBI_PYRO_CAST);
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.makeVfxTextures();

    // Define the pyro walk animation once. Guard against double-create when the
    // scene restarts (anims live on the global AnimationManager).
    if (!this.anims.exists(PYRO_WALK_ANIM)) {
      this.anims.create({
        key: PYRO_WALK_ANIM,
        frames: this.anims.generateFrameNumbers('chibi-pyro-walk', { start: 0, end: 6 }),
        frameRate: 11,
        repeat: -1,
      });
    }

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

    // Audio needs a user gesture to start; resume the SFX context on the first
    // pointer/key interaction with the canvas (idempotent + guarded, and also
    // covered by main.ts's first-click handler).
    this.input.once('pointerdown', () => initAudio());
    this.input.keyboard!.once('keydown', () => initAudio());
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

    // SFX throttles: fire at most one cast/whoosh/explosion sound per frame so
    // a burst of new ids (e.g. a multi-projectile spell or many simultaneous
    // blasts) doesn't stack into a wall of noise.
    let castPlayed = false;
    let whooshPlayed = false;
    this.explosionPlayedThisFrame = false;

    for (const p of w.projectiles) {
      if (this.seenProj.has(p.id)) continue;
      this.seenProj.add(p.id);
      const st = byId.get(p.ownerId);
      // A freshly-set castUntil means a new owned projectile appeared this frame.
      if (st) st.castUntil = this.t + CAST_POSE_SECS;
      if (!castPlayed) {
        sfxCast();
        castPlayed = true;
      }
      // Fire projectiles also get an airy whoosh.
      if ((p.spell === 'fireball' || p.spell === 'firestorm') && !whooshPlayed) {
        sfxFireball();
        whooshPlayed = true;
      }
    }
    for (const fx of w.effects) {
      if (this.seenFx.has(fx.id)) {
        // already reacted to this effect id
      } else {
        this.seenFx.add(fx.id);
        if (fx.ownerId) {
          const st = byId.get(fx.ownerId);
          if (st) st.castUntil = this.t + CAST_POSE_SECS;
          // Effect-only casts (e.g. self-AoE) still get the cast shimmer.
          if (!castPlayed) {
            sfxCast();
            castPlayed = true;
          }
        }
        if (fx.kind === 'blast') this.onBlast(fx);
      }
    }
  }

  // One-shot blast impact. A normal fireball gets a snappy ember burst + brief
  // orange flash + tiny shake. A firestorm blast (much larger radius) escalates
  // into an expanding fire ring, more + longer-lived embers, and a stronger
  // flash/shake so it reads as a proper inferno. The explosion SFX is throttled
  // to one per frame regardless of how many blasts land.
  private onBlast(fx: TransientEffect): void {
    const radius = fx.radius ?? CONFIG.fireball.explosionRadius;
    const big = radius >= FIRESTORM_BLAST_RADIUS;

    // Punchy boom (bigger/louder/longer when firestorm), capped at one per frame.
    if (!this.explosionPlayedThisFrame) {
      sfxExplosion(big);
      this.explosionPlayedThisFrame = true;
    }

    // Ember burst — denser, faster-spreading, and longer-lived for firestorm.
    const burst = this.add.particles(fx.a.x, fx.a.y, 'spark', {
      lifespan: big ? 620 : 360,
      speed: { min: big ? 90 : 60, max: big ? 340 : 220 },
      angle: { min: 0, max: 360 },
      scale: { start: big ? 1.8 : 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: big ? [0xfff0a0, 0xff5a1a, 0xc22a0a] : [0xfff0a0, 0xff8c1a, 0xd63a1a],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    burst.setDepth(DEPTH_VFX);
    burst.explode(big ? 48 : 24);
    // self-destruct once every particle has faded
    this.time.delayedCall(big ? 720 : 450, () => burst.destroy());

    // Firestorm: an additive expanding+fading fire ring scaled to the blast.
    if (big) {
      const ring = this.add.image(fx.a.x, fx.a.y, 'glow');
      ring.setBlendMode(Phaser.BlendModes.ADD).setTint(0xff5a1a).setDepth(DEPTH_VFX);
      // 'glow' visible disc is ~32px radius; start near the blast radius and
      // expand to ~1.7x while fading over ~0.4s.
      const startScale = radius / 32;
      ring.setScale(startScale * 0.6).setAlpha(0.9);
      this.tweens.add({
        targets: ring,
        scale: startScale * 1.7,
        alpha: 0,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy(),
      });
    }

    // Camera: stronger + slightly longer flash/shake for the bigger blast.
    if (big) {
      this.cameras.main.flash(180, 255, 120, 30, false);
      this.cameras.main.shake(220, 0.008);
    } else {
      this.cameras.main.flash(120, 255, 140, 40, false);
      this.cameras.main.shake(120, 0.004);
    }
  }

  // Lazily create (or fetch) a pooled Image for `key` at `id` (enemies). Sizing
  // is owned by the caller, so this only guarantees the Image exists with the
  // right base texture.
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

  // Lazily create (or fetch) a pooled Sprite for a player. Players are Sprites
  // (not Images) so the pyro chibi can play animations; static textures render
  // fine on a Sprite for the other classes. Sizing/origin/position are owned by
  // drawPlayer (they differ per class), so this only guarantees existence.
  private playerSpriteFor(id: string, key: string): Phaser.GameObjects.Sprite {
    let sprite = this.playerSprites.get(id);
    if (!sprite) {
      sprite = this.add.sprite(0, 0, key);
      this.playerSprites.set(id, sprite);
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

  // --- fire projectiles: pooled additive glow + bright core + ember trail -----
  // Fireball = a quick, clean, bright orb. Firestorm = a bigger, deeper-red,
  // churning fire mass: larger slower-pulsing halo, a denser ember trail plus a
  // second darker smoke-ish layer, and a slight rotation/wobble.
  private drawFireProjectile(p: { id: number; spell: SpellId; pos: { x: number; y: number }; radius: number }): void {
    const storm = p.spell === 'firestorm';
    let vfx = this.fireVfx.get(p.id);
    if (!vfx) {
      const halo = this.add.image(p.pos.x, p.pos.y, 'glow');
      // firestorm tints a deeper red-orange; fireball stays brighter/cleaner.
      halo.setBlendMode(Phaser.BlendModes.ADD).setTint(storm ? 0xff5a1a : 0xff8c1a).setDepth(DEPTH_VFX);
      const core = this.add.image(p.pos.x, p.pos.y, 'glow');
      core.setBlendMode(Phaser.BlendModes.ADD).setTint(storm ? 0xffb24a : 0xffe08a).setDepth(DEPTH_VFX);
      const trail = this.add.particles(p.pos.x, p.pos.y, 'spark', {
        lifespan: storm ? 420 : 300,
        frequency: storm ? 18 : 35, // firestorm emits ~2x as fast
        quantity: storm ? 2 : 1,
        speed: { min: 0, max: storm ? 55 : 30 }, // wider ember spread
        angle: { min: 0, max: 360 },
        scale: { start: storm ? 1.5 : 1.1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: storm ? [0xff8c1a, 0xff5a1a, 0xd63a1a] : [0xff8c1a, 0xd63a1a],
        blendMode: Phaser.BlendModes.ADD,
      });
      trail.setDepth(DEPTH_TRAIL);
      vfx = { halo, core, trail, storm };
      // firestorm only: a darker, slower, larger smoke-ish ember layer underneath
      // for a roiling-mass read. NOT additive, so it darkens rather than glows.
      if (storm) {
        const smoke = this.add.particles(p.pos.x, p.pos.y, 'spark', {
          lifespan: 560,
          frequency: 26,
          quantity: 1,
          speed: { min: 0, max: 40 },
          angle: { min: 0, max: 360 },
          scale: { start: 2.0, end: 0.4 },
          alpha: { start: 0.5, end: 0 },
          tint: [0x7a2208, 0xb23a10],
        });
        smoke.setDepth(DEPTH_TRAIL - 1); // beneath the bright ember trail
        vfx.smoke = smoke;
      }
      this.fireVfx.set(p.id, vfx);
    }

    // pulse: firestorm pulses slower + deeper than the snappy fireball.
    const pulse = storm
      ? 1 + 0.25 * Math.sin(this.t * 11)
      : 1 + 0.15 * Math.sin(this.t * 20);
    // 'glow' visible disc is ~32px radius. Firestorm halo ≈3.5x the projectile
    // radius (vs fireball ≈2.5x) so it reads as a larger fire mass.
    const haloMul = storm ? 3.5 : 2.5;
    const coreMul = storm ? 1.4 : 1.1;
    const haloScale = ((p.radius * haloMul) / 32) * pulse;
    const coreScale = ((p.radius * coreMul) / 32) * pulse;
    // firestorm wobble: a small roiling offset + halo rotation so it churns.
    let ox = 0;
    let oy = 0;
    if (storm) {
      ox = Math.sin(this.t * 13) * p.radius * 0.25;
      oy = Math.cos(this.t * 17) * p.radius * 0.25;
      vfx.halo.setRotation(this.t * 1.5);
    }
    vfx.halo.setPosition(p.pos.x + ox, p.pos.y + oy).setScale(haloScale);
    vfx.core.setPosition(p.pos.x, p.pos.y).setScale(coreScale);
    vfx.trail.setPosition(p.pos.x, p.pos.y);
    if (vfx.smoke) vfx.smoke.setPosition(p.pos.x, p.pos.y);
  }

  private destroyFireVfx(vfx: FireVfx): void {
    vfx.halo.destroy();
    vfx.core.destroy();
    vfx.trail.destroy();
    if (vfx.smoke) vfx.smoke.destroy();
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

  // --- players: flip L/R + cast pose/punch (NO rotation) ----------------------
  // Pyro uses an animated chibi (walk-cycle anim + idle/cast textures); the
  // other classes keep their single legacy <classId> texture and procedural bob.
  private drawPlayer(w: World, pl: Player, dt: number): void {
    const g = this.gfx;
    const def = CLASSES[pl.classId];
    const color = hexColor(def.color);
    const r = CONFIG.player.radius;
    const x = pl.pos.x;
    const y = pl.pos.y;
    const isPyro = pl.classId === 'pyro';

    // anim state (lazy)
    let st = this.playerAnim.get(pl.id);
    if (!st) {
      st = { bobPhase: Math.random() * Math.PI * 2, castUntil: 0, lastX: x, lastY: y };
      this.playerAnim.set(pl.id, st);
    }

    const casting = this.t < st.castUntil;

    // movement detection from frame-to-frame displacement
    const dx = x - st.lastX;
    const dy = y - st.lastY;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    const moving = speed > 20;
    st.lastX = x;
    st.lastY = y;

    // Initial texture: pyro starts idle, others use their legacy <classId>.
    const initialKey = isPyro ? 'chibi-pyro-idle' : pl.classId;
    const sprite = this.playerSpriteFor(pl.id, initialKey);
    sprite.setDepth(DEPTH_PLAYER);
    sprite.setAlpha(pl.downed ? 0.4 : 1);

    if (pl.downed) {
      // downed: no anim/bob/cast. Stop any walk anim and show the idle/legacy
      // texture, keep the legacy dim + cross marker.
      sprite.anims.stop();
      if (isPyro) {
        if (sprite.texture.key !== 'chibi-pyro-idle') sprite.setTexture('chibi-pyro-idle');
        sprite.setOrigin(0.5, PYRO_ORIGIN_Y);
        sprite.setScale(PYRO_SCALE);
        sprite.setPosition(x, y + PYRO_GROUND_OFFSET);
      } else {
        if (sprite.texture.key !== pl.classId) sprite.setTexture(pl.classId);
        sprite.setOrigin(0.5, 0.5);
        sprite.setScale(PLAYER_SPRITE_H_DEFAULT / sprite.height);
        sprite.setPosition(x, y);
      }
      sprite.setFlipX(false);
      this.drawDowned(pl, color);
      this.drawLabel(pl, x, y - r - 14, 0x9aa0b5);
      return;
    }

    // face the aim's horizontal side (art faces right by default).
    sprite.setFlipX(Math.cos(pl.facing) < 0);

    // cast punch: a quick scale-up that decays over CAST_POSE_SECS
    const punch = casting ? 1 + 0.15 * ((st.castUntil - this.t) / CAST_POSE_SECS) : 1;

    if (isPyro) {
      // --- chibi pyro state machine: cast > walk > idle ---
      if (casting) {
        sprite.anims.stop();
        if (sprite.texture.key !== 'chibi-pyro-cast') sprite.setTexture('chibi-pyro-cast');
      } else if (moving) {
        // ignoreIfPlaying=true so the walk cycle isn't restarted every frame.
        sprite.play(PYRO_WALK_ANIM, true);
      } else {
        sprite.anims.stop();
        if (sprite.texture.key !== 'chibi-pyro-idle') sprite.setTexture('chibi-pyro-idle');
      }

      // The walk frames carry the motion; keep only a tiny idle/cast bob.
      st.bobPhase += dt * (moving ? 10 : 3.5);
      const yOffset = moving ? 0 : Math.sin(st.bobPhase) * 2;

      // Feet near the cell bottom + small ground nudge so the chibi looks
      // planted at its world pos rather than floating/sunk.
      sprite.setOrigin(0.5, PYRO_ORIGIN_Y);
      sprite.setScale(PYRO_SCALE * punch);
      sprite.setPosition(x, y + PYRO_GROUND_OFFSET + yOffset);
    } else {
      // --- other classes: single legacy texture, unchanged look ---
      sprite.anims.stop();
      if (sprite.texture.key !== pl.classId) sprite.setTexture(pl.classId);
      sprite.setOrigin(0.5, 0.5);

      // bob: faster + bigger while moving (legacy behavior)
      st.bobPhase += dt * (moving ? 10 : 3.5);
      const yOffset = Math.sin(st.bobPhase) * (moving ? 5 : 2.5);

      // base uniform scale to render at PLAYER_SPRITE_H_DEFAULT px tall
      const baseScale = PLAYER_SPRITE_H_DEFAULT / sprite.height;
      // subtle idle "breathing" on scaleY when not moving/casting
      const breathe = !moving && !casting ? 1 + 0.03 * Math.sin(st.bobPhase) : 1;

      sprite.setScale(baseScale * punch, baseScale * punch * breathe);
      sprite.setPosition(x, y + yOffset);
    }

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
