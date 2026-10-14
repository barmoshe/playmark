# Privacy

Playmark collects nothing.

- **What it writes:** marks, which are screenshots, your notes, the last seconds of play and recent
  game logs, saved to `.playmark/` inside your game project. They are git-ignored by default.
- **What it sends:** nothing to Bar Moshe or anyone else. A browser game (Cocos) can't write
  files, so it hands each mark to `scripts/sink.mjs`, a small server on your own machine
  (127.0.0.1) that writes `.playmark/`. The game only talks to a sink on this machine.
- **Your agent:** Claude Code or Codex reads those local files when you ask it to, under its own
  terms.
- **Sharing:** `inbox.mjs export` writes a page to your disk; it goes only where you send it.

Questions: [open an issue](https://github.com/barmoshe/playmark/issues).
