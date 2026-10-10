#!/usr/bin/env bash
# Records the Star Dodger showcase: each mark before, the one-line fix in tune.gd (committed in the
# game's repo), each mark after. Footage lands in $OUT/<step>/frames + mm.avi (audio).
#
#   film/showcase/record-star-dodger.sh [first-step] [last-step]    m1 | m2 | m3 | m4 (default m1 m4)
#
# Env: GAME (default ../star-dodger next to this repo), OUT (default ./footage/sd),
#      GODOT (default godot, 4.5+). On Linux without a display it runs under xvfb-run.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
GAME="${GAME:-$HERE/../star-dodger}"
OUT="${OUT:-$HERE/footage/sd}"
GODOT="${GODOT:-godot}"
CLI="$HERE/scripts/inbox.mjs"
DRIVER="--playmark-driver=$HERE/film/capture.gd"
FIRST="${1:-m1}"
LAST="${2:-m4}"
RUN=()
if [ "$(uname)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then RUN=(xvfb-run -a -s "-screen 0 1920x1080x24"); fi
mkdir -p "$OUT"
cd "$GAME"

rec() { # name, args...
  local out="$OUT/$1"; mkdir -p "$out"; shift
  "${RUN[@]}" "$GODOT" --path "$GAME" --write-movie "$out/mm.avi" --fixed-fps 30 -- --autoplay $DRIVER --film-out="$out" "$@" > "$out.log" 2>&1
  grep -E "film:|SCRIPT ERROR" "$out.log"
}
fix() { # sed expression, commit message (skipped if tune.gd already has it)
  sed -i.bak "$1" tune.gd && rm -f tune.gd.bak
  git add tune.gd && git commit -qm "$2" && git log --oneline | head -1
}
step() { [[ ! "$1" < "$FIRST" && ! "$1" > "$LAST" ]]; }

if step m1; then
  rec m1-mark --film-part=group-mark --film-group=meteor --film-shape=box --film-cat=art \
    "--film-note=Make the meteors glow red so they read as danger." --film-still="$OUT/m1-still.png"
  fix 's/^const METEOR_COLOR := "#8a8a9a"/const METEOR_COLOR := "#ff5a3c"/; s/^const METEOR_GLOW := false/const METEOR_GLOW := true/' \
    "Mark #1 (art): meteors glow red so they read as danger"
  rec m1-fixed --film-part=group-fixed --film-cli="$CLI" "--film-res=Meteors: #8A8A9A → #FF5A3C, with a glow (tune.gd)."
fi
if step m2; then
  rec m2-mark --film-part=group-mark --film-group=ship --film-shape=pin --film-cat=feel \
    "--film-note=Make the ship glide: ease into and out of every move." --film-still="$OUT/m2-still.png"
  fix 's/^const SHIP_ACCEL := 0.0/const SHIP_ACCEL := 900.0/' \
    "Mark #2 (feel): the ship eases into and out of every move"
  rec m2-fixed --film-part=group-fixed --film-cli="$CLI" "--film-res=Ship acceleration 0 → 900: it glides now (tune.gd)."
fi
if step m3; then
  rec m3-mark --film-part=group-mark --film-group=meteor --film-shape=box --film-cat=balance \
    "--film-note=Start the meteors slower and speed them up as the score climbs." --film-still="$OUT/m3-still.png"
  fix 's/^const METEOR_SPEED := 190.0/const METEOR_SPEED := 120.0/; s/^const METEOR_SPEED_PER_POINT := 0.0/const METEOR_SPEED_PER_POINT := 6.0/' \
    "Mark #3 (balance): meteors start slower and speed up with the score"
  rec m3-fixed --film-part=group-fixed --film-cli="$CLI" "--film-res=Meteors start at 120 and add 6 per point (tune.gd)."
fi
if step m4; then
  rec m4-mark --film-part=group-mark --film-group=ship --film-shape=pin --film-cat=feel --film-hit=1 \
    "--film-note=Add a screen shake and a spark burst when a meteor hits the ship." --film-still="$OUT/m4-still.png"
  fix 's/^const HIT_SHAKE := 0.0/const HIT_SHAKE := 6.0/; s/^const HIT_SPARKS := 0/const HIT_SPARKS := 18/' \
    "Mark #4 (feel): a hit shakes the screen and throws sparks"
  rec m4-fixed --film-part=group-fixed --film-cli="$CLI" --film-hit=1 "--film-res=Hits shake the screen and throw 18 sparks (tune.gd)." --film-hold=4.0
fi
echo "done: footage in $OUT; run ffmpeg -i <step>/mm.avi -vn full.wav for each step's audio"
