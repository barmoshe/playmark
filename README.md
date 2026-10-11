<div align="center">

<img src="docs/icon.png" width="88" alt="Playmark icon: an orange marker on a stem">

# Playmark

**Mark what you see while playing your Godot game. Claude Code fixes it.**

[![ci](https://github.com/barmoshe/playmark/actions/workflows/ci.yml/badge.svg)](https://github.com/barmoshe/playmark/actions/workflows/ci.yml)
![Godot 4.5+](https://img.shields.io/badge/Godot-4.5%2B-478cbf)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-f2621b)
[![MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

[Watch](#watch-it-work) · [Quick start](#quick-start) · [A real example](#a-real-example-redesigning-an-enemy) · [What Claude gets](#what-a-mark-contains) · [Changelog](CHANGELOG.md)

<br>

<img src="docs/loop-color.gif" width="760" alt="Playmark in a toy Godot scene: the game freezes, a pin lands on the teal square, the note 'Boxy should be orange' is saved with a stamp; back in the game the square turns orange and a toast says Fixed #1">

</div>

<br>

Playtesting your own game, you notice small things you'd rather not stop and write up.
Playmark is a Godot addon plus a Claude Code plugin for exactly that moment. Press
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>: the game freezes, you pin what you mean and write one
line. Claude Code gets the frame, the last five seconds, the log and the code under your pin,
and fixes it. Back in the game, a toast says "Fixed" and a marker stays where you left the note.

## Watch it work

Three short films, narrated and captioned. Click a frame to play it; each also comes in Hebrew. A 45 s [montage across all three games](film/showcase/videos/playmark-montage-en.mp4) (English) is good for sharing.

<table>
<tr>
<td align="center" width="33%"><a href="film/showcase/videos/playmark-color-en.mp4"><img src="docs/video-color.jpg" width="300" alt="Video: a pin on the teal square Boxy with the note 'Boxy should be orange' in the Playmark overlay"></a><br><b>The loop in 16 s</b><br><sub>Mark a shape, Claude fixes it, retest.<br><a href="film/showcase/videos/playmark-color-en.mp4">English</a> · <a href="film/showcase/videos/playmark-color-he.mp4">עברית</a></sub></td>
<td align="center" width="33%"><a href="film/showcase/videos/playmark-thornback-en.mp4"><img src="docs/video-thornback.jpg" width="300" alt="Video: a box drawn around the Thornback enemy in Wandcraft with the note to redesign it as a charging ram"></a><br><b>Redesigning an enemy, 23 s</b><br><sub>The Thornback from Wandcraft, one mark.<br><a href="film/showcase/videos/playmark-thornback-en.mp4">English</a> · <a href="film/showcase/videos/playmark-thornback-he.mp4">עברית</a></sub></td>
<td align="center" width="33%"><a href="film/showcase/videos/playmark-star-dodger-en.mp4"><img src="docs/video-star-dodger.jpg" width="300" alt="Video: Star Dodger, a small space game with a ship dodging asteroids, with a Playmark ghost marker on screen"></a><br><b>A game built by marking, 55 s</b><br><sub>Star Dodger: blank project, four marks.<br><a href="film/showcase/videos/playmark-star-dodger-en.mp4">English</a> · <a href="film/showcase/videos/playmark-star-dodger-he.mp4">עברית</a></sub></td>
</tr>
</table>

## How it works

```mermaid
flowchart LR
  A["Play 🎮"] -->|"Ctrl+Shift+M"| B["Mark 📍<br/>pin · box · note"]
  B -->|".playmark/inbox"| C["Claude Code 🤖<br/>/playmark:triage"]
  C -->|"fix + resolve"| D["In game ✅<br/>Fixed #N · ghost marker"]
  D --> A
```

<table>
<tr>
<td width="25%" valign="top"><b>1. Play</b><br>Run your game from Godot. Playmark keeps the last five seconds.</td>
<td width="25%" valign="top"><b>2. Mark</b><br><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> freezes the frame. Click to pin, drag to box, <kbd>1</kbd>-<kbd>5</kbd> for a category, type the note.</td>
<td width="25%" valign="top"><b>3. Claude fixes</b><br>Your next prompt mentions the mark. <code>/playmark:triage</code> finds the code under the pin and proposes a fix. You pick.</td>
<td width="25%" valign="top"><b>4. Retest</b><br>The game shows "Fixed #N" with what changed. The marker stays where you made it.</td>
</tr>
</table>

## A real example: redesigning an enemy

[Wandcraft](https://github.com/barmoshe/wandcraft) is a pixel-art roguelite. Its Thornback,
an enemy that charges at you, looked like a loaf of bread. One mark, mid-fight:

<p align="center">
  <img src="docs/thornback-mark.png" width="820" alt="The Playmark overlay over a Wandcraft fight: a blue box around the Thornback, the ART stamp, and the note 'Redesign the Thornback: make it look like a charging ram, with curled horns, thorns along its back and a glowing eye.'">
</p>

> **Redesign the Thornback: make it look like a charging ram, with curled horns, thorns along its back and a glowing eye.**

The box told Claude which node it was (`enemy.gd`, kind `ram`), the art lives as 16 rows of
pixel data in `bestiary.gd`, and the game's palette rules came with the project. The redraw:

<p align="center">
  <img src="docs/thornback-before-after.png" width="820" alt="Before: a flat brown loaf with three green leaves. After: a hunched brown beast with pale spikes along its back, a curled horn, a glowing orange eye and a wool chest.">
</p>

<p align="center">
  <img src="docs/thornback-flow.gif" width="760" alt="The same fight replayed after the fix: the new Thornback charges in, a toast reads Fixed #1, and a marker floats where the mark was made">
</p>

## Small changes, same flow

<table>
<tr>
<td align="center" width="33%"><img src="docs/change-color.gif" width="260" alt="Pin on the teal square, note 'Boxy should be orange', then the square turns orange"><br><sub><b>Color</b><br>"Boxy should be orange."</sub></td>
<td align="center" width="33%"><img src="docs/change-shape.gif" width="260" alt="Pin on the pink triangle, note 'Redesign Pointy: make it a five-point star.', then the triangle becomes a star"><br><sub><b>Shape</b><br>"Redesign Pointy: make it a five-point star."</sub></td>
<td align="center" width="33%"><img src="docs/change-motion.gif" width="260" alt="Pin on the blue hexagon, note 'Make Nutty hop instead of spinning.', then the hexagon hops"><br><sub><b>Motion</b><br>"Make Nutty hop instead of spinning."</sub></td>
</tr>
</table>

Each was one line in the toy scene's `look.gd`. The toy is in [`demo/`](demo).

## What it does

| | |
|---|---|
| **Photo mode for feedback** | A native window over the game, sharp at any game resolution, pixel art included. |
| **Rewind** | The last five seconds are kept. Press <kbd>←</kbd> and mark the frame where it happened. |
| **The code under your pin** | Each mark lists the colliders, nodes, scripts and UI controls under every pin and box. |
| **Ghosts** | Past marks reappear in the world where you made them. Orange is open, blue is fixed. |
| **Errors mark themselves** | A script error becomes a bug mark with the clip and the log. |
| **Warp back** | `inbox.mjs warp 3` opens the game at mark #3; `--shot` saves a frame so Claude can check its fix. |
| **Your game's state** | One line adds the player, the level or the loadout to every mark. |
| **Dev builds only** | Nothing runs in a release export unless you turn it on. |

## Quick start

Needs Godot 4.5+, Claude Code and Node 18+. In Claude Code:

```
/plugin marketplace add barmoshe/playmark
/plugin install playmark@playmark
```

Then, from your game's repo:

```
/playmark:install
```

That copies `addons/playmark` into the project, enables it and git-ignores `.playmark/`.
Run the game from Godot and press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>. Update later with
`claude plugin update playmark`.

### Or start a new game with it

```
/playmark:new star-dodger --name "Star Dodger"
```

A blank Godot project with Playmark already wired in: one playable scene (a square you move in
an empty room), a `CLAUDE.md` that teaches the build, playtest, mark, fix loop, and a first
commit. Say what game to build, play each step, mark what's off.

[Star Dodger](https://github.com/barmoshe/star-dodger) was built this way: a blank project, step 1,
then four marks while playing, one commit each. Watch it on
[playmark.bar-builds.com](https://playmark.bar-builds.com/#new) (55 s, with sound).

<details>
<summary>Without Claude Code</summary>

<br>

Copy `addons/playmark` into your project and enable **Playmark** in Project Settings, Plugins.
Marks still land in `.playmark/inbox/`, readable by any tool or person.

</details>

## What a mark contains

`<project>/.playmark/inbox/<id>/`, moved to `done/` once fixed. Git-ignored by default.

| File | |
|---|---|
| `annotated.png` | the frame with numbered pins and boxes |
| `clip_sheet.png` | up to 12 frames from the last seconds, oldest first |
| `clip/` | every clip frame (`inbox.mjs video <id>` makes an mp4) |
| `screenshot.png` | the clean frame |
| `log.txt` | the last lines Godot printed, warnings and errors included |
| `mark.json` | note, category, marks, scene, the nodes under each mark, your context, warp data |

<details>
<summary>mark.json from the Thornback mark (trimmed)</summary>

<br>

```json
{
  "seq": 1,
  "category": "art",
  "note": "Redesign the Thornback: make it look like a charging ram, with curled horns, thorns along its back and a glowing eye.",
  "marks": [{ "type": "box", "number": 1 }],
  "scene": { "path": "res://scenes/main.tscn" },
  "scope": "fight/s_thorns",
  "under_marks": [{ "mark": 1, "nodes": [{ "class": "Node2D", "script": "res://scripts/world/enemy.gd" }] }],
  "context": { "run": { "seed": 3, "step": 1, "room": "fight/s_thorns", "hp": "100/100" } },
  "warp": { "data": { "args": ["--seed=3", "--step=1", "--kind=fight", "--room=s_thorns"] } }
}
```

</details>

## Using it in a game

All optional. Without any of it, marks still carry the frame, the clip, the log and the nodes under each mark.

```gdscript
# State saved with every mark.
Playmark.add_context("player", func(): return {"hp": hp, "wand": wand.describe()})

# Ghosts open their note when the player walks up to them (the mouse otherwise).
Playmark.set_player($Player)

# Many rooms in one scene: keep each ghost in its room.
Playmark.set_scope(func(): return "room/%s" % room_id)

# Warp: what to save with a mark, and how to put the game back there.
Playmark.set_warp(
    func(): return {"args": ["--level=%d" % level], "player": [position.x, position.y]},
    func(d): position = Vector2(d.player[0], d.player[1]))

# Open the overlay from a debug button.
Playmark.open()
```

<details>
<summary>Keys</summary>

<br>

| Key | Where | Does |
|---|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | game | open the overlay |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | game | show or hide ghosts |
| click / drag / right-click | overlay | pin / box / undo |
| <kbd>1</kbd>-<kbd>5</kbd> | overlay | bug, feel, art, balance, idea |
| <kbd>←</kbd> <kbd>→</kbd> | overlay | rewind |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> | overlay | save |
| <kbd>Esc</kbd> | overlay | cancel |

</details>

<details>
<summary>Settings</summary>

<br>

Project Settings, under `playmark/`:

| Setting | Default | |
|---|---|---|
| `general/enabled` | `true` | |
| `general/shortcut` | `Ctrl+Shift+M` | modifiers: Ctrl, Shift, Alt, Cmd |
| `general/release_builds` | `false` | also run in release exports |
| `capture/clip_seconds` | `5.0` | |
| `capture/clip_fps` | `8` | `0` turns the clip off |
| `capture/clip_max_width` | `640` | clip frames are scaled down to this |
| `capture/log_lines` | `200` | |
| `capture/auto_on_error` | `true` | script errors become bug marks |
| `ghosts/visible` | `true` | |
| `ghosts/shortcut` | `Ctrl+Shift+G` | |
| `ghosts/fixed_hours` | `72` | how long fixed marks stay visible; `-1` forever |
| `output/dir` | `res://.playmark` | exported builds use `user://playmark` |

</details>

## Platforms

Desktop. Tested on macOS with Godot 4.6 and 4.7; CI checks 4.5 and 4.7 on Linux. Windows
should work and is untested so far. iOS, Android and the web export print "coming soon" and
stay off for now.

## Development

```bash
node --test tests/*.test.mjs                                  # the Claude Code side
godot --headless --path demo --script "$PWD/tests/unit.gd"    # the addon, no window
tests/run_selftest.sh                                         # the whole loop, in a window
```

`demo/` holds the toy scene (four shapes, one table of looks) and the arena the selftest uses.
`film/capture.gd` drives the game under Godot's movie writer; every GIF here was recorded with it.
`film/showcase/` holds the scripts that record the three showcase videos, their edit lists (English and
Hebrew, rendered by `film/cut`) and the finished videos.

## License

MIT, by Bar Moshe. Heebo and Cascadia Mono, bundled in `addons/playmark/fonts/`, are under
the SIL Open Font License (`OFL.txt` there).

## Website

The site (EN + `/he`) lives in [`site/`](site/): plain HTML, no build step. Vercel serves it with the project's root directory set to `site`; `.github/workflows/site.yml` checks it on every change.
