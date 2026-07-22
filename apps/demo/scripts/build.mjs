// Bundles src/main.ts (and the @er-explorer/* workspace packages it imports)
// into a single self-contained dist/index.html that can be opened directly
// in a browser with no dev server, no build step, and no network access.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src", "main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  outfile: path.join(distDir, "bundle.js")
});

const bundleJs = fs.readFileSync(path.join(distDir, "bundle.js"), "utf8");
const shellHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const standalone = shellHtml.replace('<script src="./bundle.js"></script>', `<script>\n${bundleJs}\n</script>`);
fs.writeFileSync(path.join(distDir, "index.html"), standalone);

console.log(`Built self-contained demo: ${path.relative(process.cwd(), path.join(distDir, "index.html"))} (${(standalone.length / 1024).toFixed(0)} KB)`);
