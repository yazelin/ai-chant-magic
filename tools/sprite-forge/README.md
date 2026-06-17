# sprite-forge

Make a game sprite animation (walk / idle / attack / cast) for any character or
monster, from one AI image, by **rolling a grid of pose candidates and
cherry-picking the good ones in a webpage**.

This doc is the SOP. Humans and AI agents both follow it.

## Why it works this way (read this first)

AI image models (gpt-image / Codex `$imagegen`) are great at **a character's
look** but **cannot reliably copy a specific skeletal pose** — feed them a walk
frame and ask for "the same stride" and they draw a generic standing hero
instead. So we do NOT try to pose-transfer frame by frame.

Instead: ask for **one image containing a big grid (e.g. 8x8) of the same
character in many different poses**. The model varies the legs across 60+ cells
in a single shot. We then **pick the handful that form a clean cycle**. Cost is
**one generation** no matter how many candidates — the same trick that took ~20
rolls for the first character now costs 1 roll for 64 candidates.

A clean walk needs **as few as 4–6 frames** (contact → passing → contact(other
foot) → passing). You do not need 9. Fewer, clearly-different poses beat many
near-identical ones.

## Prerequisites

- The codex-image service on `192.168.11.11` (`ching-tech.ddns.net/codex-image`),
  with an auth token at `~/.config/codex-image/auth`. `ce.sh` posts to it and
  supports reference images (the local `codex-image-gen` CLI does not). It does
  not burn local ChatGPT quota and rotates accounts, so it dodges rate limits.
- `python3` with Pillow (`PIL`). `jq`, `curl`, `base64`.

## A "job" = one character × one action

Name jobs `<character>-<action>`, e.g. `jeanne-walk`, `megumin-idle`,
`slime-attack`. Everything for a job lives in `jobs/<job>/`.

## Workflow (4 steps)

```bash
cd tools/sprite-forge

# 1. ROLL a pose grid (1 generation). Feed a design reference image of the
#    character (a clean idle/portrait). --action describes the poses to vary.
./forge.sh gen jeanne-walk /path/design-ref.png --key magenta \
  --action "many different side-view walking stances, legs from feet-together to a wide forward/back stride, a leg lifted mid-step"

# 2. SEGMENT the grid into numbered transparent cells.
./forge.sh seg jeanne-walk --key magenta

# 3. PICK in the browser. Click cells → live walk preview → drag to reorder.
./forge.sh serve         # then open the printed URL
#    http://127.0.0.1:8799/picker.html?job=jeanne-walk

# 4. BUILD the sheet from the chosen numbers (copied from the picker).
./forge.sh build jeanne-walk 20,11,17,14,10 --fps 8
#    -> jobs/jeanne-walk/jeanne-walk.png  (single-row, N*128 x 128, transparent)
#    -> jobs/jeanne-walk/jeanne-walk.png.gif  (preview)
```

## Who operates which step

Everything except the browser picker is scriptable, so an **AI agent can run the
whole pipeline**. The only split is at picking:

- **Human path:** `forge.sh serve` → click cells in `picker.html?job=<job>`, watch
  the live animation, drag to reorder. Fastest for judging motion *feel*.
- **AI-agent path:** `forge.sh montage <job>` → Read the numbered `contact.png`,
  reason about which cells form a clean cycle, then `forge.sh build <job> <nums>`.
  No browser needed. After building, look at `<job>.png.gif` to sanity-check.

What still wants a human in the loop: the final "does it walk smoothly / is it
on-model / does it look good" call — an agent judges static frames well but
temporal feel weakly. Treat the agent's pick as a first draft.

## Decision rules

**Key color** — the chroma background must be a hue ABSENT from the character:
- `--key green` for **dark / cool** palettes (dark hair, no green/yellow). Green
  spills onto blonde/yellow, so never use it for blonde characters.
- `--key magenta` for **blonde / warm** palettes (it's far from gold/silver/white).
  Avoid magenta for characters with **red/pink/magenta** clothing (e.g. a red
  cloak) — use green for those.
- Quick test: is the character mostly warm (yellow/red/gold)? If hair is blonde
  → magenta, but if they also wear lots of red → green and accept a little spill.

**Frame count** — aim for 4–6 clearly distinct poses. For a walk you want at
least one frame with the **opposite foot forward** and one **feet-together**
passing frame, or it reads as a bob, not a step. Armored/skirted characters hide
leg motion — lean on bigger stride differences.

**Grid size** — default `8x8`. At 1024px that's 128px cells (sprite-sized).
More cells = more candidates but smaller/mushier; 6x6–8x8 is the sweet spot.

**Rolls** — if no 4–6 cells form a good cycle, just `gen` again (1 image). The
grid is cheap; roll until the candidates are good rather than forcing a bad set.

## Wiring a finished sheet into the game

Sheets are single-row `N*128 x 128`, left-facing, feet near the bottom — same
convention as the pyro LPC art. In `client/src/render/GameScene.ts` the
animated-class path (`isAnimated`) handles this: copy the sheet to
`client/src/assets/<class>-walk.png`, add a `load.spritesheet`, create the anim
with `{ start: 0, end: <frames-1> }`, and add the class to `isAnimated` with its
`walkAnim` / `idleKey` keys. `warden` is the worked example.

## Files

| file | role |
|---|---|
| `forge.sh` | orchestrator: `gen` / `seg` / `serve` / `build` |
| `ce.sh` | posts prompt + base64 reference images to the codex-image service |
| `segment.py` | chroma-key + connected-component slice → cells + `frames.json` |
| `picker.html` | browse candidates, pick + reorder, live animation preview |
| `assemble.py` | chosen numbers → sprite sheet + preview GIF |
| `jobs/<job>/` | per-job grid, cells, frames.json, output sheet+gif |
