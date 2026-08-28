/**
 * XO Galaxy — build tiptap.js (lazy-loaded editor bundle).
 * npx esbuild src/editor.js --bundle --minify --format=esm --outfile=dist/tiptap.js
 */
import { build } from "esbuild";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const out = resolve(ROOT, "dist", "tiptap.js");

await build({
  entryPoints: [resolve(ROOT, "src/editor.js")],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: out,
  target: "es2020",
  logLevel: "info",
  treeShaking: true,
  define: { "process.env.NODE_ENV": '"production"' },
}).catch(() => process.exit(1));

console.log("built:", out);
