#!/usr/bin/env bash
# codex-image-edit: POST prompt + base64 reference images to the 192.168.11.11 codex-image service.
# usage: ce.sh <prompt> <out.png> [--count N] [--quality q] [--size WxH] --image ref1 [--image ref2 ...]
set -euo pipefail
AUTH_FILE="${CODEX_IMAGE_AUTH_FILE:-$HOME/.config/codex-image/auth}"
ENDPOINT="${CODEX_IMAGE_ENDPOINT:-https://ching-tech.ddns.net/codex-image/v1/images/generate}"
PROMPT="$1"; shift; OUT="$1"; shift
SIZE="1024x1024"; QUALITY="high"; COUNT=1; REFS=()
while [ $# -gt 0 ]; do case "$1" in
  --count) COUNT="$2"; shift 2;; --quality) QUALITY="$2"; shift 2;;
  --size) SIZE="$2"; shift 2;; --image) REFS+=("$2"); shift 2;;
  *) echo "unknown arg: $1" >&2; exit 2;; esac; done
KEY="$(tr -d '\r\n' < "$AUTH_FILE")"
# build refs json array via stdin (avoid ARG_MAX); base64 each file, one per line -> jq array
REFTMP=$(mktemp)
for f in "${REFS[@]}"; do base64 -w0 "$f"; printf '\n'; done | jq -R . | jq -s . > "$REFTMP"
PTMP=$(mktemp); printf '%s' "$PROMPT" > "$PTMP"
BODYTMP=$(mktemp)
jq -nc --rawfile p "$PTMP" --arg s "$SIZE" --arg q "$QUALITY" --argjson c "$COUNT" --slurpfile refs "$REFTMP" \
  '{prompt:$p,size:$s,quality:$q,count:$c,reference_images_base64:$refs[0]}' > "$BODYTMP"
RESP=$(mktemp)
CODE=$(curl -sS --max-time 360 -X POST "$ENDPOINT" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" --data-binary @"$BODYTMP" -o "$RESP" -w "%{http_code}")
rm -f "$REFTMP" "$PTMP" "$BODYTMP"
if [ "$CODE" != 200 ]; then echo "HTTP $CODE" >&2; cat "$RESP" >&2; exit 1; fi
ST=$(jq -r .status < "$RESP"); if [ "$ST" != succeeded ]; then echo "status=$ST" >&2; cat "$RESP" >&2; exit 1; fi
n=$(jq '.images|length' < "$RESP"); base="${OUT%.png}"
for i in $(seq 0 $((n-1))); do
  url=$(jq -r ".images[$i].url" < "$RESP"); dst="$OUT"; [ "$i" -gt 0 ] && dst="${base}-$((i+1)).png"
  curl -sS --max-time 60 "$url" -o "$dst"; readlink -f "$dst"
done
rm -f "$RESP"
