/**
 * XO Galaxy — edición del post vía Blogger API v3 (OAuth 2.0).
 *
 * Lee credenciales de ~/.config/xogalaxy/blogger.json (o la ruta de
 * XOGALAXY_BLOGGER_CREDS): client_id, client_secret, refresh_token,
 * blog_id y post_id. Las credenciales NO se guardan en el repo. El post_id se
 * puede sobreescribir con --post-id o guardar por post en creds.posts
 * (mapea nombre de archivo -> post_id) para no pisar el post_id por defecto.
 *
 * Uso:
 *   node scripts/blogger-update-post.mjs [--post archivo.html] [--dry-run] [--force] [--post-id id]
 *   node scripts/blogger-update-post.mjs --create --post archivo.html --title "..." --labels "a,b,c"
 *   node scripts/blogger-update-post.mjs --page --post posts/condiciones-de-uso.html
 *
 *   --dry-run  compara el HTML local contra el post actual sin escribir.
 *   --force    saltea la confirmación interactiva del diff.
 *   --create   crea un post nuevo (guarda su post_id en creds.posts) y termina.
 *   --post-id  usa este id en vez del de las credenciales.
 *   --page     trata el archivo como una PÁGINA estática (Blogger /p/slug.html):
 *              extrae el bloque <div class="legal-page"> y hace upsert por el slug
 *              del título (lista las páginas, PATCH si existe, INSERT si no).
 *              Guarda el id en creds.pages (mapea nombre de archivo -> page_id).
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS_PATH = process.env.XOGALAXY_BLOGGER_CREDS || join(homedir(), ".config", "xogalaxy", "blogger.json");
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/blogger/v3";

const args = process.argv.slice(2);
const postPath = (args.indexOf("--post") !== -1 ? args[args.indexOf("--post") + 1] : join(ROOT, "posts", "tumbleboy-reborn-xo-galaxy.html"));
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const create = args.includes("--create");
const page = args.includes("--page");
const postIdOverride = args.indexOf("--post-id") !== -1 ? args[args.indexOf("--post-id") + 1] : null;
const title = args.indexOf("--title") !== -1 ? args[args.indexOf("--title") + 1] : null;
const labels = args.indexOf("--labels") !== -1 ? args[args.indexOf("--labels") + 1] : null;

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

async function getPost(creds, token, postId) {
  const url = `${API}/blogs/${creds.blog_id}/posts/${postId}?fields=id,title,updated,status,content`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) fail(`GET post: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function patchPost(creds, token, postId, content) {
  const url = `${API}/blogs/${creds.blog_id}/posts/${postId}?fields=id,title,updated,status`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) fail(`PATCH post: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function createPost(creds, token, content, title, labels) {
  const url = `${API}/blogs/${creds.blog_id}/posts?fields=id,title,status,url`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content,
      labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
    }),
  });
  const data = await res.json();
  if (!res.ok) fail(`CREATE post: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ---- páginas estáticas ----

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function pageTitleFromBlock(block) {
  const m = block.match(/<h2[^>]*>([^<]+)<\/h2>/);
  return m ? m[1].trim() : null;
}

function pageBody(full) {
  const MARK = '<div class="legal-page">';
  const idx = full.indexOf(MARK);
  return idx === -1 ? null : normalize(full.slice(idx));
}

async function listPages(creds, token) {
  let items = [];
  let nextToken = null;
  do {
    const url = `${API}/blogs/${creds.blog_id}/pages?status=live&maxResults=50&fields=items(id,title,url),nextPageToken${nextToken ? "&pageToken=" + encodeURIComponent(nextToken) : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) fail(`LIST pages: HTTP ${res.status} ${JSON.stringify(data)}`);
    items = items.concat(data.items || []);
    nextToken = data.nextPageToken || null;
  } while (nextToken);
  return items;
}

async function patchPage(creds, token, pageId, content) {
  const url = `${API}/blogs/${creds.blog_id}/pages/${pageId}?fields=id,title,updated,url`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!res.ok) fail(`PATCH page: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function insertPage(creds, token, content, title) {
  const url = `${API}/blogs/${creds.blog_id}/pages?fields=id,title,url`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });
  const data = await res.json();
  if (!res.ok) fail(`INSERT page: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function getPageId(creds, baseName) {
  return creds.pages && creds.pages[baseName] ? creds.pages[baseName] : null;
}

function savePageId(creds, baseName, id) {
  creds.pages = creds.pages || {};
  creds.pages[baseName] = id;
  try {
    writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn("aviso: no se pudo guardar el page_id en las credenciales:", e.message);
  }
}

function getPostId(creds, baseName) {
  if (postIdOverride) return postIdOverride;
  if (creds.posts && creds.posts[baseName]) return creds.posts[baseName];
  return creds.post_id;
}

function savePostId(creds, baseName, id) {
  creds.posts = creds.posts || {};
  creds.posts[baseName] = id;
  try {
    writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2) + "\n", "utf8");
  } catch (e) {
    console.warn("aviso: no se pudo guardar el post_id en las credenciales:", e.message);
  }
}

function normalize(s) {
  return s.replace(/\r\n/g, "\n").trim();
}

function postBody(full) {
  const m = full.match(/class="([a-z0-9-]+)-post"/);
  if (!m) return normalize(full);
  const MARK = `<div class="${m[1]}-post">`;
  const idx = full.indexOf(MARK);
  return normalize(idx === -1 ? full : full.slice(idx));
}

async function run() {
  if (!existsSync(postPath)) fail(`no existe el HTML del post: ${postPath}`);
  const full = readFileSync(postPath, "utf8");
  const creds = readCreds();
  const token = await refreshAccessToken(creds);
  const baseName = basename(postPath);

  if (page) {
    const local = pageBody(full);
    if (!local) fail(`--page requiere un bloque <div class="legal-page"> en ${postPath}`);
    const pTitle = title || pageTitleFromBlock(local);
    if (!pTitle) fail("no se pudo inferir el título: pasalo con --title");
    const slug = slugify(pTitle);
    console.log(`página "${pTitle}" (slug "${slug}")...`);

    const pages = await listPages(creds, token);
    const hit = pages.find((p) => slugify(p.title) === slug);

    if (hit) {
      console.log(`  encontrada: id=${hit.id} title=${hit.title} url=${hit.url}`);
      const remote = normalize(hit.content || "");
      if (remote === local) {
        console.log("la página local ya es idéntica a la remota; no hace falta PATCH.");
      } else {
        console.log(`  diff de bytes: local=${local.length} remoto=${remote.length}`);
        if (dryRun) {
          console.log("dry-run: no se escribió nada.");
        } else {
          const result = await patchPage(creds, token, hit.id, local);
          savePageId(creds, baseName, hit.id);
          console.log(`PATCH OK: id=${result.id} updated=${result.updated} url=${result.url}`);
        }
      }
      return;
    }

    console.log("  no existe; se creará.");
    if (dryRun) {
      console.log("dry-run: no se escribió nada.");
      return;
    }
    const created = await insertPage(creds, token, local, pTitle);
    savePageId(creds, baseName, created.id);
    console.log(`INSERT OK: id=${created.id} title=${created.title} url=${created.url}`);
    console.log(`  page_id guardado en creds.pages["${baseName}"]`);
    return;
  }

  const local = postBody(full);

  if (create) {
    if (!title) fail("--create requiere --title");
    if (!labels) fail("--create requiere --labels (separados por comas)");
    if (dryRun) { console.log("dry-run: no se creó nada."); return; }
    console.log("creando post...");
    const created = await createPost(creds, token, local, title, labels);
    savePostId(creds, baseName, created.id);
    console.log(`CREATE OK: id=${created.id} title=${created.title} status=${created.status}`);
    console.log(`  url=${created.url}`);
    console.log(`  post_id guardado en creds.posts["${baseName}"]`);
    return;
  }

  const postId = getPostId(creds, baseName);

  console.log("obteniendo post actual...");
  const current = await getPost(creds, token, postId);
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

  const result = await patchPost(creds, token, postId, local);
  console.log(`PATCH OK: id=${result.id} updated=${result.updated} status=${result.status}`);
}

run().catch((err) => { console.error(err); process.exit(1); });
