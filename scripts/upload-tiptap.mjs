/**
 * XO Galaxy — subir web/dist/tiptap.js a Workers KV (asset:tiptap).
 * El worker lo sirve en /dist/tiptap.js con CORS para el import() dinámico.
 *
 * Uso:
 *   node scripts/upload-tiptap.mjs
 *   node scripts/upload-tiptap.mjs --file web/dist/tiptap.js
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    file: { type: "string", default: "web/dist/tiptap.js" },
  },
});

const file = resolve(ROOT, args.values.file);
if (!existsSync(file)) {
  console.error("error: no existe", file, "(corré web/build-tiptap.mjs primero)");
  process.exit(1);
}

console.log("==> subiendo", file, "a KV assets:tiptap");
execSync(
  `npx wrangler kv key put 'assets:tiptap' --path "${file}" --binding XOGALAXY_KV --remote`,
  { stdio: "inherit", cwd: join(ROOT, "worker") }
);
console.log("==> listo: probá con curl https://backend.xogalaxy.workers.dev/dist/tiptap.js");