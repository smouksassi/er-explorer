#!/usr/bin/env node
/**
 * CI-parity build verification (see docs/BUILD.md).
 * Run from repo root: node apps/demo/scripts/verify-build.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const tscJs = path.join(root, "node_modules", "typescript", "bin", "tsc");

function run(label, args) {
  console.log(`\n> ${label}`);
  const r = spawnSync(process.execPath, [tscJs, ...args], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const packages = ["domain", "analysis", "model-linear", "data", "renderer", "session-engine"];
for (const pkg of packages) {
  run(`tsc packages/${pkg}`, ["-p", `packages/${pkg}/tsconfig.build.json`]);
}

console.log("\n> build-data.mjs");
const dataBuild = spawnSync(process.execPath, ["apps/demo/scripts/build-data.mjs"], { cwd: root, stdio: "inherit" });
if (dataBuild.status !== 0) process.exit(dataBuild.status ?? 1);

run("tsc apps/demo", ["-p", "apps/demo/tsconfig.json"]);

console.log("\n> build.mjs");
const bundle = spawnSync(process.execPath, ["apps/demo/scripts/build.mjs"], { cwd: root, stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);

console.log("\nverify-build: OK");
