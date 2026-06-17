#!/usr/bin/env bash
# sprite-forge — roll a grid of pose candidates, pick the good ones in a webpage,
# assemble them into a game sprite sheet. See README.md for the full SOP.
#
#   forge.sh gen   <job> <design-ref.png> --key green|magenta --action "<pose description>" [--grid 8x8] [--size 1024x1024]
#   forge.sh seg   <job> --key green|magenta [--cell 128]
#   forge.sh serve [port]                       # open picker at /picker.html?job=<job>  (human path)
#   forge.sh montage <job>                      # numbered contact sheet PNG  (AI-agent path)
#   forge.sh build <job> <n1,n2,...> [--fps 8]  # assemble chosen cells -> <job>.png + .gif
#
# A "job" is one character x one action (e.g. jeanne-walk, megumin-idle, slime-attack).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS="$HERE/jobs"
cmd="${1:-}"; shift || true

case "$cmd" in
gen)
  job="$1"; ref="$2"; shift 2
  KEY=magenta; ACTION="many different side-view walking stances, legs ranging from feet-together to a wide forward/back stride, a leg lifted mid-step"; GRID="8 columns by 8 rows"; SIZE="1024x1024"
  while [ $# -gt 0 ]; do case "$1" in
    --key) KEY="$2"; shift 2;; --action) ACTION="$2"; shift 2;;
    --grid) GRID="$2"; shift 2;; --size) SIZE="$2"; shift 2;;
    *) echo "unknown: $1" >&2; exit 2;; esac; done
  [ "$KEY" = green ] && BG="flat solid chroma-green background (#00ff00)" || BG="flat solid magenta background (pure magenta #ff00ff)"
  mkdir -p "$JOBS/$job"
  PROMPT="Single image: a character POSE reference sheet (contact sheet) of ONE character shown in many poses. The character's exact design, colors, hair, outfit and props come from image 1 — keep them IDENTICAL in every cell, chibi proportions matching image 1, side view facing LEFT. Arrange the figures in a neat regular grid of EXACTLY ${GRID}, evenly spaced, each figure the same size and centered in its cell, full body with feet near the bottom of each cell. The ONLY thing that changes cell to cell is the POSE: ${ACTION}. Make the poses strongly and clearly different from each other. ${BG}, clear even gaps between figures, no grid lines, no frames, no text, no numbers, no watermark."
  echo "[gen] job=$job key=$KEY -> $JOBS/$job/grid.png"
  "$HERE/ce.sh" "$PROMPT" "$JOBS/$job/grid.png" --count 1 --size "$SIZE" --quality high --image "$ref"
  ;;
seg)
  job="$1"; shift
  KEY=magenta; CELL=128
  while [ $# -gt 0 ]; do case "$1" in --key) KEY="$2"; shift 2;; --cell) CELL="$2"; shift 2;; *) echo "unknown: $1">&2; exit 2;; esac; done
  python3 "$HERE/segment.py" "$JOBS/$job/grid.png" "$JOBS/$job" --key "$KEY" --cell "$CELL"
  echo "[seg] pick at: http://127.0.0.1:8799/picker.html?job=$job  (run: forge.sh serve)"
  ;;
serve)
  port="${1:-8799}"
  echo "[serve] http://127.0.0.1:$port/picker.html?job=<job>"
  cd "$HERE" && exec python3 -m http.server "$port" --bind 127.0.0.1
  ;;
montage)
  job="$1"; shift
  python3 "$HERE/montage.py" "$JOBS/$job" "$@"
  ;;
build)
  job="$1"; order="$2"; shift 2
  python3 "$HERE/assemble.py" "$JOBS/$job" "$order" "$@"
  ;;
*)
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1;;
esac
