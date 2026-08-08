/**
 * XO Galaxy — release de una nueva versión.
 *
 * Uso:
 *   node scripts/release.mjs [--version v21] [--notes notas/v21.md] [--dry]
 *
 * Flujo:
 *   1. build del bundle web (web/dist/app.js)
 *   2. inyección del bundle en theme/xogalaxy-template.xml -> dist/xogalaxy-template-<tag>.xml
 *   3. validación del XML (python3 + ElementTree)
 *   4. `gh release create <tag>` en el repo público (origin) con el XML como asset
 *      y las notas del changelog (si --notes no se pasa, se genera un mensaje corto).
 *
 * El changelog se escribe UNA vez en --notes; el widget lo muestra dinámicamente
 * desde GitHub Releases, así que el post del blog solo enlaza a la release.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_SRC = join(ROOT, "theme", "xogalaxy-template.xml");
const DIST_DIR = join(ROOT, "dist");

function run(cmd, opts) {
  execSync(cmd, { stdio: "inherit", shell: true, cwd: (opts && opts.cwd) || ROOT });
}

function fail(msg) {
  console.error("error:", msg);
  process.exit(1);
}

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    version: { type: "string" },
    notes: { type: "string" },
    dry: { type: "boolean", default: false },
  },
});

const tag = "v" + String(args.values.version || "v21").replace(/^v/, "");
const dryRun = args.values.dry;
const notesPath = args.values.notes ? resolve(ROOT, args.values.notes) : null;

console.log("==> release", tag, dryRun ? "(dry-run)" : "");

if (!existsSync(TEMPLATE_SRC)) fail(`no existe ${TEMPLATE_SRC}`);

console.log("==> build del bundle web");
run("npm run build", { cwd: join(ROOT, "web") });

console.log("==> inyección del bundle en el template");
mkdirSync(DIST_DIR, { recursive: true });
const injected = join(DIST_DIR, `xogalaxy-template-${tag}.xml`);
run(`node inject.mjs "${TEMPLATE_SRC}" "${injected}"`, { cwd: join(ROOT, "web") });
if (!existsSync(injected)) fail(`inyección falló: ${injected}`);

console.log("==> validación del XML");
const checkCmd = `python3 -c "import xml.etree.ElementTree as ET
ET.parse('${injected}')
print('XML OK')"`;
try {
  execSync(checkCmd, { stdio: "inherit", shell: true });
} catch (err) {
  fail("el XML inyectado no parsea");
}

let notesFile = notesPath;
if (!notesFile) {
  notesFile = join(DIST_DIR, `release-notes-${tag}.md`);
  writeFileSync(notesFile, `# ${tag}\n\nChangelog de esta versión (ver widget de releases en el blog).\n`);
} else if (!existsSync(notesFile)) {
  fail(`no existe el archivo de notas ${notesFile}`);
}

const notes = readFileSync(notesFile, "utf8");
const title = `XO Galaxy ${tag}`;

console.log("==> crear release en GitHub");
if (dryRun) {
  console.log(`[dry] gh release create ${tag} ${injected} --title "${title}" --notes-file ${notesFile}`);
} else {
  run(`gh release create ${tag} "${injected}" --title "${title}" --notes-file "${notesFile}"`);
}

console.log("==> listo:", tag);
