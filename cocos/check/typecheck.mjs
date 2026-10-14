#!/usr/bin/env node
// Type-checks the Cocos package the way a Cocos Creator 3.8 project compiles it (ES2015, strict),
// against a real project's generated declarations. No Cocos editor run, no install.
//   typecheck.mjs <cocos project> [path to typescript's tsc.js]
// The project must have been opened (or built) once, so temp/declarations/ exists.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "playmark");
const [projectArg, tscArg] = process.argv.slice(2);
if (!projectArg) {
  console.error("Usage: typecheck.mjs <cocos project> [tsc.js]");
  process.exit(2);
}
const decl = path.resolve(projectArg, "temp", "declarations");
if (!fs.existsSync(path.join(decl, "cc.d.ts"))) {
  console.error(`No ${path.join(decl, "cc.d.ts")}. Open or build the project once so Cocos writes it.`);
  process.exit(1);
}
// Cocos ships TypeScript inside the editor; any recent tsc works.
const guesses = [
  tscArg,
  process.env.TSC_JS,
  "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine/node_modules/typescript/lib/tsc.js",
  "/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/tsc.js",
].filter(Boolean);
const tsc = guesses.find((p) => fs.existsSync(p));
if (!tsc) {
  console.error("No tsc.js found. Pass its path, or set TSC_JS.");
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playmark-cocos-tsc-"));
const config = {
  compilerOptions: { target: "ES2015", module: "ES2015", strict: true, noEmit: true, isolatedModules: true, moduleResolution: "node", experimentalDecorators: true, skipLibCheck: true, types: [] },
  files: [...fs.readdirSync(decl).filter((f) => f.endsWith(".d.ts")).map((f) => path.join(decl, f)), ...fs.readdirSync(pkg).filter((f) => f.endsWith(".ts")).map((f) => path.join(pkg, f))],
};
fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config, null, 2));
try {
  execFileSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { stdio: "inherit" });
  console.log("cocos package: types ok");
} catch {
  process.exit(1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
