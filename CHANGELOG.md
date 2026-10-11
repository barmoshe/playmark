# Changelog

## Unreleased

- **Codex.** The plugin installs in Codex (`codex plugin marketplace add barmoshe/playmark`, then `codex plugin add playmark@playmark`), with the same skill and helpers as Claude Code: install, triage, resolve, start a new game. Thanks to SJ for the first version (#1). Tested end to end with `codex exec` on a Godot game.
- One skill for both agents: install, triage and new-game flows live in `skills/playmark/SKILL.md`; the Claude Code commands point to it.
- `inbox.mjs export [--all]`: one HTML page with every mark (frame, note, code under each pin, clip, log), images inside. Playmark without any agent: install, play, mark, export, share.
- New games get an `AGENTS.md` (Codex and most agents read it) and a `CLAUDE.md` that imports it.
- Godot: a game never opened in the editor no longer gets two automatic bug marks for the addon's fonts on first run. Found by Codex during testing.
- Docs: the README, the Unity README (screenshots, a tested table) and the skill cover Godot, Unity, Claude Code, Codex and no agent.

## 0.4.0

- **Unity.** A Unity 6 package (`unity/com.bar-builds.playmark`) that writes the same marks as the Godot addon: freeze and mark with an IMGUI overlay, a 5 s rewind kept on the GPU, the colliders, renderers, uGUI and UI Toolkit elements under each mark with their script assets and prefabs, ghosts in 2D and 3D, toasts when Claude claims or fixes a mark, errors as automatic bug marks, warp and smoke runs through the open Editor, Project Settings, and a Toy sample. `/playmark:install` detects a Unity project and embeds the package (`--git` pins a git URL instead). In Unity, ghosts toggle with Ctrl+Shift+J (Ctrl/Cmd+Shift+G is Unity's Create Empty Parent). Beta: checked in Unity 6000.3 LTS on a Mac (Built-in, URP, both input systems); known issues are on GitHub. See `unity/README.md`.
- Unity fixes from the first real Editor run: Unity's own errors no longer become auto-marks or stall a smoke run, unattended runs carry on through Error Pause, clip frames are upright on Metal, a mark points at the file that declares a component, shortcut hints read CTRL+SHIFT+J, `unity/check/compile.mjs` takes a Mac `Unity.app`.
- `inbox.mjs smoke` works right after install, before the game has been played. `install.mjs --help` prints usage instead of installing into the current folder.
- One mark format for both engines: `schema: 2`, `engine: {name, version}`. Older Godot marks (engine as a string) still read.
- `inbox.mjs smoke`: an unattended play, mark, save run, for Godot and Unity. `inbox.mjs show` names the engine and, for Unity, the prefab.
- CI builds the Unity package's engine-free core with `dotnet test`, compiles the whole package against Unity 6000.0's own assemblies (with and without the physics modules and the Input System), and checks every `.meta` file.
- Typing the note sounds like typing: a soft key click per character (a slightly different pitch each time), a lower one for delete. Pasting and `set_note()` stay quiet.
- New UI sounds: layered (a tone with its own pitch and decay, noise for the attack), 44.1 kHz, every one ending on a fade; the "fixed" chime is a bell arpeggio in a small room. Built on a worker thread with their own seeded RNG, so a game's first frames and its random state are left alone.
- Showcase videos in English and Hebrew: the color mark, the Thornback in Wandcraft, and Star Dodger from a blank project, with recording scripts in `film/showcase/`. On the site.

## 0.3.0

- A real example in the README: redesigning an enemy in Wandcraft from one mark, before and after.
- `/playmark:new`: start a blank Godot game with Playmark wired in, a playable first scene and a `CLAUDE.md` for the play, mark, fix loop.
- Ghosts draw in screen pixels, so their numbers stay crisp at any zoom.
- Releases: tag `vX.Y.Z` and CI publishes the GitHub release with an addon-only zip; `scripts/versions.mjs` keeps every version in step.

## 0.2.0

- Photo mode: the frame freezes on a blueprint stage; pins pop, boxes show their size, a stamp lands on save.
- Rewind: step back up to 5 seconds and mark the frame where it happened.
- Category stamps on keys 1 to 5; type anywhere to start the note.
- Ghosts: past marks reappear in the world where you made them. Orange is open, blue is fixed.
- Claude's status comes back in-game: "On #12 now", "Fixed #12" with its note.
- Script errors become bug marks by themselves, with the clip and the log.
- Warp: `inbox.mjs warp <id>` opens the game at the mark; `--shot` saves a frame for checking a fix.
- `set_scope()` keeps ghosts in the right room when one scene holds many rooms.
- `inbox.mjs claim` and mark numbers (`14`, `#14`) in every command.

## 0.1.0

- Ctrl+Shift+M freezes the game; pin or box what you see, write a note, save.
- Each mark saves the frame, an annotated copy, the last seconds of play, recent logs and the game state.
- The Claude Code plugin: `/playmark:install`, `/playmark:triage`, and a hook that mentions new marks.
