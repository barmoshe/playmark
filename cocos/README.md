# Playmark for Cocos Creator

**Mark what you see while playing your Cocos Creator game in a browser. Claude Code or Codex fixes it.**

This is the Cocos side of [Playmark](../README.md). It writes the same mark folders as the Godot
addon and the Unity package, so triage works the same in Claude Code and Codex.

> [!NOTE]
> **Beta.** Web only (debug web builds and the editor's browser preview). Checked by hand with
> Cocos Creator 3.8.8 on Windows: see [Tested](#tested).

## Install

Needs Cocos Creator 3.8 or newer and Node 18+.

| Claude Code | Codex |
|---|---|
| `/plugin marketplace add barmoshe/playmark`<br>`/plugin install playmark@playmark`<br>`/playmark:install` | `codex plugin marketplace add barmoshe/playmark`<br>`codex plugin add playmark@playmark`<br>then: "Install Playmark in this game" |

That copies one script into `assets/playmark/playmark.ts` and git-ignores `.playmark/`. Nothing to
add to a scene: the script starts by itself. Without an agent: copy `cocos/playmark/` into your
project's `assets/` by hand.

## Use it

1. **Start the sink** in the project folder and leave it running. A game in a browser can't write
   files; the sink receives each mark and writes `.playmark/`. It listens on 127.0.0.1 only and
   answers pages served from localhost only. Ctrl+C stops it.

   ```bash
   node <playmark>/scripts/sink.mjs            # or: sink.mjs path/to/game --port 7477
   ```

2. **Play** a debug web build (built with Debug on) served from localhost, or the editor's browser
   preview. A toast says "Playmark is on".
3. **Mark**: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> (three fingers at once on a touch screen)
   freezes the game. Click to pin, drag to box, <kbd>1</kbd>-<kbd>5</kbd> for a category,
   <kbd>←</kbd> <kbd>→</kbd> to rewind, type the note, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves.
4. **Triage**: `/playmark:triage` in Claude Code, or ask Codex. When the agent fixes a mark, the
   game shows "Fixed #N" and its ghost turns blue. Rebuild and reload to retest.

A script error becomes a bug mark by itself, with the clip and the log (3 per session at most).
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> shows or hides ghosts.

**Approve a fix.** Tap a blue ghost: its card shows your note and what the agent changed. **Approve**
hides the ghost for good (`approved` in mark.json). **Still broken** sends the mark back to the inbox
as new, keeping the fix that did not hold in `reopened[]` so the agent sees it. Fixed ghosts you
don't judge fade out after 72 hours (`ghostsFixedHours`). An open mark's card has **Dismiss** (a test, or not a
problem after all): it goes to done/ as approved, so the agent skips it. Ghosts switched off stay off on that
device across reloads.

## Your game's state, and settings

```ts
import { Playmark } from 'db://assets/playmark/playmark';

Playmark.addContext('player', () => ({ hp, level }));  // on every mark
Playmark.setScope(() => currentScreen);                 // ghosts per screen when one scene has many
Playmark.settings.project = { name: 'Star Dodger', version: '1.2' };
Playmark.settings.clipFps = 0;                          // no clip
```

Other settings: `shortcut`, `ghostsShortcut`, `clipSeconds`, `clipMaxWidth` (480), `autoOnError`,
`logLines`, `ghostsFixedHours`, `sink`. In the page URL, `?playmark=0` turns it off and
`?playmark_sink=http://127.0.0.1:7478` points it at another sink. It starts only on pages served
from localhost, because the sink answers only those.

## What a mark holds

The same files as the other engines (`mark.json`, `screenshot.png`, `annotated.png`,
`clip_sheet.png`, `clip/`, `log.txt`). Cocos specifics are in the [mark format](../docs/mark-schema.md#cocos):
`ui` lists the 2D and UI nodes under each mark, topmost first (path from the scene root, the drawing
component, the first game script); `nodes` lists 3D mesh renderers, nearest first. The log has the
game's console and the engine's own warnings and errors.

## How it works

- `playmark.ts` registers for `Director.EVENT_AFTER_DRAW` when `DEBUG` or `PREVIEW` is true. Right
  after Cocos draws, the drawing buffer still holds the frame, so it can be copied: the clip ring
  (8 fps, 5 s, canvases 480 px wide) and the freeze frame both come from there.
- The overlay is plain DOM over the canvas. While it is open the director is paused, and the
  overlay takes every pointer and key, so the game sees no input.
- One file on purpose: in a release build the start-up code is dead, the minifier drops it, and a
  0.7 KB stub (`Playmark.settings`, `addContext`...) stays. A second module would stay whole.
- Modules removed in Project Settings, Feature Cropping (3D, 2D) are skipped.

## Tested

| | |
|---|---|
| Cocos Creator 3.8.8, web-mobile debug build, Chrome, Windows 11 | Overlay, pin and box, category, note, rewind, save through the sink, `ui` hits a sprite under a pin, clip sheet, ghosts, "Fixed" toast after `inbox.mjs resolve`, automatic error mark |
| Release build of the same project | Playmark does not start; a 0.7 KB stub remains |
| `node cocos/check/typecheck.mjs <project>` | Strict TypeScript at Cocos' ES2015 target |

Not checked yet: 3D scenes (the `nodes` path), the editor's browser preview, Safari and Firefox,
touch (three fingers to open, tap and drag to mark), macOS. A phone over the network can't work
yet: the sink is local only.

## Limits

- Web only. Native builds (Android, iOS, Windows, mini-game runtimes) have no DOM; nothing starts there.
- No `warp` or `smoke`: the agent can't reopen the game at a mark yet.
- `scene.path` is the scene's name; Cocos doesn't keep asset paths at runtime.
- `script` is a class name, not a file path.
- No sounds (the Godot and Unity overlays have them).
- To put the engine's own warnings and errors in the log, Playmark rebinds Cocos' logging through
  an internal function (`_resetDebugSetting`) at the INFO level a debug build starts with. A
  project that set a quieter level gets INFO again while Playmark runs.
- Playmark wraps `console`, so DevTools shows `playmark.ts` as the source of every log line.
- Without the sink running, it asks for it every 20 s (one failed request in the console each time)
  and at every Ctrl+Shift+M.
