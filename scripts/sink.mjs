#!/usr/bin/env node
// The browser side's disk (Cocos Creator, three.js). A game in a browser can't write files, so it
// posts each mark here and this writes the same .playmark folder the Godot addon and the Unity package write.
//   sink.mjs [path] [--port 7477]
// path = the Cocos project (package.json with "creator") or three.js project (package.json that
// depends on "three"), or a repo with it one level down.
// Listens on 127.0.0.1 only and answers pages served from localhost only. Stop it with Ctrl+C.
//   GET  /playmark/status   every mark's status, for the game's toasts and ghosts
//   POST /playmark/marks    {data, files: {"screenshot.png": base64, ...}, log} -> {id, seq}
//   POST /playmark/marks/<id>/verdict  {verdict: "approved" | "reopen" | "dismiss", note}
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMarks } from "./lib.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
const MAX_BODY = 64 * 1024 * 1024;
const FILE = /^(screenshot|annotated|clip_sheet)\.png$|^clip\/\d{3}\.png$/;
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  fs.writeFileSync(path.join(root, ".gitignore"), "*\n");
  const mark = { ...data, playmark: data.playmark ?? VERSION, schema: 2, id, seq, status: "new" };
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

// Hostile input (a malformed URL, a bad header) must get a 400, never take the sink down.
const safe = (handler) => (req, res) => {
  try {
    handler(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(400, { "content-type": "text/plain" }).end("Bad request\n");
    else res.destroy();
  }
};

export function createSink(root) {
  return http.createServer(safe((req, res) => {
    const origin = req.headers.origin;
    // A page on another site must not read or write marks, and a rebinding DNS name must not either.
    const originOk = !origin || (origin.startsWith("http://") || origin.startsWith("https://")) && localHost(origin.replace(/^https?:\/\//, ""));
    if (!localHost(req.headers.host ?? "") || !originOk) {
      res.writeHead(403).end("Playmark's sink only answers pages on this machine.\n");
      return;
    }
    const cors = origin ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type", vary: "origin" } : {};
    const send = (code, obj) => res.writeHead(code, { "content-type": "application/json", ...cors }).end(JSON.stringify(obj));
    const url = new URL(req.url, "http://localhost");
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
          send(413, { error: "The mark is over 64 MB." });
          req.destroy();
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
    console.log("Usage: sink.mjs [path] [--port 7477]\n  path: the Cocos Creator or three.js project, or a repo with it one level down (default: the current folder)");
    process.exit(0);
  }
  const portAt = args.indexOf("--port");
  const port = portAt === -1 ? 7477 : Number(args[portAt + 1]);
  const start = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port") ?? process.cwd());
  let root = process.env.PLAYMARK_DIR ? path.resolve(process.env.PLAYMARK_DIR) : null;
  if (!root) {
    const project = findWeb(start);
    if (!project) {
      console.error(`No Cocos Creator (package.json with "creator") or three.js (package.json depending on "three") project in ${start} or one level down.`);
      process.exit(1);
    }
    root = path.join(project, ".playmark");
  }
  createSink(root).listen(port, "127.0.0.1", () => console.log(`Playmark sink on http://127.0.0.1:${port}, saving to ${root}. Ctrl+C stops it.`));
}
