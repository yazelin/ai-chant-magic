import { World, Command, Vec2, SpellId, Projectile, Enemy, EnemyElement, Player, ClassId, TransientEffect } from './types';
import { CONFIG } from './config';
import { SPELLS } from './spells';
import { CLASSES, classSpellSet } from './classes';
import { dist, sub, len, scale } from './vec';

// Last implemented level (0-based): 0=slime/為美好世界, 1=frostvale/Re:Zero,
// 2=electropolis/學園都市, 3=grail/聖杯戰爭. Bump this alongside a new
// LEVEL_THEMES entry (client) when a new world ships. Clearing this level ends
// the game in victory instead of transitioning further.
export const MAX_LEVEL_ID = 3;

// Regular-enemy kind per level (index = levelId). Level 0 keeps the original
// random elemental mix (pickElement); levels 1+ each commit to one signature
// enemy so every world's swarm reads differently at a glance. 'wraith' routes
// to makeWraith (blink movement); any EnemyElement routes to makeSlime with it
// (storm = dash-and-lunge, already built for phase-2 slimes; holy = tanky
// mutual healer, ditto) — reusing already-battle-tested behaviour rather than
// inventing a new mechanic per world.
const LEVEL_ENEMY: Array<EnemyElement | 'wraith' | 'mixed'> = ['mixed', 'wraith', 'storm', 'holy'];
// Boss element per level (colour only — every world's boss walks, never
// blinks/dashes, so it always reads as "the big slow tank", on purpose).
const BOSS_ELEMENT: EnemyElement[] = ['normal', 'ice', 'storm', 'holy'];

// ---------------------------------------------------------------------------
// Endless-mode formulas (see CONFIG.endless). Every one of these is a no-op
// (falls back to the exact campaign formula) when world.endless is false, so
// the campaign path is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

// Enemy hp for the current wave. Campaign: unbounded linear growth (only ever
// runs to wave 20). Endless: identical up to hpCapWave, then the slope is cut
// to hpSlopeAfterCap so "what wave did you reach" stays meaningful for a very
// long run without the number becoming absurd.
export function enemyStatWaveHp(world: World): number {
  const base = CONFIG.enemy.baseHp;
  if (!world.endless) return base + (world.wave - 1) * CONFIG.enemy.hpPerWave;
  const e = CONFIG.endless;
  const cappedWave = Math.min(world.wave, e.hpCapWave);
  const extra = Math.max(0, world.wave - e.hpCapWave);
  return base + (cappedWave - 1) * CONFIG.enemy.hpPerWave + extra * CONFIG.enemy.hpPerWave * e.hpSlopeAfterCap;
}

// Enemy walk speed for the current wave. Endless hard-caps at a fraction of
// the player's own speed — the campaign's unbounded linear formula would let
// enemies catch up to (and eventually outrun) the player around wave 36.
export function enemyStatWaveSpeed(world: World): number {
  const linear = CONFIG.enemy.baseSpeed + (world.wave - 1) * CONFIG.enemy.speedPerWave;
  if (!world.endless) return linear;
  return Math.min(linear, CONFIG.player.speed * CONFIG.endless.speedCapFrac);
}

// Share of endless-mode regular spawns that should be the wraith (世界2's
// blink-mover), ramping from 0 at wraithShareStartWave to wraithShareMax at
// wraithShareMaxWave and holding there. pickElement covers everything else.
export function endlessWraithShare(wave: number): number {
  const e = CONFIG.endless;
  if (wave < e.wraithShareStartWave) return 0;
  const t = (wave - e.wraithShareStartWave) / (e.wraithShareMaxWave - e.wraithShareStartWave);
  return Math.min(e.wraithShareMax, Math.max(0, t * e.wraithShareMax));
}

// Per-wave spawn budget / concurrent-enemy cap, scaled by party size. These
// clamp the campaign's own base*playerScale formula (which was only ever
// validated to wave 20) so a long endless run can never queue or field an
// unbounded number of enemies — a real risk: at wave 50 in a 4-player room the
// unclamped formula produces >1000 queued enemies in a single wave.
export function endlessMaxQueue(playerCount: number): number {
  const e = CONFIG.endless;
  return e.maxQueueBase + e.maxQueuePerExtra * (playerCount - 1);
}
export function endlessMaxAlive(playerCount: number): number {
  const e = CONFIG.endless;
  return e.maxAliveBase + e.maxAlivePerExtra * (playerCount - 1);
}

// The elite-mob cadence tightens as the run goes on: every-5-waves early,
// every-4 from wave 20, every-3 from wave 50. `wave` is the wave an elite
// trigger just fired on; the return value is the gap to the next trigger.
export function nextEliteInterval(wave: number): number {
  if (wave < 20) return 5;
  if (wave < 50) return 4;
  return 3;
}

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------

export interface PlayerSeed {
  id: string;
  name: string;
  classId: ClassId;
}

function zeroCooldowns(): Record<SpellId, number> {
  return {
    fireball: 0, firestorm: 0, frost: 0, frostnova: 0,
    thunder: 0, chain: 0, shield: 0, aegis: 0, heal: 0, holybolt: 0,
    chant1: 0, chant2: 0, mend: 0, repulse: 0,
  };
}

// Spread player spawns on a small ring near arena centre so they start distinct.
function spawnPos(index: number, count: number): Vec2 {
  const cx = CONFIG.arenaWidth / 2;
  const cy = CONFIG.arenaHeight / 2;
  if (count <= 1) return { x: cx, y: cy };
  const ring = 60;
  const angle = (index / count) * Math.PI * 2;
  return { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring };
}

export function createWorld(seeds: PlayerSeed[]): World {
  const players: Player[] = seeds.map((s, i) => {
    const def = CLASSES[s.classId];
    const maxHp = CONFIG.player.maxHp * def.hpMod;
    return {
      id: s.id,
      name: s.name,
      classId: s.classId,
      pos: spawnPos(i, seeds.length),
      facing: 0,
      hp: maxHp,
      maxHp,
      alive: true,
      downed: false,
      bleedoutAt: 0,
      reviveProgress: 0,
      respawnAtWave: 0,
      shieldUntil: 0,
      cooldowns: zeroCooldowns(),
      connected: true,
    };
  });

  return {
    time: 0,
    status: 'playing',
    players,
    enemies: [],
    projectiles: [],
    effects: [],
    nextEntityId: 1,
    wave: 0,
    score: 0,
    levelId: 0,
    levelCleared: false,
    transitionTimer: 0,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: CONFIG.wave.baseCadence,
    breakTimer: 0,
    endless: false,
    endlessKillBase: 0,
    endlessTimeBase: 0,
    nextEliteWave: 0,
    eliteWavesSoFar: 0,
    eliteQueue: 0,
    resonanceCalls: [],
    resonanceCooldownUntil: 0,
  };
}

export function createSoloWorld(classId: ClassId = 'pyro'): World {
  return createWorld([{ id: 'local', name: 'You', classId }]);
}

// Unlocked only from a 'victory' world: the same World continues instead of
// ending, with an infinite, ever-escalating wave loop (see updateWaves/
// spawnEndlessEnemy/spawnElite). Player hp/pos/cooldowns/score are left alone
// — only the battle/wave transients reset, exactly like a campaign level
// transition (this is deliberately the same shape of reset). The single
// source of truth for both LocalSession and Room, so solo and networked play
// can never diverge on what "entering endless mode" means.
export function enterEndlessMode(world: World): void {
  world.enemies = [];
  world.projectiles = [];
  world.effects = [];
  world.wave = 0;
  world.spawnQueue = 0;
  world.spawnTimer = 0;
  world.breakTimer = 0;
  world.levelCleared = false;
  world.transitionTimer = 0;
  world.endless = true;
  world.endlessKillBase = world.score;
  world.endlessTimeBase = world.time;
  world.nextEliteWave = 5;
  world.eliteWavesSoFar = 0;
  world.eliteQueue = 0;
  world.status = 'playing';
}

// Ends an endless run the same way a campaign wipe does — reuses the existing
// gameover screen/return-to-lobby flow rather than a bespoke ending state.
export function endEndlessMode(world: World): void {
  world.status = 'gameover';
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function findPlayer(world: World, id: string): Player | undefined {
  return world.players.find((p) => p.id === id);
}

function skillPowerMultiplier(world: World): number {
  return world.players.some((p) => p.connected && p.alive && !p.downed && world.time < (p.aegisUntil ?? 0)) ? 2 : 1;
}

function skillDamage(world: World, base: number): number {
  return base * skillPowerMultiplier(world);
}

function skillHeal(world: World, base: number): number {
  return base * skillPowerMultiplier(world);
}

// In-fight = an active participant: connected AND alive AND not downed. Used for
// command application, enemy targeting and reviver eligibility. A disconnected
// player stays in the world but is treated as having left (no command, no chase,
// cannot revive). The shared sim has no local-input gating (that lives client-side),
// so all gameplay sites use inFight rather than a connected-agnostic predicate.
function inFight(p: Player): boolean {
  return p.connected && p.alive && !p.downed;
}

export function step(
  world: World,
  commands: Command[],
  dt: number,
  rng: () => number = Math.random
): World {
  if (world.status === 'gameover' || world.status === 'victory') return world;
  world.time += dt;

  // Latest move per player; cast queue processes every cast.
  const moveDirs = new Map<string, Vec2>();
  for (const cmd of commands) {
    const p = findPlayer(world, cmd.playerId);
    if (!p || !inFight(p)) continue;
    if (cmd.kind === 'move') moveDirs.set(p.id, cmd.dir);
    else if (cmd.kind === 'face') p.facing = cmd.angle;
    else if (cmd.kind === 'cast') castSpell(world, p, cmd.spell);
    else if (cmd.kind === 'resonance') world.resonanceCalls.push({ playerId: p.id, at: world.time });
  }

  movePlayers(world, moveDirs, dt);
  updateResonance(world);
  updateWaves(world, dt, rng);
  updateEnemies(world, dt, rng);
  updateRevives(world, dt);
  updateRegen(world, dt);
  updateProjectiles(world, dt);
  decayEffects(world, dt);

  // Gameover only considers CONNECTED players: a disconnected-but-alive player
  // (connected=false, alive=true) must not keep the game alive forever after
  // everyone else dies. The length guard stops a fully-empty/disconnected world
  // from false-triggering (the server room reaper handles abandonment instead).
  const live = world.players.filter((p) => p.connected);
  if (live.length > 0 && live.every((p) => !p.alive)) {
    world.status = 'gameover';
  }
  return world;
}

function movePlayers(world: World, moveDirs: Map<string, Vec2>, dt: number): void {
  const r = CONFIG.player.radius;
  for (const p of world.players) {
    if (!inFight(p)) continue;
    const dir = moveDirs.get(p.id);
    if (!dir) continue;
    // Clamp client-supplied dir to at most unit length so it cannot grant extra
    // speed (a {x:5,y:0} dir must not move 5x further than a unit vector).
    const l = len(dir);
    const unit = l > 1 ? scale(dir, 1 / l) : dir;
    const iceSlow = world.time < (p.slowUntil ?? 0) ? CONFIG.slime.ice.slowFactor : 1;
    const speed = CONFIG.player.speed * CLASSES[p.classId].speedMod * iceSlow;
    p.pos.x += unit.x * speed * dt;
    p.pos.y += unit.y * speed * dt;
    p.pos.x = clamp(p.pos.x, r, CONFIG.arenaWidth - r);
    p.pos.y = clamp(p.pos.y, r, CONFIG.arenaHeight - r);
  }
}

// ---------------------------------------------------------------------------
// 共鳴詠唱 (resonance): ≥2 DISTINCT players calling within CONFIG.resonance.
// windowSec of each other grant the whole party a shield + heal-over-time
// burst — a coordination reward, not a per-caster spell. Trims the rolling
// call buffer every step; on trigger, clears it and starts the cooldown so
// it can't be re-triggered back-to-back.
// ---------------------------------------------------------------------------
function updateResonance(world: World): void {
  const cutoff = world.time - CONFIG.resonance.windowSec;
  world.resonanceCalls = world.resonanceCalls.filter((c) => c.at >= cutoff);
  if (world.resonanceCalls.length === 0) return;
  if (world.time < world.resonanceCooldownUntil) return;

  const distinctCallers = new Set(world.resonanceCalls.map((c) => c.playerId));
  if (distinctCallers.size < 2) return;

  for (const p of world.players) {
    if (!inFight(p)) continue;
    p.shieldUntil = Math.max(p.shieldUntil, world.time + CONFIG.resonance.shieldDuration);
    p.healUntil = Math.max(p.healUntil ?? 0, world.time + CONFIG.resonance.healDuration);
    p.healRate = Math.max(p.healRate ?? 0, CONFIG.resonance.healRate);
  }

  // A single shared burst centred on the party's centroid — there's no one
  // "caster" to anchor it on, unlike every other buff spell.
  const alive = world.players.filter(inFight);
  const cx = alive.reduce((s, p) => s + p.pos.x, 0) / alive.length;
  const cy = alive.reduce((s, p) => s + p.pos.y, 0) / alive.length;
  pushEffect(world, {
    kind: 'resonance',
    a: { x: cx, y: cy },
    radius: 220,
    ttl: CONFIG.effectTtl.resonance,
    colorHint: '#ffd24d',
  });

  world.resonanceCalls = [];
  world.resonanceCooldownUntil = world.time + CONFIG.resonance.cooldownSec;
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

function castSpell(world: World, caster: Player, spell: SpellId): void {
  if (world.time < caster.cooldowns[spell]) return;          // on cooldown
  if (!classSpellSet(caster.classId).has(spell)) return;     // not in loadout
  // 爆裂魔法 needs ≥1 charge; abort (no cooldown spent) if none stacked yet.
  if (spell === 'firestorm' && (caster.pyroCharge ?? 0) < 1) return;
  if (spell === 'firestorm') {
    // cooldown scales with the charge being consumed: bigger blast → longer recovery.
    caster.cooldowns[spell] = world.time + CONFIG.firestorm.baseCd + (caster.pyroCharge ?? 0) * CONFIG.firestorm.cdPerCharge;
  } else {
    caster.cooldowns[spell] = world.time + SPELLS[spell].cooldown;
  }

  switch (spell) {
    case 'fireball':
      spawnFacingProjectile(world, caster, 'fireball',
        CONFIG.fireball.speed, 0, CONFIG.fireball.radius, CONFIG.fireball.ttl);
      break;
    case 'holybolt':
      castHolyburst(world, caster);
      break;
    case 'frost': {
      const count = CONFIG.frost.count;
      for (let i = 0; i < count; i++) {
        const offset = (i - (count - 1) / 2) * CONFIG.frost.spread;
        const a = caster.facing + offset;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        spawnProjectile(world, caster, 'frost', dir,
          CONFIG.frost.speed, CONFIG.frost.damage, CONFIG.frost.radius, CONFIG.frost.ttl);
      }
      break;
    }
    case 'firestorm': {
      // 爆裂魔法: slow fused mortar whose explosion scales with the stacked charge,
      // then the charge is consumed.
      const charge = caster.pyroCharge ?? 0;
      // Damage = base + perCharge*層;radius grows with 層 (no cap — 惠惠 dream).
      const exDmg = CONFIG.firestorm.baseDamage + CONFIG.firestorm.perChargeDamage * charge;
      const exRadius = CONFIG.firestorm.baseRadius + CONFIG.firestorm.perChargeRadius * charge;
      const dir = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
      spawnProjectile(world, caster, 'firestorm', dir,
        CONFIG.firestorm.speed, 0, CONFIG.firestorm.radius, CONFIG.firestorm.ttl,
        CONFIG.firestorm.ttl, exDmg, exRadius);
      caster.pyroCharge = 0; // consumed
      break;
    }
    case 'chant1':
    case 'chant2':
      // No-cooldown chant: stack 爆裂 charge (no damage). Small aura to show the chant.
      caster.pyroCharge = (caster.pyroCharge ?? 0) + CONFIG.chant.chargePerCast;
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.player.radius * 1.5,
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES.pyro.color, spell,
      });
      break;
    case 'mend': {
      // 精靈自癒: self-only heal-over-time.
      caster.healUntil = world.time + CONFIG.mend.duration;
      caster.healRate = CONFIG.mend.rate;
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.player.radius * 2,
        ttl: CONFIG.mend.duration, colorHint: CLASSES.cryo.color, spell: 'mend',
      });
      break;
    }
    case 'repulse':
      castRepulse(world, caster);
      break;
    case 'frostnova':
      castFrostnova(world, caster);
      break;
    case 'thunder':
      castThunder(world, caster);
      break;
    case 'chain':
      castChain(world, caster);
      break;
    case 'shield':
      caster.shieldUntil = world.time + CONFIG.shield.duration;
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.player.radius * 1.6,
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES[caster.classId].color, spell: 'shield',
      });
      break;
    case 'aegis': {
      for (const ally of world.players) {
        if (!ally.alive || ally.downed) continue;
        if (dist(caster.pos, ally.pos) <= CONFIG.aegis.radius) {
          ally.shieldUntil = world.time + CONFIG.aegis.duration;
          ally.aegisUntil = world.time + CONFIG.aegis.duration;
        }
      }
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.aegis.radius,
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES[caster.classId].color, spell: 'aegis',
      });
      break;
    }
    case 'heal': {
      // Heal-over-time: grant regen to allies in radius (applied in updateRegen).
      for (const ally of world.players) {
        if (!ally.alive || ally.downed) continue;
        if (dist(caster.pos, ally.pos) <= CONFIG.heal.radius) {
          ally.healUntil = world.time + CONFIG.heal.duration;
          ally.healRate = CONFIG.heal.rate;
        }
      }
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.heal.radius,
        ttl: CONFIG.heal.duration, colorHint: CLASSES[caster.classId].color, spell: 'heal', // lingers the whole HoT
      });
      break;
    }
    default:
      break;
  }
}

// frostnova (「冰結」) — instant self-centred AoE: damage + FREEZE enemies in
// radius (fully stopped, not just slowed). slowUntil is set too so the existing
// blue tint shows during the freeze.
function castFrostnova(world: World, caster: Player): void {
  for (const e of world.enemies) {
    if (e.hp <= 0) continue;
    if (dist(caster.pos, e.pos) <= CONFIG.frostnova.radius + e.radius) {
      e.hp -= skillDamage(world, CONFIG.frostnova.damage);
      e.frozenUntil = world.time + CONFIG.frostnova.slowDuration;
      e.slowUntil = world.time + CONFIG.frostnova.slowDuration;
    }
  }
  pushEffect(world, {
    kind: 'nova', ownerId: caster.id,
    a: { x: caster.pos.x, y: caster.pos.y },
    radius: CONFIG.frostnova.radius,
    ttl: CONFIG.effectTtl.nova, colorHint: CLASSES.cryo.color, spell: 'frostnova',
  });
  removeDeadEnemies(world);
}

// repulse (「鐵砂之劍」) — magnetised iron-sand sweep: damage enemies in radius
// and shove them outward (magnetic knockback, clamped to the arena) off 美琴.
function castRepulse(world: World, caster: Player): void {
  const o = caster.pos;
  for (const e of world.enemies) {
    if (e.hp <= 0) continue;
    const rel = sub(e.pos, o);
    const d = len(rel);
    if (d <= CONFIG.repulse.radius + e.radius) {
      e.hp -= skillDamage(world, CONFIG.repulse.damage);
      const ux = d > 0.001 ? rel.x / d : 1;
      const uy = d > 0.001 ? rel.y / d : 0;
      e.pos.x = Math.max(0, Math.min(CONFIG.arenaWidth, e.pos.x + ux * CONFIG.repulse.knockback));
      e.pos.y = Math.max(0, Math.min(CONFIG.arenaHeight, e.pos.y + uy * CONFIG.repulse.knockback));
    }
  }
  pushEffect(world, {
    kind: 'nova', ownerId: caster.id,
    a: { x: o.x, y: o.y },
    radius: CONFIG.repulse.radius,
    ttl: CONFIG.effectTtl.nova, colorHint: CLASSES.storm.color, spell: 'repulse',
  });
  removeDeadEnemies(world);
}

// holybolt (「聖光」) — self-centred holy burst: damage enemies within radius
// (Jeanne's kit is all self-centred — no aiming). Gold nova fx.
function castHolyburst(world: World, caster: Player): void {
  for (const e of world.enemies) {
    if (e.hp <= 0) continue;
    if (dist(caster.pos, e.pos) <= CONFIG.holybolt.radius + e.radius) e.hp -= skillDamage(world, CONFIG.holybolt.damage);
  }
  pushEffect(world, {
    kind: 'nova', ownerId: caster.id,
    a: { x: caster.pos.x, y: caster.pos.y },
    radius: CONFIG.holybolt.radius,
    ttl: CONFIG.effectTtl.nova, colorHint: CLASSES.warden.color, spell: 'holybolt',
  });
  removeDeadEnemies(world);
}

// thunder (「超電磁砲」) — hitscan ray along facing that REFLECTS off the arena
// walls up to maxBounces times, drawing a folded beam. Each segment damages
// enemies within `width`; damage decays by bounceFalloff per bounce.
function castThunder(world: World, caster: Player): void {
  const W = CONFIG.arenaWidth, H = CONFIG.arenaHeight;
  const width = CONFIG.thunder.width;
  let o = { x: caster.pos.x, y: caster.pos.y };
  let dir = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
  let remaining: number = CONFIG.thunder.range;
  let dmg: number = CONFIG.thunder.damage;
  const hit = new Set<number>(); // each enemy takes damage at most once per cast

  for (let b = 0; b <= CONFIG.thunder.maxBounces; b++) {
    // nearest wall hit within the remaining length
    let segLen = remaining;
    let axis: 'x' | 'y' | null = null;
    if (dir.x > 1e-6) { const t = (W - o.x) / dir.x; if (t < segLen) { segLen = t; axis = 'x'; } }
    else if (dir.x < -1e-6) { const t = -o.x / dir.x; if (t < segLen) { segLen = t; axis = 'x'; } }
    if (dir.y > 1e-6) { const t = (H - o.y) / dir.y; if (t < segLen) { segLen = t; axis = 'y'; } }
    else if (dir.y < -1e-6) { const t = -o.y / dir.y; if (t < segLen) { segLen = t; axis = 'y'; } }
    const end = { x: o.x + dir.x * segLen, y: o.y + dir.y * segLen };

    for (const e of world.enemies) {
      if (e.hp <= 0 || hit.has(e.id)) continue;
      const rel = sub(e.pos, o);
      const along = rel.x * dir.x + rel.y * dir.y;
      if (along < 0 || along > segLen) continue;
      const perp = Math.abs(rel.x * -dir.y + rel.y * dir.x);
      if (perp <= width + e.radius) { e.hp -= skillDamage(world, dmg); hit.add(e.id); }
    }
    pushEffect(world, {
      kind: 'beam', ownerId: caster.id,
      a: { x: o.x, y: o.y }, b: end,
      ttl: CONFIG.effectTtl.beam, colorHint: CLASSES.storm.color, spell: 'thunder',
    });

    remaining -= segLen;
    if (remaining <= 1 || axis === null) break; // out of range, or ended in open space
    if (axis === 'x') dir = { x: -dir.x, y: dir.y };
    else dir = { x: dir.x, y: -dir.y };
    o = { x: end.x + dir.x * 0.5, y: end.y + dir.y * 0.5 }; // nudge off the wall
    dmg *= CONFIG.thunder.bounceFalloff;
  }
  removeDeadEnemies(world);
}

// chain — greedy nearest-unhit traversal from caster; falloff per jump; chain fx.
function castChain(world: World, caster: Player): void {
  const visited = new Set<number>();
  let from: Vec2 = caster.pos;
  let range: number = CONFIG.chain.range; // first hop allowed up to `range`
  for (let k = 0; k < CONFIG.chain.maxJumps; k++) {
    let target: Enemy | null = null;
    let bestD = Infinity;
    for (const e of world.enemies) {
      if (e.hp <= 0 || visited.has(e.id)) continue;
      const d = dist(from, e.pos);
      if (d <= range && d < bestD) { bestD = d; target = e; }
    }
    if (!target) break;
    target.hp -= skillDamage(world, CONFIG.chain.damage * Math.pow(CONFIG.chain.falloff, k));
    visited.add(target.id);
    pushEffect(world, {
      kind: 'chain', ownerId: caster.id,
      a: { x: from.x, y: from.y },
      b: { x: target.pos.x, y: target.pos.y },
      ttl: CONFIG.effectTtl.chain, colorHint: CLASSES.storm.color, spell: 'chain',
    });
    from = target.pos;
    range = CONFIG.chain.jumpRange; // subsequent hops use jumpRange
  }
  removeDeadEnemies(world);
}

function spawnFacingProjectile(
  world: World, caster: Player, spell: SpellId,
  speed: number, damage: number, radius: number, ttl: number
): void {
  const dir = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
  spawnProjectile(world, caster, spell, dir, speed, damage, radius, ttl);
}

function spawnProjectile(
  world: World, caster: Player, spell: SpellId, dir: Vec2,
  speed: number, damage: number, radius: number, ttl: number, fuse?: number,
  explosionDamage?: number, explosionRadius?: number
): void {
  world.projectiles.push({
    id: world.nextEntityId++,
    spell,
    ownerId: caster.id,
    pos: { x: caster.pos.x, y: caster.pos.y },
    vel: { x: dir.x * speed, y: dir.y * speed },
    damage, radius, ttl, fuse, explosionDamage, explosionRadius,
  });
}

// ---------------------------------------------------------------------------
// Projectiles (collide with enemies only — never allies)
// ---------------------------------------------------------------------------

function inBounds(p: Vec2): boolean {
  return p.x >= 0 && p.x <= CONFIG.arenaWidth && p.y >= 0 && p.y <= CONFIG.arenaHeight;
}

function pushEffect(world: World, e: Omit<TransientEffect, 'id'>): void {
  world.effects.push({ id: world.nextEntityId++, ...e });
}

// AoE explosion at a point — damages enemies only (never allies), spawns blast fx.
function explodeAoE(
  world: World, at: Vec2, ownerId: string,
  explosionRadius: number, explosionDamage: number, colorHint: string
): void {
  for (const e of world.enemies) {
    if (dist(at, e.pos) <= explosionRadius + e.radius) {
      e.hp -= skillDamage(world, explosionDamage);
    }
  }
  pushEffect(world, {
    kind: 'blast', ownerId,
    a: { x: at.x, y: at.y },
    radius: explosionRadius,
    ttl: CONFIG.effectTtl.blast, colorHint,
  });
}

// Returns true if the projectile detonated (so the fuse path must not re-detonate).
function onProjectileHit(world: World, proj: Projectile, hit: Enemy): boolean {
  switch (proj.spell) {
    case 'fireball':
      explodeAoE(world, proj.pos, proj.ownerId,
        CONFIG.fireball.explosionRadius, CONFIG.fireball.explosionDamage, CLASSES.pyro.color);
      return false;
    case 'firestorm':
      explodeAoE(world, proj.pos, proj.ownerId,
        proj.explosionRadius ?? CONFIG.firestorm.explosionRadius,
        proj.explosionDamage ?? CONFIG.firestorm.baseDamage, CLASSES.pyro.color);
      return true; // detonated on contact; fuse loop must skip it
    case 'frost':
      hit.hp -= skillDamage(world, proj.damage);
      hit.slowUntil = world.time + CONFIG.frost.slowDuration;
      return false;
    default:
      // holybolt and other direct-hit projectiles
      hit.hp -= skillDamage(world, proj.damage);
      return false;
  }
}

function removeDeadEnemies(world: World): void {
  const survivors: Enemy[] = [];
  let eliteBonus = 0;
  for (const e of world.enemies) {
    if (e.hp > 0) { survivors.push(e); continue; }
    if (e.element === 'fire') fireDeathExplosion(world, e); // 火史萊姆死亡小爆炸
    // world.endless guard is a defensive second layer — an elite must never
    // set boss:true in the first place (see spawnElite), so this should never
    // actually trigger in endless mode, but it stops an endless run's demoted
    // "boss" (if that ever changes) from silently re-triggering levelCleared.
    if (e.boss && !world.endless) {
      // 王死 = 這關過了,停止繼續刷怪,倒數轉場(見 updateWaves)。
      world.levelCleared = true;
      world.transitionTimer = CONFIG.transition.delay;
    }
    if (e.elite) eliteBonus += CONFIG.elite.scoreBonus - 1; // +1 per kill already counted below
  }
  world.score += world.enemies.length - survivors.length + eliteBonus;
  world.enemies = survivors;
}

// Fire slime detonates on death: AoE that hits players who hugged it (i-frame +
// shield gated, like contact). Pushes a small blast effect (client plays boom).
function fireDeathExplosion(world: World, e: Enemy): void {
  const s = CONFIG.slime.fire;
  for (const p of world.players) {
    if (!inFight(p) || p.downed) continue;
    if (world.time < p.shieldUntil || world.time < (p.invulnUntil ?? 0)) continue;
    if (dist(e.pos, p.pos) <= s.explodeRadius + CONFIG.player.radius) {
      p.hp -= s.explodeDamage;
      p.invulnUntil = world.time + CONFIG.player.invulnTime;
      if (p.hp <= 0) enterDowned(world, p);
    }
  }
  pushEffect(world, {
    kind: 'blast', a: { x: e.pos.x, y: e.pos.y },
    radius: s.explodeRadius, ttl: CONFIG.effectTtl.blast, colorHint: CLASSES.pyro.color,
  });
}

function updateProjectiles(world: World, dt: number): void {
  for (const proj of world.projectiles) {
    proj.pos.x += proj.vel.x * dt;
    proj.pos.y += proj.vel.y * dt;
    proj.ttl -= dt;
  }
  const detonated = new Set<number>();
  for (const proj of world.projectiles) {
    if (proj.ttl <= 0) continue;
    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      if (dist(proj.pos, e.pos) <= proj.radius + e.radius) {
        if (onProjectileHit(world, proj, e)) detonated.add(proj.id);
        proj.ttl = 0; // consumed
        break;
      }
    }
  }
  // Fused projectiles (firestorm) detonate where they expire if not consumed on contact.
  for (const proj of world.projectiles) {
    if (proj.spell === 'firestorm' && proj.fuse !== undefined &&
        proj.ttl <= 0 && !detonated.has(proj.id)) {
      explodeAoE(world, proj.pos, proj.ownerId,
        proj.explosionRadius ?? CONFIG.firestorm.explosionRadius,
        proj.explosionDamage ?? CONFIG.firestorm.baseDamage, CLASSES.pyro.color);
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.ttl > 0 && inBounds(p.pos));
  removeDeadEnemies(world);
}

function decayEffects(world: World, dt: number): void {
  for (const e of world.effects) e.ttl -= dt;
  world.effects = world.effects.filter((e) => e.ttl > 0);
}

// ---------------------------------------------------------------------------
// Enemies (target nearest alive player; contact damage; downed transition)
// ---------------------------------------------------------------------------

function nearestAlivePlayer(world: World, from: Vec2): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of world.players) {
    if (!inFight(p)) continue; // disconnected players are not chased
    const d = dist(from, p.pos);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function enterDowned(world: World, p: Player): void {
  p.downed = true;
  p.hp = 0;
  p.bleedoutAt = world.time + CONFIG.bleedout.time;
  p.reviveProgress = 0;
}

// Heal-over-time tick: regen alive, non-downed players whose 治療術 is active.
function updateRegen(world: World, dt: number): void {
  for (const p of world.players) {
    if (!p.alive || p.downed) continue;
    if (world.time < (p.healUntil ?? 0)) p.hp = Math.min(p.maxHp, p.hp + skillHeal(world, p.healRate ?? CONFIG.heal.rate) * dt);
  }
}

function updateEnemies(world: World, dt: number, rng: () => number): void {
  for (const e of world.enemies) {
    const target = nearestAlivePlayer(world, e.pos);
    e.targetId = target ? target.id : null;
    if (!target) continue;
    const toP = sub(target.pos, e.pos);
    const d = len(toP);
    const frozen = world.time < (e.frozenUntil ?? 0);

    // Movement: storm slimes dash (telegraph → lunge), wraiths blink, others
    // walk toward target. Elites always walk (never inherit a signature
    // movement quirk) so they read as "the big slow tank", same as a campaign
    // boss — storm-dash is explicitly excluded here for that reason.
    if (!frozen) {
      if (e.wraith) updateWraith(world, e, toP, d);
      else if (e.element === 'storm' && !e.elite) stormMove(world, e, toP, d, dt);
      else {
        const speed = world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
        if (d > 1) {
          const move = scale(toP, (speed * dt) / d);
          e.pos.x += move.x;
          e.pos.y += move.y;
        }
      }
    }

    // Holy slimes periodically heal nearby slimes (kept alive → 優先清).
    if (e.element === 'holy') holyHeal(world, e);
    // 王/菁英 periodically summons small adds (kill it to stop the adds).
    if (e.boss || e.elite) bossSummon(world, e, rng);

    if (
      d <= e.radius + CONFIG.player.radius &&
      world.time >= target.shieldUntil &&
      world.time >= (target.invulnUntil ?? 0)
    ) {
      // Discrete hit + i-frames: the first enemy to connect this window deals
      // contactHit and grants invulnerability, so the rest of a swarm can't pile
      // on in the same instant.
      target.hp -= CONFIG.player.contactHit;
      target.invulnUntil = world.time + CONFIG.player.invulnTime;
      // Ice slime also slows the player's movement briefly.
      if (e.element === 'ice') target.slowUntil = world.time + CONFIG.slime.ice.slowDuration;
      if (target.hp <= 0) enterDowned(world, target);
    }
  }
}

// Storm slime movement: every dashInterval it winds up (telegraph: holds still +
// a storm-colour aura tell) with its direction LOCKED, then lunges fast along
// that direction. Otherwise it chases at its (already faster) base speed.
function stormMove(world: World, e: Enemy, toP: Vec2, d: number, dt: number): void {
  const s = CONFIG.slime.storm;
  if (e.nextDashAt === undefined) e.nextDashAt = world.time + s.dashInterval;
  const telegraphing = world.time < (e.telegraphUntil ?? 0);
  const dashing = !telegraphing && world.time < (e.dashUntil ?? 0);

  if (!telegraphing && !dashing && world.time >= e.nextDashAt && d > 1) {
    e.telegraphUntil = world.time + s.telegraph;
    e.dashUntil = e.telegraphUntil + s.dashTime;
    e.nextDashAt = e.dashUntil + s.dashInterval;
    e.dashDir = scale(toP, 1 / d); // lock aim at wind-up so the telegraph is fair
    pushEffect(world, {
      kind: 'aura', a: { x: e.pos.x, y: e.pos.y },
      radius: e.radius * 2.4, ttl: s.telegraph, colorHint: CLASSES.storm.color,
    });
    return; // winding up: no move this frame
  }
  if (telegraphing) return; // hold still — readable tell
  if (dashing && e.dashDir) {
    e.pos.x += e.dashDir.x * s.dashSpeed * dt;
    e.pos.y += e.dashDir.y * s.dashSpeed * dt;
    return;
  }
  const speed = world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
  if (d > 1) {
    const move = scale(toP, (speed * dt) / d);
    e.pos.x += move.x;
    e.pos.y += move.y;
  }
}

// Ice wraith movement (世界2 signature enemy): holds perfectly still, then
// blinks blinkDist toward its target every blinkInterval — a flicker, not a
// walk. Distinct on purpose from every level-1 slime's smooth chase (and from
// storm's telegraphed lunge). Capped at `d` so it never overshoots the target.
function updateWraith(world: World, e: Enemy, toP: Vec2, d: number): void {
  const s = CONFIG.wraith;
  if (e.nextBlinkAt === undefined) e.nextBlinkAt = world.time + s.blinkInterval;
  if (world.time < e.nextBlinkAt || d <= 1) return;
  e.nextBlinkAt = world.time + s.blinkInterval;
  const jump = Math.min(s.blinkDist, d);
  e.pos.x += (toP.x / d) * jump;
  e.pos.y += (toP.y / d) * jump;
}

// 王/菁英召喚:每 summonInterval 在自己周圍生 summonCount 隻小怪 + 召喚光環。
// campaign 王沿用該世界的一般敵人種類(LEVEL_ENEMY),level 0 沒有 rng 可用,
// 固定召喚一般史萊姆(跟過去行為一致,不是真隨機混色)。菁英召喚改走無盡模式
// 的環境元素混合(wraithShare+pickElement),不綁定 LEVEL_ENEMY——那是 campaign
// per-level 單一種類查表,無盡模式不適用。
function bossSummon(world: World, e: Enemy, rng: () => number): void {
  const b = e.elite ? CONFIG.elite : CONFIG.boss;
  if (e.nextSummonAt === undefined) e.nextSummonAt = world.time + b.summonInterval;
  if (world.time < e.nextSummonAt) return;
  e.nextSummonAt = world.time + b.summonInterval;
  const kind = LEVEL_ENEMY[world.levelId] ?? 'mixed';
  for (let i = 0; i < b.summonCount; i++) {
    const ang = (i / b.summonCount) * Math.PI * 2;
    const r = e.radius + 24;
    const pos = { x: e.pos.x + Math.cos(ang) * r, y: e.pos.y + Math.sin(ang) * r };
    if (e.elite) spawnEndlessEnemy(world, pos, rng);
    else if (kind === 'wraith') makeWraith(world, pos);
    else if (kind === 'mixed') makeSlime(world, pos, 'normal');
    else makeSlime(world, pos, kind);
  }
  pushEffect(world, {
    kind: 'aura', a: { x: e.pos.x, y: e.pos.y },
    radius: e.radius * 1.6, ttl: 0.4, colorHint: '#ff3b6b',
  });
}

// Holy slime heal pulse: every healInterval, top up nearby slimes (incl. itself)
// up to their spawn hp, with a holy-colour aura tell.
function holyHeal(world: World, e: Enemy): void {
  const s = CONFIG.slime.holy;
  if (e.nextHealAt === undefined) e.nextHealAt = world.time + s.healInterval;
  if (world.time < e.nextHealAt) return;
  e.nextHealAt = world.time + s.healInterval;
  let healed = false;
  for (const other of world.enemies) {
    if (other.hp <= 0) continue;
    const cap = other.maxHp ?? other.hp;
    if (other.hp >= cap) continue;
    if (dist(e.pos, other.pos) <= s.healRadius) {
      other.hp = Math.min(cap, other.hp + s.healAmount);
      healed = true;
    }
  }
  if (healed) {
    pushEffect(world, {
      kind: 'aura', a: { x: e.pos.x, y: e.pos.y },
      radius: s.healRadius, ttl: 0.4, colorHint: CLASSES.warden.color,
    });
  }
}

// ---------------------------------------------------------------------------
// Revive (auto-proximity) + bleedout (Task A6)
// ---------------------------------------------------------------------------

// Nearby alive & !downed allies that can channel a revive on `downed`.
// Returns whether any reviver is present, and whether any reviver is a warden.
function revivers(world: World, downed: Player): { any: boolean; warden: boolean } {
  let any = false;
  let warden = false;
  for (const ally of world.players) {
    if (ally.id === downed.id || !inFight(ally)) continue; // disconnected ally cannot revive
    if (dist(ally.pos, downed.pos) <= CONFIG.revive.radius) {
      any = true;
      if (ally.classId === 'warden') warden = true;
    }
  }
  return { any, warden };
}

function updateRevives(world: World, dt: number): void {
  for (const p of world.players) {
    if (!p.alive || !p.downed) continue;
    const r = revivers(world, p);
    if (r.any) {
      const rate = (1 / CONFIG.revive.time) * (r.warden ? 1.5 : 1);
      p.reviveProgress += rate * dt;
      if (p.reviveProgress >= 1) {
        p.downed = false;
        p.hp = CONFIG.revive.hp;
        p.reviveProgress = 0;
      }
    } else {
      // No ally near — progress decays toward 0.
      p.reviveProgress = Math.max(0, p.reviveProgress - (1 / CONFIG.revive.time) * dt);
    }
    // Bleedout: still downed and past the deadline -> full death, respawn next wave.
    if (p.downed && world.time >= p.bleedoutAt) {
      p.alive = false;
      p.downed = false;
      p.respawnAtWave = world.wave + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

// Effective player count for scaling: connected players still in the fight
// (alive or downed; dead-awaiting-respawn do not inflate the wave).
function effectivePlayerCount(world: World): number {
  return world.players.filter((p) => p.connected && (p.alive || p.downed)).length;
}

// Respawn fully-dead players whose scheduled respawn wave has arrived: full hp,
// repositioned. A player only returns once `world.wave >= p.respawnAtWave`.
function respawnDeadPlayers(world: World): void {
  const due = world.players.filter((p) => !p.alive && world.wave >= p.respawnAtWave);
  due.forEach((p, i) => {
    p.alive = true;
    p.downed = false;
    p.hp = p.maxHp;
    p.reviveProgress = 0;
    p.bleedoutAt = 0;
    p.pos = spawnPos(i, Math.max(1, due.length));
  });
}

function beginWave(world: World, rng: () => number): void {
  world.wave += 1;
  respawnDeadPlayers(world);
  const effective = Math.max(1, effectivePlayerCount(world));
  const playerScale = Math.pow(effective, CONFIG.wave.scaleExp);
  const base = CONFIG.wave.baseCount + (world.wave - 1) * CONFIG.wave.perWave;
  world.spawnQueue = Math.round(base * playerScale);
  if (world.endless) {
    // No campaign boss wave here — endless has its own elite-mob cadence
    // (below), stacked on top of the swarm rather than replacing part of it.
    world.spawnQueue = Math.min(world.spawnQueue, endlessMaxQueue(effective));
    if (world.wave === world.nextEliteWave) {
      world.eliteWavesSoFar += 1;
      world.eliteQueue = Math.min(3, 1 + Math.floor((world.eliteWavesSoFar - 1) / 4));
      world.nextEliteWave = world.wave + nextEliteInterval(world.wave);
    }
  } else if (world.wave % CONFIG.boss.every === 0) {
    // Campaign boss wave: spawn the level's boss + thin out the regular swarm
    // so it stays the focus.
    spawnBoss(world, rng);
    world.spawnQueue = Math.round(world.spawnQueue * CONFIG.boss.swarmMul);
  }
  world.spawnCadence = Math.max(
    CONFIG.wave.minCadence,
    CONFIG.wave.baseCadence - (world.wave - 1) * CONFIG.wave.cadenceDecay
  );
  world.spawnTimer = 0; // spawn first enemy immediately
}

// Slime attribute for a fresh spawn — new elements are introduced as the waves
// climb (normal weighted heavier so it stays the staple). Phase 1: colour/look
// only; phase 2 will branch behaviour on this.
function pickElement(wave: number, rng: () => number): EnemyElement {
  const pool: EnemyElement[] = ['normal', 'normal'];
  if (wave >= 1) pool.push('fire');
  if (wave >= 2) pool.push('ice');
  if (wave >= 3) pool.push('storm');
  if (wave >= 4) pool.push('holy');
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

// A point on the off-screen ring around a random living player (or arena centre).
function ringSpawnPos(world: World, rng: () => number): Vec2 {
  const W = CONFIG.arenaWidth;
  const H = CONFIG.arenaHeight;
  const targets = world.players.filter((p) => p.alive && !p.downed);
  const c = targets.length
    ? targets[Math.floor(rng() * targets.length) % targets.length].pos
    : { x: W / 2, y: H / 2 };
  const ang = rng() * Math.PI * 2;
  const dist = CONFIG.wave.spawnRadius + rng() * CONFIG.wave.spawnRadiusJitter;
  return { x: clamp(c.x + Math.cos(ang) * dist, 0, W), y: clamp(c.y + Math.sin(ang) * dist, 0, H) };
}

// Push one standard slime of `element` at `pos` (shared by wave spawns + boss
// summons). hp/speed go through enemyStatWaveHp/enemyStatWaveSpeed so an
// endless-mode run automatically gets the soft-capped/hard-capped stats.
function makeSlime(world: World, pos: Vec2, element: EnemyElement): void {
  let hp = enemyStatWaveHp(world);
  let speed = enemyStatWaveSpeed(world);
  if (element === 'holy') hp *= CONFIG.slime.holy.hpMul; // 聖史萊姆是肉盾
  if (element === 'storm') speed *= CONFIG.slime.storm.speedMul; // 雷史萊姆又快
  world.enemies.push({
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    hp, speed, slowUntil: 0, radius: CONFIG.enemy.radius, targetId: null,
    element, maxHp: hp,
  });
}

// 世界2(frostvale)signature enemy — same makeSlime skeleton (hp scales with
// wave) but ice element + the blink movement in updateWraith. `speed` is set
// for parity with Enemy's shape but unused (a wraith doesn't walk).
function makeWraith(world: World, pos: Vec2): void {
  const hp = enemyStatWaveHp(world);
  const speed = enemyStatWaveSpeed(world);
  world.enemies.push({
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    hp, speed, slowUntil: 0, radius: CONFIG.enemy.radius, targetId: null,
    element: 'ice', maxHp: hp, wraith: true,
  });
}

function spawnEnemy(world: World, rng: () => number): void {
  const pos = ringSpawnPos(world, rng);
  if (world.endless) { spawnEndlessEnemy(world, pos, rng); return; }
  const kind = LEVEL_ENEMY[world.levelId] ?? 'mixed';
  if (kind === 'wraith') makeWraith(world, pos);
  else if (kind === 'mixed') makeSlime(world, pos, pickElement(world.wave, rng));
  else makeSlime(world, pos, kind);
}

// Endless-mode regular spawn: 100% reuses pickElement's campaign element mix,
// plus a growing share of wraiths (see endlessWraithShare) — not tied to any
// single LEVEL_ENEMY kind, since endless mixes every world's enemy together.
function spawnEndlessEnemy(world: World, pos: Vec2, rng: () => number): void {
  if (rng() < endlessWraithShare(world.wave)) makeWraith(world, pos);
  else makeSlime(world, pos, pickElement(world.wave, rng));
}

// 世界王:巨大、肉、慢、週期召喚(見 BOSS_ELEMENT/bossSummon)。永遠走路移動,
// 不套用該世界雜兵的招牌移動方式(閃現/突進等),讀起來一貫是「緩慢大坦克」。
function spawnBoss(world: World, rng: () => number): void {
  const b = CONFIG.boss;
  const hp = enemyStatWaveHp(world) * b.hpMul;
  world.enemies.push({
    id: world.nextEntityId++,
    pos: ringSpawnPos(world, rng),
    hp,
    speed: enemyStatWaveSpeed(world) * b.speedMul,
    slowUntil: 0,
    radius: CONFIG.enemy.radius * b.radiusMul,
    targetId: null,
    element: BOSS_ELEMENT[world.levelId] ?? 'normal',
    maxHp: hp,
    boss: true,
    nextSummonAt: world.time + b.summonInterval,
  });
}

// Endless-mode-only: a former campaign boss demoted to an "elite" mob mixed
// into the swarm. Independent multipliers (CONFIG.elite, deliberately lighter
// than CONFIG.boss) computed straight from enemyStatWaveHp/Speed — NOT routed
// through makeSlime, so a holy-flavoured elite doesn't also pick up the
// per-element hp/speed multiplier (that would stack unevenly across the 4
// identities). Rotates through BOSS_ELEMENT by eliteWavesSoFar so it cycles
// slime-king → wraith-queen → thunder-king → grail-queen identities; `elite`
// (not `boss`) means killing it can never set world.levelCleared.
function spawnElite(world: World, pos: Vec2): void {
  const e = CONFIG.elite;
  const idx = ((world.eliteWavesSoFar - 1) % BOSS_ELEMENT.length + BOSS_ELEMENT.length) % BOSS_ELEMENT.length;
  const hp = enemyStatWaveHp(world) * e.hpMul;
  world.enemies.push({
    id: world.nextEntityId++,
    pos: { x: pos.x, y: pos.y },
    hp,
    speed: enemyStatWaveSpeed(world) * e.speedMul,
    slowUntil: 0,
    radius: CONFIG.enemy.radius * e.radiusMul,
    targetId: null,
    element: BOSS_ELEMENT[idx],
    maxHp: hp,
    elite: true,
    nextSummonAt: world.time + e.summonInterval,
  });
}

function updateWaves(world: World, dt: number, rng: () => number): void {
  if (world.levelCleared) {
    // Boss is down; let the level-clear toast linger, then either move on to
    // the next level or — on the last one — end the game.
    if (world.transitionTimer > 0) {
      world.transitionTimer -= dt;
      if (world.transitionTimer <= 0) {
        world.transitionTimer = 0;
        if (world.levelId >= MAX_LEVEL_ID) {
          world.status = 'victory';
        } else {
          world.levelId += 1;
          world.levelCleared = false;
          world.enemies = [];
          world.wave = 0;
          world.spawnQueue = 0;
          world.spawnTimer = 0;
          world.breakTimer = 0;
        }
      }
    }
    return;
  }
  if (world.breakTimer > 0) {
    world.breakTimer -= dt;
    if (world.breakTimer <= 0) {
      world.breakTimer = 0;
      beginWave(world, rng);
    }
    return;
  }
  if (world.wave === 0 && world.spawnQueue === 0) beginWave(world, rng);

  if (world.spawnQueue > 0 || world.eliteQueue > 0) {
    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      // Consume this cadence window either way; the alive-cap check below only
      // skips the actual spawn (retried next window), never drops the queue.
      world.spawnTimer = world.spawnCadence;
      const aliveOk = !world.endless
        || world.enemies.length < endlessMaxAlive(Math.max(1, effectivePlayerCount(world)));
      if (aliveOk) {
        // Elites spawn first within a wave (players still have full hp/cooldowns).
        if (world.eliteQueue > 0) {
          spawnElite(world, ringSpawnPos(world, rng));
          world.eliteQueue -= 1;
        } else {
          spawnEnemy(world, rng);
          world.spawnQueue -= 1;
        }
      }
    }
  }

  if (world.spawnQueue === 0 && world.eliteQueue === 0 && world.enemies.length === 0) {
    world.breakTimer = CONFIG.wave.breakTime;
  }
}
