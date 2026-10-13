// One HTML page with every mark: the annotated frame, the note, the clip, the code under each
// pin and the log. Images are embedded, so the file can be opened anywhere or sent to anyone.
// No agent needed: this is how a team reads marks without Claude Code or Codex.
import fs from "node:fs";
import path from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function image(folder, name, alt) {
  const file = path.join(folder, name);
  if (!fs.existsSync(file)) return "";
  const data = fs.readFileSync(file).toString("base64");
  return `<img src="data:image/png;base64,${data}" alt="${esc(alt)}">`;
}

function engine(m) {
  const names = { unity: "Unity", cocos: "Cocos Creator", three: "three.js", godot: "Godot" };
  if (m.engine && typeof m.engine === "object") return `${names[m.engine.name] ?? m.engine.name ?? "Godot"} ${m.engine.version ?? ""}`.trim();
  return `Godot ${m.engine ?? ""}`.trim();
}

// The scripts and objects under each pin or box, one line each.
function under(m) {
  const rows = [];
  for (const u of m.under_marks ?? []) {
    for (const n of [...(u.physics ?? []), ...(u.nodes ?? []), ...(u.ui ?? [])]) {
      rows.push(`<li><b>#${u.mark}</b> ${esc(n.path)} <span>${esc(n.class)}</span>${n.script ? ` <code>${esc(n.script)}</code>` : ""}</li>`);
    }
  }
  return rows.length ? `<ul class="under">${rows.slice(0, 12).join("")}</ul>` : "";
}

function logTail(folder, lines = 15) {
  const file = path.join(folder, "log.txt");
  if (!fs.existsSync(file)) return "";
  const tail = fs.readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  return tail ? `<details><summary>Log, last ${lines} lines</summary><pre>${esc(tail)}</pre></details>` : "";
}

function card(m) {
  const fixed = m.status === "fixed" || m.box === "done";
  const when = String(m.created_at ?? "").replace("T", " ").slice(0, 16);
  return `<article class="${fixed ? "fixed" : ""}">
  <header>
    <span class="num">#${esc(m.seq ?? "?")}</span>
    <span class="cat">${esc(m.category || "no category")}</span>
    ${fixed ? '<span class="state">fixed</span>' : ""}
    <span class="meta">${esc(m.scene?.path ?? "")} · ${esc(engine(m))} · ${esc(when)} · ${esc(m.id)}</span>
  </header>
  <p class="note">${esc(m.note || "(no note)")}</p>
  ${m.resolution?.note ? `<p class="resolution">Fixed: ${esc(m.resolution.note)}</p>` : ""}
  ${image(m.folder, "annotated.png", `Mark #${m.seq}: the frozen frame with numbered pins and boxes`)}
  ${under(m)}
  <details><summary>The last seconds before the mark</summary>${image(m.folder, "clip_sheet.png", "Frames from the last seconds, oldest first")}</details>
  ${logTail(m.folder)}
</article>`;
}

export function exportMarks(marks, { title }) {
  const open = marks.filter((m) => m.box !== "done").length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: Playmark marks</title>
<style>
  :root { --ink: #111; --paper: #f2efe6; --orange: #f2621b; --blue: #6faef2; --muted: #8a877f; }
  body { margin: 0; background: var(--ink); color: var(--paper); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 32px; }
  article { border-left: 4px solid var(--orange); background: #1b1b1b; padding: 16px 20px; margin: 0 0 28px; }
  article.fixed { border-color: var(--blue); }
  header { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; }
  .num { font-weight: 800; font-size: 22px; }
  .cat, .state { text-transform: uppercase; font: 700 12px/1 ui-monospace, monospace; padding: 4px 8px; background: var(--orange); color: var(--ink); }
  .state { background: var(--blue); }
  .meta { color: var(--muted); font: 12px ui-monospace, monospace; }
  .note { font-size: 20px; margin: 12px 0; }
  .resolution { color: var(--blue); }
  img { display: block; max-width: 100%; height: auto; margin: 12px 0; }
  ul.under { font: 13px/1.6 ui-monospace, monospace; padding-left: 18px; color: #d8d4c8; }
  ul.under span { color: var(--muted); }
  code { color: var(--orange); }
  details { margin: 8px 0; } summary { cursor: pointer; color: var(--muted); }
  pre { white-space: pre-wrap; font-size: 12px; background: #000; padding: 12px; overflow-x: auto; }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">${marks.length} mark${marks.length === 1 ? "" : "s"}, ${open} open · exported ${new Date().toLocaleString("sv").slice(0, 16)} · made with Playmark</p>
${marks.map(card).join("\n")}
</main>
</body>
</html>
`;
}
