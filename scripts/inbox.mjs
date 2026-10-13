#!/usr/bin/env node
// Playmark inbox. Usage:
//   inbox.mjs list [--all]              new marks (and fixed ones with --all)
//   inbox.mjs show <id>                 everything an agent needs to read one mark
//   inbox.mjs claim <id>                mark it "working" (the game shows someone is on it)
//   inbox.mjs resolve <id> [--note ""]  move to done/ and record how it was fixed
//   inbox.mjs reopen <id>               move back to inbox/
//   inbox.mjs video <id>                clip/ -> clip.mp4 (needs ffmpeg)
//   inbox.mjs warp <id> [--shot out.png] open the game at the mark; with --shot, save a frame and quit
//   inbox.mjs smoke [--out dir]         an unattended run: play, mark, save, stop (checks an install)
//   inbox.mjs export [--all] [--out f]  one HTML page with every open mark (and fixed ones with --all)
// Unity: warp and smoke ask the open Editor through .playmark/requests/ (Playmark's Editor
// script enters Play Mode for them). For warp, $PLAYMARK_UNITY_PLAYER runs a Development
// Build instead (smoke always goes through the Editor).
// <id> is the mark's number (14 or #14), its full id, or the id's last 4 characters.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { findRoots, listMarks, findMark, oneLine } from "./lib.mjs";
import { exportMarks } from "./export.mjs";
import { isCocos, isThree } from "./sink.mjs";

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

// Godot marks before schema 2 carry the engine as a bare version string.
function engineLabel(m) {
  const names = { unity: "Unity", cocos: "Cocos Creator", three: "three.js", godot: "Godot" };
  if (m.engine && typeof m.engine === "object") return `${names[m.engine.name] ?? m.engine.name ?? "Godot"} ${m.engine.version ?? ""}`.trim();
  return `Godot ${m.engine ?? ""}`.trim();
}

const isUnity = (project) => fs.existsSync(path.join(project, "ProjectSettings", "ProjectVersion.txt"));
const isProject = (dir) => isUnity(dir) || isCocos(dir) || isThree(dir) || fs.existsSync(path.join(dir, "project.godot"));
// Cocos and three.js run in a browser: no editor to ask for a run, no command line to warp with (yet).
const noWebRuns = (what, engine) => die(`${what} isn't available for ${engine} yet. Open the game in the browser and look; say what you could not check.`);

// Smoke checks a fresh install, before anyone has played: the game's .playmark may not exist yet.
function projectRoot() {
  const cwd = process.cwd();
  const dirs = [cwd, ...fs.readdirSync(cwd, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(cwd, e.name))];
  const project = dirs.find(isProject);
  return project ? path.join(project, ".playmark") : undefined;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Asks the Unity Editor for a run (warp or smoke) by dropping a request file; Playmark's Editor
// script picks it up, enters Play Mode, and the game writes <id>.result.json when done.
function unityRequest(root, request, wait) {
  const project = path.dirname(root);
  const id = process.env.PLAYMARK_REQUEST_ID || `${request.action}-${Date.now().toString(36)}`;
  const dir = path.join(root, "requests");
  fs.mkdirSync(dir, { recursive: true });
  const resultFile = path.join(dir, `${id}.result.json`);
  if (!process.env.PLAYMARK_REQUEST_ID) fs.rmSync(resultFile, { force: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, ...request }, null, 2) + "\n");
  const requestFile = path.join(dir, `${id}.json`);
  if (!fs.existsSync(path.join(project, "Temp", "UnityLockfile"))) {
    const unity = process.env.PLAYMARK_UNITY;
    if (unity) {
      spawn(unity, ["-projectPath", project], { detached: true, stdio: "ignore" }).unref();
      console.log(`Starting Unity on ${project}; it runs the request once the project is open.`);
    } else if (wait) {
      // Nothing would answer: don't block, and don't leave a run behind for later.
      fs.rmSync(requestFile, { force: true });
      die(`Unity isn't open on ${project}. Open the project in Unity and run this again (or set $PLAYMARK_UNITY to the Unity binary to start it from here).`);
    } else {
      console.log(`Unity isn't open on ${project}. The request waits in ${dir} for up to 10 minutes; open the project in Unity.`);
    }
  }
  if (!wait) {
    console.log(`Asked Unity for ${request.action} (${id}). It enters Play Mode once any playtest in progress ends.`);
    return;
  }
  // Under Claude Code's 2-minute command limit by default.
  const timeout = Number(process.env.PLAYMARK_WAIT_S || 110) * 1000;
  const until = Date.now() + timeout;
  while (!fs.existsSync(resultFile) && Date.now() < until) sleep(500);
  if (!fs.existsSync(resultFile)) {
    // Still unclaimed: withdraw it, so it can't start Play Mode later on its own.
    const withdrawn = fs.existsSync(requestFile);
    fs.rmSync(requestFile, { force: true });
    die(withdrawn
      ? `No answer from Unity after ${timeout / 1000} s, so the request was withdrawn. Is a playtest running, or a script still compiling? Stop it and run this again.`
      : `Unity took the request but hasn't answered after ${timeout / 1000} s (still entering Play Mode?). The result will land in ${resultFile}.`);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.rmSync(resultFile, { force: true });
  if (!result.ok) die(`Unity: ${result.error ?? "the run failed"}`);
  return result;
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
      if (rest.includes("--all")) for (const m of done) console.log((m.approved ? "  ✓✓ " : "  ✓ ") + summary(m));
    }
    break;
  }
  case "show": {
    const { mark: m } = need(rest[0]);
    const f = (name) => path.join(m.folder, name);
    console.log(`# Mark #${m.seq} ${m.id} (${m.status}${m.source === "auto-error" ? ", auto-captured on an error" : ""})`);
    console.log(`category: ${m.category || "-"}\nnote: ${m.note || "(none)"}`);
    if (m.approved) console.log(`approved by the player in the game: ${m.approved.at}`);
    for (const r of m.reopened ?? []) console.log(`reopened by the player ${r.at}: the earlier fix ("${r.resolution?.note ?? ""}") did not hold${r.note ? `; they said: ${r.note}` : ""}`);
    console.log(`game: ${m.project?.name} ${m.project?.version} · ${engineLabel(m)} · ${m.os}${m.render_pipeline ? " · " + m.render_pipeline : ""}`);
    console.log(`scene: ${m.scene?.path}   at ${m.uptime_s}s, ${m.fps} fps${m.time_scale === undefined ? "" : `, time_scale ${m.time_scale}`}`);
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
        const extra = [n.script, n.prefab && "prefab " + n.prefab, n.element && "element " + n.element].filter(Boolean).join(", ");
        console.log(`     ${n.path} (${n.class}${extra ? ", " + extra : ""})`);
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
    const shotPath = flag("--shot");
    if (isCocos(project)) noWebRuns("warp", "Cocos Creator");
    if (isThree(project)) noWebRuns("warp", "three.js");
    if (isUnity(project) && !process.env.PLAYMARK_UNITY_PLAYER) {
      const result = unityRequest(root, { action: "warp", mark: m.id, ...(shotPath ? { shot: path.resolve(shotPath) } : {}) }, Boolean(shotPath));
      if (result) console.log(result.shot ?? path.resolve(shotPath));
      break;
    }
    if (isUnity(project)) {
      // A Development Build: the same flags, read from its command line.
      // The build keeps its own marks elsewhere: point it at this inbox, and pass the game's warp args.
      const player = process.env.PLAYMARK_UNITY_PLAYER;
      const gameArgs = Array.isArray(m.warp?.data?.args) ? m.warp.data.args.map(String) : [];
      const args = [...gameArgs, `-playmark-dir=${root}`, `-playmark-warp=${m.id}`, ...(shotPath ? [`-playmark-shot=${path.resolve(shotPath)}`] : [])];
      if (shotPath) {
        try {
          execFileSync(player, args, { stdio: "inherit", timeout: 110000 });
        } catch {
          die(`The build exited with an error (${player} ${args.join(" ")}). Its log says why.`);
        }
        console.log(path.resolve(shotPath));
      } else {
        spawn(player, args, { detached: true, stdio: "ignore" }).unref();
        console.log(`Opening the build at #${m.seq} (${player} ${args.join(" ")})`);
      }
      break;
    }
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
  case "smoke": {
    const root = roots[0] ?? projectRoot();
    if (!root) die("No Godot, Unity, Cocos or three.js project here. Run /playmark:install first.");
    const project = path.dirname(root);
    const out = path.resolve(flag("--out") ?? path.join(root, "smoke"));
    if (isCocos(project)) noWebRuns("smoke", "Cocos Creator");
    if (isThree(project)) noWebRuns("smoke", "three.js");
    if (isUnity(project)) {
      unityRequest(root, { action: "smoke", out }, true);
    } else {
      execFileSync(process.env.PLAYMARK_GODOT || "godot", ["--path", project, "--", `--playmark-smoke=${out}`], { stdio: "inherit", timeout: 120000 });
    }
    console.log(`Smoke run OK. Look at ${path.join(out, "smoke-overlay.png")} and ${path.join(out, "smoke-game.png")}.`);
    break;
  }
  case "export": {
    const root = roots[0];
    if (!root) die("No .playmark folder here. Play the game and press Ctrl+Shift+M to make one.");
    const marks = listMarks(root, "inbox").map((m) => ({ ...m, box: "inbox" }));
    if (rest.includes("--all")) marks.push(...listMarks(root, "done").map((m) => ({ ...m, box: "done" })));
    if (!marks.length) die(`No marks to export in ${root}${rest.includes("--all") ? "" : " (fixed ones need --all)"}.`);
    marks.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const out = path.resolve(flag("--out") ?? path.join(root, "export", "marks.html"));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const title = marks.find((m) => m.project?.name)?.project.name ?? path.basename(path.dirname(root));
    fs.writeFileSync(out, exportMarks(marks, { title }));
    console.log(`${marks.length} mark${marks.length === 1 ? "" : "s"} → ${out}`);
    break;
  }
  default:
    die("Commands: list [--all] | show <id> | claim <id> | resolve <id> [--note text] | reopen <id> | video <id> | warp <id> [--shot png] | smoke [--out dir] | export [--all] [--out file]");
}
