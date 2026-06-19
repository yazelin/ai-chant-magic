import Phaser from 'phaser';
import {
  World,
  Player,
  Enemy,
  EnemyElement,
  TransientEffect,
  SpellId,
  ClassId,
  Vec2,
  CONFIG,
  CLASSES,
} from '@acm/shared';
import { moveDirFromKeys, facingFromMouse, touchMoveDir } from '../input/controls';
import { GameSession } from '../session/GameSession';
import { initAudio, sfxExplosion, sfxSpell, sfxHit, sfxHurt } from '../audio/sfx';
import { SHEET_WALKERS, sheetWalkerKey, castKeyFor } from './walkSheets';

// Pixel-art sprite textures. Keys for the four mages are their ClassId so a
// player's texture is just `player.classId`. Enemies are no longer textured —
// they're drawn procedurally as slimes (see drawEnemy), so there's no 'enemy' key.
// Vite rewrites these URLs at build time so the PNGs are hashed + bundled.
const SPRITES: Array<{ key: string; url: string }> = [
  { key: 'pyro', url: new URL('../assets/pyro.png', import.meta.url).href },
  { key: 'cryo', url: new URL('../assets/cryo.png', import.meta.url).href },
  { key: 'storm', url: new URL('../assets/storm.png', import.meta.url).href },
  { key: 'warden', url: new URL('../assets/warden.png', import.meta.url).href },
];

// Target on-screen heights for the upright sprites (px). The scale is derived
// from each texture's real pixel height so source art can be any size.
const ENEMY_SPRITE_H = CONFIG.enemy.radius * 2.8; // ≈ 34px
// Slime body colour per attribute (phase 1: look only).
const SLIME_COLOR: Record<EnemyElement, number> = {
  normal: 0x76c442, // green
  fire: 0xff8c1a, // orange
  ice: 0x39c5e0, // cyan
  storm: 0xb06cff, // purple
  holy: 0xffd24d, // gold
};
const BOSS_COLOR = 0xd23c6b; // 史萊姆王 regal crimson (gold crown drawn on top)
// --- Level scene themes -----------------------------------------------------
// A "world" = a swappable theme: a CSS sky (applied to #game-chrome) + a scene
// draw mode. Adding a future world (Re:Zero / 學園都市 / 現代-貞德 / …, can be
// more than four) = one entry here + flip ACTIVE_THEME. Art is intentionally
// light — the point is the architecture, not the polish.
interface SceneTheme {
  sky: string; // CSS background applied to the play container
  mode: 'grid' | 'dream';
  border: number;
  grid?: number; // grid mode: line/dot colour
  blobColors?: number[]; // dream mode: goo blob palette
  bubble?: number; // dream mode: drifting bubble colour
}
const THEMES: Record<string, SceneTheme> = {
  // "developer's world" — the plain engineering grid (fine while iterating).
  engineer: {
    sky: 'radial-gradient(140% 120% at 50% 30%, #14142a 0%, #0b0b14 70%)',
    mode: 'grid', border: 0x4a4a78, grid: 0x2a2a4a,
  },
  // Level 1 — slime / KonoSuba dreamscape.
  slime: {
    sky: 'radial-gradient(140% 120% at 50% 18%, #1b3a44 0%, #122230 42%, #0a0f1a 78%, #070710 100%)',
    mode: 'dream', border: 0x3a6a60, blobColors: [0x2fae7a, 0x3a9d9d, 0x7a6ad0], bubble: 0xaff0d4,
  },
};
const ACTIVE_THEME = 'slime'; // swap per level (e.g. 'engineer' while developing)
const PLAYER_SPRITE_H_DEFAULT = CONFIG.player.radius * 3; // ≈ 42px

// Walk sprites use 128px cells mostly filled by the character; a fixed scale
// that lands the on-screen height around ~58px reads right.
const WALKER_FRAME_H = 128;
const WALKER_TARGET_H = 58;
const WALKER_SCALE = WALKER_TARGET_H / WALKER_FRAME_H; // ≈ 0.453
// Feet sit near the bottom of the cell; origin-y near the bottom + a tiny world
// offset so the mage looks grounded at its world pos. Higher origin-y = the
// art's feet land closer to the world pos.
const WALKER_ORIGIN_Y = 0.82;
// Small downward nudge so the feet read as planted at the player pos rather than
// slightly above it (tune by eyeball alongside WALKER_ORIGIN_Y).
const WALKER_GROUND_OFFSET = 4;

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

// Health-bar fill colour by remaining fraction: green → yellow → red.
function hpColor(frac: number): number {
  return frac > 0.5 ? 0x6fe39a : frac > 0.25 ? 0xffd24d : 0xff6b6b;
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
  // Dedicated overlay for aim indicators (per-player chevron + local cursor
  // reticle), kept above the player sprites so it never gets occluded.
  private aimGfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  // Pooled sprites, keyed by entity id. Created on first sight, repositioned
  // each frame, and destroyed when the entity leaves the world (mirrors the
  // name-label pooling). Never recreated per frame.
  // Players are Sprites (not Images) so the pyro LPC mage can play its walk-cycle
  // animation; a Sprite renders a static texture fine for the other classes too.
  private playerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  // First-seen hp per enemy id → treated as "full" for the damage hp bar.
  private enemyMaxHp = new Map<number, number>();
  // Impact detection (drives hit/kill/hurt SFX + visual feedback): previous-frame
  // hp + last-known position per enemy, the local player's previous hp, and a
  // per-enemy "flash white" expiry (scene time) applied in drawEnemy.
  private prevEnemy = new Map<number, { hp: number; x: number; y: number; element: EnemyElement }>();
  private prevSelfHp = -1;
  private enemyHitFlash = new Map<number, number>();
  // Local player hurt cue: scene time until which to tint the self sprite red.
  private hurtFlashUntil = 0;
  // Decorative scene elements (built once): ground goo blobs + drifting bubbles.
  private scenery: { x: number; y: number; rx: number; ry: number; c: number; a: number }[] = [];
  private bubbles: { x: number; y: number; r: number; phase: number; speed: number }[] = [];
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
  // Touch virtual-joystick state (left-half drag → move). null id = inactive.
  private joyPointerId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyCur = { x: 0, y: 0 };
  private touchMove: Vec2 = { x: 0, y: 0 };
  // Touch RIGHT aim stick (right-half drag → facing direction, twin-stick style).
  // touchFacing holds the last aimed angle (persists after release); null = no
  // touch aim yet → fall back to the mouse (desktop).
  private aimPointerId: number | null = null;
  private aimOrigin = { x: 0, y: 0 };
  private aimCur = { x: 0, y: 0 };
  private touchFacing: number | null = null;

  // GameScene is session-agnostic: it renders whatever World the injected
  // GameSession exposes (LocalSession runs the sim locally; NetSession returns
  // an interpolated snapshot world). It never touches `step` itself.
  constructor(session: GameSession) {
    super('game');
    this.session = session;
  }

  preload(): void {
    for (const s of SPRITES) this.load.image(s.key, s.url);
    // Sheet-walker classes (128x128 cells) — all four mages. Walk sheet + a
    // single cast-pose frame each.
    for (const cls of Object.keys(SHEET_WALKERS) as ClassId[]) {
      const sw = SHEET_WALKERS[cls]!;
      this.load.spritesheet(sheetWalkerKey(cls), sw.url, { frameWidth: 128, frameHeight: 128 });
      this.load.image(castKeyFor(cls), sw.castUrl);
    }
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.aimGfx = this.add.graphics();
    this.aimGfx.setDepth(DEPTH_PLAYER + 1);
    this.makeVfxTextures();

    // Apply the active level theme: sky (CSS on the play container) + scenery.
    const theme = THEMES[ACTIVE_THEME];
    const chrome = document.getElementById('game-chrome');
    if (chrome) chrome.style.background = theme.sky;
    if (theme.mode === 'dream') this.buildScenery(theme);

    // Define each walk animation once. Guard against double-create when the
    // scene restarts (anims live on the global AnimationManager).
    for (const cls of Object.keys(SHEET_WALKERS) as ClassId[]) {
      const sw = SHEET_WALKERS[cls]!;
      if (!this.anims.exists(sw.anim)) {
        this.anims.create({
          key: sw.anim,
          frames: this.anims.generateFrameNumbers(sheetWalkerKey(cls), { start: 0, end: sw.frames - 1 }),
          frameRate: 10,
          repeat: -1,
        });
      }
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

    // INPUT — mouse drives aim directly; touch splits the screen into a left
    // virtual joystick (move) + a right aim STICK (drag direction = facing,
    // twin-stick style). Casting stays voice-only (no touch-to-cast). Allow up
    // to 3 pointers for 2 fingers.
    this.input.addPointer(2);
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) { this.mouse = { x: p.x, y: p.y }; return; }
      if (p.id === this.joyPointerId) {
        this.joyCur = { x: p.x, y: p.y };
        this.touchMove = touchMoveDir(this.joyOrigin, this.joyCur);
      } else if (p.id === this.aimPointerId) {
        this.aimCur = { x: p.x, y: p.y };
        const dx = this.aimCur.x - this.aimOrigin.x;
        const dy = this.aimCur.y - this.aimOrigin.y;
        if (Math.hypot(dx, dy) > 6) this.touchFacing = Math.atan2(dy, dx); // direction = facing
      }
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.wasTouch) return;
      if (p.x < this.scale.width / 2) {
        this.joyPointerId = p.id; // left half: anchor the move joystick
        this.joyOrigin = { x: p.x, y: p.y };
        this.joyCur = { x: p.x, y: p.y };
        this.touchMove = { x: 0, y: 0 };
      } else {
        this.aimPointerId = p.id; // right half: anchor the aim stick
        this.aimOrigin = { x: p.x, y: p.y };
        this.aimCur = { x: p.x, y: p.y };
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.id === this.joyPointerId) {
        this.joyPointerId = null;
        this.touchMove = { x: 0, y: 0 };
      }
      if (p.id === this.aimPointerId) this.aimPointerId = null; // keep last aimed dir
    });

    // Audio needs a user gesture to start; resume the SFX context on the first
    // pointer/key interaction with the canvas (idempotent + guarded, and also
    // covered by main.ts's first-click handler).
    this.input.once('pointerdown', () => initAudio());
    this.input.keyboard!.once('keydown', () => initAudio());

    // Camera: zoom stays 1 so sprites keep their native size — a bigger screen
    // simply reveals MORE of the world. update() positions the scroll manually
    // (see followCamera): an axis larger than the arena is CENTERED; a smaller
    // one follows the local player, clamped to the arena edge. (No setBounds —
    // it would pin the arena to the top-left when the window exceeds it.)
    this.cameras.main.setRoundPixels(true);
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
    // Clear impact bookkeeping so reused entity ids after a reset don't carry
    // stale hp/flash state into the fresh game.
    this.prevEnemy.clear();
    this.enemyHitFlash.clear();
    this.prevSelfHp = -1;
    this.hurtFlashUntil = 0;
    this.aimPointerId = null;
    this.joyPointerId = null;
    this.touchMove = { x: 0, y: 0 };
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
      this.followCamera(self);
      // Facing: touch aim stick (direction) wins; else mouse position (desktop).
      if (this.touchFacing !== null) {
        this.session.sendFace(this.touchFacing);
      } else {
        const aim = this.cameras.main.getWorldPoint(this.mouse.x, this.mouse.y);
        this.session.sendFace(facingFromMouse(self.pos, aim));
      }
      // Touch joystick wins when active; otherwise keyboard.
      const active = this.touchMove.x !== 0 || this.touchMove.y !== 0;
      this.session.sendMove(active ? this.touchMove : moveDirFromKeys(this.keys));
    }

    this.session.tick(dt);
    this.draw(dt);
  }

  private draw(dt: number): void {
    const w = this.session.getWorld();
    const g = this.gfx;
    g.clear();
    this.aimGfx.clear();

    // World-fixed scene (under everything): scrolls as the camera follows the
    // player, so movement reads; style depends on the active level theme.
    this.drawScene();

    // Cast detection runs before drawing players so the caster snaps to the
    // cast pose on the same frame their spell first appears.
    this.detectCasts(w);
    // Impact reactions (hit/kill/hurt SFX + damage numbers / flash / death burst)
    // off the same per-frame hp deltas. Runs before drawEnemy so a fresh hit-flash
    // is applied the same frame.
    this.detectImpacts(w);

    this.drawEffects(w);

    // enemies — procedurally-drawn bouncing slimes (coloured by element), below players
    const liveEnemies = new Set<number>();
    for (const e of w.enemies) {
      this.drawEnemy(w, e);
      liveEnemies.add(e.id);
    }
    // prune render-side per-enemy hp memory for enemies that have left the world
    for (const id of this.enemyMaxHp.keys()) {
      if (!liveEnemies.has(id)) this.enemyMaxHp.delete(id);
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

    // local player's aim crosshair, pinned to the cursor (drawn last, on top)
    this.drawAimReticle();
    this.drawTouchJoystick();

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

  // A soft glowing arrowhead floating just ahead of a player in its aim
  // direction. Two stroke passes (wide dim + thin bright) fake a glow.
  private drawAimChevron(
    x: number,
    y: number,
    r: number,
    facing: number,
    color: number,
  ): void {
    const g = this.aimGfx;
    const tipD = r + 17;
    const wing = 9;
    const spread = 0.62; // half-angle of the wings (radians)
    const tx = x + Math.cos(facing) * tipD;
    const ty = y + Math.sin(facing) * tipD;
    const back = facing + Math.PI;
    const w1x = tx + Math.cos(back - spread) * wing;
    const w1y = ty + Math.sin(back - spread) * wing;
    const w2x = tx + Math.cos(back + spread) * wing;
    const w2y = ty + Math.sin(back + spread) * wing;
    const stroke = (width: number, alpha: number) => {
      g.lineStyle(width, color, alpha);
      g.beginPath();
      g.moveTo(w1x, w1y);
      g.lineTo(tx, ty);
      g.lineTo(w2x, w2y);
      g.strokePath();
    };
    stroke(6, 0.22);
    stroke(2.5, 0.95);
    g.lineStyle(0, 0, 0);
  }

  // Local player's aim crosshair: a small glowing fire reticle pinned to the
  // mouse cursor. World == screen here (arena fills the canvas, no camera
  // scroll). Only shown while the local player is present and alive.
  private drawAimReticle(): void {
    const self = this.self();
    if (!self || !self.connected || self.downed) return;
    const g = this.aimGfx;
    // Touch: reticle sits in front of the player along the aim-stick direction.
    // Mouse: reticle pinned to the cursor (converted screen→world via camera).
    let mx: number;
    let my: number;
    if (this.touchFacing !== null) {
      const r = 120; // how far in front the reticle floats
      mx = self.pos.x + Math.cos(this.touchFacing) * r;
      my = self.pos.y + Math.sin(this.touchFacing) * r;
    } else {
      const aim = this.cameras.main.getWorldPoint(this.mouse.x, this.mouse.y);
      mx = aim.x;
      my = aim.y;
    }
    const ringR = 9;
    // warm outer glow
    g.fillStyle(0xff8c28, 0.1);
    g.fillCircle(mx, my, 13);
    g.fillStyle(0xff8c28, 0.18);
    g.fillCircle(mx, my, 8);
    // ring + four ticks
    g.lineStyle(2, 0xffc878, 0.92);
    g.strokeCircle(mx, my, ringR);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      g.lineBetween(
        mx + Math.cos(a) * (ringR + 2),
        my + Math.sin(a) * (ringR + 2),
        mx + Math.cos(a) * (ringR + 6),
        my + Math.sin(a) * (ringR + 6),
      );
    }
    g.lineStyle(0, 0, 0);
    // bright center
    g.fillStyle(0xfff0c0, 1);
    g.fillCircle(mx, my, 2.2);
  }

  // Position the camera (zoom 1): an axis wider than the arena is centered (so
  // the arena sits in the middle with even margins, not pinned top-left); a
  // narrower axis follows the local player, clamped so we never scroll past the
  // arena edge.
  private followCamera(self: Player): void {
    const cam = this.cameras.main;
    const aw = CONFIG.arenaWidth;
    const ah = CONFIG.arenaHeight;
    const sx = cam.width >= aw ? (aw - cam.width) / 2 : Phaser.Math.Clamp(self.pos.x - cam.width / 2, 0, aw - cam.width);
    const sy = cam.height >= ah ? (ah - cam.height) / 2 : Phaser.Math.Clamp(self.pos.y - cam.height / 2, 0, ah - cam.height);
    cam.setScroll(sx, sy);
  }

  // Touch sticks — base ring at the anchor + a knob clamped to a max radius in
  // the drag direction. Left (white) = move, right (warm) = aim. Only drawn
  // while the matching finger is down.
  private drawTouchJoystick(): void {
    if (this.joyPointerId !== null) this.drawStick(this.joyOrigin, this.joyCur, 0xffffff);
    if (this.aimPointerId !== null) this.drawStick(this.aimOrigin, this.aimCur, 0xffc878);
  }

  private drawStick(originScreen: { x: number; y: number }, curScreen: { x: number; y: number }, color: number): void {
    const g = this.aimGfx;
    const baseR = 46;
    // anchors/knobs are screen-space; draw on world-space aimGfx via the camera
    // (zoom 1 → on-screen radius unchanged).
    const cam = this.cameras.main;
    const o = cam.getWorldPoint(originScreen.x, originScreen.y);
    const c = cam.getWorldPoint(curScreen.x, curScreen.y);
    const ox = o.x;
    const oy = o.y;
    g.fillStyle(color, 0.06);
    g.fillCircle(ox, oy, baseR);
    g.lineStyle(2, color, 0.35);
    g.strokeCircle(ox, oy, baseR);
    const dx = c.x - ox;
    const dy = c.y - oy;
    const l = Math.hypot(dx, dy) || 1;
    const k = Math.min(l, baseR);
    g.lineStyle(0, 0, 0);
    g.fillStyle(color, 0.5);
    g.fillCircle(ox + (dx / l) * k, oy + (dy / l) * k, 18);
  }

  // CAST DETECTION + impact reactions. For every NEW projectile or effect id
  // owned by a player, flip that player into the cast pose. Blast effects also
  // trigger a one-shot ember burst + subtle camera flash/shake on first sight.
  private detectCasts(w: World): void {
    const byId = new Map<string, PlayerAnimState>();
    for (const [id, s] of this.playerAnim) byId.set(id, s);

    // SFX throttles: at most one cast + one explosion sound per frame so a burst
    // of new ids (multi-projectile spell, many blasts) doesn't stack into noise.
    let castPlayed = false;
    this.explosionPlayedThisFrame = false;

    for (const p of w.projectiles) {
      if (this.seenProj.has(p.id)) continue;
      this.seenProj.add(p.id);
      const st = byId.get(p.ownerId);
      // A freshly-set castUntil means a new owned projectile appeared this frame.
      if (st) st.castUntil = this.t + CAST_POSE_SECS;
      // Each spell carries its own id → its own dedicated cast SFX.
      if (!castPlayed) { sfxSpell(p.spell); castPlayed = true; }
    }
    for (const fx of w.effects) {
      if (this.seenFx.has(fx.id)) continue;
      this.seenFx.add(fx.id);
      if (fx.ownerId) {
        const st = byId.get(fx.ownerId);
        if (st) st.castUntil = this.t + CAST_POSE_SECS;
        // Per-skill cast sound (effects now carry their spell id). Blast carries
        // its own explosion boom via onBlast, so don't double it with a cast sound.
        if (fx.kind !== 'blast' && fx.spell && !castPlayed) { sfxSpell(fx.spell); castPlayed = true; }
      }
      if (fx.kind === 'blast') this.onBlast(fx);
    }
  }

  // IMPACT DETECTION — derives hit / kill / hurt reactions from per-frame hp
  // deltas (the client only has snapshots, not damage events). Enemy hp drop →
  // floating damage number + white flash; enemy gone since last frame → death
  // burst + kill SFX (one per frame); local player hp drop → hurt SFX + red
  // camera flash.
  private detectImpacts(w: World): void {
    const liveIds = new Set<number>();
    for (const e of w.enemies) {
      liveIds.add(e.id);
      const prev = this.prevEnemy.get(e.id);
      if (prev && e.hp < prev.hp - 0.01) {
        this.spawnDamageNumber(e.pos.x, e.pos.y - ENEMY_SPRITE_H / 2, Math.round(prev.hp - e.hp));
        this.enemyHitFlash.set(e.id, this.t + 0.08); // flash white ~0.08s
      }
      this.prevEnemy.set(e.id, { hp: e.hp, x: e.pos.x, y: e.pos.y, element: e.element });
    }
    // Kills: ids tracked last frame but absent now (enemies only leave by dying).
    let killed = false;
    for (const [id, prev] of this.prevEnemy) {
      if (!liveIds.has(id)) {
        this.spawnDeathBurst(prev.x, prev.y, SLIME_COLOR[prev.element] ?? SLIME_COLOR.normal);
        this.prevEnemy.delete(id);
        this.enemyHitFlash.delete(id);
        killed = true;
      }
    }
    if (killed) sfxHit(); // one kill blip per frame, no matter how many died

    const self = this.self();
    if (self) {
      if (this.prevSelfHp >= 0 && self.hp < this.prevSelfHp - 0.01) {
        sfxHurt();
        // Gentle, LOCAL hurt cue — a brief red tint on the player sprite (see
        // drawPlayer), NOT a full-screen flash. With i-frames, hp only drops once
        // per invuln window, so this pulses calmly instead of strobing.
        this.hurtFlashUntil = this.t + 0.18;
      }
      this.prevSelfHp = self.hp;
    }
  }

  // Floating damage number that drifts up and fades.
  private spawnDamageNumber(x: number, y: number, dmg: number): void {
    if (dmg <= 0) return;
    const txt = this.add
      .text(x, y, String(dmg), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PLAYER + 5);
    this.tweens.add({
      targets: txt,
      y: y - 26,
      alpha: 0,
      duration: 600,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  // Ember pop where a slime died, tinted by its element, then self-destruct.
  private spawnDeathBurst(x: number, y: number, color: number): void {
    const burst = this.add.particles(x, y, 'spark', {
      lifespan: 380,
      speed: { min: 50, max: 190 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.3, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    burst.setDepth(DEPTH_VFX);
    burst.explode(14);
    this.time.delayedCall(440, () => burst.destroy());
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

  // Lazily create (or fetch) a pooled Sprite for a player. Players are Sprites
  // (not Images) so the pyro LPC mage can play animations; static textures render
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

  // Build decorative scene elements once (dream themes): soft goo blobs on the
  // ground + drifting bubbles. Math.random is fine here (one-off client decor).
  private buildScenery(theme: SceneTheme): void {
    const W = CONFIG.arenaWidth;
    const H = CONFIG.arenaHeight;
    const cols = theme.blobColors ?? [0x2fae7a];
    for (let i = 0; i < 34; i++) {
      const r = 22 + Math.random() * 110;
      this.scenery.push({
        x: Math.random() * W, y: Math.random() * H, rx: r, ry: r * (0.55 + Math.random() * 0.3),
        c: cols[Math.floor(Math.random() * cols.length)], a: 0.04 + Math.random() * 0.06,
      });
    }
    for (let i = 0; i < 18; i++) {
      this.bubbles.push({
        x: Math.random() * W, y: Math.random() * H, r: 4 + Math.random() * 11,
        phase: Math.random() * Math.PI * 2, speed: 8 + Math.random() * 18,
      });
    }
  }

  // World-fixed scene (drawn under everything). Scrolls with the camera so motion
  // reads. Two modes per the active theme: 'grid' (engineering floor) or 'dream'
  // (goo blobs + drifting bubbles).
  private drawScene(): void {
    const g = this.gfx;
    const aw = CONFIG.arenaWidth;
    const ah = CONFIG.arenaHeight;
    const theme = THEMES[ACTIVE_THEME];
    if (theme.mode === 'grid') {
      const step = 80;
      g.lineStyle(1, theme.grid ?? 0x2a2a4a, 0.55);
      for (let x = step; x < aw; x += step) g.lineBetween(x, 0, x, ah);
      for (let y = step; y < ah; y += step) g.lineBetween(0, y, aw, y);
      g.fillStyle(0x3a3a60, 0.6);
      for (let x = step; x < aw; x += step) for (let y = step; y < ah; y += step) g.fillCircle(x, y, 1.3);
    } else {
      // soft goo blobs (scroll with the camera → motion + slime theme)
      for (const s of this.scenery) {
        g.fillStyle(s.c, s.a);
        g.fillEllipse(s.x, s.y, s.rx * 2, s.ry * 2);
      }
      // drifting dream bubbles (animate upward, wrap)
      const bub = theme.bubble ?? 0xaff0d4;
      for (const b of this.bubbles) {
        const y = (((b.y - this.t * b.speed) % ah) + ah) % ah;
        const x = b.x + Math.sin(this.t * 0.7 + b.phase) * 7;
        g.fillStyle(bub, 0.08);
        g.fillCircle(x, y, b.r);
        g.lineStyle(1, bub, 0.16);
        g.strokeCircle(x, y, b.r);
        g.lineStyle(0, 0, 0);
      }
    }
    // arena edge
    g.lineStyle(3, theme.border, 0.8);
    g.strokeRect(0, 0, aw, ah);
    g.lineStyle(0, 0, 0);
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

  // --- enemies: procedural bouncing slime, coloured by element ----------------
  // Drawn immediate-mode on this.gfx (no pooled sprite): an ellipse body with a
  // squash/stretch + hop bounce, a highlight, and two eyes. Colour = element
  // (white when just hit, frosty when slowed/frozen). Phase 2 will add behaviour.
  private drawEnemy(w: World, e: Enemy): void {
    const g = this.gfx;
    const slowed = w.time < e.slowUntil || w.time < (e.frozenUntil ?? 0);
    const flashing = (this.enemyHitFlash.get(e.id) ?? 0) > this.t;
    let color = e.boss ? BOSS_COLOR : SLIME_COLOR[e.element] ?? SLIME_COLOR.normal;
    if (flashing) color = 0xffffff;
    else if (slowed) color = 0x9fd8ff;

    // bounce: hop up + squash/stretch, phase staggered per enemy id
    const ph = this.t * 6 + e.id * 0.9;
    const hop = Math.abs(Math.sin(ph)) * 5;
    const sq = Math.sin(ph * 2) * 0.16;
    const bw = e.radius * 2.6 * (1 + sq);
    const bh = e.radius * 2.2 * (1 - sq);
    const cx = e.pos.x;
    const cy = e.pos.y - hop;

    g.fillStyle(color, 0.92);
    g.fillEllipse(cx, cy, bw, bh);
    g.lineStyle(2, 0x101018, 0.3);
    g.strokeEllipse(cx, cy, bw, bh);
    g.lineStyle(0, 0, 0);
    // glossy highlight
    g.fillStyle(0xffffff, 0.22);
    g.fillEllipse(cx - bw * 0.18, cy - bh * 0.22, bw * 0.32, bh * 0.18);
    // eyes
    const eyeY = cy - bh * 0.06;
    const ex = bw * 0.16;
    g.fillStyle(0xffffff, 0.95);
    g.fillCircle(cx - ex, eyeY, 2.6);
    g.fillCircle(cx + ex, eyeY, 2.6);
    g.fillStyle(0x222233, 1);
    g.fillCircle(cx - ex, eyeY, 1.3);
    g.fillCircle(cx + ex, eyeY, 1.3);

    // per-element ambient accent — read the attribute at a glance + juice
    const topY = cy - bh / 2;
    const ap = this.t * 5 + e.id;
    if (e.element === 'fire') {
      g.fillStyle(0xffd24d, 0.9);
      for (let i = -1; i <= 1; i++) {
        const fl = 0.6 + 0.4 * Math.sin(ap + i);
        g.fillCircle(cx + i * bw * 0.24, topY - 3 - fl * 6, 1.4 + fl); // rising embers
      }
    } else if (e.element === 'ice') {
      g.fillStyle(0xffffff, 0.85);
      for (let i = 0; i < 3; i++) {
        const a = ap + i * 2.1;
        const tw = 0.5 + 0.5 * Math.sin(a * 1.7);
        g.fillCircle(cx + Math.cos(a) * bw * 0.42, topY - 1 + Math.sin(a) * bh * 0.18, 0.9 + tw * 1.3); // frost twinkle
      }
    } else if (e.element === 'storm') {
      if (Math.sin(ap * 2) > 0.6) { // crackle on/off
        g.lineStyle(1.5, 0xe6d8ff, 0.95);
        const sx = cx + bw * 0.28;
        g.lineBetween(sx, topY - 1, sx + 4, topY - 6);
        g.lineBetween(sx + 4, topY - 6, sx - 1, topY - 9);
        g.lineStyle(0, 0, 0);
      }
    } else if (e.element === 'holy') {
      g.lineStyle(2, 0xffe9a8, 0.18 + 0.12 * Math.sin(ap)); // pulsing blessed ring
      g.strokeCircle(cx, cy, bw * 0.7);
      g.lineStyle(0, 0, 0);
    }

    // 史萊姆王 gold crown on top
    if (e.boss) {
      const cyTop = cy - bh / 2;
      const cw = bw * 0.62;
      const cl = cx - cw / 2;
      g.fillStyle(0xffd24d, 1);
      g.fillRect(cl, cyTop - bh * 0.12, cw, bh * 0.13); // band
      const spikes = 3;
      for (let i = 0; i < spikes; i++) {
        const sx = cl + (cw * (i + 0.5)) / spikes;
        const half = cw / (spikes * 2);
        g.fillTriangle(sx - half, cyTop - bh * 0.1, sx + half, cyTop - bh * 0.1, sx, cyTop - bh * 0.34);
      }
    }

    // hp bar above the slime: bosses always show it; normal slimes only once damaged.
    if (!this.enemyMaxHp.has(e.id)) this.enemyMaxHp.set(e.id, e.hp);
    const max = this.enemyMaxHp.get(e.id)!;
    if (e.boss) this.drawBar(cx, cy - bh / 2 - bh * 0.42, e.hp / max, 46);
    else if (e.hp < max - 0.01) this.drawBar(cx, cy - bh / 2 - 8, e.hp / max, 20);
  }

  // --- players: flip L/R + cast pose/punch (NO rotation) ----------------------
  // Pyro uses an animated LPC fire-mage (walk-cycle anim + idle/cast textures);
  // the other classes keep their single legacy <classId> texture and procedural bob.
  private drawPlayer(w: World, pl: Player, dt: number): void {
    const g = this.gfx;
    const def = CLASSES[pl.classId];
    const color = hexColor(def.color);
    const r = CONFIG.player.radius;
    const x = pl.pos.x;
    const y = pl.pos.y;
    const sw = SHEET_WALKERS[pl.classId]; // sheet-walker config, if any
    const isSheet = !!sw; // walk sheet, idle = frame 0, no cast art
    const isAnimated = isSheet; // every mage is now a sheet walker
    // texture keys (sheet walkers have no separate idle/cast art → frame 0)
    const walkAnim = sw?.anim ?? '';
    const idleKey = isSheet ? sheetWalkerKey(pl.classId) : '';
    const castKey = isSheet ? castKeyFor(pl.classId) : ''; // dedicated cast-pose image
    const idleFrame = sw?.idleFrame ?? 0; // feet-together frame for standing

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

    // Initial texture: animated classes start on their idle key, others use their legacy <classId>.
    const initialKey = isAnimated ? idleKey : pl.classId;
    const sprite = this.playerSpriteFor(pl.id, initialKey);
    sprite.setDepth(DEPTH_PLAYER);
    sprite.setAlpha(pl.downed ? 0.4 : 1);
    // Local player hurt cue: brief soft-red multiply tint (no full-screen flash).
    if (pl.id === this.session.getSelfId() && this.t < this.hurtFlashUntil) sprite.setTint(0xff6a6a);
    else sprite.clearTint();

    if (pl.downed) {
      // downed: no anim/bob/cast. Stop any walk anim and show the idle/legacy
      // texture, keep the legacy dim + cross marker.
      sprite.anims.stop();
      if (isAnimated) {
        if (sprite.texture.key !== idleKey) sprite.setTexture(idleKey);
        sprite.setFrame(idleFrame);
        sprite.setOrigin(0.5, WALKER_ORIGIN_Y);
        sprite.setScale(WALKER_SCALE);
        sprite.setPosition(x, y + WALKER_GROUND_OFFSET);
      } else {
        if (sprite.texture.key !== pl.classId) sprite.setTexture(pl.classId);
        sprite.setOrigin(0.5, 0.5);
        sprite.setScale(PLAYER_SPRITE_H_DEFAULT / sprite.height);
        sprite.setPosition(x, y);
      }
      sprite.setFlipX(false);
      this.drawDowned(pl, color);
      this.drawLabel(pl, x, y - WALKER_TARGET_H * WALKER_ORIGIN_Y - 12, 0x9aa0b5);
      return;
    }

    // The LPC art faces LEFT by default, so flipX=true makes it face RIGHT.
    // Face the WALK direction while moving horizontally (instant A/D response);
    // fall back to the aim direction when standing still / moving purely vertically.
    const flip =
      moving && Math.abs(dx) > 0.5 ? dx > 0 : Math.cos(pl.facing) > 0;
    sprite.setFlipX(flip);

    // cast punch: a quick scale-up that decays over CAST_POSE_SECS
    const punch = casting ? 1 + 0.15 * ((st.castUntil - this.t) / CAST_POSE_SECS) : 1;

    if (isAnimated) {
      // --- animated-class state machine: cast > walk > idle ---
      if (casting) {
        sprite.anims.stop();
        sprite.anims.timeScale = 1;
        // cast pose is a dedicated single-frame image
        if (sprite.texture.key !== castKey) sprite.setTexture(castKey);
        sprite.setFrame(0);
      } else if (moving) {
        // ignoreIfPlaying=true so the walk cycle isn't restarted every frame.
        sprite.play(walkAnim, true);
        // Foot-sliding sync: drive the walk playback rate from the actual
        // movement speed so faster movement → faster steps and the feet appear
        // planted instead of skating. Clamp so it never crawls or strobes.
        sprite.anims.timeScale = Phaser.Math.Clamp(speed / CONFIG.player.speed, 0.6, 2.2);
      } else {
        sprite.anims.stop();
        sprite.anims.timeScale = 1;
        if (sprite.texture.key !== idleKey) sprite.setTexture(idleKey);
        if (isSheet) sprite.setFrame(idleFrame);
      }

      // The walk frames carry the motion; keep only a tiny idle bob.
      st.bobPhase += dt * (moving ? 10 : 3.5);
      const yOffset = moving ? 0 : Math.sin(st.bobPhase) * 2;

      // Feet near the cell bottom + small ground nudge so the mage looks
      // planted at its world pos rather than floating/sunk.
      sprite.setOrigin(0.5, WALKER_ORIGIN_Y);
      sprite.setScale(WALKER_SCALE * punch);
      sprite.setPosition(x, y + WALKER_GROUND_OFFSET + yOffset);
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

    // aim chevron: a soft glowing arrowhead floating just ahead of the player in
    // its facing/aim direction (replaces the old white line that sliced the
    // sprite). Drawn in the class colour on the dedicated above-sprite overlay.
    this.drawAimChevron(x, y, r, pl.facing, color);

    // name on top + a thin hp bar right under it, placed ABOVE the sprite's head
    // (the walk sprite is ~WALKER_TARGET_H tall with feet near the world pos, so
    // the head sits ~WALKER_TARGET_H*WALKER_ORIGIN_Y above y — clear it + margin).
    const headY = y - WALKER_TARGET_H * WALKER_ORIGIN_Y - 8;
    this.drawBar(x, headY, Math.max(0, pl.hp) / pl.maxHp, 32);
    this.drawLabel(pl, x, headY - 4, color);
  }

  // A thin centred bar (bg + hp-coloured fill). Used for player + enemy health.
  private drawBar(cx: number, topY: number, frac: number, w: number): void {
    const g = this.gfx;
    const h = 4;
    const x0 = cx - w / 2;
    const f = Math.max(0, Math.min(1, frac));
    g.fillStyle(0x000000, 0.55);
    g.fillRect(x0 - 1, topY - 1, w + 2, h + 2);
    g.fillStyle(0x2a2a3a, 1);
    g.fillRect(x0, topY, w, h);
    g.fillStyle(hpColor(f), 1);
    g.fillRect(x0, topY, f * w, h);
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
