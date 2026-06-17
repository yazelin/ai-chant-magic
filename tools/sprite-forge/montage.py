#!/usr/bin/env python3
"""Render a numbered contact sheet of a job's cells — the AI-agent picking path.

Usage: montage.py <job-dir> [--per 8] [--scale 3] [--out contact.png]

An agent can Read the output PNG, reason about which cells form a clean cycle,
then call `forge.sh build <job> <n1,n2,...>` — no browser needed. Humans can use
picker.html instead.
"""
import os, json, argparse
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("jobdir"); ap.add_argument("--per", type=int, default=8)
ap.add_argument("--scale", type=int, default=3); ap.add_argument("--out", default=None)
a = ap.parse_args()

manifest = json.load(open(os.path.join(a.jobdir, "frames.json")))
cells = [(m["n"], Image.open(os.path.join(a.jobdir, m["file"])).convert("RGBA")) for m in manifest]
CELL = cells[0][1].width if cells else 128
sc = a.scale; PER = a.per
rows = (len(cells) + PER - 1) // PER
W, H = PER * CELL * sc, rows * CELL * sc
sheet = Image.new("RGBA", (W, H), (235, 235, 235, 255)); d = ImageDraw.Draw(sheet)
t = 24
for yy in range(0, H, t):
    for xx in range(0, W, t):
        if ((xx // t) + (yy // t)) % 2: d.rectangle([xx, yy, xx + t - 1, yy + t - 1], fill=(215, 215, 215, 255))
for i, (n, cell) in enumerate(cells):
    cx, cy = (i % PER) * CELL * sc, (i // PER) * CELL * sc
    sheet.alpha_composite(cell.resize((CELL * sc, CELL * sc), Image.NEAREST), (cx, cy))
    d.rectangle([cx, cy, cx + CELL * sc - 1, cy + CELL * sc - 1], outline=(120, 120, 120, 255), width=2)
    d.rectangle([cx + 2, cy + 2, cx + 46, cy + 30], fill=(20, 20, 30, 255))
    d.text((cx + 8, cy + 6), str(n), fill=(255, 220, 60, 255))
out = a.out or os.path.join(a.jobdir, "contact.png")
sheet.convert("RGB").save(out)
print(f"contact sheet -> {out}  ({len(cells)} cells, {PER}/row)")
