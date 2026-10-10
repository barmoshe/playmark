#!/usr/bin/env bash
# Records the color video's footage on the demo's shapes scene, in a scratch copy of the demo:
# pin Boxy and ask for orange, the one-line fix in look.gd, then the fix landing.
# Footage lands in $OUT/shapes-color-mark and $OUT/shapes-color-fixed (frames + mm.avi).
#
#   film/showcase/record-color.sh
#
# Env: OUT (default ./footage), GODOT (default godot, 4.5+). On Linux without a display it runs
# under xvfb-run.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$HERE/footage}"
GODOT="${GODOT:-godot}"
CLI="$HERE/scripts/inbox.mjs"
DRIVER="--playmark-driver=$HERE/film/capture.gd"
RUN=()
if [ "$(uname)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then RUN=(xvfb-run -a -s "-screen 0 1920x1080x24"); fi
WORK="$(mktemp -d)"
cp -RL "$HERE/demo" "$WORK/demo"
rm -rf "$WORK/demo/.playmark" "$WORK/demo/.godot"
"$GODOT" --headless --path "$WORK/demo" --import > /dev/null 2>&1
mkdir -p "$OUT"

rec() { # name, args...
  local out="$OUT/$1"; rm -rf "$out"; mkdir -p "$out"; shift
  "${RUN[@]}" "$GODOT" --path "$WORK/demo" res://shapes.tscn --write-movie "$out/mm.avi" --fixed-fps 30 \
    -- $DRIVER --film-out="$out" "$@" > "$out.log" 2>&1
  grep -E "film:|SCRIPT ERROR" "$out.log"
}

rec shapes-color-mark --film-part=pick-mark --film-target=1 --film-cat=art "--film-note=Boxy should be orange"
sed -i.bak 's/"name": "Boxy", "kind": "square", "color": "#2EC4B6"/"name": "Boxy", "kind": "square", "color": "#FF8A1F"/' "$WORK/demo/look.gd"
rm -f "$WORK/demo/look.gd.bak"
grep -q '#FF8A1F' "$WORK/demo/look.gd" || { echo "record-color: the fix did not apply" >&2; exit 1; }
rec shapes-color-fixed --film-part=pick-fixed --film-cli="$CLI" "--film-res=Boxy: #2EC4B6 → #FF8A1F in look.gd"
rm -rf "$WORK"
echo "done: footage in $OUT; run ffmpeg -i <step>/mm.avi -vn -ac 2 -ar 44100 <step>/full.wav for each step's audio"
