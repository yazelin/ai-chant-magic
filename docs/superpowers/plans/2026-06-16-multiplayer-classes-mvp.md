# 連線 co-op + 職業系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. TDD the `shared` simulation and all pure logic. Steps use `- [ ]`.

**Goal:** Turn the single-player game into 2-4 player co-op with an authoritative Node WebSocket server reusing the shared simulation, plus a 4-class system (pyro/cryo/storm/warden) with distinct spell loadouts. Ends in a playable two-tab localhost demo.

**Authority on design:** `docs/superpowers/specs/2026-06-16-multiplayer-classes-design.md`, **§15 is the final authority** where it conflicts with earlier sections.

**Phasing (from review):**
- **Phase A** = workspaces refactor + multiplayer `shared` simulation (players array, 10 spells, effects channel, downed/revive/respawn/scaling) + single-player still playable via `LocalSession`. Independently shippable.
- **Phase B** = `ws` authoritative server + client `NetSession`/lobby/multi-render + two-tab e2e.

**Hard rules carried from the review:**
- No client prediction. Render everything (incl. self) from a snapshot interpolation buffer (~100ms behind). One 50ms server step+broadcast.
- `World` and `Snapshot` carry a transient `effects[]` array for one-shot visuals.
- Disconnect → mark `connected=false`, **never splice** the players array. Joins only in lobby.
- heal/aegis affect **alive** allies (incl self) only. Revive is **auto-proximity** (no command).
- Server binds `process.env.PORT` on `0.0.0.0`, `/healthz` on the same http server.
- Two-tab acceptance runs on the **Vite dev server** (http→ws localhost), not Pages.

---

## Workspace layout (target)

```
ai-chant-magic/
├─ package.json            # private, workspaces:[shared,client,server], root scripts
├─ package-lock.json       # single root lock
├─ shared/  (@acm/shared)  # pure TS, consumed as source
├─ client/  (@acm/client)  # Vite + Phaser
├─ server/  (@acm/server)  # ws, run via tsx (dev) / esbuild bundle (prod)
├─ render.yaml
└─ .github/workflows/deploy.yml
```

---

# PHASE A

## Task A1: Workspace scaffold + relocate shared (keep single-player green)

**Goal:** Introduce npm workspaces; move pure logic to `shared/`, the app to `client/`; 60 existing tests stay green; single-player still builds/runs. **No behavior change.**

**Files (moves via `git mv` to preserve history):**
- `src/sim/*` → `shared/src/*` (vec, types, config, spells, world)
- `src/voice/matcher.ts`, `src/voice/recognizer-policy.ts` → `shared/src/`
- `tests/sim/*`, `tests/voice/matcher.test.ts`, `tests/voice/recognizer-policy.test.ts` → `shared/tests/`
- `src/main.ts`, `src/render/*`, `src/input/*`, `src/voice/recognizer.ts`, `index.html`, `vite.config.ts` → under `client/`
- `tests/input/controls.test.ts` → `client/tests/`

- [ ] **Step 1: Root `package.json`**
```json
{
  "name": "ai-chant-magic",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "workspaces": ["shared", "client", "server"],
  "scripts": {
    "dev": "concurrently -k -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:client": "npm run dev -w @acm/client",
    "dev:server": "npm run dev -w @acm/server",
    "build": "npm run build -w @acm/client && npm run build -w @acm/server",
    "build:client": "npm run build -w @acm/client",
    "test": "npm run test -w @acm/shared && npm run test -w @acm/server",
    "test:client": "npm run test -w @acm/client"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```
(Server scripts referenced here are created in Phase B; `dev`/`build` that touch server are not exercised until then. For Phase A, `npm run build:client` and `npm run test -w @acm/shared` are the gates.)

- [ ] **Step 2: `shared/package.json`**
```json
{
  "name": "@acm/shared",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0" }
}
```

- [ ] **Step 3: `shared/src/index.ts`** — public surface re-exports:
```ts
export * from './vec';
export * from './types';
export * from './config';
export * from './spells';
export * from './world';
export * from './matcher';
export * from './recognizer-policy';
```

- [ ] **Step 4:** `shared/tsconfig.json` (strict, ES2020, module ESNext, moduleResolution bundler, noEmit, types: vitest/globals) and `shared/vitest.config.ts` (node env, globals). Move sim/voice files in; fix relative imports (now same dir: `./vec`, `./types`, etc. — matcher imports `../sim/types` becomes `./types`). Move tests; fix import paths to `../src/...`.

- [ ] **Step 5: `client/package.json`**
```json
{
  "name": "@acm/client",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc --noEmit && vite build", "preview": "vite preview", "test": "vitest run" },
  "dependencies": { "phaser": "^3.80.1", "@acm/shared": "*" },
  "devDependencies": { "typescript": "^5.4.0", "vite": "^5.2.0", "vitest": "^1.6.0" }
}
```

- [ ] **Step 6:** `client/vite.config.ts` — keep `base: './'`; add to be safe with workspace TS source:
```ts
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['@acm/shared'] },
  server: { fs: { allow: ['..'] } },
});
```
`client/tsconfig.json` (DOM lib), `client/vitest.config.ts` (node env). Update client imports: anything importing `../sim/...`, `./voice/matcher`, `./voice/recognizer-policy` now imports from `@acm/shared`. `client/index.html` references `/src/main.ts`.

- [ ] **Step 7:** From repo root run `npm install` (creates root lock + symlinks). Then:
  - Run: `npm run test -w @acm/shared` → Expected: all moved shared tests PASS (vec/spells/world/matcher/recognizer-policy ≈ 60).
  - Run: `npm run test -w @acm/client` → controls test PASS.
  - Run: `npm run build:client` → tsc clean + vite build emits `client/dist`.
- [ ] **Step 8: Commit** `refactor: split into shared/client npm workspaces (no behavior change)`.

**Verification gate A1:** all prior tests green from new locations; `client/dist` builds; `npm run dev:client` boots and the single-player game still plays (manual: shapes render, WSAD moves).

---

## Task A2: Class & spell foundations in `shared`

**Files:** rewrite `shared/src/spells.ts`, add `shared/src/classes.ts`, extend `shared/src/types.ts`, `shared/src/config.ts`. Tests: `shared/tests/spells.test.ts` (update), `shared/tests/classes.test.ts` (new).

- [ ] **Step 1: Extend `types.ts`** (full new SpellId/ClassId + effects + players model):
```ts
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
  cooldowns: Record<SpellId, number>;
  connected: boolean;
}
export interface Enemy { id:number; pos:Vec2; hp:number; speed:number; slowUntil:number; radius:number; targetId:string|null; }
export interface Projectile { id:number; spell:SpellId; ownerId:string; pos:Vec2; vel:Vec2; damage:number; radius:number; ttl:number; fuse?:number; }
export type EffectKind = 'beam'|'chain'|'nova'|'blast'|'aura';
export interface TransientEffect { id:number; kind:EffectKind; ownerId?:string; a:Vec2; b?:Vec2; radius?:number; ttl:number; colorHint:string; }

export interface World {
  time:number; status:GameStatus;
  players:Player[]; enemies:Enemy[]; projectiles:Projectile[]; effects:TransientEffect[];
  nextEntityId:number; wave:number; score:number;
  spawnQueue:number; spawnTimer:number; spawnCadence:number; breakTimer:number;
}
export interface MoveCommand { kind:'move'; playerId:string; dir:Vec2; }
export interface FaceCommand { kind:'face'; playerId:string; angle:number; }
export interface CastCommand { kind:'cast'; playerId:string; spell:SpellId; }
export type Command = MoveCommand | FaceCommand | CastCommand;
```
(Keep `Vec2` re-export from `./vec`.)

- [ ] **Step 2: `config.ts`** — extend with all tuning. Concrete starting values (tune later):
```ts
export const CONFIG = {
  arenaWidth: 960, arenaHeight: 640,
  player: { speed: 200, maxHp: 100, radius: 14 },
  contactDps: 20,
  shield: { duration: 2.5 }, aegis: { duration: 3, radius: 160 },
  heal: { amount: 28, radius: 150, cooldown: 7 },
  revive: { radius: 70, time: 3, hp: 40 },        // ally channels over `time` s
  bleedout: { time: 8 },                           // downed -> dead if not revived
  fireball: { speed:420, radius:8, ttl:1.5, explosionRadius:60, explosionDamage:30 },
  firestorm:{ speed:300, radius:10, ttl:1.1, explosionRadius:120, explosionDamage:55 },
  frost:    { speed:360, radius:6, ttl:1.2, damage:18, slowDuration:2, spread:0.25, count:3 },
  frostnova:{ radius:150, damage:14, slowDuration:2.5 },
  thunder:  { range:500, width:28, damage:55 },
  chain:    { range:260, jumpRange:170, maxJumps:4, damage:34, falloff:0.75 },
  holybolt: { speed:460, radius:7, ttl:1.2, damage:26 },
  enemy: { baseSpeed:60, radius:12, baseHp:30, hpPerWave:5, speedPerWave:4 },
  wave: { baseCount:6, perWave:3, baseCadence:1.2, cadenceDecay:0.05, minCadence:0.4, breakTime:2, scaleExp:1.4 },
  effectTtl: { beam:0.12, chain:0.18, nova:0.3, blast:0.35, aura:0.4 },
} as const;
```

- [ ] **Step 3: `spells.ts`** — all 10 spells. `SpellDef = { id, displayName, aliases:string[], cooldown, kind:'projectile'|'aoe-self'|'hitscan'|'chain'|'buff-self'|'buff-allies'|'heal-allies', directional:boolean }`. Provide aliases (zh+en) per spec §6 table + firestorm(火海/inferno), frostnova(冰霜新星/nova/新星), chain(連鎖閃電/chain/閃電鏈), aegis(聖盾/barrier), holybolt(聖光/smite). Cooldowns: fireball 1.2, firestorm 4, frost 1.5, frostnova 5, thunder 2.5, chain 3, shield 6, aegis 9, heal 7, holybolt 1.0. Keep `JUMON='我命汝顯現'`.

- [ ] **Step 4: `classes.ts`**:
```ts
export interface ClassDef { id:ClassId; displayName:string; spells:SpellId[]; shape:'diamond'|'hexagon'|'triangle'|'circle'; color:string; hpMod:number; speedMod:number; }
export const CLASSES: Record<ClassId, ClassDef> = {
  pyro:   { id:'pyro',  displayName:'炎術士', spells:['fireball','firestorm','shield'], shape:'diamond',  color:'#ff8c1a', hpMod:1.0, speedMod:1.0 },
  cryo:   { id:'cryo',  displayName:'霜法師', spells:['frost','frostnova','shield'],    shape:'hexagon',  color:'#39c5e0', hpMod:1.0, speedMod:1.0 },
  storm:  { id:'storm', displayName:'雷術士', spells:['thunder','chain','shield'],       shape:'triangle', color:'#b06cff', hpMod:0.95,speedMod:1.08 },
  warden: { id:'warden',displayName:'守護者', spells:['heal','aegis','holybolt'],        shape:'circle',   color:'#ffd24d', hpMod:1.2, speedMod:0.95 },
};
export function classSpellSet(c:ClassId):Set<SpellId> { return new Set(CLASSES[c].spells); }
```

- [ ] **Step 5: Tests** — `classes.test.ts`: 4 classes; each has exactly 3 spells; all class spells exist in SPELLS; warden has heal+aegis+holybolt; shapes/colors distinct. `spells.test.ts`: 10 spells; every alias list ≥2; cooldowns>0; class loadouts ⊆ SPELLS keys. TDD (write tests, run red where applicable, implement, green).
- [ ] **Step 6: Commit** `feat(shared): 4-class system and 10-spell definitions`.

---

## Task A3: Matcher — restrict to a player's class loadout

**Files:** `shared/src/matcher.ts`, `shared/tests/matcher.test.ts`.

- [ ] **Step 1:** Extend `matchSpell(transcript, opts)` where `opts` adds `allowed?: Set<SpellId>`. After computing a candidate spell, **only return it if `!allowed || allowed.has(spell)`**; otherwise continue scanning so e.g. a warden saying "火球術" does not cast (returns the first *allowed* match or null). Keep existing mueisho/eisho/jumon/fuzzy behavior. TDD: warden loadout + "火球術" → null; warden + "治療術" → heal; pyro + "火球術" → fireball; no `allowed` given → legacy behavior.
- [ ] **Step 2: Commit** `feat(shared): matchSpell honors per-class allowed spells`.

---

## Task A4: Multiplayer `world.ts` — players array, movement, casting, projectiles

**Files:** rewrite `shared/src/world.ts`; `shared/tests/world.test.ts` (rewrite for multiplayer). This task is the core; TDD each behavior. Keep `step(world, commands, dt, rng=Math.random)` mutating+returning `world`.

**`createWorld(players)` contract:** accepts `Array<{id,name,classId}>`; builds `Player[]` with class hp (`maxHp = CONFIG.player.maxHp * classMod`), spawn positions spread near arena center, `alive:true, downed:false, connected:true`, cooldowns all 0; `status:'playing'`, empty enemies/projectiles/effects, wave 0. (A `createSoloWorld(classId='pyro')` helper wraps it with one player for LocalSession.)

**`step` order each tick:**
1. `time += dt`; if gameover, return.
2. Aggregate commands already done by caller (server) — but `step` accepts a flat `Command[]`; apply: move/face set on matching **alive & !downed** player; `cast` → `castSpell(world, player, spell)`.
3. `movePlayers` (alive & !downed only; clamp arena).
4. `updateWaves` (scaling by effective player count; see below).
5. `updateEnemies` (target nearest alive player; contact damage unless shielded; on player hp≤0 → enter downed).
6. `updateRevives` (auto proximity).
7. `updateProjectiles` (move, collide vs enemies, apply spell hit, spawn blast effects).
8. `decayEffects` (ttl-=dt, drop ≤0).
9. respawn handled in `updateWaves` at wave start.
10. gameover when no player has `alive===true` AND no `downed` player can still be revived (i.e., all players `!alive`).

**Cast gating:** `if (world.time < player.cooldowns[spell]) return; if (!classSpellSet(player.classId).has(spell)) return;` then set cooldown and apply effect. (Server already filters by class via matcher, but the sim re-validates — authoritative.)

- [ ] **Step 1 (tests+impl): createWorld** — N players, class hp applied, distinct spawn spots, all alive.
- [ ] **Step 2: movement & facing** — move command moves the right player; downed/dead players ignore move; clamp.
- [ ] **Step 3: cooldown + class gating** — wrong-class spell ignored; cooldown blocks repeat; cooldown set to time+def.cooldown.
- [ ] **Step 4: fireball + projectile update + no-friendly-fire** — projectile carries ownerId; damages enemies only (never players); AoE explosion spawns a `blast` effect; kills score. Place an ally in blast radius and assert ally unhurt.
- [ ] **Step 5: frost (fan + slow)**; **holybolt (single projectile dmg)** — reuse projectile path.
- [ ] **Step 6: Commit** `feat(shared): multiplayer world — players, movement, casting, projectiles, no friendly fire`.

(Use `w.breakTimer = 999` in tests that must isolate from wave auto-spawn, as established in the single-player suite.)

---

## Task A5: New spell behaviors — firestorm, frostnova, thunder, chain, shield, aegis, heal

**Files:** `shared/src/world.ts` (cast handlers + effect spawns), `shared/tests/world.test.ts`.

Algorithms (implement precisely):
- **thunder** (hitscan): existing ray logic; additionally push a `beam` effect from player to `player+dir*range`.
- **firestorm**: spawn projectile `spell:'firestorm'` with `fuse=ttl`; in `updateProjectiles`, firestorm explodes **on enemy contact OR when ttl≤0**; explosion = AoE `explosionDamage` within `explosionRadius`, spawn `blast` effect. (Generalize fireball's onHit; on ttl-expiry also explode at current pos.)
- **frostnova** (aoe-self): immediately damage + slow all enemies within `CONFIG.frostnova.radius` of the caster; spawn `nova` effect centered on caster.
- **chain**: starting point = caster pos; find nearest enemy within `CONFIG.chain.range`; hit it (`damage`), add to `visited`; then up to `maxJumps-1` more: from last hit enemy pos, find nearest **unvisited** enemy within `jumpRange`, hit with `damage*falloff^k`; stop when none. Spawn a `chain` effect per segment (a→b). Remove dead enemies, score.
- **shield** (buff-self): set caster `shieldUntil = time+CONFIG.shield.duration`; spawn `aura` effect on caster.
- **aegis** (buff-allies): for every **alive** player within `CONFIG.aegis.radius` of caster (incl self), set `shieldUntil = time+CONFIG.aegis.duration`; spawn `aura` effect (radius) on caster.
- **heal** (heal-allies): for every **alive** player within `CONFIG.heal.radius` (incl self), `hp = min(maxHp, hp+amount)`; spawn `aura` effect.

- [ ] **Step 1: firestorm** — test: ttl-expiry explodes (no enemy) and damages enemies in radius; contact also explodes.
- [ ] **Step 2: frostnova** — test: enemies in radius damaged + slowed; outside untouched; nova effect present.
- [ ] **Step 3: chain** — test: 3 enemies in a line within jumpRange → all hit with decreasing damage; an enemy beyond jumpRange not hit; maxJumps respected; visited prevents re-hit.
- [ ] **Step 4: shield/aegis/heal** — aegis shields alive allies in radius but NOT a downed ally and NOT an out-of-range ally; heal caps at maxHp and skips dead/downed; effects spawned.
- [ ] **Step 5: effects decay** — every cast pushes an effect; effects ttl decays and removes.
- [ ] **Step 6: Commit** `feat(shared): firestorm/frostnova/thunder/chain/shield/aegis/heal with transient effects`.

---

## Task A6: Downed / revive / bleedout / respawn / scaling / gameover

**Files:** `shared/src/world.ts`, `shared/tests/world.test.ts`.

- **Downed:** player hp≤0 (and alive) → `alive` stays true but `downed=true`, `hp=0`, `bleedoutAt=time+CONFIG.bleedout.time`, `reviveProgress=0`. Downed players: not moved, not targeted by enemies, deal no damage, can't cast.
- **Revive (auto):** for each downed player, if any **alive & !downed** ally within `CONFIG.revive.radius`, `reviveProgress += dt / CONFIG.revive.time` (×1.5 if a warden is the reviver). At ≥1 → `downed=false, hp=CONFIG.revive.hp`. If no ally near, progress decays toward 0.
- **Bleedout:** if `downed` and `time≥bleedoutAt` and not revived → `alive=false, downed=false, respawnAtWave=wave+1`.
- **Respawn:** in `beginWave`, any `!alive` player → `alive=true, downed=false, hp=maxHp`, repositioned.
- **Scaling:** `effectivePlayers = players.filter(p=>p.connected && (p.alive||p.downed)).length`; `playerScale = max(1, effectivePlayers)^CONFIG.wave.scaleExp`; wave count = `round((baseCount+(wave-1)*perWave) * playerScale)`. Enemies still target nearest **alive** player.
- **Gameover:** when `players.every(p=>!p.alive)` → `status='gameover'`.

- [ ] **Step 1: downed transition** — single player hp→0 becomes downed, not gameover yet.
- [ ] **Step 2: revive** — 2 players, one downed, ally in radius → revived to reviveHp; warden faster; ally out of range → bleeds out.
- [ ] **Step 3: bleedout → dead → respawn next wave** — downed with no rescuer past bleedout becomes !alive; next `beginWave` respawns at full hp.
- [ ] **Step 4: scaling** — wave enemy count grows super-linearly with player count (assert count for 1 vs 3 players using rng=()=>0; compare spawnQueue sizes).
- [ ] **Step 5: gameover** — all players !alive → status gameover; single-player path (1 player downed, no rescuer, bleedout) → eventually gameover.
- [ ] **Step 6: Commit** `feat(shared): downed/revive/bleedout/respawn, player-count scaling, gameover`.

**Verification gate A-core:** `npm run test -w @acm/shared` fully green (sim + spells + classes + matcher + recognizer-policy).

---

## Task A7: Client GameSession abstraction + LocalSession (keep single-player playable with classes)

**Files:** `client/src/session/GameSession.ts`, `client/src/session/LocalSession.ts`, refactor `client/src/render/GameScene.ts` to consume a `World` from a session, `client/src/main.ts`, `client/src/render/hud.ts`.

- **`GameSession` interface:** `start():void; sendMove(dir:Vec2):void; sendFace(angle:number):void; sendCast(spell:SpellId):void; getWorld():World; getSelfId():string; onWorld(cb:(w:World)=>void):void;`
- **LocalSession:** constructs `createSoloWorld(classId)`; on a fixed timer (or via Phaser update) collects local input each frame, builds commands for `selfId='local'`, calls `step` locally, exposes world. (Effectively the current single-player, now class-aware and on the new World.)
- **GameScene** becomes session-driven: it no longer owns `step`; it reads `session.getWorld()` each frame, renders players (per-class shape/color from CLASSES, name label, downed icon, revive ring), enemies, projectiles, and **effects** (beam/chain lines, nova/blast/aura circles with neon glow on dark bg). Local input → `session.sendMove/Face/Cast`.
- **Voice:** recognized text → `matchSpell(text,{mode,jumon,allowed:classSpellSet(selfClass)})` → `session.sendCast`.
- **main.ts:** for Phase A, pick a class (simple selector or default pyro) → LocalSession → GameScene. (Full lobby comes in Phase B.)

- [ ] **Step 1:** Implement GameSession + LocalSession; unit-test LocalSession command→world effect (e.g., sendCast fireball spawns a projectile) in `client/tests/session.test.ts` (node env, no Phaser).
- [ ] **Step 2:** Refactor GameScene to session-driven rendering incl. effects + per-class player rendering.
- [ ] **Step 3:** Verify `npm run build:client` clean; manual: single-player plays with a chosen class, all that class's spells castable (keyboard test hooks if voice unavailable — bind number keys 1/2/3 to the class spells for testing).
- [ ] **Step 4: Commit** `feat(client): session abstraction + LocalSession; class-aware single-player on multiplayer world`.

**Verification gate A (Phase A done):** shared tests green; client builds; single-player playable with classes + effects rendering; downed→bleedout→gameover reachable solo. **This is a shippable playable demo.**

---

# PHASE B

## Task B1: Server protocol + pure room logic

**Files:** `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/protocol.ts`, `server/src/snapshot.ts`, `server/src/rooms.ts`; tests `server/tests/rooms.test.ts`, `server/tests/snapshot.test.ts`.

- [ ] **Step 1: `server/package.json`**
```json
{
  "name": "@acm/server", "version": "0.2.0", "private": true, "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --outfile=dist/index.js",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": { "ws": "^8.17.0", "@acm/shared": "*" },
  "devDependencies": { "@types/ws":"^8.5.10", "@types/node":"^20.12.0", "typescript":"^5.4.0", "tsx":"^4.15.0", "esbuild":"^0.21.0", "vitest":"^1.6.0" }
}
```
- [ ] **Step 2: `protocol.ts`** — `ClientMsg` union (`create|join|quickJoin|ready|start|input|leave`) and `ServerMsg` union (`joined|lobby|started|snapshot|error|peerLeft`) exactly per spec §8. `input` = `{type:'input', seq:number, move?:Vec2, face?:number, casts?:SpellId[]}`.
- [ ] **Step 3: `snapshot.ts`** — `toSnapshot(world):Snapshot` pure: include players (id,name,classId,pos,facing,hp,maxHp,alive,downed,reviveProgress,shieldUntil), enemies (id,pos,hp,slowUntil,radius), projectiles (id,spell,pos), effects, wave, score, status, time. Test: round-trips key fields, omits server-only fields.
- [ ] **Step 4: `rooms.ts`** — `RoomRegistry` pure logic: `makeCode()` (4 chars from a no-ambiguous alphabet — inject rng for tests), `create`, `joinByCode` (errors: not-found, full(>4), already-started), `quickJoin` (pick first lobby room with space else create), `remove`. Tests cover code generation determinism (injected rng), full/started/not-found errors, quick-join picks open room then creates.
- [ ] **Step 5: Commit** `feat(server): protocol, snapshot serializer, room registry (pure, tested)`.

## Task B2: Room runtime + ws server wiring

**Files:** `server/src/room.ts`, `server/src/index.ts`; tests `server/tests/room.test.ts`.

- **`Room`** holds players (lobby entries: id,name,classId,ready,connected + a send fn), `world|null`, status. Methods: `addPlayer`, `setReady`, `setClass`, `start()` (→ `createWorld(players)`, status playing), `applyInput(playerId, msg)` (buffer latest move/face, append casts), `tick(dt)` (drain buffered inputs → `Command[]` → `step` → produce snapshot), `removePlayer` (mark connected=false; if world, mark player.connected=false — **no splice**), `isEmpty`. Inject a clock; `tick` is pure-ish (no ws). **Unit-test** lobby→start→input→tick→snapshot and that disconnect marks (not splices) and that mid-game join is rejected by the registry/room.
- **`index.ts`** (thin, manual-verified): `http.createServer` with `/healthz`→200; `WebSocketServer({server})`; bind `process.env.PORT||8787` on `0.0.0.0`; route ClientMsg→registry/room; one `setInterval(50ms)` ticks all playing rooms and broadcasts snapshots to each room's connected sockets; on socket close → room.removePlayer; reap empty rooms.
- [ ] Steps: write room.test.ts (red) → implement room.ts (green) → implement index.ts → `npm run build -w @acm/server` (esbuild bundles, emits dist/index.js) → Commit `feat(server): authoritative room runtime + ws wiring`.

## Task B3: Server integration smoke (node ws)

**Files:** `server/tests/integration.smoke.test.ts` (or a runnable script).
- [ ] Spin up the server on an ephemeral port; open two `ws` clients; client A `create` → receives `joined` with code; client B `join{code}`; A `start`; both receive `started` then `snapshot`s; A sends `input{casts:['fireball']}`; assert a subsequent snapshot shows a projectile (or effect). Tear down. Run: `npm run test -w @acm/server`. Commit `test(server): two-client ws integration smoke`.

## Task B4: Client NetClient + NetSession + interpolation

**Files:** `client/src/net/NetClient.ts`, `client/src/session/NetSession.ts`; test `client/tests/interp.test.ts` (pure interpolation buffer).
- **NetClient:** connect to `serverUrl` (`?server=` query > `import.meta.env.VITE_SERVER_URL` > `ws://localhost:8787`); send ClientMsg; on `snapshot` push into a buffer; expose lobby callbacks (`joined/lobby/started/error/peerLeft`).
- **Interpolation buffer (pure, tested):** keep last ~3 snapshots; `sample(renderTime)` returns interpolated entity states between the two snapshots straddling `renderTime = now - 100ms`; entities matched by id; missing-in-newer → drop; new → pop-in. Test pure `interpolate(prev,next,alpha)` and buffer sampling with synthetic snapshots/timestamps (inject clock).
- **NetSession:** implements GameSession over NetClient; `getWorld()` returns the interpolated world; `sendCast` → `input{casts:[spell]}` (batch per frame); `getSelfId()` from `joined`.
- [ ] Steps: TDD interpolation → implement NetClient/NetSession → Commit `feat(client): NetClient + NetSession with snapshot interpolation`.

## Task B5: Lobby UI + wire sessions

**Files:** `client/src/ui/Lobby.ts`, `client/src/main.ts`, `client/index.html`, `client/src/render/hud.ts`.
- **Lobby flow:** name input → class pick (4 cards: shape/color/loadout, dark-arcane styled) → buttons: 建立房間 / 輸入代碼加入 / 快速加入 / 單機(LocalSession). On create/join show room code + member list + ready/start. On `started` → hand the chosen `GameSession` (Net or Local) to GameScene.
- **HUD:** party panel (each player name/hp/downed), wave, team score, self spell hints (per class), mic status.
- [ ] Steps: implement Lobby + wire; `npm run build:client` clean; Commit `feat(client): lobby (name/class/room-code/quick-join/solo) + party HUD`.

## Task B6: Deploy config + docs

**Files:** `render.yaml`, `.github/workflows/deploy.yml` (update), root `README.md` (update), `client` reads server URL.
- [ ] **deploy.yml:** build job runs `npm ci`, `npm run test -w @acm/shared && npm run test -w @acm/server`, `npm run build:client`, upload `client/dist`.
- [ ] **render.yaml:**
```yaml
services:
  - type: web
    name: ai-chant-magic-server
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build -w @acm/server
    startCommand: node server/dist/index.js
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: 22
```
- [ ] **README:** how to `npm install && npm run dev` (two-tab localhost playtest), how to deploy server to Render (blueprint) and point the Pages client via `?server=wss://<render-url>`, browser/voice notes, class/spell list.
- [ ] Commit `ci+docs: client Pages build, Render blueprint, multiplayer README`.

## Task B7: Two-tab e2e verification (manual + automated where possible)
- [ ] Run `npm run dev`; open two tabs at the Vite URL; tab1 create room → code; tab2 join by code; pick pyro vs warden; start; verify: both move/aim; enemies scale; cast via keyboard test-keys (and voice in real Chrome); one goes down → other revives by standing close; bleedout→respawn next wave; team gameover→restart. Record results. Fix regressions via the relevant shared/server task (with a failing test first).

---

## Self-review checklist (plan author)
- Spec §15 authority reflected: no prediction ✓ (B4 interpolation only), single 50ms rate ✓ (B2 tick), effects channel ✓ (A2 types, A5 spawns, A7 render, B1 snapshot), no-splice disconnect ✓ (B2), lobby-only joins ✓ (B1/B2), heal/aegis alive-only ✓ (A5), auto revive no command ✓ (A6, Command has no revive), PORT/0.0.0.0/healthz ✓ (B2), two-tab on Vite dev ✓ (B7), deploy.yml builds client ✓ (B6).
- Phasing: Phase A ends shippable/playable (A7 gate) independent of B ✓.
- Balance: warden self-sustain (heal self + holybolt real dmg) ✓ (A2 config/classes), scaleExp 1.4 ✓, chain concrete ✓ (A5), firestorm fuse ✓ (A5).
- Type consistency: SpellId/ClassId/World/Player/Command/Snapshot/GameSession/CLASSES/CONFIG names used consistently across tasks.
- Restructure safety: A1 is pure move (tests green) before any World rewrite (A4) ✓.
