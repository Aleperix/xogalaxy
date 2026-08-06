/**
 * XO Galaxy — inyección de app.js en el template de Blogger.
 * Reemplaza el marcador `<!-- XOGALAXY_APP_SCRIPT -->` por un <script> embebido con el bundle.
 *
 * Uso:
 *   node inject.mjs <template.xml> <salida.xml>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MARKER = "<!-- XOGALAXY_APP_SCRIPT -->";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("uso: node inject.mjs <template.xml> <salida.xml>");
  process.exit(1);
}

const template = readFileSync(resolve(src), "utf8");
if (!template.includes(MARKER)) {
  console.error(`marcador ${MARKER} no encontrado en ${src}`);
  process.exit(1);
}

const bundle = readFileSync(join(ROOT, "dist", "app.js"), "utf8");
const script = `<script type="text/javascript">\n  //<![CDATA[\n${bundle}\n  //]]>\n</script>`;
writeFileSync(resolve(dest), template.replace(MARKER, script));
console.log("inyectado:", resolve(dest));
