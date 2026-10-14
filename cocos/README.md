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
   answers pages served from localhost only (for a phone, see [Test on your phone](#test-on-your-phone)).
   Ctrl+C stops it.

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
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> shows or hides ghosts (on a phone: hold the MARK button).

**Approve a fix.** Tap a blue ghost: its card shows your note and what the agent changed. **Approve**
hides the ghost for good (`approved` in mark.json). **Still broken** sends the mark back to the inbox
as new, keeping the fix that did not hold in `reopened[]` so the agent sees it. Fixed ghosts you
don't judge fade out after 72 hours (`ghostsFixedHours`). An open mark's card has **Dismiss** (a test, or not a
problem after all): it goes to done/ as approved, so the agent skips it. Ghosts switched off stay off on that
device across reloads.

## Test on your phone

Play the game on a phone on the same Wi-Fi and mark it there. The marks land on the PC, in the same
`.playmark/inbox`, and "Fixed #N" shows on the phone.

1. Build the game for web with **Debug** on (`build/web-mobile`).
2. In the project folder:

   ```bash
   node <playmark>/scripts/sink.mjs --lan          # or: --lan --serve path/to/web-build --port 7477
   ```

   It serves the build and prints a URL like `http://192.168.1.20:7477/?pm=Xk3...` and a QR code.
3. Open that URL on the phone (scan the code with the camera). Tap **MARK**, or three fingers at
   once, to freeze the game. Tap to pin, drag to box, type the note, **SAVE MARK**.

**The token.** With `--lan` the sink listens on every network of the PC, so anyone on the Wi-Fi
could reach it. `pm=` is a random token made at each start; the first page turns it into a cookie
for that one sink. Without it the sink refuses everything from another device: the marks, their
status (notes included) and the game files. Requests from the PC itself keep the localhost rules,
so the editor preview still works next to it. Only the PC's own addresses are accepted as a host,
nothing under the build folder that starts with a dot is served (`.playmark/` included), and files
outside it are not reachable through `..` or links. The page removes the token from its address as
soon as it loads, and sends no referrer.

**Use a Wi-Fi you trust.** It is plain HTTP. Anyone who can see the network's traffic (a shared or
public Wi-Fi, a network whose password others know) can take the token and with it read the marks
and their notes, add or dismiss marks, and change what the phone runs. Stop the sink (Ctrl+C) when
you are done; the next start makes a new token.

**Firewall.** If the phone can't load the page, the PC's firewall is blocking Node:
- Windows: the first `--lan` start may ask to allow Node.js. Allow **Private networks** only. If you
  dismissed it: Windows Security, Firewall & network protection, Allow an app through firewall,
  Node.js JavaScript Runtime, tick Private. Check that the Wi-Fi is set to a private network.
- macOS: if the firewall is on, allow incoming connections for `node` when asked (System Settings,
  Network, Firewall, Options).
- Guest Wi-Fi and some office networks keep devices apart; use a home network or a phone hotspot.

Other ways in: the PC's other addresses are printed too (VPN, virtual adapters). `?playmark_sink=`
still points the page at another sink.

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
`?playmark_sink=http://127.0.0.1:7478` points it at another sink on this machine (any other host is ignored). It starts only on pages served
from localhost, or by `sink.mjs --lan`, because the sink answers only those.

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
| `sink.mjs --lan`, 3.8.8 web-mobile debug build, Chrome emulating an iPhone 13 (touch) over the PC's LAN address | MARK button and three-finger tap open the overlay, tap to pin, category, note, save; both marks in the inbox; "Fixed" toast after `inbox.mjs resolve`; requests without the token, `..` paths and `/.playmark/` refused |

Not checked yet: 3D scenes (the `nodes` path), the editor's browser preview, Safari and Firefox,
a real phone (iOS Safari, Android Chrome: the soft keyboard, Safari's own three-finger gestures),
the firewall prompts, macOS.

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
