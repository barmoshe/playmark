#!/usr/bin/env bash
# Records the Thornback video's footage in a scratch copy of Wandcraft: the mark on the old
# Thornback (bestiary.gd from 798aefd), then the redrawn one (main) as the fix lands. This repo's
# Playmark addon is copied over Wandcraft's, so the footage has the current UI sounds. The game's
# music and ambience are muted and its effects turned down: the video's own bed goes on top.
# Footage lands in $OUT/thorn-mark and $OUT/thorn-fixed (frames + mm.avi).
#
#   film/showcase/record-thornback.sh
#
# Env: WANDCRAFT (default ../wandcraft next to this repo), OUT (default ./footage),
#      GODOT (default godot, 4.7). On Linux without a display it runs under xvfb-run.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WANDCRAFT="${WANDCRAFT:-$HERE/../wandcraft}"
OUT="${OUT:-$HERE/footage}"
GODOT="${GODOT:-godot}"
CLI="$HERE/scripts/inbox.mjs"
DRIVER="--playmark-driver=$HERE/film/capture.gd"
BUS="--film-bus=Music:mute,Sting:mute,Ambience:mute,SFX:-12,Critical:-12,UI:-12"
GAME_ARGS=(--demo --seed=3 --step=1 --kind=fight)
AIM=(--film-kind=ram --film-hold-at=260,142)
RUN=()
if [ "$(uname)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then RUN=(xvfb-run -a -s "-screen 0 1920x1080x24"); fi
WORK="$(mktemp -d)"
cp -RL "$WANDCRAFT/game" "$WORK/game"
rm -rf "$WORK/game/.playmark" "$WORK/game/.godot" "$WORK/game/addons/playmark"
cp -RL "$HERE/addons/playmark" "$WORK/game/addons/playmark"
git -C "$WANDCRAFT" show 798aefd:game/scripts/art/bestiary.gd > "$WORK/game/scripts/art/bestiary.gd"
"$GODOT" --headless --path "$WORK/game" --import > /dev/null 2>&1
mkdir -p "$OUT"

rec() { # name, args...
  local out="$OUT/$1"; rm -rf "$out"; mkdir -p "$out"; shift
  "${RUN[@]}" "$GODOT" --path "$WORK/game" --write-movie "$out/mm.avi" --fixed-fps 30 \
    -- "${GAME_ARGS[@]}" $DRIVER "$BUS" --film-out="$out" "$@" > "$out.log" 2>&1
  grep -E "film:|SCRIPT ERROR" "$out.log"
}

rec thorn-mark --film-part=enemy-mark "${AIM[@]}" \
  "--film-note=Redesign the Thornback: make it look like a charging ram, with curled horns, thorns along its back and a glowing eye."
cp "$WANDCRAFT/game/scripts/art/bestiary.gd" "$WORK/game/scripts/art/bestiary.gd"
rec thorn-fixed --film-part=enemy-fixed "${AIM[@]}" --film-cli="$CLI" \
  "--film-res=Thornback redrawn in bestiary.gd: curled horn, spikes along the back, a glowing eye."
rm -rf "$WORK"
echo "done: footage in $OUT; run ffmpeg -i <step>/mm.avi -vn -ac 2 -ar 44100 <step>/full.wav for each step's audio"
