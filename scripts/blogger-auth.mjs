/**
 * XO Galaxy — (re)autorización OAuth para la Blogger API.
 *
 * Flujo:
 *   1. Lee client_id/client_secret de ~/.config/xogalaxy/blogger.json o, si se
 *      pasa --secret <archivo>, desde un JSON descargado de Google Cloud
 *      Console (tipo "installed"/desktop). Si no hay credenciales válidas,
 *      falla con instrucciones.
 *   2. Levanta un servidor local en 127.0.0.1 y abre el browser con la pantalla
 *      de consentimiento (scope blogger, access_type=offline, prompt=consent).
 *   3. Captura el ?code= del redirect, lo cambia por tokens y guarda el
 *      refresh_token (y client_id/client_secret usados) en blogger.json.
 *
 * Uso:
 *   node scripts/blogger-auth.mjs [--secret ~/Downloads/client_secret_xxx.json]
 *
 * Requisitos en Google Cloud Console (https://console.cloud.google.com/apis/credentials):
 *   - Un ID de cliente OAuth tipo "Aplicación de escritorio".
 *   - El JSON descargado ("Descargar JSON") es el que se pasa con --secret.
 */
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS_PATH = process.env.XOGALAXY_BLOGGER_CREDS || join(homedir(), ".config", "xogalaxy", "blogger.json");
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/blogger";
const PORT = 8321;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const secretArg = args.indexOf("--secret") !== -1 ? args[args.indexOf("--secret") + 1] : null;

function fail(msg) {
  console.error("error:", msg);
  process.exit(1);
}

// ---- credenciales ----

let clientId = null;
let clientSecret = null;

if (secretArg) {
  if (!existsSync(secretArg)) fail(`no existe ${secretArg}`);
  const raw = JSON.parse(readFileSync(secretArg, "utf8"));
  const key = Object.keys(raw).find((k) => k === "installed" || k === "web");
  const c = key ? raw[key] : raw;
  if (!c.client_id || !c.client_secret) fail("el archivo --secret no tiene client_id/client_secret");
  clientId = c.client_id;
  clientSecret = c.client_secret;
} else {
  // buscar el client_secret_*.json más reciente en ~/.config/xogalaxy/
  const dir = CREDS_PATH.slice(0, CREDS_PATH.lastIndexOf("/"));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("client_secret")).sort() : [];
  if (!existsSync(CREDS_PATH) && !files.length) {
    fail(`no hay credenciales ni archivos client_secret_* en ${dir}.
Pasá uno con --secret <archivo.json> (descargado de Google Cloud Console).`);
  }
}

const existing = existsSync(CREDS_PATH) ? JSON.parse(readFileSync(CREDS_PATH, "utf8")) : {};
if (!clientId) {
  clientId = existing.client_id || null;
}
if (!clientSecret && existing.client_secret && existing.client_id === clientId) {
  clientSecret = existing.client_secret;
}
if (!clientId || !clientSecret) {
  fail("faltan client_id/client_secret: pasá --secret <archivo.json> descargado de Google Cloud Console.");
}

console.log("cliente:", clientId);

// ---- servidor local para capturar el code ----

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.searchParams.get("error")) {
    res.end("<h1>Autorización cancelada</h1><p>Podés cerrar esta pestaña.</p>");
    finish(null, url.searchParams.get("error"));
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("falta code");
    return;
  }
  res.end("<h1>¡Listo!</h1><p>Autorización completada. Podés cerrar esta pestaña y volver a la terminal.</p>");
  finish(code, null);
});

server.listen(PORT, "127.0.0.1", () => {
  const authUrl =
    `${AUTH_URI}?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=${encodeURIComponent(SCOPE)}` +
    `&access_type=offline&prompt=consent`;
  console.log("");
  console.log("Abrí este enlace en el browser (elegí tu cuenta de Google del blog):");
  console.log("");
  console.log(authUrl);
  console.log("");
});

server.on("error", (err) => {
  fail(`no se pudo escuchar en 127.0.0.1:${PORT} (${err.message}); ¿está libre el puerto?`);
});

async function finish(code, error) {
  server.close();
  if (error) fail(`autorización cancelada: ${error}`);
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URI, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    fail(`token exchange: HTTP ${res.status} ${JSON.stringify(data.error_description || data)}`);
  }

  const creds = Object.assign({}, existing, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: data.refresh_token,
    scope: data.scope || SCOPE,
  });
  if (!creds.blog_id) {
    console.log("aviso: blogger.json no tiene blog_id; agregalo a mano (el del blog xogalax.blogspot.com).");
  }
  writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2) + "\n", "utf8");
  console.log(`refresh_token nuevo guardado en ${CREDS_PATH}`);
  process.exit(0);
}
