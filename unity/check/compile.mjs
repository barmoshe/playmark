#!/usr/bin/env node
// Compiles the Unity package with the real C# compiler against a Unity Editor's own assemblies,
// without running Unity (no license, no project). Catches API mistakes, missing usings and
// C# features Unity can't take, in every optional-module combination.
//
//   node unity/check/compile.mjs [--unity <Editor/Data dir>] [--inputsystem <package dir>]
//
// --unity: the Editor's Data folder (holds Managed/ and NetStandard/). Default $UNITY_DATA,
//   else /opt/unity-ref/Editor/Data. CI extracts it from the Linux Editor archive.
// --inputsystem: an unpacked com.unity.inputsystem package. Default $UNITY_INPUTSYSTEM,
//   else /opt/unity-pkgs/inputsystem/package. Without it, the Input System path is skipped.
// Needs the .NET SDK (dotnet) for csc.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..", "..");
const pkg = path.join(repo, "unity", "com.bar-builds.playmark");
const flag = (name, env, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : process.env[env] || fallback;
};
const data = flag("--unity", "UNITY_DATA", "/opt/unity-ref/Editor/Data");
const inputPkg = flag("--inputsystem", "UNITY_INPUTSYSTEM", "/opt/unity-pkgs/inputsystem/package");
const managed = path.join(data, "Managed");
const engineDir = path.join(managed, "UnityEngine");
const ugui = path.join(data, "Resources", "PackageManager", "BuiltInPackages", "com.unity.ugui");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "playmark-compile-"));

if (!fs.existsSync(engineDir)) {
  console.error(`No Unity assemblies at ${engineDir}. Pass --unity <Editor/Data>.`);
  process.exit(2);
}

const csc = (() => {
  const dotnet = execFileSync("bash", ["-lc", "command -v dotnet"], { encoding: "utf8" }).trim();
  const sdkRoot = path.join(path.dirname(fs.realpathSync(dotnet)), "sdk");
  const sdk = fs.readdirSync(sdkRoot).sort().pop();
  return { dotnet, dll: path.join(sdkRoot, sdk, "Roslyn", "bincore", "csc.dll") };
})();

const netstandard = path.join(data, "NetStandard", "ref", "2.1.0", "netstandard.dll");
const compat = path.join(data, "NetStandard", "compat", "2.1.0", "shims", "netfx");
const dlls = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : []);
const engineRefs = dlls(engineDir, /^UnityEngine\..*Module\.dll$/);
const editorRefs = dlls(engineDir, /^UnityEditor\..*Module\.dll$/);
const sources = (dir, skip = /(Tests|Editor)[\\/]/) => {
  const all = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.endsWith("~")) walk(p); }
      else if (e.name.endsWith(".cs") && !skip.test(path.relative(dir, p) + (e.isDirectory() ? "/" : ""))) all.push(p);
    }
  };
  walk(dir);
  return all;
};

function compile(name, files, refs, defines, { warnAsError = false, nowarn = [], unsafe = false } = {}) {
  const dll = path.join(out, name + ".dll");
  const rsp = path.join(out, name + ".rsp");
  const lines = [
    "-nologo", "-noconfig", "-nostdlib", "-target:library", "-langversion:9", "-deterministic",
    `-out:${dll}`, `-r:${netstandard}`,
    ...refs.map((r) => `-r:${r}`),
    `-define:${["UNITY_6000_0_OR_NEWER", "UNITY_2021_3_OR_NEWER", "UNITY_2022_3_OR_NEWER", "UNITY_2023_1_OR_NEWER", "UNITY_STANDALONE", ...defines].join(";")}`,
    ...(warnAsError ? ["-warnaserror+"] : []),
    ...(unsafe ? ["-unsafe"] : []),
    ...(nowarn.length ? [`-nowarn:${nowarn.join(",")}`] : []),
    ...files.map((f) => `"${f}"`),
  ];
  fs.writeFileSync(rsp, lines.join("\n"));
  try {
    execFileSync(csc.dotnet, [csc.dll, `@${rsp}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const text = (e.stdout || "") + (e.stderr || "");
    const errors = text.split("\n").filter((l) => / error | warning /.test(l));
    console.error(`FAIL ${name} [${defines.join(" ") || "no optional modules"}]\n  ` + errors.slice(0, 40).join("\n  "));
    process.exitCode = 1;
    return null;
  }
  return dll;
}

// Dependencies first, from their package sources, the way Unity builds them.
const uiDefines = ["PACKAGE_PHYSICS", "PACKAGE_PHYSICS2D", "PACKAGE_ANIMATION", "PACKAGE_UITOOLKIT"];
const ui = compile("UnityEngine.UI", sources(path.join(ugui, "Runtime", "UGUI")), engineRefs, uiDefines, { nowarn: ["0618", "0649", "0414", "0169", "0067", "0108", "0114", "0672", "0809"] });
let input = null;
if (fs.existsSync(path.join(inputPkg, "InputSystem"))) {
  // Console and mobile plugins need platform-generated code; Playmark only touches the core API.
  const inputSources = sources(path.join(inputPkg, "InputSystem"), /((^|[\\/])(Editor|Tests|Switch|Steam|XR|Android|iOS|WebGL)[\\/]|EditorWindowSpaceProcessor)/);
  input = compile("Unity.InputSystem", inputSources, [...engineRefs, ...(ui ? [ui] : [])], ["UNITY_INPUT_SYSTEM_ENABLE_UI", "PACKAGE_DOCS_GENERATION", "UNITY_INPUT_SYSTEM_PROJECT_WIDE_ACTIONS", "UNITY_INPUT_SYSTEM_INPUT_ACTIONS_EDITOR_AUTO_SAVE_ON_FOCUS_LOST"], { nowarn: ["0618", "0649", "0414", "0169", "0067", "0108", "0114", "0672", "0809", "0612", "1574", "1584", "1580", "1581", "0419"], unsafe: true });
  if (!input && !process.argv.includes("--inputsystem")) {
    // Locally, a mismatched Input System version shouldn't block the rest; in CI (an explicit
    // --inputsystem) it fails the run.
    console.error("(the Input System source did not build here; checking without it)");
    process.exitCode = 0;
  }
}
if (!ui) process.exit(1);

const core = compile("BarBuilds.Playmark.Core", sources(path.join(pkg, "Core")), [], [], { warnAsError: true });
if (!core) process.exit(1);
const runtimeSources = sources(path.join(pkg, "Runtime"));
const combos = [
  ["PLAYMARK_PHYSICS", "PLAYMARK_PHYSICS2D", ...(input ? ["PLAYMARK_INPUT_SYSTEM"] : [])],
  [], // physics modules disabled, legacy input only
];
let runtime = null;
for (const defs of combos) {
  const dll = compile("BarBuilds.Playmark" + (defs.length ? "" : ".Bare"), runtimeSources, [...engineRefs, core, ui, ...(input && defs.includes("PLAYMARK_INPUT_SYSTEM") ? [input] : [])], defs, { warnAsError: true });
  if (defs.length && dll) runtime = dll;
}
// The runtime as the Editor compiles it (UNITY_EDITOR), then the Editor assembly on top.
const runtimeEd = compile("BarBuilds.Playmark", runtimeSources, [...engineRefs, ...editorRefs, core, ui, ...(input ? [input] : [])], ["UNITY_EDITOR", "PLAYMARK_PHYSICS", "PLAYMARK_PHYSICS2D", ...(input ? ["PLAYMARK_INPUT_SYSTEM"] : [])], { warnAsError: true });
if (runtimeEd) compile("BarBuilds.Playmark.Editor", sources(path.join(pkg, "Editor"), /Tests[\\/]/), [...engineRefs, ...editorRefs, core, runtimeEd, ui], ["UNITY_EDITOR"], { warnAsError: true });

// The Toy sample compiles into the user's project (Assembly-CSharp and Assembly-CSharp-Editor).
const toy = path.join(pkg, "Samples~", "Toy");
if (runtime && fs.existsSync(toy)) {
  const toyDll = compile("Toy", sources(toy), [...engineRefs, core, runtime], [], { warnAsError: true });
  if (toyDll) compile("Toy.Editor", sources(path.join(toy, "Editor"), /Tests[\\/]/), [...engineRefs, ...editorRefs, toyDll], ["UNITY_EDITOR"], { warnAsError: true });
}

if (!process.exitCode) console.log(`unity package: compiles against ${path.basename(path.dirname(path.dirname(data))) || data} (${input ? "with" : "without"} the Input System)`);
fs.rmSync(out, { recursive: true, force: true });
