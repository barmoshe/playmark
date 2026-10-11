# The mark format (schema 2)

Playmark's engine side (the Godot addon, the Unity package) and its agent side (`scripts/`,
`hooks/`, the skill) only meet in this folder. Anything that writes it this way works with
`/playmark:triage`, `inbox.mjs` and the in-game toasts.

```
<project>/.playmark/
  .gitignore            "*": marks stay local
  inbox/<id>/           open marks
  done/<id>/            fixed marks (inbox.mjs resolve moves them here)
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
| `status` | `new` \| `working` \| `fixed` | the game turns changes into toasts; only the agent side (`inbox.mjs`) writes `working` and `fixed` |
| `source` | `player` \| `auto-error` | |
| `category` | `bug` \| `feel` \| `art` \| `balance` \| `idea` \| `""` | |
| `note` | string | the player's words |
| `marks[]` | object | `type` (`pin` \| `box`), `number`, `x`, `y` (`w`, `h` for boxes) in the marked frame's pixels, `color`, `norm` (the same in 0..1), `world` (where it is in the game world: `[x, y]` in Godot 2D, `[x, y, z]` in Unity) |
| `frame_offset_s` | number | 0 for the freeze frame, negative for a rewound one |
| `scope` | string | the game's room or area, from `set_scope` / `SetScope` |
| `project` | `{name, version}` | |
| `engine` | `{name, version}` | `name` is `godot` or `unity`. A bare string in marks before schema 2 means Godot. |
| `os`, `debug_build` | string, bool | Unity adds `editor`, `render_pipeline`, `graphics` |
| `scene` | `{path, name}` | `res://...tscn` in Godot, `Assets/...unity` in Unity (`also_loaded` lists additive scenes) |
| `window_size`, `viewport_size`, `screenshot_size` | `[w, h]` | |
| `fps`, `time_scale`, `uptime_s`, `mouse` | | `time_scale` before the freeze |
| `under_marks[]` | object | per mark: `mark` (its number), `physics[]`, `nodes[]`, `ui[]`, and `world` when it has a place in the world. Each entry: `path`, `class`, `script` when one is attached, `position`. Unity adds `prefab`, `components`, `script_on`, `other_scripts`, `layer`, `tag`; UI Toolkit entries add `element`, `element_class`, `uss_classes`. |
| `context` | object | the game's registered state |
| `warp` | `{scene, camera, data}` | `data` is what the game's warp save returned; an `args` list in it is passed on the command line |
| `files[]`, `clip` | | `clip` is `{frames, fps, offsets_s[], dir}` |
| `claimed_at` | string | set by `inbox.mjs claim` |
| `resolution` | `{note, at}` | set by `inbox.mjs resolve` |

## Requests (Unity)

`inbox.mjs warp` and `smoke` write `requests/<id>.json`:

```json
{ "id": "warp-lx2k9", "action": "warp", "mark": "20261011-153012-a3f9", "shot": "/abs/after.png" }
{ "id": "smoke-lx2ka", "action": "smoke", "out": "/abs/.playmark/smoke" }
```

The Editor renames it to `<id>.taken`, enters Play Mode, and the game writes
`<id>.result.json`: `{ "id": "...", "ok": true, "shot": "..." }` or `{ "ok": false, "error": "..." }`.
