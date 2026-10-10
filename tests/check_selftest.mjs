// Checks what tests/run_selftest.sh left behind. Exit 1 with a list of failures.
import fs from "node:fs";
import path from "node:path";

const [root, shots, logFile] = process.argv.slice(2);
const fails = [];
const ok = (cond, what) => cond || fails.push(what);
const log = fs.readFileSync(logFile, "utf8");
ok(log.includes("demo: selftest DONE"), "the selftest finished");
ok(!/SCRIPT ERROR/.test(log), "no script errors");

const read = (box) => (fs.existsSync(path.join(root, box)) ? fs.readdirSync(path.join(root, box)) : [])
  .map((id) => JSON.parse(fs.readFileSync(path.join(root, box, id, "mark.json"), "utf8")));
const done = read("done");
const inbox = read("inbox");
const fixed = done.find((m) => m.source === "player");
ok(fixed, "the player mark was resolved into done/");
if (fixed) {
  const dir = path.join(root, "done", fixed.id);
  ok(fixed.status === "fixed" && fixed.resolution?.note, "status fixed with a resolution note");
  ok(fixed.marks.length === 2 && fixed.marks[0].world, "two marks, the first with a world position");
  ok(fixed.under_marks[0].physics.some((n) => n.path === "Enemy1"), "pin 1 found Enemy1 by physics");
  ok(fixed.under_marks[1].nodes.some((n) => n.script === "res://player.gd"), "box 2 found the player script");
  ok(fixed.context?.demo?.score >= 0, "custom context saved");
  ok(fixed.category === "feel" && fixed.seq >= 1, "category and seq");
  for (const f of ["screenshot.png", "annotated.png", "clip_sheet.png", "log.txt"]) ok(fs.existsSync(path.join(dir, f)), f);
  ok(fs.readdirSync(path.join(dir, "clip")).length >= 10, "at least 10 clip frames");
  ok(fs.readFileSync(path.join(dir, "log.txt"), "utf8").includes("a warning for the log"), "log captured the warning");
}
ok(inbox.some((m) => m.source === "auto-error" && m.note.includes("boom")), "the script error became an auto mark");
for (const s of ["overlay", "stamp", "working", "fixed", "near", "auto"]) ok(fs.existsSync(path.join(shots, s + ".png")), `capture ${s}.png`);

if (fails.length) {
  console.error("FAIL\n  " + fails.join("\n  "));
  process.exit(1);
}
console.log("selftest: all checks passed");
