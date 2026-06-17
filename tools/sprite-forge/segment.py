#!/usr/bin/env python3
"""Segment a chroma-key pose grid into transparent NxN cells + frames.json.

Usage: segment.py <grid.png> <out-dir> [--key green|magenta] [--cell 128] [--min 400]

Detects every figure via connected components (so overlapping props from a
neighbour cell never bleed in — each figure is its own component, fragments are
dropped), keys out the background, fits each figure into a CELLxCELL transparent
frame with feet near the bottom, and writes frames.json (a list the picker reads).
"""
import sys, os, json, argparse
from PIL import Image
import numpy as np
from collections import deque

ap = argparse.ArgumentParser()
ap.add_argument("grid"); ap.add_argument("outdir")
ap.add_argument("--key", choices=["green", "magenta"], default="magenta")
ap.add_argument("--cell", type=int, default=128)
ap.add_argument("--min", type=int, default=400, help="min component size (half-res px)")
a = ap.parse_args()

src = Image.open(a.grid).convert("RGBA")
A = np.array(src).astype(int); H, W = A.shape[:2]
r, g, b = A[..., 0], A[..., 1], A[..., 2]

if a.key == "green":
    # green spills onto warm/yellow → use ONLY for dark/cool-haired characters
    bg = (g > 90) & (g > r * 1.30) & (g > b * 1.30)
    # despill greenish fringe
    keep = (~bg) & (g > (r + b) / 2 + 25)
    A[..., 1] = np.where(keep, ((r + b) // 2 + 25), A[..., 1])
else:  # magenta — safe for blonde/warm palettes (avoid for red-cloak chars)
    bg = (r > 110) & (b > 110) & (g < np.minimum(r, b) * 0.62)
    keep = (~bg) & (g < np.minimum(r, b) - 20) & (r > 90) & (b > 90)
    A[..., 1] = np.where(keep, np.minimum(r, b) - 15, A[..., 1])
fg = ~bg

# half-res connected components (fast, plenty for figure separation)
fh = fg[::2, ::2]; hh, hw = fh.shape; lbl = np.zeros((hh, hw), np.int32); cur = 0; sizes = {}
for sy in range(hh):
    for sx in range(hw):
        if fh[sy, sx] and lbl[sy, sx] == 0:
            cur += 1; cnt = 0; dq = deque([(sy, sx)]); lbl[sy, sx] = cur
            while dq:
                y, x = dq.popleft(); cnt += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < hh and 0 <= nx < hw and fh[ny, nx] and lbl[ny, nx] == 0:
                        lbl[ny, nx] = cur; dq.append((ny, nx))
            sizes[cur] = cnt

comps = [(c, s) for c, s in sizes.items() if s > a.min]
info = []
for c, s in comps:
    ys, xs = np.where(lbl == c); info.append((c, xs.mean() * 2, ys.mean() * 2))
# group into rows by y, sort left→right within each row (reading order)
info.sort(key=lambda t: t[2]); rows = []; cure = []; lasty = None
for it in info:
    if lasty is None or abs(it[2] - lasty) < 55: cure.append(it)
    else: rows.append(cure); cure = [it]
    lasty = it[2]
if cure: rows.append(cure)
ordered = []
for row in rows: row.sort(key=lambda t: t[1]); ordered += row

lbl_up = np.kron(lbl, np.ones((2, 2), np.int32))[:H, :W]
os.makedirs(a.outdir, exist_ok=True)
for f in os.listdir(a.outdir):
    if f.startswith("cell-") and f.endswith(".png"): os.remove(os.path.join(a.outdir, f))

CELL = a.cell; manifest = []; kept = 0
for c, cx, cy in ordered:
    mask = (lbl_up == c) & fg
    ys, xs = np.where(mask)
    if len(xs) == 0: continue
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    if (y1 - y0) < 40: continue  # drop malformed scraps
    out = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    out[..., :3] = A[y0:y1, x0:x1, :3]; out[..., 3] = np.where(mask[y0:y1, x0:x1], 255, 0)
    fig = Image.fromarray(out, "RGBA"); sc = (CELL * 0.875) / fig.height
    fig = fig.resize((max(1, int(fig.width * sc)), int(fig.height * sc)), Image.LANCZOS)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    cell.alpha_composite(fig, ((CELL - fig.width) // 2, CELL - fig.height - 6))
    kept += 1; fn = f"cell-{kept:02d}.png"; cell.save(os.path.join(a.outdir, fn))
    manifest.append({"n": kept, "file": fn})
json.dump(manifest, open(os.path.join(a.outdir, "frames.json"), "w"))
print(f"rows={[len(r) for r in rows]} kept={kept} -> {a.outdir}/frames.json")
