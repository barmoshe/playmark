#!/usr/bin/env node
// Installs the Playmark addon into a Godot 4.5+ project. Safe to run again (updates in place).
//   install.mjs [path]   path = the project folder, or a repo with the project one level down
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, "..", "addons", "playmark");
const start = path.resolve(process.argv[2] ?? process.cwd());

function findProject(dir) {
  if (fs.existsSync(path.join(dir, "project.godot"))) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith(".") && fs.existsSync(path.join(dir, e.name, "project.godot"))) return path.join(dir, e.name);
  }
  return null;
}

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

const project = findProject(start);
if (!project) {
  console.error(`No project.godot in ${start} or one level down.`);
  process.exit(1);
}
const target = path.join(project, "addons", "playmark");
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true, dereference: true });

const file = path.join(project, "project.godot");
let text = fs.readFileSync(file, "utf8");
text = ensureLine(text, "autoload", "Playmark", 'Playmark="*res://addons/playmark/playmark.gd"');
text = enablePlugin(text);
fs.writeFileSync(file, text);

const ignore = path.join(project, ".gitignore");
const ig = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
if (!ig.split("\n").includes(".playmark/")) fs.writeFileSync(ignore, ig.replace(/\n*$/, ig ? "\n" : "") + ".playmark/\n");

console.log(`Playmark installed in ${project}`);
console.log("Run the game and press Ctrl+Shift+M to mark. Marks land in .playmark/inbox.");
