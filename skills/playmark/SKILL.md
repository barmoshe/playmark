---
name: playmark
description: Read and act on Playmark marks - feedback a player left from inside a running Godot or Unity game (a frozen frame with numbered pins and boxes, a note, a category, the last seconds of play, logs, game state). Use when a prompt mentions Playmark, new marks, playtest feedback from the game, a `.playmark` folder, or /playmark:triage.
---

# Playmark marks

A **mark** is a folder in `<game project>/.playmark/inbox/<id>/`, saved when the player pressed Ctrl+Shift+M mid-game (Godot or Unity: same folder, same files). Fixed marks move to `.playmark/done/`.

| File | What it is |
|---|---|
| `annotated.png` | The frozen frame with each mark numbered: pins are circles, boxes are rectangles. Start here. |
| `clip_sheet.png` | The last seconds before the freeze, up to 12 frames in a grid, oldest top-left. Use it for motion, timing and "it felt wrong" notes. |
| `clip/NNN.png` | Every clip frame. `inbox.mjs video <id>` makes `clip.mp4` if ffmpeg is installed. |
| `screenshot.png` | The clean frame, no marks. |
| `log.txt` | The last lines the game logged (Godot output, Unity Console with stack traces), warnings and errors included. |
| `mark.json` | Everything else (below). |

`mark.json` fields that matter:
- `note`, `category` (bug, feel, art, balance, idea, or empty), `marks[]` (number, type, x/y/w/h in screenshot pixels, `norm` 0..1).
- `scene.path`, `project.version`, `engine` (`{name: godot|unity, version}`; a bare string in older Godot marks), `fps`, `time_scale` (below 1 means slow-mo or hit-stop was active).
- `under_marks[]`: per mark number, what is under it: `physics` (colliders hit), `nodes` (Godot: Node2D near a pin or inside a box; Unity: renderers, scripted first), `ui` (Godot Controls; Unity uGUI graphics and UI Toolkit elements). Each has `path` (Godot: relative to the current scene; Unity: the hierarchy path), `class`, `script`. Unity adds `prefab`, `components`, `script_on` (the parent the script sits on). This is the fastest route to the code.
- `context`: state the game registered with `Playmark.add_context()`.
- `clip.offsets_s`: each clip frame's time before the freeze.

## How to treat a mark

- The note is the player's words, often short and emotional ("too floaty", "can't read this"). Read the frame and clip to find what they mean before you search code.
- A `feel` or `balance` mark is a design call: propose numbers and say what you'd change, but let the player decide.
- Never edit marks. When something is fixed: `node <plugin>/scripts/inbox.mjs resolve <id> --note "<one line>"`. Marks are the player's; don't resolve one you didn't fix.
- Marks are local and git-ignored by default (`.playmark/.gitignore`). Don't commit them unless asked.

## Unity marks

- `script` is the asset path in the Editor (`Assets/Scripts/Enemy.cs`). From a Development Build it is the type's full name: search for the class.
- Fix in C# first. Scenes and prefabs (`.unity`, `.prefab`) are YAML: edit them only when the fix can't live in code, and say so.
- Unity recompiles a changed script when the Editor gets focus. Tell the player to stop and press Play again to retest (a reload mid-play can break the running game).
- `inbox.mjs warp <id> --shot after.png` asks the open Editor to play the mark's scene and save a frame. It waits while a playtest is running and fails on unsaved scene changes: say so rather than retrying.

## Starting from nothing

`/playmark:new <folder>` makes a blank Godot game (Godot only for now) with Playmark already in it and a `CLAUDE.md`
for the loop: build one small step, ask the player to play it and mark what's off, triage the
marks, commit, repeat.

## Commands

`inbox.mjs list [--all] | show <id> | claim <id> | resolve <id> --note "" | reopen <id> | video <id> | warp <id> [--shot png] | smoke`. Ids match on a prefix or the last 4 characters.
