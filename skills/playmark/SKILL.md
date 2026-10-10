---
name: playmark
description: Read and act on Playmark marks - feedback a player left from inside a running Godot game (a frozen frame with numbered pins and boxes, a note, a category, the last seconds of play, logs, game state). Use when a prompt mentions Playmark, new marks, playtest feedback from the game, a `.playmark` folder, or /playmark:triage.
---

# Playmark marks

A **mark** is a folder in `<godot project>/.playmark/inbox/<id>/`, saved when the player pressed Ctrl+Shift+M mid-game. Fixed marks move to `.playmark/done/`.

| File | What it is |
|---|---|
| `annotated.png` | The frozen frame with each mark numbered: pins are circles, boxes are rectangles. Start here. |
| `clip_sheet.png` | The last seconds before the freeze, up to 12 frames in a grid, oldest top-left. Use it for motion, timing and "it felt wrong" notes. |
| `clip/NNN.png` | Every clip frame. `inbox.mjs video <id>` makes `clip.mp4` if ffmpeg is installed. |
| `screenshot.png` | The clean frame, no marks. |
| `log.txt` | The last lines Godot printed, warnings and errors included. |
| `mark.json` | Everything else (below). |

`mark.json` fields that matter:
- `note`, `category` (bug, feel, art, balance, idea, or empty), `marks[]` (number, type, x/y/w/h in screenshot pixels, `norm` 0..1).
- `scene.path`, `project.version`, `engine`, `fps`, `time_scale` (below 1 means slow-mo or hit-stop was active).
- `under_marks[]`: per mark number, the nodes under it: `physics` (colliders hit), `nodes` (Node2D near a pin or inside a box, scripted first), `ui` (Controls under it). Each has `path` (relative to the current scene), `class`, `script`. This is the fastest route to the code.
- `context`: state the game registered with `Playmark.add_context()`.
- `clip.offsets_s`: each clip frame's time before the freeze.

## How to treat a mark

- The note is the player's words, often short and emotional ("too floaty", "can't read this"). Read the frame and clip to find what they mean before you search code.
- A `feel` or `balance` mark is a design call: propose numbers and say what you'd change, but let the player decide.
- Never edit marks. When something is fixed: `node <plugin>/scripts/inbox.mjs resolve <id> --note "<one line>"`. Marks are the player's; don't resolve one you didn't fix.
- Marks are local and git-ignored by default (`.playmark/.gitignore`). Don't commit them unless asked.

## Commands

`inbox.mjs list [--all] | show <id> | resolve <id> --note "" | reopen <id> | video <id>`. Ids match on a prefix or the last 4 characters.
