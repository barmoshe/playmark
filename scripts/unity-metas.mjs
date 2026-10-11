#!/usr/bin/env node
// Unity needs a .meta file next to every file and folder in a package installed from git (the
// package is read-only, so Unity can't make them, and it ignores anything without one).
//   unity-metas.mjs write   create missing .meta files, remove orphaned ones
//   unity-metas.mjs check   exit 1 if any are missing or orphaned (CI)
// GUIDs come from the path, so they are stable across machines and reruns.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "unity", "com.bar-builds.playmark");
const mode = process.argv[2];
if (mode !== "write" && mode !== "check") {
  console.error("Usage: unity-metas.mjs write | check");
  process.exit(1);
}

const tail = "  userData: \n  assetBundleName: \n  assetBundleVariant: \n";
const simple = (importer) => `${importer}:\n  externalObjects: {}\n${tail}`;
function body(rel, isDir) {
  if (isDir) return `folderAsset: yes\n${simple("DefaultImporter")}`;
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".cs") return `MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n${tail}`;
  if (ext === ".asmdef") return simple("AssemblyDefinitionImporter");
  if (rel === "package.json") return simple("PackageManifestImporter");
  if (ext === ".ttf" || ext === ".otf") {
    const name = path.basename(rel, ext).replace(/-\d+$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    return `TrueTypeFontImporter:\n  externalObjects: {}\n  serializedVersion: 4\n  fontSize: 16\n  forceTextureCase: -2\n  characterSpacing: 0\n  characterPadding: 1\n  includeFontData: 1\n  fontNames:\n  - ${name}\n  fallbackFontReferences: []\n  customCharacters: \n  fontRenderingMode: 0\n  ascentCalculationMode: 1\n  useLegacyBoundsCalculation: 0\n  shouldRoundAdvanceValue: 1\n${tail}`;
  }
  return simple(ext === ".md" || ext === ".txt" || ext === ".json" ? "TextScriptImporter" : "DefaultImporter");
}

const guid = (rel) => crypto.createHash("md5").update("com.bar-builds.playmark/" + rel.split(path.sep).join("/")).digest("hex");

const want = new Map(); // meta path -> content
const have = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(root, p);
    // Unity skips hidden items and folders ending in "~" (Samples~, Documentation~).
    if (e.name.startsWith(".") || e.name.endsWith("~")) continue;
    if (e.name.endsWith(".meta")) {
      have.add(p);
      continue;
    }
    want.set(p + ".meta", `fileFormatVersion: 2\nguid: ${guid(rel)}\n${body(rel, e.isDirectory())}`);
    if (e.isDirectory()) walk(p);
  }
})(root);

const missing = [...want.keys()].filter((m) => !fs.existsSync(m));
const orphans = [...have].filter((m) => !want.has(m));
if (mode === "check") {
  for (const m of missing) console.error(`missing: ${path.relative(root, m)}`);
  for (const m of orphans) console.error(`orphan: ${path.relative(root, m)}`);
  if (missing.length || orphans.length) {
    console.error("Run: node scripts/unity-metas.mjs write");
    process.exit(1);
  }
  console.log(`unity metas ok (${want.size})`);
} else {
  for (const m of missing) fs.writeFileSync(m, want.get(m));
  for (const m of orphans) fs.rmSync(m);
  console.log(`unity metas: ${missing.length} written, ${orphans.length} removed, ${want.size} total`);
}
