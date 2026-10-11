---
description: Install Playmark into a Godot 4.5+ or Unity 6+ project (Godot: copies addons/playmark and enables it; Unity: embeds the package). Ignores .playmark/.
argument-hint: "[path to the game project] [--git]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" $ARGUMENTS` from the user's project (default: the current folder, or a project one level down). It finds `project.godot` (Godot) or `ProjectSettings/ProjectVersion.txt` (Unity).

Then tell the user, briefly:
- **Godot:** run the game from Godot (or `godot --path <project>`) and press **Ctrl+Shift+M** to mark.
- **Unity:** switch to Unity so it imports the package, press Play, then **Ctrl+Shift+M**. Optional: Package Manager, Playmark, Samples, import **Toy scene**, then Tools, Playmark, Create Toy Scene, to try the loop on four shapes. `node "${CLAUDE_PLUGIN_ROOT}/scripts/inbox.mjs" smoke` checks the install by itself (it plays 6 s, marks, saves, stops).
- Optional: register game state that should ride along with every mark, e.g.
  Godot `Playmark.add_context("player", func(): return {"hp": hp})`,
  Unity `Playmark.AddContext("player", () => new { hp });`
- Marks land in `<project>/.playmark/inbox/`. Next session, Claude mentions new marks; `/playmark:triage` works through them.

If `project.godot` declares a Godot version older than 4.5, say Playmark needs 4.5+ (it uses the Logger API) and stop. The installer itself refuses Unity before 6000.0.

`--git` (Unity) adds the package to `Packages/manifest.json` as a git URL pinned to this plugin's release tag instead of embedding it.
