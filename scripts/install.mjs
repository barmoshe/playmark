#!/usr/bin/env node
// Installs Playmark into a game project. Safe to run again (updates in place).
//   install.mjs [path] [--git]
// path = the project folder, or a repo with the project one level down.
//
// Godot 4.5+ (project.godot): copies addons/playmark, registers the autoload, enables the plugin.
// Unity 6+ (ProjectSettings/ProjectVersion.txt): copies the package into
//   Packages/com.bar-builds.playmark (an embedded package: in your repo, works offline, same
//   version as this plugin). With --git, adds it to Packages/manifest.json as a git URL pinned
//   to this plugin's release tag instead.
// Both: git-ignores .playmark/ (marks stay local).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const godotSource = path.join(pluginRoot, "addons", "playmark");
const unitySource = path.join(pluginRoot, "unity", "com.bar-builds.playmark");
const UNITY_PACKAGE = "com.bar-builds.playmark";
const args = process.argv.slice(2);
// Any other flag (--help included) must not fall through to installing into the current folder.
if (args.some((a) => a.startsWith("-") && a !== "--git")) {
  const help = args.includes("--help") || args.includes("-h");
  (help ? console.log : console.error)("Usage: install.mjs [path] [--git]\n  path: the Godot or Unity project, or a repo with it one level down (default: the current folder)\n  --git: Unity only, reference the package by git URL instead of copying it");
  process.exit(help ? 0 : 2);
}
const useGit = args.includes("--git");
const start = path.resolve(args.find((a) => !a.startsWith("--")) ?? process.cwd());

const isGodot = (dir) => fs.existsSync(path.join(dir, "project.godot"));
const isUnity = (dir) => fs.existsSync(path.join(dir, "ProjectSettings", "ProjectVersion.txt")) && fs.existsSync(path.join(dir, "Assets"));

function findProject(dir) {
  if (isGodot(dir)) return { dir, engine: "godot" };
  if (isUnity(dir)) return { dir, engine: "unity" };
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const sub = path.join(dir, e.name);
    if (isGodot(sub)) return { dir: sub, engine: "godot" };
    if (isUnity(sub)) return { dir: sub, engine: "unity" };
  }
  return null;
}

// --- Godot ----------------------------------------------------------------------------

// Adds `line` under [section], creating the section if needed. Returns the new text.
function ensureLine(text, section, key, line) {
  const header = `[${section}]`;
  const lines = text.split("\n");
  let start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return text.replace(/\s*$/, "") + `\n\n${header}\n\n${line}\n`;
  let end = lines.findIndex((l, i) => i > start && /^\[.+\]$/.test(l.trim()));
  if (end === -1) end = lines.length;
  const existing = lines.slice(start + 1, end).findIndex((l) => l.startsWith(key + "="));
  if (existing !== -1) {
    lines[start + 1 + existing] = line;
  } else {
    let at = end;
    while (at > start + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, line);
  }
  return lines.join("\n");
}

function enablePlugin(text) {
  const cfg = '"res://addons/playmark/plugin.cfg"';
  const m = text.match(/^enabled=PackedStringArray\((.*)\)$/m);
  if (m && m[1].includes(cfg)) return text;
  const list = m && m[1].trim() ? `${m[1]}, ${cfg}` : cfg;
  return ensureLine(text, "editor_plugins", "enabled", `enabled=PackedStringArray(${list})`);
}

function installGodot(project) {
  const target = path.join(project, "addons", "playmark");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(godotSource, target, { recursive: true, dereference: true });
  const file = path.join(project, "project.godot");
  let text = fs.readFileSync(file, "utf8");
  text = ensureLine(text, "autoload", "Playmark", 'Playmark="*res://addons/playmark/playmark.gd"');
  text = enablePlugin(text);
  fs.writeFileSync(file, text);
  console.log(`Playmark installed in ${project} (Godot)`);
  console.log("Run the game and press Ctrl+Shift+M to mark. Marks land in .playmark/inbox.");
}

// --- Unity ----------------------------------------------------------------------------

function installUnity(project) {
  const editor = fs.readFileSync(path.join(project, "ProjectSettings", "ProjectVersion.txt"), "utf8").match(/m_EditorVersion:\s*(\S+)/)?.[1] ?? "";
  if (editor && parseInt(editor, 10) < 6000) {
    console.error(`This project uses Unity ${editor}. Playmark needs Unity 6 (6000.0) or newer.`);
    process.exit(1);
  }
  const pluginVersion = JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
  const manifestFile = path.join(project, "Packages", "manifest.json");
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : { dependencies: {} };
  manifest.dependencies ??= {};
  const embedded = path.join(project, "Packages", UNITY_PACKAGE);
  if (useGit) {
    const [major, minor] = pluginVersion.split(".").map(Number);
    if (major === 0 && minor < 4) {
      console.error(`--git needs a release with the Unity package (0.4.0 or newer); this plugin is ${pluginVersion}. Run without --git to embed the package instead.`);
      process.exit(1);
    }
    fs.rmSync(embedded, { recursive: true, force: true }); // an embedded copy would win over the URL
    manifest.dependencies[UNITY_PACKAGE] = `https://github.com/barmoshe/playmark.git?path=/unity/${UNITY_PACKAGE}#v${pluginVersion}`;
  } else {
    fs.rmSync(embedded, { recursive: true, force: true });
    fs.cpSync(unitySource, embedded, { recursive: true, dereference: true });
    delete manifest.dependencies[UNITY_PACKAGE]; // Unity finds embedded packages by themselves
  }
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Playmark ${pluginVersion} installed in ${project} (Unity, ${useGit ? "git package" : `embedded in Packages/${UNITY_PACKAGE}`})`);
  console.log("Switch to Unity (it imports the package), press Play, then Ctrl+Shift+M to mark. Marks land in .playmark/inbox.");
}

// --------------------------------------------------------------------------------------

const found = findProject(start);
if (!found) {
  console.error(`No Godot (project.godot) or Unity (ProjectSettings/ProjectVersion.txt) project in ${start} or one level down.`);
  process.exit(1);
}
if (found.engine === "godot") installGodot(found.dir);
else installUnity(found.dir);

const ignore = path.join(found.dir, ".gitignore");
const ig = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
if (!ig.split("\n").includes(".playmark/")) fs.writeFileSync(ignore, ig.replace(/\n*$/, ig ? "\n" : "") + ".playmark/\n");
