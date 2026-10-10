# Changelog

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
