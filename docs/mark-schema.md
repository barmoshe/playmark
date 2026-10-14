# The mark format (schema 2)

Playmark's engine side (the Godot addon, the Unity package, the Cocos script, the three.js module) and its agent side (`scripts/`,
`hooks/`, the skill) only meet in this folder. Anything that writes it this way works with
`/playmark:triage`, `inbox.mjs` and the in-game toasts.

```
<project>/.playmark/
  .gitignore            "*": marks stay local
  inbox/<id>/           open marks
  done/<id>/            fixed marks (inbox.mjs resolve moves them here; so does a player's Dismiss)
  requests/<id>.json    runs asked of the Unity Editor (warp, smoke); <id>.result.json answers
```

`<id>` is `YYYYMMDD-HHMMSS-xxxx` (local time, 4 hex digits). A folder is complete once
`mark.json` exists: writers save it last.

## Files in a mark

| File | |
|---|---|
| `mark.json` | everything below |
| `screenshot.png` | the clean frame |
| `annotated.png` | the frame upscaled to at least 960 px wide, pins as orange rings, boxes in blue, numbered from 1 |
| `clip_sheet.png` | up to 12 clip frames, oldest first, 4 to a row (only with a clip) |
| `clip/NNN.png` | every clip frame |
| `log.txt` | the last log lines; errors carry their stack |

## mark.json

| Key | Type | |
|---|---|---|
| `playmark` | string | the version that wrote it |
| `schema` | 2 | absent in older Godot marks |
| `id`, `seq` | string, int | `seq` is the number the player sees (#14) |
| `created_at` | string | local `YYYY-MM-DDTHH:MM:SS` |
| `status` | `new` \| `working` \| `fixed` | the game turns changes into toasts; the agent side (`inbox.mjs`) writes `working` and `fixed`; the player's Dismiss (Cocos) also writes `fixed`, with `dismissed: true` |
| `source` | `player` \| `auto-error` | |
| `category` | `bug` \| `feel` \| `art` \| `balance` \| `idea` \| `""` | |
| `note` | string | the player's words |
| `marks[]` | object | `type` (`pin` \| `box`), `number`, `x`, `y` (`w`, `h` for boxes) in the marked frame's pixels, `color`, `norm` (the same in 0..1), `world` (where it is in the game world: `[x, y]` in Godot 2D, `[x, y, z]` in Unity) |
| `frame_offset_s` | number | 0 for the freeze frame, negative for a rewound one |
| `frozen` | bool | three.js only: false when the game kept running while the player marked; `under_marks` then lists nothing (`skipped`) |
| `scope` | string | the game's room or area, from `set_scope` / `SetScope` |
| `project` | `{name, version}` | |
| `engine` | `{name, version}` | `name` is `godot`, `unity`, `cocos` or `three` (version: `THREE.REVISION`). A bare string in marks before schema 2 means Godot. |
| `os`, `debug_build` | string, bool | Unity adds `editor`, `render_pipeline`, `graphics`; Cocos adds `preview`, `url`, `device_pixel_ratio`; three.js adds `url`, `device_pixel_ratio`, `camera` and has no `debug_build` |
| `scene` | `{path, name}` | `res://...tscn` in Godot, `Assets/...unity` in Unity (`also_loaded` lists additive scenes). Cocos knows only the scene's name at runtime: `path` is that name |
| `window_size`, `viewport_size`, `screenshot_size` | `[w, h]` | |
| `fps`, `time_scale`, `uptime_s`, `mouse` | | `time_scale` before the freeze |
| `under_marks[]` | object | per mark: `mark` (its number), `physics[]`, `nodes[]`, `ui[]`, and `world` when it has a place in the world. Each entry: `path`, `class`, `script` when one is attached, `position`. Unity adds `prefab`, `components`, `script_on`, `other_scripts`, `layer`, `tag`; UI Toolkit entries add `element`, `element_class`, `uss_classes`. |
| `context` | object | the game's registered state |
| `warp` | `{scene, camera, data}` | `data` is what the game's warp save returned; an `args` list in it is passed on the command line |
| `files[]`, `clip` | | `clip` is `{frames, fps, offsets_s[], dir}` |
| `claimed_at` | string | set by `inbox.mjs claim` |
| `resolution` | `{note, at}` | set by `inbox.mjs resolve` |
| `approved` | `{at}` | the player approved the fix in the game (Cocos: a fixed ghost's card); its ghost is hidden |
| `dismissed` | `true` | the player dismissed an open mark in the game (a test, not a problem); it is `fixed` and `approved` with no change made |
| `reopened[]` | `{at, note, resolution}` | the player said a fix did not hold; the mark is back in `inbox/` as `new`, and `resolution` is the fix that did not hold |

## Requests (Unity)

`inbox.mjs warp` and `smoke` write `requests/<id>.json`:

```json
{ "id": "warp-lx2k9", "action": "warp", "mark": "20261011-153012-a3f9", "shot": "/abs/after.png" }
{ "id": "smoke-lx2ka", "action": "smoke", "out": "/abs/.playmark/smoke" }
```

The Editor renames it to `<id>.taken`, enters Play Mode, and the game writes
`<id>.result.json`: `{ "id": "...", "ok": true, "shot": "..." }` or `{ "ok": false, "error": "..." }`.

## Cocos

A game in a browser can't write files, so the Cocos script posts each mark to `scripts/sink.mjs`
(`POST /playmark/marks` with `{data, files, log}`, files base64), which writes the folder above with
the same rules (`mark.json` last) and picks `id` and `seq`. The game reads statuses from
`GET /playmark/status`. In `under_marks`, `ui` holds 2D and UI nodes (anything with a
`UITransform` that draws, takes input or carries a game script), topmost first; `nodes` holds 3D
`MeshRenderer`s, nearest first, with their `distance`. `physics` is empty. `path` is the node path
from the scene root, `class` the drawing component (`cc.Sprite`, `cc.Label`, `cc.MeshRenderer`...),
`script` the first component that isn't `cc.*` (a class name: search for it), plus `components`.
`world` is `[x, y]` on the 2D/UI plane or `[x, y, z]` where the pin's ray hit a 3D bound.

## three.js

The three.js module posts to the same sink. `scene.path` is the scene's `name`, or the page path
when it has none. `camera` is `{name, class}` of the camera it raycasts with. There is no
`time_scale`. In `under_marks`, only `nodes` is filled (`physics` and `ui` stay empty): for a pin,
the objects `THREE.Raycaster` hits from the camera (hidden objects and other layers skipped); for a
box, drawn objects whose bounding-box center projects inside it. Nearest first, up to 10. Each
entry: `path` (object names below the scene, an unnamed object as its type), `class` (`Mesh`,
`Sprite`, `Points`...), `position`, `material` (name, else type; a list for multi-material),
`geometry`, `user_data` (the keys of `userData`), `distance` from the camera, and for pins `world`
(the hit point) and `instance` (an `InstancedMesh` index). `world` on the mark is the nearest hit.
