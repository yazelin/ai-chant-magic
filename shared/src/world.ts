import { World, Command, Vec2, SpellId, Projectile, Enemy, Player, ClassId, TransientEffect } from './types';
import { CONFIG } from './config';
import { SPELLS } from './spells';
import { CLASSES, classSpellSet } from './classes';
import { dist, sub, len, scale } from './vec';

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
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: CONFIG.wave.baseCadence,
    breakTimer: 0,
  };
}

export function createSoloWorld(classId: ClassId = 'pyro'): World {
  return createWorld([{ id: 'local', name: 'You', classId }]);
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
  if (world.status === 'gameover') return world;
  world.time += dt;

  // Latest move per player; cast queue processes every cast.
  const moveDirs = new Map<string, Vec2>();
  for (const cmd of commands) {
    const p = findPlayer(world, cmd.playerId);
    if (!p || !inFight(p)) continue;
    if (cmd.kind === 'move') moveDirs.set(p.id, cmd.dir);
    else if (cmd.kind === 'face') p.facing = cmd.angle;
    else if (cmd.kind === 'cast') castSpell(world, p, cmd.spell);
  }

  movePlayers(world, moveDirs, dt);
  updateWaves(world, dt, rng);
  updateEnemies(world, dt);
  updateRevives(world, dt);
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
    const speed = CONFIG.player.speed * CLASSES[p.classId].speedMod;
    p.pos.x += unit.x * speed * dt;
    p.pos.y += unit.y * speed * dt;
    p.pos.x = clamp(p.pos.x, r, CONFIG.arenaWidth - r);
    p.pos.y = clamp(p.pos.y, r, CONFIG.arenaHeight - r);
  }
}

// ---------------------------------------------------------------------------
// Casting
// ---------------------------------------------------------------------------

function castSpell(world: World, caster: Player, spell: SpellId): void {
  if (world.time < caster.cooldowns[spell]) return;          // on cooldown
  if (!classSpellSet(caster.classId).has(spell)) return;     // not in loadout
  caster.cooldowns[spell] = world.time + SPELLS[spell].cooldown;

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
      // Slow fused mortar: explodes on enemy contact OR when ttl expires.
      const dir = { x: Math.cos(caster.facing), y: Math.sin(caster.facing) };
      spawnProjectile(world, caster, 'firestorm', dir,
        CONFIG.firestorm.speed, 0, CONFIG.firestorm.radius, CONFIG.firestorm.ttl,
        CONFIG.firestorm.ttl);
      break;
    }
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
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES[caster.classId].color,
      });
      break;
    case 'aegis': {
      for (const ally of world.players) {
        if (!ally.alive || ally.downed) continue;
        if (dist(caster.pos, ally.pos) <= CONFIG.aegis.radius) {
          ally.shieldUntil = world.time + CONFIG.aegis.duration;
        }
      }
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.aegis.radius,
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES[caster.classId].color,
      });
      break;
    }
    case 'heal': {
      for (const ally of world.players) {
        if (!ally.alive || ally.downed) continue;
        if (dist(caster.pos, ally.pos) <= CONFIG.heal.radius) {
          ally.hp = Math.min(ally.maxHp, ally.hp + CONFIG.heal.amount);
        }
      }
      pushEffect(world, {
        kind: 'aura', ownerId: caster.id,
        a: { x: caster.pos.x, y: caster.pos.y },
        radius: CONFIG.heal.radius,
        ttl: CONFIG.effectTtl.aura, colorHint: CLASSES[caster.classId].color,
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
      e.hp -= CONFIG.frostnova.damage;
      e.frozenUntil = world.time + CONFIG.frostnova.slowDuration;
      e.slowUntil = world.time + CONFIG.frostnova.slowDuration;
    }
  }
  pushEffect(world, {
    kind: 'nova', ownerId: caster.id,
    a: { x: caster.pos.x, y: caster.pos.y },
    radius: CONFIG.frostnova.radius,
    ttl: CONFIG.effectTtl.nova, colorHint: CLASSES.cryo.color,
  });
  removeDeadEnemies(world);
}

// holybolt (「聖光」) — self-centred holy burst: damage enemies within radius
// (Jeanne's kit is all self-centred — no aiming). Gold nova fx.
function castHolyburst(world: World, caster: Player): void {
  for (const e of world.enemies) {
    if (e.hp <= 0) continue;
    if (dist(caster.pos, e.pos) <= CONFIG.holybolt.radius + e.radius) e.hp -= CONFIG.holybolt.damage;
  }
  pushEffect(world, {
    kind: 'nova', ownerId: caster.id,
    a: { x: caster.pos.x, y: caster.pos.y },
    radius: CONFIG.holybolt.radius,
    ttl: CONFIG.effectTtl.nova, colorHint: CLASSES.warden.color,
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
      if (perp <= width + e.radius) { e.hp -= dmg; hit.add(e.id); }
    }
    pushEffect(world, {
      kind: 'beam', ownerId: caster.id,
      a: { x: o.x, y: o.y }, b: end,
      ttl: CONFIG.effectTtl.beam, colorHint: CLASSES.storm.color,
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
    target.hp -= CONFIG.chain.damage * Math.pow(CONFIG.chain.falloff, k);
    visited.add(target.id);
    pushEffect(world, {
      kind: 'chain', ownerId: caster.id,
      a: { x: from.x, y: from.y },
      b: { x: target.pos.x, y: target.pos.y },
      ttl: CONFIG.effectTtl.chain, colorHint: CLASSES.storm.color,
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
  speed: number, damage: number, radius: number, ttl: number, fuse?: number
): void {
  world.projectiles.push({
    id: world.nextEntityId++,
    spell,
    ownerId: caster.id,
    pos: { x: caster.pos.x, y: caster.pos.y },
    vel: { x: dir.x * speed, y: dir.y * speed },
    damage, radius, ttl, fuse,
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
      e.hp -= explosionDamage;
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
        CONFIG.firestorm.explosionRadius, CONFIG.firestorm.explosionDamage, CLASSES.pyro.color);
      return true; // detonated on contact; fuse loop must skip it
    case 'frost':
      hit.hp -= proj.damage;
      hit.slowUntil = world.time + CONFIG.frost.slowDuration;
      return false;
    default:
      // holybolt and other direct-hit projectiles
      hit.hp -= proj.damage;
      return false;
  }
}

function removeDeadEnemies(world: World): void {
  const survivors = world.enemies.filter((e) => e.hp > 0);
  world.score += world.enemies.length - survivors.length;
  world.enemies = survivors;
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
        CONFIG.firestorm.explosionRadius, CONFIG.firestorm.explosionDamage, CLASSES.pyro.color);
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

function updateEnemies(world: World, dt: number): void {
  for (const e of world.enemies) {
    const target = nearestAlivePlayer(world, e.pos);
    e.targetId = target ? target.id : null;
    if (!target) continue;
    const toP = sub(target.pos, e.pos);
    const d = len(toP);
    const frozen = world.time < (e.frozenUntil ?? 0);
    const speed = frozen ? 0 : world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
    if (d > 1) {
      const move = scale(toP, (speed * dt) / d);
      e.pos.x += move.x;
      e.pos.y += move.y;
    }
    if (d <= e.radius + CONFIG.player.radius && world.time >= target.shieldUntil) {
      target.hp -= CONFIG.contactDps * dt;
      if (target.hp <= 0) enterDowned(world, target);
    }
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

function beginWave(world: World): void {
  world.wave += 1;
  respawnDeadPlayers(world);
  const effective = effectivePlayerCount(world);
  const playerScale = Math.pow(Math.max(1, effective), CONFIG.wave.scaleExp);
  const base = CONFIG.wave.baseCount + (world.wave - 1) * CONFIG.wave.perWave;
  world.spawnQueue = Math.round(base * playerScale);
  world.spawnCadence = Math.max(
    CONFIG.wave.minCadence,
    CONFIG.wave.baseCadence - (world.wave - 1) * CONFIG.wave.cadenceDecay
  );
  world.spawnTimer = 0; // spawn first enemy immediately
}

function spawnEnemy(world: World, rng: () => number): void {
  const W = CONFIG.arenaWidth;
  const H = CONFIG.arenaHeight;
  const edge = Math.floor(rng() * 4) % 4;
  let pos;
  if (edge === 0) pos = { x: rng() * W, y: 0 };
  else if (edge === 1) pos = { x: rng() * W, y: H };
  else if (edge === 2) pos = { x: 0, y: rng() * H };
  else pos = { x: W, y: rng() * H };
  world.enemies.push({
    id: world.nextEntityId++,
    pos,
    hp: CONFIG.enemy.baseHp + (world.wave - 1) * CONFIG.enemy.hpPerWave,
    speed: CONFIG.enemy.baseSpeed + (world.wave - 1) * CONFIG.enemy.speedPerWave,
    slowUntil: 0,
    radius: CONFIG.enemy.radius,
    targetId: null,
  });
}

function updateWaves(world: World, dt: number, rng: () => number): void {
  if (world.breakTimer > 0) {
    world.breakTimer -= dt;
    if (world.breakTimer <= 0) {
      world.breakTimer = 0;
      beginWave(world);
    }
    return;
  }
  if (world.wave === 0 && world.spawnQueue === 0) beginWave(world);

  if (world.spawnQueue > 0) {
    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      spawnEnemy(world, rng);
      world.spawnQueue -= 1;
      world.spawnTimer = world.spawnCadence;
    }
  }

  if (world.spawnQueue === 0 && world.enemies.length === 0) {
    world.breakTimer = CONFIG.wave.breakTime;
  }
}
