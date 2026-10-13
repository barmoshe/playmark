#!/usr/bin/env node
// Keeps every version number in step. Used by CI and by releases.
//   versions.mjs check [--tag vX.Y.Z]   exit 1 if any place disagrees (or with the tag)
//   versions.mjs bump X.Y.Z             write X.Y.Z everywhere and open its CHANGELOG section
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACES = [
  { file: "plugin.json", re: /("version":\s*")([^"]+)(")/ },
  { file: ".claude-plugin/plugin.json", re: /("version":\s*")([^"]+)(")/ },
  { file: "addons/playmark/plugin.cfg", re: /(version=")([^"]+)(")/ },
  { file: "addons/playmark/playmark.gd", re: /(const VERSION := ")([^"]+)(")/ },
  { file: "unity/com.bar-builds.playmark/package.json", re: /("version":\s*")([^"]+)(")/ },
  { file: "unity/com.bar-builds.playmark/Runtime/Playmark.cs", re: /(public const string Version = ")([^"]+)(")/ },
  { file: "cocos/playmark/playmark.ts", re: /(PLAYMARK_VERSION = ')([^']+)(')/ },
];

const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const found = () => PLACES.map((p) => ({ ...p, version: read(p.file).match(p.re)?.[2] }));

const [cmd, arg, value] = process.argv.slice(2);
if (cmd === "check") {
  const all = found();
  const versions = new Set(all.map((p) => p.version));
  const tag = arg === "--tag" ? value?.replace(/^v/, "") : null;
  const changelog = read("CHANGELOG.md").includes(`## ${all[0].version}`);
  for (const p of all) console.log(`${p.version}  ${p.file}`);
  if (versions.size !== 1) { console.error("Versions disagree."); process.exit(1); }
  if (tag && !versions.has(tag)) { console.error(`Tag v${tag} does not match ${all[0].version}.`); process.exit(1); }
  if (!changelog) { console.error(`CHANGELOG.md has no "## ${all[0].version}" section.`); process.exit(1); }
  console.log("versions ok");
} else if (cmd === "bump" && /^\d+\.\d+\.\d+$/.test(arg ?? "")) {
  for (const p of PLACES) fs.writeFileSync(path.join(root, p.file), read(p.file).replace(p.re, `$1${arg}$3`));
  const log = read("CHANGELOG.md");
  if (!log.includes(`## ${arg}`)) {
    const next = log.includes("## Unreleased")
      ? log.replace("## Unreleased", `## ${arg}`)
      : log.replace("# Changelog\n", `# Changelog\n\n## ${arg}\n\n- \n`);
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), next);
  }
  console.log(`bumped to ${arg}; edit CHANGELOG.md, commit, then: git tag v${arg} && git push --tags`);
} else {
  console.error("Usage: versions.mjs check [--tag vX.Y.Z] | bump X.Y.Z");
  process.exit(1);
}
