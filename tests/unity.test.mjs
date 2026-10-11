// node --test tests/*.test.mjs
// The Claude Code side with a Unity project: install, reading Unity marks, warp and smoke requests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const run = (script, args, cwd, env = {}) =>
  execFileSync("node", [path.join(repo, script), ...args], { cwd, encoding: "utf8", env: { ...process.env, PLAYMARK_DIR: "", PLAYMARK_UNITY: "", PLAYMARK_UNITY_PLAYER: "", ...env } });
const fails = (script, args, cwd, env = {}) => {
  try {
    run(script, args, cwd, env);
  } catch (e) {
    return e.stderr + e.stdout;
  }
  assert.fail(`${script} ${args.join(" ")} should have failed`);
};

function unityProject(version = "6000.0.84f1") {
  // The real path: on macOS the temp dir is a /var -> /private/var symlink, and inbox.mjs
  // reports resolved paths.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "playmark-unity-")));
  const game = path.join(dir, "game");
  fs.mkdirSync(path.join(game, "Assets"), { recursive: true });
  fs.mkdirSync(path.join(game, "ProjectSettings"));
  fs.mkdirSync(path.join(game, "Packages"));
  fs.writeFileSync(path.join(game, "ProjectSettings", "ProjectVersion.txt"), `m_EditorVersion: ${version}\nm_EditorVersionWithRevision: ${version} (78ab6fc243d5)\n`);
  fs.writeFileSync(path.join(game, "Packages", "manifest.json"), JSON.stringify({ dependencies: { "com.unity.ugui": "2.0.0" } }, null, 2));
  return { dir, game };
}

function unityMark(game, id, extra = {}) {
  const f = path.join(game, ".playmark", "inbox", id);
  fs.mkdirSync(f, { recursive: true });
  fs.writeFileSync(path.join(f, "mark.json"), JSON.stringify({
    playmark: "0.3.0", schema: 2, id, seq: 1, status: "new", category: "art", note: "Boxy should be orange",
    engine: { name: "unity", version: "6000.0.84f1" }, render_pipeline: "Built-in",
    scene: { path: "Assets/PlaymarkToy.unity" },
    marks: [{ number: 1, type: "pin", x: 400, y: 300, world: [-1.3, 0, 0] }],
    under_marks: [{ mark: 1, physics: [{ path: "Toy/Boxy", class: "CircleCollider2D", script: "Assets/Samples/Toy/Toy.cs" }],
      nodes: [{ path: "Toy/Boxy/Body", class: "SpriteRenderer", script: "Assets/Samples/Toy/Toy.cs", prefab: "Assets/Boxy.prefab" }], ui: [] }],
    ...extra,
  }));
  fs.writeFileSync(path.join(f, "log.txt"), "Playmark: saved\nERROR: NullReferenceException: boss\n");
}

test("install embeds the Unity package, idempotently, and ignores .playmark/", () => {
  const { dir, game } = unityProject();
  run("scripts/install.mjs", [dir], dir);
  run("scripts/install.mjs", [dir], dir);
  const pkg = path.join(game, "Packages", "com.bar-builds.playmark");
  assert.ok(fs.existsSync(path.join(pkg, "package.json")));
  assert.ok(fs.existsSync(path.join(pkg, "Runtime", "PlaymarkHost.cs.meta")));
  const manifest = JSON.parse(fs.readFileSync(path.join(game, "Packages", "manifest.json"), "utf8"));
  assert.equal(manifest.dependencies["com.unity.ugui"], "2.0.0");
  assert.equal(manifest.dependencies["com.bar-builds.playmark"], undefined); // embedded: no manifest entry
  assert.equal(fs.readFileSync(path.join(game, ".gitignore"), "utf8"), ".playmark/\n");
});

test("install --git pins the package to this plugin's tag, once a release has it", () => {
  const { dir, game } = unityProject();
  run("scripts/install.mjs", [game], dir);
  const version = JSON.parse(fs.readFileSync(path.join(repo, ".claude-plugin", "plugin.json"), "utf8")).version;
  const [major, minor] = version.split(".").map(Number);
  if (major === 0 && minor < 4) {
    // No tag before 0.4.0 has unity/: refuse rather than write a URL UPM can't resolve.
    assert.match(fails("scripts/install.mjs", [game, "--git"], dir), /--git needs a release with the Unity package/);
    assert.ok(fs.existsSync(path.join(game, "Packages", "com.bar-builds.playmark", "package.json")));
    return;
  }
  run("scripts/install.mjs", [game, "--git"], dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(game, "Packages", "manifest.json"), "utf8"));
  assert.equal(manifest.dependencies["com.bar-builds.playmark"], `https://github.com/barmoshe/playmark.git?path=/unity/com.bar-builds.playmark#v${version}`);
  assert.ok(!fs.existsSync(path.join(game, "Packages", "com.bar-builds.playmark")));
});

test("install refuses Unity before 6", () => {
  const { dir } = unityProject("2022.3.40f1");
  assert.match(fails("scripts/install.mjs", [dir], dir), /Unity 2022\.3\.40f1\. Playmark needs Unity 6/);
});

test("show reads a Unity mark: engine, prefab, scripts", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa");
  const out = run("scripts/inbox.mjs", ["show", "aaaa"], dir);
  assert.match(out, /Unity 6000\.0\.84f1/);
  assert.match(out, /Built-in/);
  assert.match(out, /Toy\/Boxy\/Body \(SpriteRenderer, Assets\/Samples\/Toy\/Toy\.cs, prefab Assets\/Boxy\.prefab\)/);
  assert.match(out, /ERROR: NullReferenceException/);
});

test("show still reads old Godot marks (engine as a string)", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-bbbb", { engine: "4.7.2.stable", schema: undefined });
  assert.match(run("scripts/inbox.mjs", ["show", "bbbb"], dir), /Godot 4\.7\.2\.stable/);
});

test("warp asks the Unity Editor through a request file and waits for the shot", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa");
  const requests = path.join(game, ".playmark", "requests");

  // Without --shot: the request is left for the Editor, nothing waits.
  const asked = run("scripts/inbox.mjs", ["warp", "1"], dir, { PLAYMARK_REQUEST_ID: "w1" });
  assert.match(asked, /Unity isn't open/);
  const req = JSON.parse(fs.readFileSync(path.join(requests, "w1.json"), "utf8"));
  assert.deepEqual({ id: req.id, action: req.action, mark: req.mark }, { id: "w1", action: "warp", mark: "20261011-120000-aaaa" });

  // With --shot: waits for <id>.result.json (written here as the game would).
  fs.mkdirSync(path.join(game, "Temp"));
  fs.writeFileSync(path.join(game, "Temp", "UnityLockfile"), "");
  fs.writeFileSync(path.join(requests, "w2.result.json"), JSON.stringify({ id: "w2", ok: true, shot: "/tmp/after.png" }));
  const out = run("scripts/inbox.mjs", ["warp", "aaaa", "--shot", "/tmp/after.png"], dir, { PLAYMARK_REQUEST_ID: "w2" });
  assert.match(out, /\/tmp\/after\.png/);
  assert.doesNotMatch(out, /isn't open/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(requests, "w2.json"), "utf8")).shot, "/tmp/after.png");
  assert.ok(!fs.existsSync(path.join(requests, "w2.result.json")), "the answer is cleared once read");
});

test("a waiting run doesn't block when Unity is closed, and leaves nothing behind", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa");
  assert.match(fails("scripts/inbox.mjs", ["warp", "1", "--shot", "x.png"], dir, { PLAYMARK_REQUEST_ID: "w5" }), /Unity isn't open/);
  assert.ok(!fs.existsSync(path.join(game, ".playmark", "requests", "w5.json")));
});

test("warp with a Development Build passes the inbox and the game's args", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa", { warp: { scene: "Assets/PlaymarkToy.unity", data: { args: ["-level=3"] } } });
  const player = path.join(dir, "player.sh");
  const record = path.join(dir, "args.txt");
  fs.writeFileSync(player, `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`, { mode: 0o755 });
  run("scripts/inbox.mjs", ["warp", "1", "--shot", path.join(dir, "s.png")], dir, { PLAYMARK_UNITY_PLAYER: player });
  const args = fs.readFileSync(record, "utf8").trim().split("\n");
  assert.deepEqual(args, ["-level=3", `-playmark-dir=${path.join(game, ".playmark")}`, "-playmark-warp=20261011-120000-aaaa", `-playmark-shot=${path.join(dir, "s.png")}`]);
});

test("warp reports the Editor's error, and times out when nobody answers", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa");
  const requests = path.join(game, ".playmark", "requests");
  fs.mkdirSync(requests, { recursive: true });
  fs.mkdirSync(path.join(game, "Temp"));
  fs.writeFileSync(path.join(game, "Temp", "UnityLockfile"), "");
  fs.writeFileSync(path.join(requests, "w3.result.json"), JSON.stringify({ id: "w3", ok: false, error: "The open scene has unsaved changes." }));
  assert.match(fails("scripts/inbox.mjs", ["warp", "1", "--shot", "x.png"], dir, { PLAYMARK_REQUEST_ID: "w3" }), /unsaved changes/);
  assert.match(fails("scripts/inbox.mjs", ["warp", "1", "--shot", "x.png"], dir, { PLAYMARK_REQUEST_ID: "w4", PLAYMARK_WAIT_S: "1" }), /No answer from Unity after 1 s, so the request was withdrawn/);
  assert.ok(!fs.existsSync(path.join(requests, "w4.json")), "an unanswered request is withdrawn");
});

test("smoke asks Unity for an unattended run", () => {
  const { dir, game } = unityProject();
  unityMark(game, "20261011-120000-aaaa");
  const requests = path.join(game, ".playmark", "requests");
  fs.mkdirSync(requests, { recursive: true });
  fs.mkdirSync(path.join(game, "Temp"));
  fs.writeFileSync(path.join(game, "Temp", "UnityLockfile"), "");
  fs.writeFileSync(path.join(requests, "s1.result.json"), JSON.stringify({ id: "s1", ok: true }));
  const out = run("scripts/inbox.mjs", ["smoke"], game, { PLAYMARK_REQUEST_ID: "s1" });
  assert.match(out, /Smoke run OK/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(requests, "s1.json"), "utf8")).action, "smoke");
});
