#!/usr/bin/env bash
# End-to-end check in a real window: copies the demo to a temp folder, runs the arena with
# --playmark-selftest (mark, save, claim, resolve, ghost, auto-error), then checks the files.
#   tests/run_selftest.sh [godot binary]      (needs a display; macOS or Linux with X)
set -euo pipefail
GODOT="${1:-${GODOT:-godot}}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
rsync -aL --exclude .playmark --exclude .godot "$HERE/demo/" "$WORK/demo/"
mkdir -p "$WORK/scripts" && cp "$HERE/scripts/"*.mjs "$WORK/scripts/"
SHOTS="$WORK/shots"; mkdir -p "$SHOTS"
"$GODOT" --headless --path "$WORK/demo" --import >/dev/null 2>&1 || true
"$GODOT" --path "$WORK/demo" res://main.tscn -- --playmark-selftest="$SHOTS" > "$WORK/run.log" 2>&1 || true
node "$HERE/tests/check_selftest.mjs" "$WORK/demo/.playmark" "$SHOTS" "$WORK/run.log"
echo "selftest output: $WORK"
