// node --test tests/*.test.mjs
// The Cocos side: install, the sink that writes marks for the browser, and reading Cocos marks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createSink } from "../scripts/sink.mjs";

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

function cocosProject(version = "3.8.8") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "playmark-cocos-")));
  const game = path.join(dir, "game");
  fs.mkdirSync(path.join(game, "assets"), { recursive: true });
  fs.writeFileSync(path.join(game, "package.json"), JSON.stringify({ name: "game", creator: { version } }));
  return { dir, game };
}

// One request to the sink, as a page on `origin` would make it.
function request(port, method, url, { body, origin = "http://localhost:8080", host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { host, ...(origin ? { origin } : {}), ...(data ? { "content-type": "application/json" } : {}) };
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

async function withSink(root, fn) {
  const server = createSink(root);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const mark = (note) => ({
  data: { playmark: "0.4.0", created_at: "2026-10-13T21:00:00", source: "player", category: "art", note, engine: { name: "cocos", version: "3.8.8" },
    scene: { path: "main", name: "main" }, marks: [{ type: "pin", number: 1, x: 1, y: 1 }], under_marks: [{ mark: 1, ui: [{ path: "Canvas/dot", class: "cc.Sprite" }] }] },
  files: { "screenshot.png": png.toString("base64"), "annotated.png": png.toString("base64"), "clip/000.png": png.toString("base64") },
  log: "hello\nERROR: boom",
});

test("install copies the package into assets/playmark and keeps Cocos' meta files", () => {
  const { dir, game } = cocosProject();
  run("scripts/install.mjs", [dir], dir);
  const target = path.join(game, "assets", "playmark");
  assert.ok(fs.existsSync(path.join(target, "playmark.ts")));
  fs.writeFileSync(path.join(target, "playmark.ts.meta"), '{"uuid":"keep"}');
  fs.writeFileSync(path.join(target, "gone.ts.meta"), '{"uuid":"orphan"}');
  run("scripts/install.mjs", [dir], dir);
  assert.equal(fs.readFileSync(path.join(target, "playmark.ts.meta"), "utf8"), '{"uuid":"keep"}');
  assert.ok(!fs.existsSync(path.join(target, "gone.ts.meta")), "a meta without its file goes");
  assert.equal(fs.readFileSync(path.join(game, ".gitignore"), "utf8"), ".playmark/\n");
});

test("install refuses Cocos Creator before 3.8", () => {
  const { dir } = cocosProject("3.7.4");
  assert.match(fails("scripts/install.mjs", [dir], dir), /needs Cocos Creator 3\.8/);
});

test("the sink writes a mark folder the inbox reads, mark.json last, numbers in order", async () => {
  const { game } = cocosProject();
  const root = path.join(game, ".playmark");
  await withSink(root, async (port) => {
    const first = await request(port, "POST", "/playmark/marks", { body: mark("Dot should be green") });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.headers["access-control-allow-origin"], "http://localhost:8080");
    assert.equal(first.json.seq, 1);
    assert.match(first.json.id, /^\d{8}-\d{6}-[0-9a-f]{4}$/);
    const second = await request(port, "POST", "/playmark/marks", { body: mark("Second") });
    assert.equal(second.json.seq, 2);

    const folder = path.join(root, "inbox", first.json.id);
    for (const f of ["mark.json", "screenshot.png", "annotated.png", "clip/000.png", "log.txt"]) assert.ok(fs.existsSync(path.join(folder, f)), f);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, "mark.json"), "utf8"));
    assert.deepEqual([saved.schema, saved.id, saved.seq, saved.status], [2, first.json.id, 1, "new"]);
    assert.equal(fs.readFileSync(path.join(root, ".gitignore"), "utf8"), "*\n");

    const status = await request(port, "GET", "/playmark/status");
    assert.deepEqual(status.json.marks.map((m) => m.seq).sort(), [1, 2]);
  });
  const shown = run("scripts/inbox.mjs", ["show", "1"], game);
  assert.match(shown, /Cocos Creator 3\.8\.8/);
  assert.match(shown, /Canvas\/dot \(cc\.Sprite\)/);
  assert.match(fails("scripts/inbox.mjs", ["warp", "1"], game), /isn't available for Cocos Creator/);
});

test("the sink refuses other sites, rebinding hosts, odd file names and bad bodies", async () => {
  const { game } = cocosProject();
  const root = path.join(game, ".playmark");
  await withSink(root, async (port) => {
    assert.equal((await request(port, "GET", "/playmark/status", { origin: "https://evil.example" })).status, 403);
    assert.equal((await request(port, "POST", "/playmark/marks", { body: mark("x"), origin: "http://localhost.evil.example" })).status, 403);
    assert.equal((await request(port, "GET", "/playmark/status", { host: "rebind.example:80" })).status, 403);
    const escape = mark("x");
    escape.files = { "../../escape.png": png.toString("base64") };
    assert.equal((await request(port, "POST", "/playmark/marks", { body: escape })).status, 400);
    assert.equal((await request(port, "POST", "/playmark/marks", { body: { data: [] } })).status, 400);
    assert.equal((await request(port, "OPTIONS", "/playmark/marks")).status, 204);
  });
  assert.ok(!fs.existsSync(path.join(game, "escape.png")));
  assert.ok(!fs.existsSync(path.join(root, "inbox")) || fs.readdirSync(path.join(root, "inbox")).length === 0, "no partial marks");
});

test("the player's verdict: approve keeps a fixed mark done, reopen sends it back with the fix that did not hold", async () => {
  const { game } = cocosProject();
  const root = path.join(game, ".playmark");
  await withSink(root, async (port) => {
    const a = (await request(port, "POST", "/playmark/marks", { body: mark("Approve me") })).json;
    const b = (await request(port, "POST", "/playmark/marks", { body: mark("Reopen me") })).json;
    // Only a fixed mark gets a verdict.
    assert.equal((await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "approved" } })).status, 400);
    run("scripts/inbox.mjs", ["resolve", String(a.seq), "--note", "made it green"], game);
    run("scripts/inbox.mjs", ["resolve", String(b.seq), "--note", "first try"], game);
    assert.equal((await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "approved" } })).status, 200);
    const reopened = await request(port, "POST", `/playmark/marks/${b.id}/verdict`, { body: { verdict: "reopen", note: "still red" } });
    assert.equal(reopened.status, 200, reopened.text);
    const status = (await request(port, "GET", "/playmark/status")).json.marks;
    const sa = status.find((m) => m.id === a.id), sb = status.find((m) => m.id === b.id);
    assert.equal(sa.box, "done");
    assert.ok(sa.approved?.at);
    assert.deepEqual([sb.box, sb.status, sb.resolution], ["inbox", "new", null]);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "inbox", b.id, "mark.json"), "utf8"));
    assert.equal(saved.reopened[0].resolution.note, "first try");
    assert.equal(saved.reopened[0].note, "still red");
    // A bad id or verdict never touches the disk.
    assert.equal((await request(port, "POST", "/playmark/marks/..%2f..%2fx/verdict", { body: { verdict: "approved" } })).status, 400);
    assert.equal((await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "delete" } })).status, 400);
    assert.equal((await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "approved" }, origin: "https://evil.example" })).status, 403);
  });
  assert.match(run("scripts/inbox.mjs", ["list", "--all"], game), /✓✓ .*Approve me/);
  assert.match(run("scripts/inbox.mjs", ["show", "2"], game), /did not hold; they said: still red/);
});

test("dismiss: an open test mark goes to done as fixed and approved, and only an open one", async () => {
  const { game } = cocosProject();
  const root = path.join(game, ".playmark");
  await withSink(root, async (port) => {
    const a = (await request(port, "POST", "/playmark/marks", { body: mark("Just testing") })).json;
    const out = await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "dismiss" } });
    assert.equal(out.status, 200, out.text);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "done", a.id, "mark.json"), "utf8"));
    assert.deepEqual([saved.status, saved.dismissed, Boolean(saved.approved?.at)], ["fixed", true, true]);
    assert.equal((await request(port, "POST", `/playmark/marks/${a.id}/verdict`, { body: { verdict: "dismiss" } })).status, 400);
  });
  assert.match(run("scripts/inbox.mjs", ["list"], game), /\(0 new, 1 fixed\)/);
});
