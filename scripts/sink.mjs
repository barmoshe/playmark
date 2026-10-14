#!/usr/bin/env node
// The browser side's disk (Cocos Creator, three.js). A game in a browser can't write files, so it
// posts each mark here and this writes the same .playmark folder the Godot addon and the Unity package write.
//   sink.mjs [path] [--port 7477] [--lan] [--serve <web build>]
// path = the Cocos project (package.json with "creator") or three.js project (package.json that
// depends on "three"), or a repo with it one level down.
// Listens on 127.0.0.1 and answers pages served from localhost only (with --lan, see below). Ctrl+C stops it.
//   GET  /playmark/status   every mark's status, for the game's toasts and ghosts
//   POST /playmark/marks    {data, files: {"screenshot.png": base64, ...}, log} -> {id, seq}
//   POST /playmark/marks/<id>/verdict  {verdict: "approved" | "reopen" | "dismiss", note}
// --serve also serves a web build. --lan (testing on a phone) serves it to this Wi-Fi too: every
// request from another device needs the session token. The printed URL carries it (?pm=), and the
// first page sets it as a cookie. Requests from this machine keep the localhost rules above.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMarks } from "./lib.mjs";
import { qrText } from "./qr.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
const MAX_BODY = 64 * 1024 * 1024;
const FILE = /^(screenshot|annotated|clip_sheet)\.png$|^clip\/\d{3}\.png$/;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const AGENT_KEYS = new Set(["status", "resolution", "approved", "dismissed", "reopened", "claimed_at", "id", "seq", "schema"]);

export const isCocos = (dir) => {
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).creator) && fs.existsSync(path.join(dir, "assets"));
  } catch {
    return false;
  }
};

export const isThree = (dir) => {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return Boolean(p.dependencies?.three || p.devDependencies?.three || p.peerDependencies?.three);
  } catch {
    return false;
  }
};

const isWeb = (dir) => isCocos(dir) || isThree(dir);

export function findWeb(dir) {
  if (isWeb(dir)) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && isWeb(path.join(dir, e.name))) return path.join(dir, e.name);
  }
  return null;
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
function newId(now = new Date()) {
  const hex = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${hex}`;
}

function statusOf(root) {
  const marks = [];
  for (const box of ["inbox", "done"]) {
    for (const m of listMarks(root, box)) {
      let modified = 0;
      try { modified = fs.statSync(path.join(m.folder, "mark.json")).mtimeMs; } catch {}
      marks.push({ id: m.id, box, seq: m.seq, status: m.status ?? "new", note: m.note ?? "", category: m.category ?? "",
        scene: m.scene?.path ?? "", scope: m.scope ?? "", marks: m.marks ?? [], resolution: m.resolution ?? null, approved: m.approved ?? null, modified });
    }
  }
  return marks;
}

// The player's verdict on a fixed mark, from the game: "approved" keeps it in done/ and hides its ghost;
// "reopen" moves it back to inbox/ as new, keeping what the agent said it did. On an open mark,
// "dismiss" (a test, or not a problem after all) moves it to done/ as fixed and approved, so the agent skips it.
export function verdict(root, id, body) {
  if (!/^\d{8}-\d{6}-[0-9a-f]{4}$/.test(id)) throw new Error("bad mark id");
  const { verdict: v, note = "" } = body ?? {};
  if (v !== "approved" && v !== "reopen" && v !== "dismiss") throw new Error('verdict must be "approved", "reopen" or "dismiss"');
  const at = new Date().toISOString().slice(0, 19);
  if (v === "dismiss") {
    const from = path.join(root, "inbox", id);
    if (!fs.existsSync(path.join(from, "mark.json"))) throw new Error("only an open mark can be dismissed");
    const data = JSON.parse(fs.readFileSync(path.join(from, "mark.json"), "utf8"));
    // The agent is on it: moving the mark now would make its `inbox.mjs resolve` fail.
    if (data.status === "working") throw new Error("the agent is working on this mark; wait for its fix");
    const target = path.join(root, "done", id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(from, target);
    Object.assign(data, { status: "fixed", resolution: { note: "Dismissed by the player in the game", at }, approved: { at }, dismissed: true });
    fs.writeFileSync(path.join(target, "mark.json"), JSON.stringify(data, null, 2) + "\n");
    return { id, seq: data.seq, verdict: v };
  }
  const folder = path.join(root, "done", id);
  const file = path.join(folder, "mark.json");
  if (!fs.existsSync(file)) throw new Error("only a fixed mark can get a verdict");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (v === "approved") {
    data.approved = { at };
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    return { id, seq: data.seq, verdict: v };
  }
  data.status = "new";
  data.reopened = [...(Array.isArray(data.reopened) ? data.reopened : []), { at, note: String(note).slice(0, 500), resolution: data.resolution ?? null }];
  delete data.resolution;
  delete data.approved;
  const target = path.join(root, "inbox", id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(folder, target);
  fs.writeFileSync(path.join(target, "mark.json"), JSON.stringify(data, null, 2) + "\n");
  return { id, seq: data.seq, verdict: v };
}

// Writes one mark: the images and log first, mark.json last (a folder is complete once it exists).
export function writeMark(root, body) {
  const { data, files = {}, log = "" } = body ?? {};
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("data must be an object");
  if (typeof files !== "object" || Array.isArray(files)) throw new Error("files must be an object");
  for (const name of Object.keys(files)) {
    if (!FILE.test(name)) throw new Error(`unexpected file ${JSON.stringify(name)}`);
    if (typeof files[name] !== "string") throw new Error(`${name} must be base64`);
  }
  const seq = statusOf(root).reduce((top, m) => Math.max(top, Number(m.seq) || 0), 0) + 1;
  let id = newId();
  while (fs.existsSync(path.join(root, "inbox", id)) || fs.existsSync(path.join(root, "done", id))) id = newId();
  const folder = path.join(root, "inbox", id);
  fs.mkdirSync(path.join(folder, "clip"), { recursive: true });
  for (const [name, b64] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), Buffer.from(b64, "base64"));
  if (!fs.readdirSync(path.join(folder, "clip")).length) fs.rmdirSync(path.join(folder, "clip"));
  fs.writeFileSync(path.join(folder, "log.txt"), String(log));
  // Once: someone who un-ignored marks on purpose keeps that.
  if (!fs.existsSync(path.join(root, ".gitignore"))) fs.writeFileSync(path.join(root, ".gitignore"), "# Playmark marks stay local by default.\n*\n");
  // Only what a game reports: verdicts, fixes and claims are written by the agent's side and the
  // player's verdict, never by the page that posts the mark.
  const own = Object.fromEntries(Object.entries(data).filter(([k]) => !AGENT_KEYS.has(k)));
  const mark = { ...own, playmark: data.playmark ?? VERSION, schema: 2, id, seq, status: "new" };
  fs.writeFileSync(path.join(folder, "mark.json"), JSON.stringify(mark, null, 2) + "\n");
  return { id, seq, folder };
}

const localHost = (value) => {
  try {
    return LOCAL.has(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
};

/** This machine's IPv4 addresses on its networks (Wi-Fi, Ethernet, virtual adapters). */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) if ((a.family === "IPv4" || a.family === 4) && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}

// Byte lengths, not string lengths: timingSafeEqual throws on unequal buffers, and a crafted token must not crash the sink.
const sameToken = (a, b) => {
  if (typeof a !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

/** The file under `serve` a URL path names, or null: never a dot-name, never outside `serve` (symlinks too), never in `root`. */
export function staticFile(serve, root, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0") || rel.split(/[\\/]/).some((p) => p.startsWith("."))) return null;
  // Native realpath: on Windows it returns long names in their real case, so PLAYMA~1 or a
  // different case can't slip past the checks below.
  const real = fs.realpathSync.native;
  const lower = (p) => (process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p);
  const inside = (dir, f) => lower(f) === lower(dir) || lower(f).startsWith(lower(dir) + path.sep);
  try {
    const base = real(serve);
    let file = real(path.join(base, rel));
    if (fs.statSync(file).isDirectory()) file = real(path.join(file, "index.html"));
    let marks = null;
    try { marks = real(root); } catch {}
    if (file === base || !inside(base, file) || (marks && inside(marks, file)) || !fs.statSync(file).isFile()) return null;
    // The dot rule again, on what the path really resolved to.
    if (path.relative(base, file).split(path.sep).some((p) => p.startsWith("."))) return null;
    return file;
  } catch {
    return null;
  }
}

// A page served by a LAN sink learns it from this line, and then talks to the sink same-origin.
const MARKER = "<script>window.PLAYMARK_LAN=1</script>";
// Runs first in <head>: the token is in the cookie now, so take it out of the address bar, the
// history and whatever the game's own scripts (analytics) read from location.
const STRIP_TOKEN = "<script>(function(){var u=new URL(location.href);if(u.searchParams.has('pm')){u.searchParams.delete('pm');history.replaceState(history.state,'',u.pathname+u.search+u.hash)}})()</script>";

/**
 * Default: localhost only, as described at the top. `serve`: also serves that folder.
 * `lan` + `token`: also answers this machine's network addresses, when the request carries the token.
 */
// Hostile input (a malformed URL, a bad header) must get a 400, never take the sink down.
const safe = (handler) => (req, res) => {
  try {
    handler(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain" }).end("Bad request\n");
    else res.destroy();
  }
};

export function createSink(root, { lan = false, serve = null, token = "" } = {}) {
  if (lan && (!serve || !token)) throw new Error("LAN mode needs a folder to serve and a token");
  return http.createServer(safe((req, res) => {
    const origin = req.headers.origin;
    const lanHosts = lan ? new Set(lanAddresses().map((a) => a.address)) : new Set();
    const known = (value) => {
      try {
        const h = new URL(`http://${value}`).hostname;
        return LOCAL.has(h) || lanHosts.has(h);
      } catch {
        return false;
      }
    };
    // A page on another site must not read or write marks, and a rebinding DNS name must not either.
    const originOk = !origin || (origin.startsWith("http://") || origin.startsWith("https://")) && known(origin.replace(/^https?:\/\//, ""));
    if (!known(req.headers.host ?? "") || !originOk) {
      res.writeHead(403).end("Playmark's sink only answers pages on this machine.\n");
      return;
    }
    const url = new URL(req.url, "http://localhost");
    const extra = {};
    if (lan) {
      // From this machine to a localhost name, the default rules already hold. Anything else needs the token.
      const loopback = /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress ?? "") && localHost(req.headers.host ?? "");
      const name = `playmark_${req.socket.localPort}`; // cookies are per host, not per port
      const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);
      const query = url.searchParams.get("pm");
      if (!loopback && !sameToken(query, token) && !sameToken(cookie, token)) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Playmark: open the URL with ?pm= that the sink printed. The token is new every time the sink starts.\n");
        return;
      }
      // A page on another port of this address (another dev server) is not the game.
      if (origin && !loopback) {
        let o = null;
        try { o = new URL(origin); } catch {}
        if (!o || o.host !== (req.headers.host ?? "")) {
          res.writeHead(403).end("Playmark's sink only answers the game it serves.\n");
          return;
        }
      }
      if (sameToken(query, token)) extra["set-cookie"] = `${name}=${token}; Path=/; HttpOnly; SameSite=Strict`;
      extra["cache-control"] = "no-store"; // a phone's browser would keep the last build
      extra["referrer-policy"] = "no-referrer"; // the first URL carries the token
    }
    const cors = origin ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", vary: "origin" } : {};
    const send = (code, obj) => res.writeHead(code, { "content-type": "application/json", ...cors, ...extra }).end(JSON.stringify(obj));
    if (serve && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/playmark/")) {
      // <script src="http://localhost:7477/..."> on some other site must not load the game's code.
      if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { error: "cross-site" });
      const file = staticFile(serve, root, url.pathname);
      if (!file) return send(404, { error: "not found" });
      const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
      let body = fs.readFileSync(file);
      if (lan && type.startsWith("text/html")) {
        let html = body.toString("utf8");
        const open = html.match(/<head[^>]*>/i);
        html = open ? html.replace(open[0], open[0] + STRIP_TOKEN) : STRIP_TOKEN + html;
        const at = html.search(/<\/head>/i);
        body = Buffer.from(at === -1 ? MARKER + html : html.slice(0, at) + MARKER + html.slice(at));
      }
      res.writeHead(200, { "content-type": type, "content-length": body.length, ...extra }).end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST" }).end();
    } else if (req.method === "GET" && url.pathname === "/playmark/status") {
      send(200, { playmark: VERSION, root, marks: statusOf(root) });
    } else if (req.method === "POST" && url.pathname === "/playmark/marks") {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          // Stop buffering but let the upload finish, so the 413 reaches the page.
          if (!res.headersSent) send(413, { error: "The mark is over 64 MB." });
          chunks.length = 0;
        } else chunks.push(c);
      });
      req.on("end", () => {
        if (size > MAX_BODY) return;
        try {
          const saved = writeMark(root, JSON.parse(Buffer.concat(chunks).toString("utf8")));
          console.log(`Saved #${saved.seq} ${saved.folder}`);
          send(200, { id: saved.id, seq: saved.seq });
        } catch (e) {
          send(400, { error: e.message });
        }
      });
    } else if (req.method === "POST" && /^\/playmark\/marks\/[^/]+\/verdict$/.test(url.pathname)) {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => { size += c.length; if (size <= 64 * 1024) chunks.push(c); });
      req.on("end", () => {
        try {
          if (size > 64 * 1024) throw new Error("too large");
          const out = verdict(root, url.pathname.split("/")[3], JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
          console.log(`${{ approved: "Approved", reopen: "Reopened", dismiss: "Dismissed" }[out.verdict]} #${out.seq}`);
          send(200, out);
        } catch (e) {
          send(400, { error: e.message });
        }
      });
    } else {
      send(404, { error: "not found" });
    }
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log([
      "Usage: sink.mjs [path] [--port 7477] [--lan] [--serve <dir>]",
      "  path: the Cocos Creator or three.js project, or a repo with it one level down (default: the current folder)",
      "  --serve: also serve a web build folder (with --lan, default: the project's build/web-mobile or build/web-desktop)",
      "  --lan: test on a phone on this Wi-Fi (Cocos Creator); prints a URL with a session token",
    ].join("\n"));
    process.exit(0);
  }
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const port = Number(value("--port") ?? 7477);
  const lan = args.includes("--lan");
  const start = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port" && args[i - 1] !== "--serve") ?? process.cwd());
  let root = process.env.PLAYMARK_DIR ? path.resolve(process.env.PLAYMARK_DIR) : null;
  if (!root) {
    const project = findWeb(start);
    if (!project) {
      console.error(`No Cocos Creator (package.json with "creator") or three.js (package.json depending on "three") project in ${start} or one level down.`);
      process.exit(1);
    }
    root = path.join(project, ".playmark");
  }
  let serve = value("--serve") && path.resolve(value("--serve"));
  if (!serve && lan) serve = ["web-mobile", "web-desktop"].map((b) => path.join(path.dirname(root), "build", b)).find((d) => fs.existsSync(path.join(d, "index.html")));
  if (lan && !serve) {
    console.error("--lan serves the game to the phone: build it for web with Debug on, or pass --serve <web build folder>.");
    process.exit(1);
  }
  if (serve && !fs.existsSync(path.join(serve, "index.html"))) {
    console.error(`No index.html in ${serve}. Build the game for web (Debug on) first.`);
    process.exit(1);
  }
  const token = lan ? crypto.randomBytes(16).toString("base64url") : "";
  createSink(root, { lan, serve, token }).listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`Playmark sink on http://127.0.0.1:${port}, saving to ${root}. Ctrl+C stops it.`);
    if (serve) console.log(`Serving ${serve} at http://localhost:${port}/`);
    if (!lan) return;
    const urls = lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${port}/?pm=${token}` }));
    // The QR gets the likeliest Wi-Fi: a private address on an adapter that isn't virtual (VirtualBox,
    // Docker, WSL/Hyper-V, VPN tunnels). Every address is listed below it anyway.
    const virtual = /vbox|virtualbox|vmnet|vethernet|hyper-v|wsl|docker|br-|veth|utun|tun|tap|tailscale|zerotier|zt/i;
    const priv = (a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    const rank = (u) => (virtual.test(u.name) ? 2 : 0) + (priv(u.address) ? 0 : 1);
    const wifi = [...urls].sort((a, b) => rank(a) - rank(b))[0];
    if (!wifi) {
      console.log("\nNo network address found. Is this computer on Wi-Fi?");
      return;
    }
    console.log(`\nOn your phone, on the same Wi-Fi, open:\n\n    ${wifi.url}\n`);
    if (process.stdout.isTTY) console.log(`or scan:\n\n${qrText(wifi.url)}\n`);
    for (const u of urls) if (u !== wifi) console.log(`  on ${u.name}: ${u.url}`);
    console.log("\nThe token (pm=) is new each run. Without it, other devices are refused.");
    console.log("Nothing loads on the phone? Allow Node.js on private networks in the firewall (see cocos/README.md).");
  });
}
