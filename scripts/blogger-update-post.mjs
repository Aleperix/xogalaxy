/**
 * XO Galaxy — edición del post vía Blogger API v3 (OAuth 2.0).
 *
 * Lee credenciales de ~/.config/xogalaxy/blogger.json (o la ruta de
 * XOGALAXY_BLOGGER_CREDS): client_id, client_secret, refresh_token,
 * blog_id y post_id. Las credenciales NO se guardan en el repo.
 *
 * Uso:
 *   node scripts/blogger-update-post.mjs [--post archivo.html] [--dry-run] [--force]
 *
 *   --dry-run  compara el HTML local contra el post actual sin escribir.
 *   --force    saltea la confirmación interactiva del diff.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS_PATH = process.env.XOGALAXY_BLOGGER_CREDS || join(homedir(), ".config", "xogalaxy", "blogger.json");
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/blogger/v3";

const args = process.argv.slice(2);
const postPath = (args.indexOf("--post") !== -1 ? args[args.indexOf("--post") + 1] : join(ROOT, "posts", "tumbleboy-reborn-xo-galaxy.html"));
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function fail(msg) {
  console.error("error:", msg);
  process.exit(1);
}

function readCreds() {
  if (!existsSync(CREDS_PATH)) fail(`no hay credenciales en ${CREDS_PATH} (falta autorizar OAuth)`);
  return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
}

async function refreshAccessToken(creds) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
  });
  const res = await fetch(TOKEN_URI, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json();
  if (!res.ok || !data.access_token) fail(`token: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

async function getPost(creds, token) {
  const url = `${API}/blogs/${creds.blog_id}/posts/${creds.post_id}?fields=id,title,updated,status,content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) fail(`GET post: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function patchPost(creds, token, content) {
  const url = `${API}/blogs/${creds.blog_id}/posts/${creds.post_id}?fields=id,title,updated,status`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) fail(`PATCH post: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function normalize(s) {
  return s.replace(/\r\n/g, "\n").trim();
}

async function run() {
  if (!existsSync(postPath)) fail(`no existe el HTML del post: ${postPath}`);
  const local = normalize(readFileSync(postPath, "utf8"));
  const creds = readCreds();
  const token = await refreshAccessToken(creds);

  console.log("obteniendo post actual...");
  const current = await getPost(creds, token);
  console.log(`  id=${current.id} title=${current.title} updated=${current.updated}`);

  const remote = normalize(current.content || "");
  if (remote === local) {
    console.log("el post local ya es idéntico al remoto; no hace falta PATCH.");
    return;
  }
  console.log(`  diff de bytes: local=${local.length} remoto=${remote.length}`);

  if (dryRun) {
    console.log("dry-run: no se escribió nada.");
    return;
  }

  if (!force) {
    const a = remote.split("\n"), b = local.split("\n");
    let first = 0;
    while (first < Math.min(a.length, b.length) && a[first] === b[first]) first++;
    let lastA = a.length, lastB = b.length;
    while (lastA > first && lastB > first && a[lastA - 1] === b[lastB - 1]) { lastA--; lastB--; }
    console.log(`  cambian líneas ${first + 1}..${lastB} de ${b.length} en local (remoto ${first + 1}..${lastA} de ${a.length})`);
  }

  const result = await patchPost(creds, token, local);
  console.log(`PATCH OK: id=${result.id} updated=${result.updated} status=${result.status}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
