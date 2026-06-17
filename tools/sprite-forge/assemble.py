#!/usr/bin/env python3
"""Assemble chosen cells (in order) into a sprite sheet + preview GIF.

Usage: assemble.py <job-dir> <n1,n2,...> [--out sheet.png] [--cell 128] [--fps 8] [--bg 2b2440]

Writes <out> (a single-row sheet, len*CELL x CELL, transparent) and <out>.gif
(animated preview on a solid bg) next to it.
"""
import sys, os, argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("jobdir"); ap.add_argument("order")
ap.add_argument("--out", default=None)
ap.add_argument("--cell", type=int, default=128)
ap.add_argument("--fps", type=float, default=8)
ap.add_argument("--bg", default="2b2440", help="preview-GIF bg hex")
a = ap.parse_args()

nums = [int(x) for x in a.order.replace(" ", "").split(",") if x]
CELL = a.cell
cells = [Image.open(os.path.join(a.jobdir, f"cell-{n:02d}.png")).convert("RGBA") for n in nums]
out = a.out or os.path.join(a.jobdir, os.path.basename(a.jobdir.rstrip("/")) + ".png")

sheet = Image.new("RGBA", (CELL * len(cells), CELL), (0, 0, 0, 0))
for i, c in enumerate(cells): sheet.alpha_composite(c, (i * CELL, 0))
sheet.save(out)

bg = tuple(int(a.bg[i:i+2], 16) for i in (0, 2, 4)) + (255,)
sc = 4; dur = int(1000 / a.fps)
gif = []
for c in cells:
    f = Image.new("RGBA", (CELL * sc, CELL * sc), bg)
    f.alpha_composite(c.resize((CELL * sc, CELL * sc), Image.NEAREST))
    gif.append(f.convert("P"))
gif[0].save(out + ".gif", save_all=True, append_images=gif[1:], duration=dur, loop=0, disposal=2)
print(f"sheet -> {out}  ({len(cells)} frames, {sheet.size})")
print(f"gif   -> {out}.gif")
