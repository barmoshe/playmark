# Playmark for three.js

**Mark what you see while playing your three.js game in a browser. Claude Code or Codex fixes it.**

This is the three.js side of [Playmark](../README.md). It writes the same mark folders as the
other engines, so triage works the same in Claude Code and Codex.

> [!NOTE]
> **Beta.** `WebGLRenderer` only. Checked with three r170 in Chromium on Windows: see [Tested](#tested).

## Install

Needs a three.js project with a `package.json` that lists `three`, and Node 18+.
`/playmark:install` (or "Install Playmark in this game" in Codex) copies one file,
`playmark.js`, to `src/playmark/` (or `playmark/` when there is no `src/`), and git-ignores
`.playmark/`. Without an agent: copy [`playmark.js`](playmark.js) into your project by hand.

Then hand it your renderer, scene and camera, in development only:

```js
if (import.meta.env?.DEV ?? true) {   // Vite's dev flag; true on a plain page with an import map
  const { Playmark } = await import('./playmark/playmark.js');
  Playmark.attach({ renderer, scene, camera });
}
renderer.setAnimationLoop(animate);   // after attach, so the overlay can stop the loop
```

It imports `three` by its bare name, which resolves the same way under an import map and under a
bundler, so Playmark uses your copy of three. It has no other dependency and no build step.

## Use it

1. **Start the sink** in the project folder and leave it running. A game in a browser can't write
   files; the sink receives each mark and writes `.playmark/`. It listens on 127.0.0.1 only and
   answers pages served from localhost only. Ctrl+C stops it.

   ```bash
   node <playmark>/scripts/sink.mjs            # or: sink.mjs path/to/game --port 7477
   ```

2. **Play** the game from your dev server on localhost. A toast says "Playmark is on".
3. **Mark**: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> (three fingers at once on a touch screen)
   freezes the frame. Click to pin, drag to box, <kbd>1</kbd>-<kbd>5</kbd> for a category,
   <kbd>←</kbd> <kbd>→</kbd> to rewind, type the note, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves.
4. **Triage**: `/playmark:triage` in Claude Code, or ask Codex. When the agent fixes a mark, the
   game shows "Fixed #N" and its ghost turns blue. Reload to retest.

A script error becomes a bug mark by itself, with the clip and the log (3 per session at most).
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> shows or hides ghosts.

## Freezing the game

three.js has no global pause, so Playmark freezes what it can:

- `Playmark.attach({ ..., onPause, onResume })`: your functions, called when the overlay opens and
  closes. Use these if your game has a pause.
- Otherwise, a loop started with `renderer.setAnimationLoop` **after** `attach` is stopped while
  the overlay is open. Your game then sees one long frame on resume: clamp your delta time.
- Otherwise (your own `requestAnimationFrame` loop, or `setAnimationLoop` called before `attach`)
  the game keeps running behind the overlay, and the overlay says `GAME STILL RUNNING`. The frame
  you mark is still the one you froze, but the scene has moved on by the time you save, so the
  mark lists nothing under the pin (`"skipped"`) rather than the wrong objects, and says
  `"frozen": false`. Pass `onPause`/`onResume` to get the objects back.

The overlay takes every click and key while it is open (keyups still reach the game, so a key
held when it opened is let go), and leaves pointer lock.

## Your game's state, and settings

```js
Playmark.addContext('player', () => ({ hp, level }));  // on every mark
Playmark.setScope(() => currentLevel);                  // ghosts per level
Playmark.attach({ renderer, scene, camera: newCamera }); // again when the game switches camera
Playmark.detach();                                        // stop, and give the renderer back (a remount calls attach again)
Playmark.settings.project = { name: 'Star Dodger', version: '1.2' };
Playmark.settings.clipFps = 0;                          // no clip
```

Other settings: `shortcut`, `ghostsShortcut`, `clipSeconds`, `clipMaxWidth` (480), `autoOnError`,
`logLines`, `ghostsFixedHours`, `sink`. In the page URL, `?playmark=0` turns it off and
`?playmark_sink=http://127.0.0.1:7478` points it at another sink. It starts only on pages served
from localhost; `attach({ ..., anyHost: true })` starts it anywhere, but the sink still refuses
pages that aren't on localhost.

## What a mark holds

The same files as the other engines (`mark.json`, `screenshot.png`, `annotated.png`,
`clip_sheet.png`, `clip/`, `log.txt`). three.js specifics are in the
[mark format](../docs/mark-schema.md#threejs): `nodes` lists the objects under each pin (a ray from
the camera) or inside each box (the center of their bounds), nearest first, with their path of
names, type, material and geometry names, `userData` keys, distance and hit point.

## How it works

- `attach` wraps `renderer.render`. After a render to the screen it copies the canvas in a
  microtask: after every `render()` call of that frame (a HUD scene, post-processing) and before the
  browser shows it and clears the drawing buffer. `preserveDrawingBuffer` is not needed.
- A game that renders only when something changes: if nothing renders within 250 ms of the
  shortcut, Playmark renders `scene` with `camera` once itself (without your post-processing).
- Pins are raycast with `THREE.Raycaster` against `scene`, with the camera's layers; hidden objects
  are skipped. Boxes list drawn objects whose bounding-box center projects inside the box.

## Tested

| | |
|---|---|
| three r170 (npm), `WebGLRenderer`, headless Chromium 151 (Playwright, ANGLE D3D11), Windows 11 | [`demo/`](demo): overlay opens on a non-black frame that includes a second HUD render; the loop stops while it is open and resumes after; pin on a named mesh and box around another listed in `under_marks` (`inbox.mjs show`); category and note; clip sheet; save through the sink; ghost; "Fixed" toast after `inbox.mjs resolve`; the 250 ms on-demand render when no loop runs |
| `node --test tests/` | install, project detection, reading three.js marks |

Not checked yet: a real game, bundlers (Vite, webpack), `onPause`/`onResume`, post-processing
(EffectComposer), `InstancedMesh`, skinned meshes, Firefox, Safari, macOS, touch, the automatic
error mark, `WebGPURenderer`.

To run the demo: `npm install` in `three/demo`, serve `three/` on localhost, start the sink in
`three/demo`, open `demo/index.html?playmark_sink=http://127.0.0.1:7477`.

## Limits

- `WebGLRenderer`. `WebGPURenderer` isn't supported yet.
- The screenshot is the WebGL canvas only: an HTML or CSS HUD over it isn't in the frame.
- One renderer, one scene, one camera per `attach`. Split screens and viewports: pins are
  raycast through the whole canvas.
- `ui` and `physics` stay empty: three.js has neither.
- No `warp` or `smoke`: the agent can't reopen the game at a mark yet.
- Import it in development only. Imported in production, it stays inert off localhost but still
  ships in your bundle.
- No sounds (the Godot and Unity overlays have them).
- Playmark wraps `console`, so DevTools shows `playmark.js` as the source of every log line.
- Without the sink running, it asks for it every 20 s (one failed request in the console each time)
  and at every Ctrl+Shift+M.
