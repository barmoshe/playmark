---
description: Install the Playmark addon into a Godot 4.5+ project (copies addons/playmark, enables it, ignores .playmark/).
argument-hint: "[path to the Godot project]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" $ARGUMENTS` from the user's project (default: the current folder, or a project one level down).

Then tell the user, briefly:
- Run the game from Godot (or `godot --path <project>`) and press **Ctrl+Shift+M** to mark.
- Optional: register game state that should ride along with every mark, e.g. in the player script:
  `Playmark.add_context("player", func(): return {"hp": hp, "wand": wand.describe()})`
- Marks land in `<project>/.playmark/inbox/`. Next session, Claude mentions new marks; `/playmark:triage` works through them.

If `project.godot` declares a Godot version older than 4.5, say Playmark needs 4.5+ (it uses the Logger API) and stop.
