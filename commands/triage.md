---
description: Work through Playmark marks left while playtesting - read each one, find the code, propose fixes, fix what's approved.
argument-hint: "[mark id | all]"
---

Triage Playmark marks. Follow the `playmark` skill.

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/inbox.mjs" list` (from the project root). If `$ARGUMENTS` names a mark, take only that one.
2. For each mark, run `inbox.mjs show <id>`, then **Read** `annotated.png` and `clip_sheet.png` (and `screenshot.png` if a mark hides detail). Look at the image before the data: the note says what the player felt, the frame says where.
3. Locate the code: the scene path, the scripts of the nodes under each mark, the game context, then errors in the log.
4. Reply with one numbered list, one item per mark: what the player saw (one line), the cause you found (file:line) or your best lead, and the fix you propose. Group marks that share a cause. Say which ones are taste calls the player should decide.
5. Stop there and wait. Edit nothing until the player answers which marks to fix (and how, for taste calls). Then run `inbox.mjs claim <id>` (the game shows "On #N now"), fix it, and run the project's tests.
6. Close each fixed mark: `inbox.mjs resolve <id> --note "<what changed, one line>"`. Leave unfixed marks in the inbox.
