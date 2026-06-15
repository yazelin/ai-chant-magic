# 真。AI。咏唱魔法 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-player, top-down, browser wave-survival game where the player moves with WSAD/arrows, aims with the mouse, and casts spells by speaking their names into the microphone — runnable locally and deployable to GitHub Pages with zero backend.

**Architecture:** Strict one-way data flow `Input → Command → Simulation → Render`. The Simulation layer is pure TypeScript (no Phaser, no DOM) so it is fully unit-testable and so a network layer can later be inserted between Command and Simulation without touching simulation or rendering. Rendering is Phaser 3; voice is the Web Speech API behind a swappable `VoiceInput` interface.

**Tech Stack:** TypeScript, Phaser 3, Vite, Vitest, Web Speech API. Deploy via GitHub Actions → GitHub Pages.

**Reference spec:** `docs/superpowers/specs/2026-06-15-ai-chant-magic-design.md`

---

## File Structure

```
ai-chant-magic/
├─ index.html                  # Vite entry, mounts game + mode toggle UI
├─ package.json
├─ tsconfig.json
├─ vite.config.ts              # base: './' for Pages subpath
├─ vitest.config.ts            # node environment
├─ LICENSE                     # MIT (林亞澤)
├─ README.md
├─ .gitignore
├─ .github/workflows/deploy.yml
└─ src/
   ├─ main.ts                  # assemble layers, mount Phaser
   ├─ sim/
   │  ├─ vec.ts                # Vec2 + pure vector math
   │  ├─ types.ts              # World/Player/Enemy/Projectile/Command types
   │  ├─ config.ts             # CONFIG tuning constants
   │  ├─ spells.ts             # SpellDef, SPELLS, JUMON
   │  └─ world.ts              # createWorld + step (the simulation)
   ├─ voice/
   │  ├─ matcher.ts            # normalize, levenshtein, matchSpell (pure)
   │  └─ recognizer.ts         # VoiceInput interface + WebSpeechVoiceInput
   ├─ input/
   │  └─ controls.ts           # keys/mouse → move dir + facing (pure helpers)
   └─ render/
      ├─ GameScene.ts          # Phaser scene: owns world, runs step, draws
      └─ hud.ts                # DOM HUD: hp/wave/score/spell list/mic status
└─ tests/
   ├─ sim/vec.test.ts
   ├─ sim/spells.test.ts
   ├─ sim/world.test.ts
   ├─ voice/matcher.test.ts
   └─ input/controls.test.ts
```

**Layer responsibilities:**
- `sim/*` — pure game logic. Imports nothing from `render/`, `voice/recognizer`, Phaser, or DOM. Fully tested.
- `voice/matcher.ts` — pure text → SpellId. Fully tested.
- `voice/recognizer.ts` — Web Speech API wrapper behind an interface. Manual verification (needs browser).
- `input/controls.ts` — pure input math. Tested.
- `render/*` + `main.ts` — Phaser glue. Manual verification.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`, `LICENSE`, `src/main.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ai-chant-magic",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "phaser": "^3.80.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

// base: './' makes built asset paths relative, which works both locally
// and under the GitHub Pages project subpath (/ai-chant-magic/).
export default defineConfig({
  base: './',
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>真。AI。咏唱魔法</title>
    <style>
      body { margin: 0; background: #0b0b14; color: #e8e8f0; font-family: system-ui, sans-serif; }
      #app { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px; }
      #game { line-height: 0; }
      .row { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; justify-content: center; }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="row">
        <strong>真。AI。咏唱魔法</strong>
        <label>詠唱模式:
          <select id="mode">
            <option value="mueisho">無詠唱(直接喊法術名)</option>
            <option value="eisho">詠唱(先念呪文)</option>
          </select>
        </label>
        <span id="mic-status">麥克風:未啟動</span>
      </div>
      <div id="hud" class="row"></div>
      <div id="game"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create placeholder `src/main.ts`**

```ts
// Assembled in Task 19. Placeholder so the dev server boots.
console.log('真。AI。咏唱魔法 booting…');
```

- [ ] **Step 7: Create `.gitignore`**

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 8: Create `LICENSE` (MIT, 林亞澤)**

```
MIT License

Copyright (c) 2026 林亞澤 (Yaze Lin)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 9: Install and verify toolchain**

Run: `npm install`
Then: `npm run test`
Expected: Vitest runs and reports "No test files found" (exit 0) — toolchain works.
Then: `npm run dev` (Ctrl-C after it prints the local URL)
Expected: Vite prints `Local: http://localhost:5173/` with no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + TS + Phaser + Vitest project"
```

---

## Task 2: Vector math (`sim/vec.ts`)

**Files:**
- Create: `src/sim/vec.ts`
- Test: `tests/sim/vec.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sim/vec.test.ts
import { describe, it, expect } from 'vitest';
import { sub, scale, len, dist, normalize } from '../../src/sim/vec';

describe('vec', () => {
  it('sub subtracts components', () => {
    expect(sub({ x: 5, y: 7 }, { x: 2, y: 3 })).toEqual({ x: 3, y: 4 });
  });
  it('scale multiplies', () => {
    expect(scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
  });
  it('len computes magnitude', () => {
    expect(len({ x: 3, y: 4 })).toBe(5);
  });
  it('dist computes distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
  it('normalize returns unit vector', () => {
    const n = normalize({ x: 0, y: 10 });
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(1);
  });
  it('normalize of zero vector returns zero', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/vec.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/vec`.

- [ ] **Step 3: Implement `src/sim/vec.ts`**

```ts
export interface Vec2 {
  x: number;
  y: number;
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(v: Vec2): Vec2 {
  const l = len(v);
  if (l === 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/vec.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/vec.ts tests/sim/vec.test.ts
git commit -m "feat(sim): vector math helpers"
```

---

## Task 3: Core types & config (`sim/types.ts`, `sim/config.ts`)

**Files:**
- Create: `src/sim/types.ts`, `src/sim/config.ts`

These are type/constant declarations; no behavior to test. They are imported by later tested tasks, which will fail if a name is wrong.

- [ ] **Step 1: Create `src/sim/types.ts`**

```ts
import { Vec2 } from './vec';

export type SpellId = 'fireball' | 'frost' | 'thunder' | 'shield' | 'heal';

export type GameStatus = 'playing' | 'gameover';

export interface Player {
  pos: Vec2;
  facing: number;               // radians
  hp: number;
  maxHp: number;
  shieldUntil: number;          // world time (s) shield is active until; 0 = none
  cooldowns: Record<SpellId, number>; // world time (s) each spell becomes ready again
}

export interface Enemy {
  id: number;
  pos: Vec2;
  hp: number;
  speed: number;                // px/s
  slowUntil: number;            // world time (s) the enemy is slowed until
  radius: number;
}

export interface Projectile {
  id: number;
  spell: SpellId;               // 'fireball' | 'frost'
  pos: Vec2;
  vel: Vec2;                    // px/s
  damage: number;
  radius: number;
  ttl: number;                  // seconds remaining
}

export interface World {
  time: number;                 // seconds elapsed
  status: GameStatus;
  player: Player;
  enemies: Enemy[];
  projectiles: Projectile[];
  nextEntityId: number;
  wave: number;                 // 0 before first wave starts
  score: number;                // total kills
  spawnQueue: number;           // enemies remaining to spawn this wave
  spawnTimer: number;           // seconds until next spawn
  spawnCadence: number;         // seconds between spawns this wave
  breakTimer: number;           // seconds remaining in between-wave break
}

export interface MoveCommand { kind: 'move'; dir: Vec2; }   // dir is unit length or {0,0}
export interface FaceCommand { kind: 'face'; angle: number; }
export interface CastCommand { kind: 'cast'; spell: SpellId; }
export type Command = MoveCommand | FaceCommand | CastCommand;
```

- [ ] **Step 2: Create `src/sim/config.ts`**

```ts
export const CONFIG = {
  arenaWidth: 960,
  arenaHeight: 640,
  player: { speed: 200, maxHp: 100, radius: 14 },
  shield: { duration: 2.5 },
  heal: { amount: 30 },
  contactDps: 20,               // damage/sec while an enemy touches the player
  fireball: { speed: 420, damage: 30, radius: 8, ttl: 1.5, explosionRadius: 60, explosionDamage: 30 },
  frost: { speed: 360, damage: 18, radius: 6, ttl: 1.2, slowDuration: 2, spread: 0.25, count: 3 },
  thunder: { range: 500, width: 28, damage: 55 },
  enemy: { baseSpeed: 60, radius: 12, baseHp: 30, hpPerWave: 5, speedPerWave: 4 },
  wave: { baseCount: 6, perWave: 3, baseCadence: 1.2, cadenceDecay: 0.05, minCadence: 0.4, breakTime: 2 },
} as const;
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/sim/types.ts src/sim/config.ts
git commit -m "feat(sim): core types and tuning config"
```

---

## Task 4: Spell definitions (`sim/spells.ts`)

**Files:**
- Create: `src/sim/spells.ts`
- Test: `tests/sim/spells.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sim/spells.test.ts
import { describe, it, expect } from 'vitest';
import { SPELLS, JUMON } from '../../src/sim/spells';

describe('spells', () => {
  it('defines exactly the five MVP spells', () => {
    expect(Object.keys(SPELLS).sort()).toEqual(
      ['fireball', 'frost', 'heal', 'shield', 'thunder'].sort()
    );
  });
  it('every spell has at least one chinese and one english alias', () => {
    for (const def of Object.values(SPELLS)) {
      expect(def.aliases.length).toBeGreaterThanOrEqual(2);
      expect(def.cooldown).toBeGreaterThan(0);
      expect(def.displayName.length).toBeGreaterThan(0);
    }
  });
  it('marks directional vs self-target correctly', () => {
    expect(SPELLS.fireball.directional).toBe(true);
    expect(SPELLS.frost.directional).toBe(true);
    expect(SPELLS.thunder.directional).toBe(true);
    expect(SPELLS.shield.directional).toBe(false);
    expect(SPELLS.heal.directional).toBe(false);
  });
  it('exposes a non-empty default jumon', () => {
    expect(JUMON.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/spells.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/spells`.

- [ ] **Step 3: Implement `src/sim/spells.ts`**

```ts
import { SpellId } from './types';

export interface SpellDef {
  id: SpellId;
  displayName: string;      // shown in HUD (中文)
  aliases: string[];        // raw match terms (中文 + 英文); normalized at match time
  cooldown: number;         // seconds
  directional: boolean;     // true = fired along facing; false = self-target
}

export const SPELLS: Record<SpellId, SpellDef> = {
  fireball: { id: 'fireball', displayName: '火球術', aliases: ['火球術', '火球', 'fireball', 'fire'], cooldown: 1.2, directional: true },
  frost:    { id: 'frost',    displayName: '冰霜',   aliases: ['冰錐', '冰霜', '冰', 'frost', 'ice'], cooldown: 1.5, directional: true },
  thunder:  { id: 'thunder',  displayName: '雷擊',   aliases: ['雷擊', '閃電', '雷', 'thunder', 'lightning'], cooldown: 2.5, directional: true },
  shield:   { id: 'shield',   displayName: '護盾',   aliases: ['護盾', '結界', 'shield', 'guard'], cooldown: 6, directional: false },
  heal:     { id: 'heal',     displayName: '治療術', aliases: ['治療術', '治療', '治癒', '補血', 'heal', 'cure'], cooldown: 8, directional: false },
};

// Default incantation (呪文) required before a spell name in 詠唱(eishō) mode.
export const JUMON = '我命汝顯現';
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/spells.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/spells.ts tests/sim/spells.test.ts
git commit -m "feat(sim): spell definitions and default jumon"
```

---

## Task 5: Voice matcher — normalize & levenshtein (`voice/matcher.ts`)

**Files:**
- Create: `src/voice/matcher.ts`
- Test: `tests/voice/matcher.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/voice/matcher.test.ts
import { describe, it, expect } from 'vitest';
import { normalize, levenshtein } from '../../src/voice/matcher';

describe('normalize', () => {
  it('lowercases and strips spaces and punctuation', () => {
    expect(normalize('  Fire Ball! ')).toBe('fireball');
  });
  it('strips chinese/japanese punctuation but keeps han chars', () => {
    expect(normalize('火球，術。')).toBe('火球術');
  });
  it('converts fullwidth latin to halfwidth', () => {
    expect(normalize('ＦＩＲＥ')).toBe('fire');
  });
});

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('fire', 'fire')).toBe(0);
  });
  it('counts single substitutions', () => {
    expect(levenshtein('火球術', '火球树')).toBe(1);
  });
  it('counts insert/delete', () => {
    expect(levenshtein('fire', 'fires')).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/voice/matcher.test.ts`
Expected: FAIL — cannot resolve `../../src/voice/matcher`.

- [ ] **Step 3: Implement normalize + levenshtein in `src/voice/matcher.ts`**

```ts
// Normalize transcript and aliases to a comparable form:
// fullwidth→halfwidth, lowercase, strip everything except letters/digits/CJK.
export function normalize(text: string): string {
  const halfWidth = text.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  return halfWidth
    .toLowerCase()
    .replace(/[^0-9a-z一-鿿]/g, '');
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/voice/matcher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/matcher.ts tests/voice/matcher.test.ts
git commit -m "feat(voice): normalize and levenshtein helpers"
```

---

## Task 6: Voice matcher — matchSpell (`voice/matcher.ts`)

**Files:**
- Modify: `src/voice/matcher.ts`
- Modify: `tests/voice/matcher.test.ts`

Matching rules:
- `mueisho` mode: the spell is cast if any alias appears in the transcript (substring match after normalize), OR a length-`L` window of the transcript is within Levenshtein distance 1 of an alias whose length `L >= 3` (fuzzy tolerance for homophones / minor mis-hearing).
- `eisho` mode: the normalized jumon (within distance 1) must appear; matching for the spell name is then done only on the portion of the transcript **after** the jumon occurrence.
- When multiple spells could match, the first by `SPELLS` declaration order (fireball, frost, thunder, shield, heal) wins.
- Returns `SpellId | null`.

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/voice/matcher.test.ts
import { matchSpell } from '../../src/voice/matcher';

describe('matchSpell — mueisho mode', () => {
  const opts = { mode: 'mueisho' as const, jumon: '我命汝顯現' };

  it('matches a chinese alias embedded in chatter', () => {
    expect(matchSpell('快放火球術啊', opts)).toBe('fireball');
  });
  it('matches an english alias', () => {
    expect(matchSpell('cast fireball now', opts)).toBe('fireball');
  });
  it('fuzzy-matches a one-char homophone error', () => {
    expect(matchSpell('火球树', opts)).toBe('fireball'); // 術→树
  });
  it('matches heal aliases', () => {
    expect(matchSpell('補血', opts)).toBe('heal');
    expect(matchSpell('please heal', opts)).toBe('heal');
  });
  it('returns null when no spell is present', () => {
    expect(matchSpell('今天天氣真好', opts)).toBeNull();
  });
});

describe('matchSpell — eisho mode', () => {
  const opts = { mode: 'eisho' as const, jumon: '我命汝顯現' };

  it('requires the jumon before the spell name', () => {
    expect(matchSpell('我命汝顯現火球術', opts)).toBe('fireball');
  });
  it('rejects a bare spell name without the jumon', () => {
    expect(matchSpell('火球術', opts)).toBeNull();
  });
  it('ignores a spell name that appears before the jumon', () => {
    // "火球術" before jumon must not trigger; only text after jumon counts
    expect(matchSpell('火球術 我命汝顯現 冰霜', opts)).toBe('frost');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/voice/matcher.test.ts`
Expected: FAIL — `matchSpell` is not exported.

- [ ] **Step 3: Implement matchSpell — append to `src/voice/matcher.ts`**

```ts
import { SpellId } from '../sim/types';
import { SPELLS } from '../sim/spells';

export type CastMode = 'mueisho' | 'eisho';

export interface MatchOptions {
  mode: CastMode;
  jumon: string;
}

// True if `needle` occurs in `hay` as a substring, or a same-length window of
// `hay` is within Levenshtein distance 1 of `needle` (only for needle length >= 3).
function containsFuzzy(hay: string, needle: string): boolean {
  if (needle.length === 0) return false;
  if (hay.includes(needle)) return true;
  if (needle.length < 3) return false;
  const L = needle.length;
  for (let i = 0; i + L <= hay.length; i++) {
    if (levenshtein(hay.slice(i, i + L), needle) <= 1) return true;
  }
  return false;
}

// Returns the index just past the end of a fuzzy jumon occurrence, or -1.
function jumonEndIndex(hay: string, jumon: string): number {
  const j = normalize(jumon);
  if (j.length === 0) return -1;
  const direct = hay.indexOf(j);
  if (direct >= 0) return direct + j.length;
  if (j.length < 3) return -1;
  for (let i = 0; i + j.length <= hay.length; i++) {
    if (levenshtein(hay.slice(i, i + j.length), j) <= 1) return i + j.length;
  }
  return -1;
}

export function matchSpell(transcript: string, opts: MatchOptions): SpellId | null {
  let hay = normalize(transcript);

  if (opts.mode === 'eisho') {
    const end = jumonEndIndex(hay, opts.jumon);
    if (end < 0) return null;
    hay = hay.slice(end); // only match the spell name after the jumon
  }

  for (const def of Object.values(SPELLS)) {
    for (const alias of def.aliases) {
      if (containsFuzzy(hay, normalize(alias))) return def.id;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/voice/matcher.test.ts`
Expected: PASS (all matcher tests).

- [ ] **Step 5: Commit**

```bash
git add src/voice/matcher.ts tests/voice/matcher.test.ts
git commit -m "feat(voice): matchSpell with mueisho/eisho modes and fuzzy jumon"
```

---

## Task 7: World factory (`sim/world.ts`)

**Files:**
- Create: `src/sim/world.ts`
- Test: `tests/sim/world.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/sim/world.test.ts
import { describe, it, expect } from 'vitest';
import { createWorld } from '../../src/sim/world';
import { CONFIG } from '../../src/sim/config';

describe('createWorld', () => {
  it('starts the player centered at full hp, playing', () => {
    const w = createWorld();
    expect(w.status).toBe('playing');
    expect(w.player.hp).toBe(CONFIG.player.maxHp);
    expect(w.player.pos).toEqual({ x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 });
    expect(w.enemies).toEqual([]);
    expect(w.projectiles).toEqual([]);
    expect(w.wave).toBe(0);
    expect(w.score).toBe(0);
  });
  it('starts every spell off cooldown', () => {
    const w = createWorld();
    for (const cd of Object.values(w.player.cooldowns)) expect(cd).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — cannot resolve `../../src/sim/world`.

- [ ] **Step 3: Implement `createWorld` in `src/sim/world.ts`**

```ts
import { World } from './types';
import { CONFIG } from './config';

export function createWorld(): World {
  return {
    time: 0,
    status: 'playing',
    player: {
      pos: { x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 },
      facing: 0,
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      shieldUntil: 0,
      cooldowns: { fireball: 0, frost: 0, thunder: 0, shield: 0, heal: 0 },
    },
    enemies: [],
    projectiles: [],
    nextEntityId: 1,
    wave: 0,
    score: 0,
    spawnQueue: 0,
    spawnTimer: 0,
    spawnCadence: CONFIG.wave.baseCadence,
    breakTimer: 0,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/world.test.ts
git commit -m "feat(sim): createWorld factory"
```

---

## Task 8: step — player movement & facing

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `tests/sim/world.test.ts`

`step(world, commands, dt, rng = Math.random)` mutates and returns `world`. This task adds command handling for `move`/`face` and player movement clamped to the arena. Wave/enemy/projectile logic is stubbed as no-ops for now and filled in later tasks.

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/sim/world.test.ts
import { step } from '../../src/sim/world';

describe('step — movement', () => {
  it('moves the player by speed * dt along the move dir', () => {
    const w = createWorld();
    const startX = w.player.pos.x;
    step(w, [{ kind: 'move', dir: { x: 1, y: 0 } }], 0.5);
    expect(w.player.pos.x).toBeCloseTo(startX + CONFIG.player.speed * 0.5);
  });
  it('sets facing from a face command', () => {
    const w = createWorld();
    step(w, [{ kind: 'face', angle: 1.23 }], 0.016);
    expect(w.player.facing).toBeCloseTo(1.23);
  });
  it('clamps the player inside the arena', () => {
    const w = createWorld();
    for (let i = 0; i < 200; i++) step(w, [{ kind: 'move', dir: { x: -1, y: 0 } }], 0.1);
    expect(w.player.pos.x).toBeGreaterThanOrEqual(CONFIG.player.radius);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — `step` is not exported.

- [ ] **Step 3: Implement `step` + `movePlayer` in `src/sim/world.ts`**

Add these imports at the top of the file (merge with the existing import line):

```ts
import { World, Command, Vec2 } from './types';
```

Then append:

```ts
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function movePlayer(world: World, dir: Vec2, dt: number): void {
  const p = world.player;
  p.pos.x += dir.x * CONFIG.player.speed * dt;
  p.pos.y += dir.y * CONFIG.player.speed * dt;
  const r = CONFIG.player.radius;
  p.pos.x = clamp(p.pos.x, r, CONFIG.arenaWidth - r);
  p.pos.y = clamp(p.pos.y, r, CONFIG.arenaHeight - r);
}

export function step(
  world: World,
  commands: Command[],
  dt: number,
  _rng: () => number = Math.random
): World {
  if (world.status === 'gameover') return world;
  world.time += dt;

  let moveDir: Vec2 = { x: 0, y: 0 };
  for (const cmd of commands) {
    if (cmd.kind === 'move') moveDir = cmd.dir;
    else if (cmd.kind === 'face') world.player.facing = cmd.angle;
    // 'cast' handled in Task 9
  }

  movePlayer(world, moveDir, dt);
  // waves (Task 12), enemies (Task 11), projectiles (Task 10) added later.

  if (world.player.hp <= 0) {
    world.player.hp = 0;
    world.status = 'gameover';
  }
  return world;
}
```

Note: `Vec2` is re-exported from `./types`? It is imported there from `./vec`. Add `export { Vec2 } from './vec';` to `src/sim/types.ts` so this import resolves. Do that now if not already present.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: PASS (movement tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts src/sim/types.ts tests/sim/world.test.ts
git commit -m "feat(sim): step handles movement, facing, arena clamp"
```

---

## Task 9: step — casting (cooldown, shield, heal)

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `tests/sim/world.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/sim/world.test.ts
import { SPELLS } from '../../src/sim/spells';

describe('step — casting self-target spells', () => {
  it('heal restores hp but not above max', () => {
    const w = createWorld();
    w.player.hp = 50;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    expect(w.player.hp).toBe(50 + CONFIG.heal.amount);
    w.player.hp = w.player.maxHp - 5;
    w.player.cooldowns.heal = 0; // force ready
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    expect(w.player.hp).toBe(w.player.maxHp);
  });
  it('shield sets shieldUntil into the future', () => {
    const w = createWorld();
    step(w, [{ kind: 'cast', spell: 'shield' }], 0.016);
    expect(w.player.shieldUntil).toBeGreaterThan(w.time);
  });
  it('respects cooldown — a second immediate cast does nothing', () => {
    const w = createWorld();
    w.player.hp = 10;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016);
    const afterFirst = w.player.hp;
    step(w, [{ kind: 'cast', spell: 'heal' }], 0.016); // still on cooldown
    expect(w.player.hp).toBe(afterFirst);
  });
  it('sets the cooldown to now + spell cooldown', () => {
    const w = createWorld();
    step(w, [{ kind: 'cast', spell: 'shield' }], 0.016);
    expect(w.player.cooldowns.shield).toBeCloseTo(w.time + SPELLS.shield.cooldown);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — heal/shield have no effect (cast not handled).

- [ ] **Step 3: Implement casting — modify `src/sim/world.ts`**

Add import:

```ts
import { SPELLS } from './spells';
import { SpellId } from './types';
```

Add `castSpell` and wire it into the command loop (replace the `// 'cast' handled in Task 9` comment):

```ts
    else if (cmd.kind === 'cast') castSpell(world, cmd.spell);
```

Append the function (directional spells are stubbed here; filled in Task 10/11):

```ts
function castSpell(world: World, spell: SpellId): void {
  const p = world.player;
  if (world.time < p.cooldowns[spell]) return; // on cooldown
  p.cooldowns[spell] = world.time + SPELLS[spell].cooldown;

  switch (spell) {
    case 'shield':
      p.shieldUntil = world.time + CONFIG.shield.duration;
      break;
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + CONFIG.heal.amount);
      break;
    case 'fireball':
    case 'frost':
    case 'thunder':
      // directional effects added in Task 10/11
      break;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: PASS (casting tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/world.test.ts
git commit -m "feat(sim): casting with cooldown gating, shield and heal"
```

---

## Task 10: step — directional projectiles & projectile update

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `tests/sim/world.test.ts`

Adds fireball (single projectile, AoE explosion on hit) and frost (a 3-projectile fan, single-target damage + slow on hit), plus projectile movement, collision, enemy death, and scoring. To test collisions deterministically we place an enemy directly in the path.

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/sim/world.test.ts
import { Enemy } from '../../src/sim/types';

function makeEnemy(over: Partial<Enemy> = {}): Enemy {
  return { id: 999, pos: { x: 0, y: 0 }, hp: 30, speed: 0, slowUntil: 0, radius: CONFIG.enemy.radius, ...over };
}

describe('step — fireball', () => {
  it('spawns a projectile travelling along facing', () => {
    const w = createWorld();
    w.player.facing = 0; // +x
    step(w, [{ kind: 'cast', spell: 'fireball' }], 0.016);
    expect(w.projectiles.length).toBe(1);
    expect(w.projectiles[0].vel.x).toBeGreaterThan(0);
  });
  it('damages an enemy in its path and scores the kill', () => {
    const w = createWorld();
    w.breakTimer = 999; // breakTimer suppresses wave auto-spawn (added in Task 12) so the assertion only sees the planted enemy.
    w.player.facing = 0;
    // place a weak enemy just to the right of the player
    w.enemies.push(makeEnemy({ hp: 10, pos: { x: w.player.pos.x + 30, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'fireball' }], 0.016);
    for (let i = 0; i < 30; i++) step(w, [], 0.016); // let it travel/explode
    expect(w.enemies.length).toBe(0);
    expect(w.score).toBe(1);
  });
});

describe('step — frost', () => {
  it('spawns a fan of projectiles and slows what it hits', () => {
    const w = createWorld();
    w.player.facing = 0;
    w.enemies.push(makeEnemy({ hp: 100, pos: { x: w.player.pos.x + 30, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'frost' }], 0.016);
    expect(w.projectiles.length).toBe(CONFIG.frost.count);
    for (let i = 0; i < 20; i++) step(w, [], 0.016);
    expect(w.enemies[0].slowUntil).toBeGreaterThan(w.time);
    expect(w.enemies[0].hp).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — no projectiles spawned for fireball/frost.

- [ ] **Step 3: Implement directional casts + projectile update — modify `src/sim/world.ts`**

Add imports:

```ts
import { Projectile, Enemy } from './types';
import { dist } from './vec';
```

Replace the directional `case` block in `castSpell` with:

```ts
    case 'fireball': {
      const dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      spawnProjectile(world, 'fireball', dir, CONFIG.fireball.speed, CONFIG.fireball.damage, CONFIG.fireball.radius, CONFIG.fireball.ttl);
      break;
    }
    case 'frost': {
      for (let i = 0; i < CONFIG.frost.count; i++) {
        const offset = (i - (CONFIG.frost.count - 1) / 2) * CONFIG.frost.spread;
        const a = p.facing + offset;
        const dir = { x: Math.cos(a), y: Math.sin(a) };
        spawnProjectile(world, 'frost', dir, CONFIG.frost.speed, CONFIG.frost.damage, CONFIG.frost.radius, CONFIG.frost.ttl);
      }
      break;
    }
    case 'thunder':
      // hitscan added in Task 11
      break;
```

Append helpers:

```ts
function spawnProjectile(world: World, spell: SpellId, dir: Vec2, speed: number, damage: number, radius: number, ttl: number): void {
  world.projectiles.push({
    id: world.nextEntityId++,
    spell,
    pos: { x: world.player.pos.x, y: world.player.pos.y },
    vel: { x: dir.x * speed, y: dir.y * speed },
    damage, radius, ttl,
  });
}

function inBounds(p: Vec2): boolean {
  return p.x >= 0 && p.x <= CONFIG.arenaWidth && p.y >= 0 && p.y <= CONFIG.arenaHeight;
}

function onProjectileHit(world: World, proj: Projectile, hit: Enemy): void {
  if (proj.spell === 'fireball') {
    for (const e of world.enemies) {
      if (dist(proj.pos, e.pos) <= CONFIG.fireball.explosionRadius + e.radius) {
        e.hp -= CONFIG.fireball.explosionDamage;
      }
    }
  } else {
    // frost
    hit.hp -= proj.damage;
    hit.slowUntil = world.time + CONFIG.frost.slowDuration;
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
  for (const proj of world.projectiles) {
    if (proj.ttl <= 0) continue;
    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      if (dist(proj.pos, e.pos) <= proj.radius + e.radius) {
        onProjectileHit(world, proj, e);
        proj.ttl = 0; // consumed
        break;
      }
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.ttl > 0 && inBounds(p.pos));
  removeDeadEnemies(world);
}
```

Wire `updateProjectiles` into `step` (replace the `// projectiles ... added later` comment) so it runs after the command loop:

```ts
  updateProjectiles(world, dt);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: PASS (fireball + frost tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/world.test.ts
git commit -m "feat(sim): fireball AoE, frost fan, projectile update and scoring"
```

---

## Task 11: step — thunder hitscan & enemy movement/contact

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `tests/sim/world.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/sim/world.test.ts
describe('step — thunder', () => {
  it('instantly damages enemies along the facing ray', () => {
    const w = createWorld();
    w.breakTimer = 999; // breakTimer suppresses wave auto-spawn (added in Task 12) so the assertion only sees the planted enemy.
    w.player.facing = 0; // +x
    w.enemies.push(makeEnemy({ hp: 40, pos: { x: w.player.pos.x + 200, y: w.player.pos.y } }));
    step(w, [{ kind: 'cast', spell: 'thunder' }], 0.016);
    expect(w.enemies[0]?.hp ?? 0).toBeLessThanOrEqual(0 + (40 - CONFIG.thunder.damage > 0 ? 40 : 0));
  });
  it('misses enemies far off the ray', () => {
    const w = createWorld();
    w.player.facing = 0;
    w.enemies.push(makeEnemy({ hp: 40, pos: { x: w.player.pos.x + 200, y: w.player.pos.y + 300 } }));
    step(w, [{ kind: 'cast', spell: 'thunder' }], 0.016);
    expect(w.enemies[0].hp).toBe(40);
  });
});

describe('step — enemies', () => {
  it('moves an enemy toward the player', () => {
    const w = createWorld();
    const e = makeEnemy({ hp: 100, speed: 60, pos: { x: w.player.pos.x + 200, y: w.player.pos.y } });
    w.enemies.push(e);
    const before = e.pos.x;
    step(w, [], 0.5);
    expect(e.pos.x).toBeLessThan(before); // moved left toward centered player
  });
  it('damages the player on contact unless shielded', () => {
    const w = createWorld();
    w.enemies.push(makeEnemy({ hp: 100, speed: 0, pos: { ...w.player.pos } }));
    step(w, [], 0.5);
    expect(w.player.hp).toBeLessThan(w.player.maxHp);
  });
  it('shield blocks contact damage', () => {
    const w = createWorld();
    w.player.shieldUntil = w.time + 10;
    w.enemies.push(makeEnemy({ hp: 100, speed: 0, pos: { ...w.player.pos } }));
    const hp = w.player.hp;
    step(w, [], 0.5);
    expect(w.player.hp).toBe(hp);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — thunder does no damage; enemies don't move.

- [ ] **Step 3: Implement thunder + enemy update — modify `src/sim/world.ts`**

Add imports:

```ts
import { sub, len, scale } from './vec';
```

Replace the thunder `case` body in `castSpell` with:

```ts
    case 'thunder': {
      const dir = { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      castThunder(world, dir);
      break;
    }
```

Append:

```ts
function castThunder(world: World, dir: Vec2): void {
  const o = world.player.pos;
  for (const e of world.enemies) {
    const rel = sub(e.pos, o);
    const along = rel.x * dir.x + rel.y * dir.y;       // distance along the ray
    if (along < 0 || along > CONFIG.thunder.range) continue;
    const perp = Math.abs(rel.x * -dir.y + rel.y * dir.x); // perpendicular offset
    if (perp <= CONFIG.thunder.width + e.radius) e.hp -= CONFIG.thunder.damage;
  }
  removeDeadEnemies(world);
}

function updateEnemies(world: World, dt: number): void {
  const p = world.player;
  for (const e of world.enemies) {
    const toP = sub(p.pos, e.pos);
    const d = len(toP);
    const speed = world.time < e.slowUntil ? e.speed * 0.5 : e.speed;
    if (d > 1) {
      const move = scale(toP, (speed * dt) / d);
      e.pos.x += move.x;
      e.pos.y += move.y;
    }
    if (d <= e.radius + CONFIG.player.radius && world.time >= p.shieldUntil) {
      p.hp -= CONFIG.contactDps * dt;
    }
  }
}
```

Wire `updateEnemies` into `step` immediately before `updateProjectiles`:

```ts
  updateEnemies(world, dt);
  updateProjectiles(world, dt);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: PASS (thunder + enemy tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/world.test.ts
git commit -m "feat(sim): thunder hitscan, enemy pursuit and contact damage"
```

---

## Task 12: step — wave spawning, progression & game over

**Files:**
- Modify: `src/sim/world.ts`
- Modify: `tests/sim/world.test.ts`

Wave state machine (run each step before enemy update):
- If `breakTimer > 0`: decrement; when it reaches 0, begin the next wave; skip spawning this step.
- If `wave === 0` and `spawnQueue === 0`: begin wave 1.
- If `spawnQueue > 0`: decrement `spawnTimer`; when ≤ 0, spawn one enemy at a random edge, decrement `spawnQueue`, reset `spawnTimer = spawnCadence`.
- If `spawnQueue === 0` and no enemies remain: start a break (`breakTimer = breakTime`).

`beginWave` increments `wave`, sets `spawnQueue` and `spawnCadence` scaled by wave number, and `spawnTimer = 0` (spawn first enemy immediately).

- [ ] **Step 1: Add failing tests**

```ts
// append to tests/sim/world.test.ts
describe('step — waves', () => {
  it('begins wave 1 and spawns enemies over time', () => {
    const w = createWorld();
    const rng = () => 0; // deterministic edge/position
    step(w, [], 0.016, rng);
    expect(w.wave).toBe(1);
    expect(w.enemies.length).toBe(1); // first spawns immediately
    // advance enough to spawn the rest of the wave
    for (let i = 0; i < 600; i++) step(w, [], 0.05, rng);
    expect(w.enemies.length).toBeGreaterThan(1);
  });

  it('ends the game when player hp hits zero', () => {
    const w = createWorld();
    w.player.hp = 1;
    w.enemies.push({ id: 1, pos: { ...w.player.pos }, hp: 100, speed: 0, slowUntil: 0, radius: CONFIG.enemy.radius });
    for (let i = 0; i < 20; i++) step(w, [], 0.1);
    expect(w.status).toBe('gameover');
    expect(w.player.hp).toBe(0);
  });

  it('does not advance once game over', () => {
    const w = createWorld();
    w.status = 'gameover';
    const t = w.time;
    step(w, [{ kind: 'move', dir: { x: 1, y: 0 } }], 1);
    expect(w.time).toBe(t);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL — no waves begin; `w.wave` stays 0.

- [ ] **Step 3: Implement waves — modify `src/sim/world.ts`**

Append:

```ts
function beginWave(world: World): void {
  world.wave += 1;
  world.spawnQueue = CONFIG.wave.baseCount + (world.wave - 1) * CONFIG.wave.perWave;
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
```

Wire `updateWaves` into `step`, before `updateEnemies` and after the command loop. Change `_rng` to `rng` in the `step` signature and pass it through:

```ts
export function step(
  world: World,
  commands: Command[],
  dt: number,
  rng: () => number = Math.random
): World {
  if (world.status === 'gameover') return world;
  world.time += dt;

  let moveDir: Vec2 = { x: 0, y: 0 };
  for (const cmd of commands) {
    if (cmd.kind === 'move') moveDir = cmd.dir;
    else if (cmd.kind === 'face') world.player.facing = cmd.angle;
    else if (cmd.kind === 'cast') castSpell(world, cmd.spell);
  }

  movePlayer(world, moveDir, dt);
  updateWaves(world, dt, rng);
  updateEnemies(world, dt);
  updateProjectiles(world, dt);

  if (world.player.hp <= 0) {
    world.player.hp = 0;
    world.status = 'gameover';
  }
  return world;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run`
Expected: PASS — entire suite green (vec, spells, matcher, world).

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/world.test.ts
git commit -m "feat(sim): wave spawning, progression and game over"
```

---

## Task 13: Input controls (`input/controls.ts`)

**Files:**
- Create: `src/input/controls.ts`
- Test: `tests/input/controls.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/input/controls.test.ts
import { describe, it, expect } from 'vitest';
import { moveDirFromKeys, facingFromMouse } from '../../src/input/controls';

describe('moveDirFromKeys', () => {
  it('returns zero when no keys are held', () => {
    expect(moveDirFromKeys(new Set())).toEqual({ x: 0, y: 0 });
  });
  it('maps w to up (negative y)', () => {
    expect(moveDirFromKeys(new Set(['w']))).toEqual({ x: 0, y: -1 });
  });
  it('supports arrow keys', () => {
    expect(moveDirFromKeys(new Set(['arrowright']))).toEqual({ x: 1, y: 0 });
  });
  it('normalizes diagonals to unit length', () => {
    const d = moveDirFromKeys(new Set(['w', 'd']));
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });
  it('cancels opposite keys', () => {
    expect(moveDirFromKeys(new Set(['a', 'd']))).toEqual({ x: 0, y: 0 });
  });
});

describe('facingFromMouse', () => {
  it('points right when mouse is to the right', () => {
    expect(facingFromMouse({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
  });
  it('points down when mouse is below', () => {
    expect(facingFromMouse({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/input/controls.test.ts`
Expected: FAIL — cannot resolve `../../src/input/controls`.

- [ ] **Step 3: Implement `src/input/controls.ts`**

```ts
import { Vec2 } from '../sim/vec';

export function moveDirFromKeys(keys: Set<string>): Vec2 {
  let x = 0;
  let y = 0;
  if (keys.has('w') || keys.has('arrowup')) y -= 1;
  if (keys.has('s') || keys.has('arrowdown')) y += 1;
  if (keys.has('a') || keys.has('arrowleft')) x -= 1;
  if (keys.has('d') || keys.has('arrowright')) x += 1;
  if (x === 0 && y === 0) return { x: 0, y: 0 };
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
}

export function facingFromMouse(playerScreen: Vec2, mouse: Vec2): number {
  return Math.atan2(mouse.y - playerScreen.y, mouse.x - playerScreen.x);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/input/controls.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/input/controls.ts tests/input/controls.test.ts
git commit -m "feat(input): keyboard move dir and mouse facing helpers"
```

---

## Task 14: Voice recognizer (`voice/recognizer.ts`)

**Files:**
- Create: `src/voice/recognizer.ts`

Browser-only (Web Speech API); verified manually in Task 18. Provides a swappable interface so a future local-Whisper input can replace it without touching game code.

- [ ] **Step 1: Create `src/voice/recognizer.ts`**

```ts
// Minimal Web Speech API typings (not in lib.dom for all TS versions).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

export type VoiceStatus = 'idle' | 'listening' | 'unsupported' | 'denied';

// Swappable voice input. Web Speech now; local Whisper could implement this later.
export interface VoiceInput {
  readonly status: VoiceStatus;
  start(): void;
  stop(): void;
  // called with each (possibly interim) transcript chunk
  onTranscript(cb: (text: string) => void): void;
  onStatusChange(cb: (s: VoiceStatus) => void): void;
}

export class WebSpeechVoiceInput implements VoiceInput {
  private recog: SpeechRecognitionLike | null = null;
  private _status: VoiceStatus = 'idle';
  private transcriptCb: (t: string) => void = () => {};
  private statusCb: (s: VoiceStatus) => void = () => {};
  private wantOn = false;

  constructor(private lang = 'zh-TW') {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      this.setStatus('unsupported');
      return;
    }
    const r: SpeechRecognitionLike = new Ctor();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (text) this.transcriptCb(text);
      }
    };
    r.onerror = (err: any) => {
      if (err && err.error === 'not-allowed') this.setStatus('denied');
    };
    r.onend = () => {
      // Web Speech tends to auto-stop; restart if we still want to listen.
      if (this.wantOn && this._status === 'listening') {
        try { r.start(); } catch { /* already starting */ }
      }
    };
    this.recog = r;
  }

  get status(): VoiceStatus {
    return this._status;
  }

  private setStatus(s: VoiceStatus): void {
    this._status = s;
    this.statusCb(s);
  }

  start(): void {
    if (!this.recog || this._status === 'unsupported') return;
    this.wantOn = true;
    try {
      this.recog.start();
      this.setStatus('listening');
    } catch { /* already started */ }
  }

  stop(): void {
    this.wantOn = false;
    if (this.recog) this.recog.stop();
    if (this._status === 'listening') this.setStatus('idle');
  }

  onTranscript(cb: (text: string) => void): void {
    this.transcriptCb = cb;
  }

  onStatusChange(cb: (s: VoiceStatus) => void): void {
    this.statusCb = cb;
    cb(this._status);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/voice/recognizer.ts
git commit -m "feat(voice): Web Speech recognizer behind swappable VoiceInput"
```

---

## Task 15: Render scene (`render/GameScene.ts`)

**Files:**
- Create: `src/render/GameScene.ts`

Phaser scene owns the `World`, advances it each frame with collected commands, and draws using `Phaser.GameObjects.Graphics` placeholder shapes (player = blue circle with a facing line, enemies = red circles, projectiles = small dots, fireball = orange, frost = cyan, thunder draws a brief beam). Pixel sprites replace shapes in Task 20. Verified manually in Task 18.

- [ ] **Step 1: Create `src/render/GameScene.ts`**

```ts
import Phaser from 'phaser';
import { World, Command, SpellId } from '../sim/types';
import { createWorld, step } from '../sim/world';
import { CONFIG } from '../sim/config';
import { moveDirFromKeys, facingFromMouse } from '../input/controls';

export class GameScene extends Phaser.Scene {
  private world!: World;
  private gfx!: Phaser.GameObjects.Graphics;
  private keys = new Set<string>();
  private mouse = { x: CONFIG.arenaWidth / 2, y: 0 };
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/render/GameScene.ts
git commit -m "feat(render): Phaser scene drawing world with placeholder shapes"
```

---

## Task 16: HUD (`render/hud.ts`)

**Files:**
- Create: `src/render/hud.ts`

Renders hp/wave/score, the spell list (so players know what to say), and mic status into the `#hud` and `#mic-status` DOM nodes. Verified manually in Task 18.

- [ ] **Step 1: Create `src/render/hud.ts`**

```ts
import { World } from '../sim/types';
import { SPELLS } from '../sim/spells';
import { VoiceStatus } from '../voice/recognizer';

const MIC_LABEL: Record<VoiceStatus, string> = {
  idle: '麥克風:未啟動',
  listening: '麥克風:聆聽中',
  unsupported: '麥克風:此瀏覽器不支援語音(請用 Chrome/Edge)',
  denied: '麥克風:權限被拒,請允許麥克風',
};

export class Hud {
  private hud: HTMLElement;
  private mic: HTMLElement;

  constructor() {
    this.hud = document.getElementById('hud')!;
    this.mic = document.getElementById('mic-status')!;
  }

  setMicStatus(s: VoiceStatus): void {
    this.mic.textContent = MIC_LABEL[s];
  }

  render(world: World): void {
    const spellList = Object.values(SPELLS)
      .map((s) => s.displayName)
      .join('、');
    const status = world.status === 'gameover'
      ? `遊戲結束 — 撐到第 ${world.wave} 波,擊殺 ${world.score}(按 R 重來)`
      : `HP ${Math.ceil(world.player.hp)}/${world.player.maxHp} | 第 ${world.wave} 波 | 擊殺 ${world.score}`;
    this.hud.textContent = `${status} ｜ 可喊法術:${spellList}`;
  }
}
```

- [ ] **Step 2: Type-check & commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/render/hud.ts
git commit -m "feat(render): DOM HUD with hp/wave/score, spell list, mic status"
```

---

## Task 17: Assemble everything (`main.ts`)

**Files:**
- Modify: `src/main.ts`

Wires Phaser, the HUD, the voice recognizer, the mode `<select>`, and the `R`-to-restart key together.

- [ ] **Step 1: Replace `src/main.ts`**

```ts
import Phaser from 'phaser';
import { GameScene } from './render/GameScene';
import { Hud } from './render/hud';
import { CONFIG } from './sim/config';
import { WebSpeechVoiceInput } from './voice/recognizer';
import { matchSpell, CastMode } from './voice/matcher';
import { JUMON } from './sim/spells';

const scene = new GameScene();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CONFIG.arenaWidth,
  height: CONFIG.arenaHeight,
  backgroundColor: '#141422',
  scene,
});

const hud = new Hud();

// HUD refresh loop (decoupled from Phaser so game-over text updates even when idle)
setInterval(() => {
  const w = scene.getWorld?.();
  if (w) hud.render(w);
}, 100);

// Mode toggle
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
let mode: CastMode = (modeSelect.value as CastMode) ?? 'mueisho';
modeSelect.addEventListener('change', () => {
  mode = modeSelect.value as CastMode;
});

// Restart
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') scene.restart?.();
});

// Voice → spell casting
const voice = new WebSpeechVoiceInput('zh-TW');
voice.onStatusChange((s) => hud.setMicStatus(s));
voice.onTranscript((text) => {
  const spell = matchSpell(text, { mode, jumon: JUMON });
  if (spell) scene.queueCast(spell);
});

// Browsers require a user gesture before mic access; start on first click.
window.addEventListener(
  'click',
  () => voice.start(),
  { once: true }
);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If TS complains about optional-call `getWorld?.()` / `restart?.()`, they are defined methods — keep them as direct calls `scene.getWorld()` / `scene.restart()`.)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: assemble Phaser, HUD, voice, mode toggle and restart"
```

---

## Task 18: Manual playtest verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated suite**

Run: `npm run test`
Expected: all suites PASS (vec, spells, matcher, world, controls).

- [ ] **Step 2: Build to confirm no type/build errors**

Run: `npm run build`
Expected: `tsc --noEmit` clean and Vite writes `dist/` with no errors.

- [ ] **Step 3: Launch dev server and verify in a real browser**

Run: `npm run dev`
Open the printed URL in **Chrome or Edge** (not snap Chromium — Web Speech may be disabled there; see spec §9).
Verify:
- WSAD / arrows move the blue player circle; it cannot leave the arena.
- Moving the mouse rotates the white facing line.
- Red enemies spawn from edges and chase the player; contact lowers HP in the HUD.
- Click once to grant mic; status shows "聆聽中".
- In 無詠唱 mode, saying "火球術" / "fireball" launches an orange projectile along facing; "雷擊" flashes a beam; "護盾" shows a ring; "治療" raises HP.
- Switch the dropdown to 詠唱; saying just "火球術" does nothing, but "我命汝顯現 火球術" casts it.
- Let HP reach 0 → HUD shows the game-over line; pressing R restarts.

- [ ] **Step 4: Record results**

Note any issues. If a behavior is wrong, fix via the relevant sim/voice task (with a test reproducing the bug) before proceeding. No commit if nothing changed.

---

## Task 19: GitHub Pages deploy workflow & README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

The remote repo is created later (user will push when ready), but the workflow and docs ship now so deploy works on first push.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Create `README.md`**

```markdown
# 真。AI。咏唱魔法

俯視角網頁小遊戲:用 WSAD/方向鍵移動、滑鼠瞄準,**用麥克風喊出法術名稱**即時施法,在一波波怪物中存活越久越好。純前端、零後台,部署在 GitHub Pages。

## 玩法

- 移動:WSAD 或方向鍵
- 面向:滑鼠位置(法術朝面向發出)
- 施法:點一下畫面授權麥克風後,直接喊法術名
- 法術:火球術 / 冰霜 / 雷擊 / 護盾 / 治療術(中英別名皆可)
- 詠唱模式:
  - 無詠唱 — 直接喊法術名
  - 詠唱 — 先念呪文「我命汝顯現」再接法術名
- 遊戲結束後按 `R` 重來

## 瀏覽器需求

語音辨識使用瀏覽器內建 Web Speech API,請用 **Chrome 或 Edge**。
部分 Linux 的 snap 版 Chromium 不支援語音(會顯示提示),其餘操作仍可進行。

## 開發

```bash
npm install
npm run dev      # 本機開發
npm run test     # 單元測試(模擬層 + 語音比對)
npm run build    # 產出 dist/
```

## 架構

`Input → Command → Simulation → Render` 單向資料流。`src/sim/` 為純邏輯、零依賴、可單元測試;未來要做多人連線,只需在 Command 與 Simulation 之間插入網路層,模擬與繪圖層幾乎不用改。

## 授權

MIT © 林亞澤 (Yaze Lin)
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "ci: GitHub Pages deploy workflow; docs: README"
```

---

## Task 20: (Optional polish) Pixel sprites

**Files:**
- Create: `src/assets/` (generated PNGs), Modify: `src/render/GameScene.ts`

Replaces placeholder shapes with pixel sprites. Do this only after the shape-based game is confirmed fun in Task 18. Asset generation is interactive (codex-imagegen / nanobanana), so this task is intentionally last and optional for MVP.

- [ ] **Step 1: Generate pixel sprites**

Generate top-down pixel-art PNGs (transparent background), each roughly 32×32:
- `player.png` — a robed mage seen from above
- `enemy.png` — a small monster seen from above
- `fireball.png`, `frost.png` — projectile icons
Use the `codex-imagegen` skill (or `nanobanana:generate`). Save under `src/assets/`.

- [ ] **Step 2: Load and use textures in `GameScene`**

In `preload()`:

```ts
preload(): void {
  this.load.image('player', new URL('../assets/player.png', import.meta.url).href);
  this.load.image('enemy', new URL('../assets/enemy.png', import.meta.url).href);
  this.load.image('fireball', new URL('../assets/fireball.png', import.meta.url).href);
  this.load.image('frost', new URL('../assets/frost.png', import.meta.url).href);
}
```

Replace `Graphics` circles for player/enemy/projectiles with `this.add.image(...)` sprites that are repositioned/rotated each frame, keeping the `Graphics` layer only for the thunder beam and shield ring. (Manage sprite pools keyed by entity `id`; destroy sprites for entities no longer present.)

- [ ] **Step 3: Verify in browser**

Run: `npm run dev` and confirm sprites render, rotate to face direction, and there are no leaked/duplicate sprites as enemies die.

- [ ] **Step 4: Commit**

```bash
git add src/assets src/render/GameScene.ts
git commit -m "feat(render): pixel sprite art replacing placeholder shapes"
```

---

## Self-Review Notes (completed by plan author)

- **Spec coverage:** top-down view (Task 15) ✓; WSAD/arrow move + mouse facing (Tasks 8, 13, 15) ✓; voice-cast along facing (Tasks 9–11, 14, 17) ✓; continuous STT + fuzzy match + zh/en aliases (Tasks 5–6) ✓; 無詠唱/詠唱 dual mode + 呪文 (Task 6, 17) ✓; 5 spells with distinct effects + cooldowns (Tasks 4, 9–11) ✓; heal can't out-pace DPS (config tuning, Task 3) ✓; wave survival + game over + restart (Tasks 12, 16, 17) ✓; HUD with hp/wave/score/spell list/mic status (Task 16) ✓; pure testable sim + matcher (Tasks 2–13 tests) ✓; multiplayer-ready seam — Command/Simulation split, no net code (Tasks 3, 8, 12) ✓; GitHub Pages zero-backend deploy (Tasks 1, 19) ✓; MIT 林亞澤 (Task 1) ✓; pixel sprites (Task 20) ✓.
- **Placeholder scan:** no TBD/TODO; every code step contains complete code.
- **Type consistency:** `step(world, commands, dt, rng)`, `createWorld()`, `matchSpell(transcript, {mode, jumon})`, `SPELLS`, `JUMON`, `moveDirFromKeys`, `facingFromMouse`, `VoiceInput`/`WebSpeechVoiceInput`, `Hud`, `GameScene.queueCast/getWorld/restart` are named consistently across tasks.
