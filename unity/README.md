<div align="center">

# Playmark for Unity

**Mark what you see while playing your Unity game. Claude Code or Codex fixes it.**

![Unity 6+ beta](https://img.shields.io/badge/Unity-6%2B%20beta-222222)
![Built-in · URP](https://img.shields.io/badge/pipelines-Built--in%20·%20URP-478cbf)

[Install](#install) · [See it](#see-it) · [Tested](#tested) · [Known issues](https://github.com/barmoshe/playmark/issues) · [Playmark](../README.md)

<br>

<img src="../docs/unity/overlay-note.png" width="760" alt="The Playmark overlay in Unity over the toy scene: four shapes frozen, a numbered pin, the ART category picked and the note 'input system only' typed, with a Save Mark button">

</div>

<br>

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> in Play Mode: the game freezes, you pin or box
what you mean and write one line. Your agent gets the frame, the last five seconds, the Console log
and the scripts and prefabs under your pin. When it fixes the mark, a toast says so in the game and
a marker stays where you left the note.

This is the Unity side of [Playmark](../README.md). It writes the same mark folders as the Godot
addon, so triage works the same in Claude Code and Codex.

> [!NOTE]
> **Beta.** Checked by hand in Unity 6000.3 LTS on a Mac: see [Tested](#tested). Godot is the main
> addon; the Unity package gets fixes as people use it. Open items are
> [GitHub issues](https://github.com/barmoshe/playmark/issues).

## Install

Needs Unity 6 (6000.0) or newer and Node 18+.

| Claude Code | Codex |
|---|---|
| `/plugin marketplace add barmoshe/playmark`<br>`/plugin install playmark@playmark`<br>`/playmark:install` | `codex plugin marketplace add barmoshe/playmark`<br>`codex plugin add playmark@playmark`<br>then: "Install Playmark in this game" |

That copies the package into `Packages/com.bar-builds.playmark` (an embedded package: it lives in
your repo and works offline) and git-ignores `.playmark/`. Switch to Unity so it imports, press
Play, then <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd>.

<details>
<summary>Without an agent, or as a git package</summary>

<br>

Package Manager, **+**, **Add package from git URL**:

```
https://github.com/barmoshe/playmark.git?path=/unity/com.bar-builds.playmark#v0.4.0
```

Use a release tag that includes the `unity/` folder (0.4.0 or later). `/playmark:install --git`
writes the same URL into `Packages/manifest.json`, pinned to your plugin's version. Marks land in
`.playmark/inbox/`; `node playmark/scripts/inbox.mjs export` turns them into one page to share
([more](../README.md#no-agent-mark-export-share)).

</details>

### Try it on the toy scene

Package Manager, Playmark, **Samples**, import **Toy scene**, then **Tools, Playmark, Create Toy
Scene**. Press Play, pin Boxy, write "Boxy should be orange", save. Ask your agent to triage: the
fix is one line in `ToyLooks.cs`. Stop and play again to see it.

## See it

All taken in Unity 6000.3 on a Mac, on the toy scene.

<table>
<tr>
<td align="center" width="50%"><img src="../docs/unity/smoke-overlay.png" width="380" alt="The overlay with a numbered pin between the square and the triangle, a blue box over the circle, the BUG category and a note"><br><sub><b>Mark</b>: pin, box, category, note</sub></td>
<td align="center" width="50%"><img src="../docs/unity/overlay-rewind.png" width="380" alt="The overlay rewound 1.56 seconds, the timeline strip showing an earlier frame selected"><br><sub><b>Rewind</b>: <kbd>←</kbd> <kbd>→</kbd> through the last seconds</sub></td>
</tr>
<tr>
<td align="center"><img src="../docs/unity/fixed-replay.png" width="380" alt="Back in the game after the fix: the square is now orange and a blue fixed marker floats above it"><br><sub><b>Fixed</b>: Boxy is orange after a one-line fix</sub></td>
<td align="center"><img src="../docs/unity/ghosts-toast.png" width="380" alt="Ghost markers 4, 5 and 6 floating in the scene and a toast reading Ghosts on, 4 marks in this scene, CTRL+SHIFT+J to toggle"><br><sub><b>Ghosts</b>: past marks where you made them</sub></td>
</tr>
</table>

<details>
<summary>The clip Claude Code or Codex reads (<code>clip_sheet.png</code>)</summary>

<br>

<img src="../docs/unity/clip-sheet-linear.png" width="760" alt="A grid of twelve frames from the last seconds before the mark, oldest top-left, the shapes moving slightly between frames">

</details>

## What it does

| | |
|---|---|
| **Freeze and mark** | `Time.timeScale = 0` and paused audio while the overlay is open. Click to pin, drag to box, right-click to undo, <kbd>1</kbd>-<kbd>5</kbd> for a category, type the note. |
| **Rewind** | The last five seconds are kept on the GPU. <kbd>←</kbd> <kbd>→</kbd> picks the frame where it happened. |
| **The code under your pin** | Each mark lists the colliders (2D and 3D), renderers and UI (uGUI and UI Toolkit) under every pin and box, with the script asset (`Assets/Scripts/Enemy.cs`) and the prefab they come from. |
| **Ghosts** | Past marks reappear in the world, in 2D and 3D. Orange is open, blue is fixed. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> toggles them (not G as in Godot: Unity's Ctrl/Cmd+Shift+G is Create Empty Parent, and menu shortcuts fire in Play Mode). |
| **Errors mark themselves** | The first error or exception of each kind becomes a bug mark with the clip and the log (3 per session). |
| **Warp back** | `inbox.mjs warp 3` asks the open Editor to open mark #3's scene and enter Play Mode; `--shot after.png` saves a frame and stops, so the agent can check its fix. |
| **Your game's state** | One line adds the player, the level or the loadout to every mark. |
| **Nothing to set up** | It starts with Play Mode by itself. Nothing goes in your scenes. Release builds skip it. |

## Using it in a game

All optional. Without any of it, marks still carry the frame, the clip, the log and what's under each mark.

```csharp
using BarBuilds.Playmark;

// State saved with every mark.
Playmark.AddContext("player", () => new { hp, wand = wand.Describe() });

// Ghosts open their note when the player walks up to them (the mouse otherwise).
Playmark.SetPlayer(player.transform);

// Many rooms in one scene: keep each ghost in its room.
Playmark.SetScope(() => "room/" + roomId);

// Warp: what to save with a mark, and how to put the game back there.
Playmark.SetWarp(
    () => new { level, x = player.position.x, y = player.position.y },
    d => LoadLevel((long)d["level"], (double)d["x"], (double)d["y"]));

// Open the overlay from a debug button.
Playmark.Open();

// The old Input Manager can't be paused from outside: skip input while marking.
if (Playmark.IsOpen) return;
```

Or put `IPlaymarkContext` on any MonoBehaviour: its `PlaymarkContext()` result rides along under the
GameObject's name.

## Settings

**Project Settings, Playmark.** The defaults apply until you click **Create settings asset**
(`Assets/Resources/PlaymarkSettings.asset`). Same keys as the Godot addon: shortcut, release
builds, clip seconds, fps and width, log lines, errors as marks, ghosts and their shortcut, how long
fixed ghosts stay, the output folder. **Run Smoke Test** on the same page plays 6 s, marks, saves
and stops: a quick check that Playmark works in your project.

## How it fits Unity

- **Play Mode is the playtest.** Playmark boots with `RuntimeInitializeOnLoadMethod` and keeps one
  hidden object. It works with domain reload on or off.
- **The overlay is IMGUI.** It needs no EventSystem, no theme asset and nothing in your scenes, and
  it reads keys and the mouse the same way under either input system. While it's open, your
  EventSystem is switched off and, with the Input System, every enabled action is disabled, so a
  click on the overlay never reaches the game.
- **Script paths come from the Editor.** In Play Mode a mark names `Assets/.../Enemy.cs` and the
  prefab. A Development Build has no asset paths, so marks there name the type instead.
- **The fix arrives mid-play.** Editing a `.cs` file makes Unity recompile, and with the default
  "Recompile And Continue Playing" many games break after the reload. The "Fixed" toast says to
  replay: stop and press Play again.
- **Warp goes through the Editor.** Command-line Unity can't open a project the Editor already has
  open, so `inbox.mjs` drops a request in `.playmark/requests/`. The package's Editor script opens
  the mark's scene and enters Play Mode. It waits while you're playing, and refuses when the open
  scene has unsaved changes. It imports the agent's edits first, refuses when scripts don't compile,
  and lets that one Play session run in the background (Play Mode otherwise pauses when Unity
  isn't the front window). If a Development Build is your playtest, set `$PLAYMARK_UNITY_PLAYER`
  to it and warp runs the build with `-playmark-dir=<.playmark> -playmark-warp=<id>` (plus any `args`
  your warp data saved) instead. A request nobody picks up within 10 minutes expires, so opening
  Unity later never replays an old run.

## Tested

Unity 6000.3.26f1 on a MacBook Pro (Intel, Metal), the toy scene, October 2026.

| | Result |
|---|---|
| Compile, package and sample | ✅ no errors or warnings |
| Overlay: pin, box, typing, categories, rewind, save | ✅ |
| Snapshot: the script file and objects under a pin | ✅ |
| Freeze frame and clip: colors, orientation | ✅ Built-in, Gamma and Linear; URP freeze frame |
| Fix mid-play, the Fixed toast, replay | ✅ |
| Ghosts and their toggle | ✅ |
| `inbox.mjs smoke` and `warp --shot` | ✅ smoke on Built-in and URP, warp on Built-in |
| Old Input Manager, Input System, "Both" | ✅ |
| Overlay colors in Linear-color projects (every URP project) | ❌ drawn washed out; saved images are right ([#2](https://github.com/barmoshe/playmark/issues/2)) |
| <kbd>⌘</kbd>+<kbd>Enter</kbd> to save on a Mac | ❓ <kbd>Ctrl</kbd>+<kbd>Enter</kbd> works ([#3](https://github.com/barmoshe/playmark/issues/3)) |
| Windows, Linux, HDRP, Unity 6000.0, Apple silicon, a built player | not yet ([#4](https://github.com/barmoshe/playmark/issues/4)) |

Also known: clip frames include Playmark's own toasts and ghosts when they are on screen (the
freeze frame hides them), as in the Godot addon. Hebrew in the note is not shaped right-to-left yet.

## Development

| Folder | |
|---|---|
| `com.bar-builds.playmark/Core` | Plain C#, no Unity: mark files, JSON, the inbox poll, images and PNG, the log ring, the UI sounds. |
| `com.bar-builds.playmark/Runtime` | The Unity side: boot, capture, overlay, snapshot, ghosts, toasts. |
| `com.bar-builds.playmark/Editor` | Script and prefab paths, the request bridge (warp, smoke), Project Settings. |
| `com.bar-builds.playmark/Samples~/Toy` | The toy scene. |
| `core-tests` | `dotnet test unity/core-tests/Tests`: the Core, built as Unity builds it (netstandard2.1, C# 9). |
| `check/compile.mjs` | Compiles the package against a Unity Editor's own DLLs, without running Unity. |

```bash
dotnet test unity/core-tests/Tests          # Core: inbox, JSON, PNG, images, sounds
node unity/check/compile.mjs --unity <Editor/Data> --inputsystem <com.unity.inputsystem>
# on a Mac: --unity /Applications/Unity/Hub/Editor/<version>/Unity.app
#           --inputsystem <project>/Library/PackageCache/com.unity.inputsystem@<hash>
node scripts/unity-metas.mjs write          # after adding a file to the package
```

## Licenses

MIT, by Bar Moshe. Heebo and Cascadia Mono, bundled in `Runtime/Resources/Playmark/`, are under
the SIL Open Font License (`OFL.txt`).
