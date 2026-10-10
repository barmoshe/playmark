// Shared helpers: find Playmark folders and read marks. Node built-ins only.
import fs from "node:fs";
import path from "node:path";

// A Playmark root is a `.playmark` folder. Looked up in $PLAYMARK_DIR, the cwd, and one
// level down (a repo whose Godot project lives in game/).
export function findRoots(cwd = process.cwd()) {
  if (process.env.PLAYMARK_DIR) return [path.resolve(process.env.PLAYMARK_DIR)];
  const roots = [];
  const here = path.join(cwd, ".playmark");
  if (isDir(here)) roots.push(here);
  for (const entry of safeReaddir(cwd)) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const candidate = path.join(cwd, entry, ".playmark");
    if (isDir(candidate)) roots.push(candidate);
  }
  return roots;
}

// Complete marks (folders with mark.json) in <root>/<box>, newest first.
export function listMarks(root, box = "inbox") {
  const dir = path.join(root, box);
  return safeReaddir(dir)
    .map((id) => readMark(path.join(dir, id)))
    .filter(Boolean)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

export function readMark(folder) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(folder, "mark.json"), "utf8"));
    return { ...data, folder };
  } catch {
    return null;
  }
}

export function findMark(roots, id) {
  for (const root of roots) {
    for (const box of ["inbox", "done"]) {
      for (const m of listMarks(root, box)) {
        const seq = /^#?\d{1,4}$/.test(id) ? Number(id.replace("#", "")) : null;
        if (seq !== null ? m.seq === seq : m.id === id || m.id.startsWith(id) || m.id.endsWith(id)) return { root, box, mark: m };
      }
    }
  }
  return null;
}

export function oneLine(text = "", max = 70) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
