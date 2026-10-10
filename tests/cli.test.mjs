// node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const run = (script, args, cwd) => execFileSync("node", [path.join(repo, script), ...args], { cwd, encoding: "utf8", env: { ...process.env, PLAYMARK_DIR: "" } });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playmark-"));
  const game = path.join(dir, "game");
  fs.mkdirSync(game);
  fs.writeFileSync(path.join(game, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="T"\n\n[autoload]\n\nGame="*res://game.gd"\n');
  return { dir, game };
}

function addMark(game, id, note = "boss bar overlaps the hp") {
  const f = path.join(game, ".playmark", "inbox", id);
  fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, "mark.json"), JSON.stringify({ id, status: "new", category: "bug", note, marks: [{ number: 1, type: "pin", x: 4, y: 5 }], scene: { path: "res://main.tscn" } }));
  fs.writeFileSync(path.join(f, "log.txt"), "hello\nERROR: boom\n");
}

test("install is idempotent and keeps existing autoloads", () => {
  const { dir, game } = fixture();
  run("scripts/install.mjs", [dir], dir);
  run("scripts/install.mjs", [dir], dir);
  const text = fs.readFileSync(path.join(game, "project.godot"), "utf8");
  assert.equal(text.match(/Playmark=/g).length, 1);
  assert.match(text, /Game="\*res:\/\/game.gd"/);
  assert.equal(text.match(/plugin\.cfg/g).length, 1);
  assert.ok(fs.existsSync(path.join(game, "addons", "playmark", "playmark.gd")));
  assert.equal(fs.readFileSync(path.join(game, ".gitignore"), "utf8"), ".playmark/\n");
});

test("notice: silent with nothing, one line per new mark, never repeats", () => {
  const { dir, game } = fixture();
  assert.equal(run("hooks/notice.mjs", [], dir), "");
  addMark(game, "20261010-120000-aaaa");
  addMark(game, "20261010-120100-bbbb", "too floaty");
  const out = run("hooks/notice.mjs", [], dir);
  assert.match(out, /2 new marks/);
  assert.match(out, /too floaty/);
  assert.equal(run("hooks/notice.mjs", [], dir), "");
});

test("inbox list, show, resolve, reopen", () => {
  const { dir, game } = fixture();
  addMark(game, "20261010-120000-aaaa");
  assert.match(run("scripts/inbox.mjs", ["list"], dir), /1 new, 0 fixed/);
  const shown = run("scripts/inbox.mjs", ["show", "aaaa"], dir);
  assert.match(shown, /annotated\.png/);
  assert.match(shown, /ERROR: boom/);
  run("scripts/inbox.mjs", ["resolve", "aaaa", "--note", "moved the bar"], dir);
  const done = JSON.parse(fs.readFileSync(path.join(game, ".playmark", "done", "20261010-120000-aaaa", "mark.json"), "utf8"));
  assert.equal(done.status, "fixed");
  assert.equal(done.resolution.note, "moved the bar");
  assert.match(run("scripts/inbox.mjs", ["list"], dir), /0 new, 1 fixed/);
  run("scripts/inbox.mjs", ["reopen", "aaaa"], dir);
  assert.match(run("scripts/inbox.mjs", ["list"], dir), /1 new, 0 fixed/);
});
