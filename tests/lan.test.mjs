// node --test tests/*.test.mjs
// Phone testing: the sink's --lan mode (token, own addresses only) and its static serving.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createSink, lanAddresses } from "../scripts/sink.mjs";
import { qrMatrix } from "../scripts/qr.mjs";

const TOKEN = "t0ken-for-the-tests-only";
const lanIp = lanAddresses()[0]?.address;

// A game folder served as the web build, with its .playmark inside and a secret one level up.
function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "playmark-lan-")));
  const game = path.join(dir, "game");
  fs.mkdirSync(path.join(game, ".playmark", "inbox", "20261013-210000-abcd"), { recursive: true });
  fs.writeFileSync(path.join(game, ".playmark", "inbox", "20261013-210000-abcd", "mark.json"), JSON.stringify({ seq: 1, note: "private note" }));
  fs.writeFileSync(path.join(game, "index.html"), "<html><head><title>g</title></head><body>game</body></html>");
  fs.mkdirSync(path.join(game, "src"));
  fs.writeFileSync(path.join(game, "src", "app.js"), "console.log(1)");
  fs.writeFileSync(path.join(dir, "secret.txt"), "SECRET");
  return { dir, game, root: path.join(game, ".playmark") };
}

// A raw request: `path` goes on the wire exactly as written (fetch would normalize /../).
function request(port, method, rawPath, { host, origin, cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers = { host: host ?? `${lanIp}:${port}`, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/json" } : {}) };
    const req = http.request({ host: "127.0.0.1", port, method, path: rawPath, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(data);
  });
}

async function withSink(root, options, fn) {
  const server = createSink(root, options);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

const mark = { data: { note: "from the phone", marks: [] }, files: {}, log: "" };

test("LAN mode: no token, no answer to another device (status, marks, the game itself)", { skip: !lanIp && "no network address" }, async () => {
  const { game, root } = project();
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    for (const [method, url] of [["GET", "/playmark/status"], ["GET", "/"], ["GET", "/index.html"], ["GET", "/playmark/status?pm=wrong"]]) {
      const r = await request(port, method, url);
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.ok(!r.text.includes("private note"));
    }
    assert.equal((await request(port, "POST", "/playmark/marks", { body: mark })).status, 403);
    assert.equal((await request(port, "GET", "/", { cookie: `playmark_${port}=wrong` })).status, 403);
    // The token does not make a rebinding name or another site acceptable.
    assert.equal((await request(port, "GET", `/playmark/status?pm=${TOKEN}`, { host: `rebind.example:${port}` })).status, 403);
    assert.equal((await request(port, "GET", `/playmark/status?pm=${TOKEN}`, { origin: "http://evil.example" })).status, 403);
  });
  assert.equal(fs.readdirSync(path.join(root, "inbox")).length, 1, "no mark written");
});

test("LAN mode: the token in the URL sets a cookie; the page, its files, status and marks then work", { skip: !lanIp && "no network address" }, async () => {
  const { game, root } = project();
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    const page = await request(port, "GET", `/?pm=${TOKEN}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<script>window\.PLAYMARK_LAN=1<\/script><\/head>/);
    assert.equal(page.headers["cache-control"], "no-store");
    const cookie = page.headers["set-cookie"][0].split(";")[0];
    assert.equal(cookie, `playmark_${port}=${TOKEN}`);
    assert.match(page.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);

    const js = await request(port, "GET", "/src/app.js", { cookie });
    assert.deepEqual([js.status, js.headers["content-type"], js.text], [200, "text/javascript", "console.log(1)"]);
    const origin = `http://${lanIp}:${port}`;
    const status = await request(port, "GET", "/playmark/status", { cookie, origin });
    assert.equal(status.status, 200);
    assert.match(status.text, /private note/);
    const saved = await request(port, "POST", "/playmark/marks", { cookie, origin, body: mark });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(JSON.parse(saved.text).seq, 2);
  });
});

test("LAN mode: this machine on localhost keeps working without the token", async () => {
  const { game, root } = project();
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    const r = await request(port, "GET", "/playmark/status", { host: `127.0.0.1:${port}`, origin: "http://localhost:7456" });
    assert.equal(r.status, 200);
    assert.equal(r.headers["access-control-allow-origin"], "http://localhost:7456");
  });
});

test("static serving stays in its folder: no traversal, no dot-folders, no symlink out, no .playmark", async () => {
  const { dir, game, root } = project();
  fs.symlinkSync(dir, path.join(game, "out"), "junction");
  fs.symlinkSync(root, path.join(game, "marks"), "junction");
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    const host = `127.0.0.1:${port}`;
    for (const url of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/..%5csecret.txt", "/src/..%5c..%5csecret.txt", "/.playmark/inbox/20261013-210000-abcd/mark.json",
      "/%2eplaymark/inbox/20261013-210000-abcd/mark.json", "/out/secret.txt", "/marks/inbox/20261013-210000-abcd/mark.json", "/%E0%A4%A", "/index.html%00.js"]) {
      const r = await request(port, "GET", url, { host });
      assert.equal(r.status, 404, url);
      assert.ok(!r.text.includes("SECRET") && !r.text.includes("private note"), url);
    }
    assert.equal((await request(port, "GET", "/src/app.js", { host })).status, 200);
  });
});

test("without --lan, serving adds nothing and other devices are still refused", async () => {
  const { game, root } = project();
  await withSink(root, { serve: game }, async (port) => {
    const page = await request(port, "GET", "/", { host: `localhost:${port}` });
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes("PLAYMARK_LAN"));
    if (lanIp) assert.equal((await request(port, "GET", `/?pm=${TOKEN}`)).status, 403);
  });
  assert.throws(() => createSink(root, { lan: true, serve: game }), /token/);
});

test("the QR code is the one OpenCV decoded (2026-10-13) for a sink URL", () => {
  // Decoded with cv2.QRCodeDetector for versions 1 to 6; this pins the bits so a change shows.
  const m = qrMatrix("http://192.168.0.104:7477/?pm=AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(m.length, 29);
  const bits = m.map((r) => r.map((b) => (b ? 1 : 0)).join("")).join("");
  let h = 0;
  for (const c of bits) h = (h * 31 + Number(c)) >>> 0;
  assert.equal(h, 3891004324);
  assert.throws(() => qrMatrix("x".repeat(200)), /too long/);
});

test("LAN mode: a token with multi-byte characters is refused, not a crash", { skip: !lanIp && "no network address" }, async () => {
  const { game, root } = project();
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    const bad = encodeURIComponent("é".repeat(TOKEN.length));
    assert.equal((await request(port, "GET", `/playmark/status?pm=${bad}`)).status, 403);
    assert.equal((await request(port, "GET", `/playmark/status?pm=${TOKEN}`)).status, 200, "the sink is still up");
  });
});

// From a real network address (not 127.0.0.1), as a device on the Wi-Fi connects.
function fromLan(port, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: lanIp, port, method: "GET", path: rawPath, headers }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("LAN mode: a device on the Wi-Fi can't skip the token by claiming Host: localhost", { skip: !lanIp && "no network address" }, async () => {
  const { game, root } = project();
  const server = createSink(root, { lan: true, serve: game, token: TOKEN });
  await new Promise((r) => server.listen(0, lanIp, r));
  const port = server.address().port;
  try {
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `${lanIp}:${port}`]) {
      assert.equal((await fromLan(port, "/playmark/status", { host })).status, 403, host);
    }
    assert.equal((await fromLan(port, `/playmark/status?pm=${TOKEN}`, { host: `${lanIp}:${port}` })).status, 200);
  } finally {
    server.close();
  }
});

test("LAN mode: the page drops the token from its address, sends no referrer, and other ports or sites are refused", { skip: !lanIp && "no network address" }, async () => {
  const { game, root } = project();
  await withSink(root, { lan: true, serve: game, token: TOKEN }, async (port) => {
    const page = await request(port, "GET", `/?pm=${TOKEN}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers["referrer-policy"], "no-referrer");
    const strip = page.text.indexOf("searchParams.delete('pm')");
    assert.ok(strip > 0 && strip < page.text.indexOf("<title>"), "the token is stripped before anything else in <head> runs");
    const cookie = page.headers["set-cookie"][0].split(";")[0];
    assert.equal((await request(port, "GET", "/playmark/status", { cookie, origin: `http://${lanIp}:${port}` })).status, 200);
    assert.equal((await request(port, "GET", "/playmark/status", { cookie, origin: `http://${lanIp}:${port + 1}` })).status, 403, "another port");
  });
  await withSink(root, { lan: false, serve: game }, async (port) => {
    const r = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/src/app.js", headers: { host: `localhost:${port}`, "sec-fetch-site": "cross-site" } }, (res) => resolve(res.statusCode)).on("error", reject);
    });
    assert.equal(r, 403, "a <script> on another site can't load the build");
  });
});
