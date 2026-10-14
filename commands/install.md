---
description: "Install Playmark into a Godot 4.5+, Unity 6+, Cocos Creator 3.8+ or three.js project (Godot: copies addons/playmark and enables it; Unity: embeds the package; Cocos: copies assets/playmark; three.js: copies src/playmark/playmark.js). Ignores .playmark/."
argument-hint: "[path to the game project] [--git]"
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install.mjs" $ARGUMENTS` from the user's project, then
follow the **Install** section of the `playmark` skill to tell the user, briefly, how to make the
first mark. Add: next session, Claude mentions new marks, and `/playmark:triage` works through them.
