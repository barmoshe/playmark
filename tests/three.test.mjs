// node --test tests/*.test.mjs
// The three.js side: install, finding the project for the sink, and reading three.js marks.
// The module itself needs a browser and `three`; here it is only syntax-checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findWeb, writeMark } from "../scripts/sink.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const run = (script, args, cwd) => execFileSync("node", [path.join(repo, script), ...args], { cwd, encoding: "utf8", env: { ...process.env, PLAYMARK_DIR: "" } });
const fails = (script, args, cwd) => {
  try {
    run(script, args, cwd);
  } catch (e) {
    return e.stderr + e.stdout;
  }
  assert.fail(`${script} ${args.join(" ")} should have failed`);
};

function threeProject({ src = false, deps = { three: "^0.170.0" }, extra = {} } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "playmark-three-")));
  const game = path.join(dir, "game");
  fs.mkdirSync(src ? path.join(game, "src") : game, { recursive: true });
  fs.writeFileSync(path.join(game, "package.json"), JSON.stringify({ name: "game", ...extra, devDependencies: deps }));
  return { dir, game };
}

test("the module parses as an ES module", () => {
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "playmark-three-")), "playmark.mjs");
  fs.copyFileSync(path.join(repo, "three", "playmark.js"), copy);
  execFileSync("node", ["--check", copy]);
});

test("install copies playmark.js to src/playmark when there is a src folder, else to playmark/", () => {
  const withSrc = threeProject({ src: true });
  const out = run("scripts/install.mjs", [withSrc.dir], withSrc.dir);
  assert.match(out, /three\.js, src\/playmark\/playmark\.js/);
  assert.match(out, /Playmark\.attach\(\{ renderer, scene, camera \}\)/);
  assert.equal(fs.readFileSync(path.join(withSrc.game, "src", "playmark", "playmark.js"), "utf8"), fs.readFileSync(path.join(repo, "three", "playmark.js"), "utf8"));
  assert.equal(fs.readFileSync(path.join(withSrc.game, ".gitignore"), "utf8"), ".playmark/\n");
  run("scripts/install.mjs", [withSrc.game], withSrc.game); // again: updates in place

  const flat = threeProject();
  run("scripts/install.mjs", [flat.game], flat.game);
  assert.ok(fs.existsSync(path.join(flat.game, "playmark", "playmark.js")));
});

test("a Cocos project that also depends on three is installed as Cocos", () => {
  const { dir, game } = threeProject({ extra: { creator: { version: "3.8.8" } } });
  fs.mkdirSync(path.join(game, "assets"));
  assert.match(run("scripts/install.mjs", [dir], dir), /Cocos Creator/);
  assert.ok(!fs.existsSync(path.join(game, "playmark")));
});

test("a package.json without three is no project", () => {
  const { dir } = threeProject({ deps: { vite: "^5" } });
  assert.match(fails("scripts/install.mjs", [dir], dir), /three\.js \(package\.json depending on "three"\)/);
  assert.equal(findWeb(dir), null);
});

test("the sink finds a three.js project, and the inbox reads its marks", () => {
  const { dir, game } = threeProject();
  assert.equal(findWeb(dir), game);
  writeMark(path.join(game, ".playmark"), {
    data: { playmark: "0.4.0", source: "player", category: "art", note: "Sphere should shine", engine: { name: "three", version: "170" },
      scene: { path: "Toy", name: "Toy" }, uptime_s: 3.6, fps: 60, marks: [{ type: "pin", number: 1, x: 1, y: 1 }],
      under_marks: [{ mark: 1, physics: [], ui: [], nodes: [{ path: "Props/BlueSphere", class: "Mesh", material: "Water", distance: 7.5, world: [0, 1, 0.8] }] }] },
    files: {},
  });
  const shown = run("scripts/inbox.mjs", ["show", "1"], game);
  assert.match(shown, /three\.js 170/);
  assert.match(shown, /Props\/BlueSphere \(Mesh\)/);
  assert.doesNotMatch(shown, /time_scale/);
  assert.match(fails("scripts/inbox.mjs", ["warp", "1"], game), /isn't available for three\.js/);
  assert.match(fails("scripts/inbox.mjs", ["smoke"], game), /isn't available for three\.js/);
});
