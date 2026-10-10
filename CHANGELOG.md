# Changelog

## Unreleased

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
