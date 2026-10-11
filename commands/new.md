---
description: Start a blank Godot game with Playmark wired in, then build it with the play, mark, fix loop.
argument-hint: "<folder> [--name \"Game Name\"]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/new.mjs" $ARGUMENTS`, then follow the **Start a new game**
section of the `playmark` skill. Tell the user, briefly: open the folder in Godot (or
`godot --path <folder>`) and play, Ctrl+Shift+M marks anything, say what game to build, and
`/playmark:triage` works through the marks.
