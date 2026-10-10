#!/usr/bin/env node
// Playmark inbox. Usage:
//   inbox.mjs list [--all]              new marks (and fixed ones with --all)
//   inbox.mjs show <id>                 everything Claude needs to read one mark
//   inbox.mjs claim <id>                mark it "working" (the game shows Claude is on it)
//   inbox.mjs resolve <id> [--note ""]  move to done/ and record how it was fixed
//   inbox.mjs reopen <id>               move back to inbox/
//   inbox.mjs video <id>                clip/ -> clip.mp4 (needs ffmpeg)
//   inbox.mjs warp <id> [--shot out.png] open the game at the mark; with --shot, save a frame and quit
// <id> is the mark's number (14 or #14), its full id, or the id's last 4 characters.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findRoots, listMarks, findMark, oneLine } from "./lib.mjs";

const [cmd = "list", ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1] ?? "";
};
const roots = findRoots();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function need(id) {
  if (!id) die("Which mark? Pass its id (or the last 4 characters).");
  const hit = findMark(roots, id);
  if (!hit) die(`No mark "${id}" under ${roots.join(", ") || "this folder (no .playmark found)"}.`);
  return hit;
}

function summary(m) {
  const marks = (m.marks ?? []).map((k) => (k.type === "box" ? `#${k.number} box` : `#${k.number} pin`)).join(", ");
  return `#${String(m.seq ?? "?").padEnd(3)} ${m.id}  ${(m.status === "working" ? "[working] " : "")}${(m.category || "-").padEnd(7)} ${oneLine(m.note || "(no note)", 60)}  [${marks}]  ${m.scene?.path ?? ""}`;
}

switch (cmd) {
  case "list": {
    if (!roots.length) {
      console.log("No .playmark folder here. Play the game and press Ctrl+Shift+M to make one.");
      break;
    }
    for (const root of roots) {
      const inbox = listMarks(root, "inbox");
      const done = listMarks(root, "done");
      console.log(`${root}  (${inbox.length} new, ${done.length} fixed)`);
      for (const m of inbox) console.log("  " + summary(m));
      if (rest.includes("--all")) for (const m of done) console.log("  ✓ " + summary(m));
    }
    break;
  }
  case "show": {
    const { mark: m } = need(rest[0]);
    const f = (name) => path.join(m.folder, name);
    console.log(`# Mark #${m.seq} ${m.id} (${m.status}${m.source === "auto-error" ? ", auto-captured on an error" : ""})`);
    console.log(`category: ${m.category || "-"}\nnote: ${m.note || "(none)"}`);
    console.log(`game: ${m.project?.name} ${m.project?.version} · Godot ${m.engine} · ${m.os}`);
    console.log(`scene: ${m.scene?.path}   at ${m.uptime_s}s, ${m.fps} fps, time_scale ${m.time_scale}`);
    console.log(`\nRead these images:\n  ${f("annotated.png")}   (marks numbered on the frame)`);
    if (m.clip?.frames) console.log(`  ${f("clip_sheet.png")}   (last ${m.clip.frames} frames, oldest first, left to right)`);
    console.log(`  ${f("screenshot.png")}   (clean frame)`);
    console.log(`\nMarks and what is under them:`);
    for (const k of m.marks ?? []) {
      const under = (m.under_marks ?? []).find((u) => u.mark === k.number) ?? {};
      const where = k.type === "box" ? `box ${k.x},${k.y} ${k.w}x${k.h}` : `pin ${k.x},${k.y}`;
      console.log(`  #${k.number} ${where}`);
      const seen = new Set();
      const nodes = [...(under.physics ?? []), ...(under.nodes ?? []), ...(under.ui ?? [])].filter((n) => !seen.has(n.path) && seen.add(n.path));
      for (const n of nodes.slice(0, 8)) {
        console.log(`     ${n.path} (${n.class}${n.script ? ", " + n.script : ""})`);
      }
    }
    if (m.context && Object.keys(m.context).length) console.log(`\nGame context:\n${JSON.stringify(m.context, null, 2)}`);
    const log = fs.existsSync(f("log.txt")) ? fs.readFileSync(f("log.txt"), "utf8").trim().split("\n") : [];
    const errors = log.filter((l) => /ERROR|WARNING/.test(l));
    console.log(`\nLog: ${log.length} lines, ${errors.length} errors/warnings (${f("log.txt")})`);
    for (const l of errors.slice(-10)) console.log("  " + l);
    console.log(`\nFull data: ${f("mark.json")}`);
    break;
  }
  case "claim": {
    const { box, mark: m } = need(rest[0]);
    if (box === "done") die(`#${m.seq} is already fixed.`);
    const file = path.join(m.folder, "mark.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.status = "working";
    data.claimed_at = new Date().toISOString().slice(0, 19);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    console.log(`Working on #${m.seq}`);
    break;
  }
  case "warp": {
    const { root, mark: m } = need(rest[0]);
    const project = path.dirname(root);
    const godot = process.env.PLAYMARK_GODOT || "godot";
    const shot = flag("--shot");
    // The game's warp data may carry its own launch args (seed, level...): they go first.
    const gameArgs = Array.isArray(m.warp?.data?.args) ? m.warp.data.args : [];
    const args = ["--path", project, "--", ...gameArgs, `--playmark-warp=${m.id}`];
    if (shot) args.push(`--playmark-shot=${path.resolve(shot)}`);
    if (shot) {
      execFileSync(godot, args, { stdio: "inherit", timeout: 120000 });
      console.log(path.resolve(shot));
    } else {
      const { spawn } = await import("node:child_process");
      spawn(godot, args, { detached: true, stdio: "ignore" }).unref();
      console.log(`Opening the game at #${m.seq} (${godot} ${args.join(" ")})`);
    }
    break;
  }
  case "resolve": {
    const { root, box, mark: m } = need(rest[0]);
    if (box === "done") die(`${m.id} is already fixed.`);
    const note = flag("--note") ?? "";
    const target = path.join(root, "done", m.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(m.folder, target);
    const data = JSON.parse(fs.readFileSync(path.join(target, "mark.json"), "utf8"));
    data.status = "fixed";
    data.resolution = { note, at: new Date().toISOString().slice(0, 19) };
    fs.writeFileSync(path.join(target, "mark.json"), JSON.stringify(data, null, 2) + "\n");
    console.log(`Fixed #${m.seq} → ${target}`);
    break;
  }
  case "reopen": {
    const { root, box, mark: m } = need(rest[0]);
    if (box === "inbox") die(`${m.id} is already open.`);
    const target = path.join(root, "inbox", m.id);
    fs.renameSync(m.folder, target);
    const data = JSON.parse(fs.readFileSync(path.join(target, "mark.json"), "utf8"));
    data.status = "new";
    fs.writeFileSync(path.join(target, "mark.json"), JSON.stringify(data, null, 2) + "\n");
    console.log(`Reopened ${m.id}`);
    break;
  }
  case "video": {
    const { mark: m } = need(rest[0]);
    const fps = String(m.clip?.fps || 8);
    const out = path.join(m.folder, "clip.mp4");
    try {
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", fps, "-i", path.join(m.folder, "clip", "%03d.png"),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", out]);
      console.log(out);
    } catch {
      die("ffmpeg failed or is not installed.");
    }
    break;
  }
  default:
    die("Commands: list [--all] | show <id> | claim <id> | resolve <id> [--note text] | reopen <id> | video <id> | warp <id> [--shot png]");
}
