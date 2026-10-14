#!/usr/bin/env node
// SessionStart / UserPromptSubmit hook: one line about marks Claude hasn't been told about.
// Silent when there is nothing new. Never fails the prompt.
import fs from "node:fs";
import path from "node:path";
import { findRoots, listMarks, oneLine } from "../scripts/lib.mjs";

try {
  const fresh = [];
  for (const root of findRoots()) {
    const seenFile = path.join(root, ".announced");
    const seen = new Set(fs.existsSync(seenFile) ? fs.readFileSync(seenFile, "utf8").split("\n").filter(Boolean) : []);
    // A mark the player sent back ("still broken") is news again: count its reopenings in the key.
    const key = (m) => (Array.isArray(m.reopened) && m.reopened.length ? `${m.id}#${m.reopened.length}` : m.id);
    const marks = listMarks(root, "inbox").filter((m) => !seen.has(key(m)));
    if (!marks.length) continue;
    fresh.push(...marks.map((m) => ({ ...m, root })));
    fs.writeFileSync(seenFile, [...seen, ...marks.map(key)].join("\n") + "\n");
  }
  if (fresh.length) {
    const first = fresh[0];
    const what = `${first.category || "note"}: "${oneLine(first.note || "no note", 60)}"`;
    const more = fresh.length > 1 ? ` and ${fresh.length - 1} more` : "";
    console.log(`Playmark: ${fresh.length} new mark${fresh.length > 1 ? "s" : ""} from playtesting (${what}${more}). Run /playmark:triage to work through them.`);
  }
} catch {
  // A broken inbox must never block a prompt.
}
process.exit(0);
