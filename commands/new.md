---
description: Start a blank Godot game with Playmark wired in, then build it with the play, mark, fix loop.
argument-hint: "<folder> [--name \"Game Name\"]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/new.mjs" $ARGUMENTS`.

It creates a Godot 4.5+ project with one playable scene (a square that moves in an empty
room), installs Playmark, writes a `CLAUDE.md` for the game, and makes the first commit.

Then tell the user, briefly:
- Open the folder in Godot (or `godot --path <folder>`) and play. Ctrl+Shift+M marks anything.
- Say what game to build. Work in small steps; after each one, ask them to playtest and mark.
- `/playmark:triage` works through the marks.

If the folder exists and isn't empty, say so and ask for another one.
