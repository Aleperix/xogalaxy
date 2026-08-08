/**
 * XO Galaxy — proxy de GitHub Releases de juegos.
 * GET /releases?url=<url de una página de releases de GitHub> (p. ej.
 * https://github.com/Aleperix/tumbleboy-reborn/releases/).
 * Valida que la URL apunte a github.com/<owner>/<repo>/releases..., la mapea
 * a la API pública (latest | tag/<tag>) y devuelve datos normalizados para el
 * widget del frontend (portada, botones de descarga con tamaño, changelog).
 * Usa XOGALAXY_GH_TOKEN si está configurado; el response se cachea 1h en el
 * CDN vía Cache-Control.
 */

const API = "https://api.github.com";
const RELEASES_RE = /^\/releases(?:\/(latest|tag)\/([^/?#]+))?\/?/;

export function parseReleaseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch (err) {
    throw new Error("invalid url");
  }
  if (url.origin !== "https://github.com") throw new Error("not a github release url");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("not a github release url");
  const owner = decodeURIComponent(parts[0]);
  const repo = decodeURIComponent(parts[1]);
  if (!owner || !repo) throw new Error("not a github release url");
  const rest = "/" + parts.slice(2).join("/");
  let tag = null;
  const m = RELEASES_RE.exec(rest);
  if (m && m[1] === "tag" && m[2]) tag = m[2];
  return { owner, repo, tag };
}

export function buildApiUrl({ owner, repo, tag }) {
  const base = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`;
  return tag ? `${base}/tags/${encodeURIComponent(tag)}` : `${base}/latest`;
}

function apiHeaders(env) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "xogalaxy-backend",
  };
  if (env.XOGALAXY_GH_TOKEN) headers.Authorization = `Bearer ${env.XOGALAXY_GH_TOKEN}`;
  return headers;
}

export async function fetchRelease(env, urlString) {
  const parsed = parseReleaseUrl(urlString);
  const apiUrl = buildApiUrl(parsed);
  const res = await fetch(apiUrl, { headers: apiHeaders(env) });
  if (!res.ok) throw new Error(`github HTTP ${res.status}`);
  const rel = await res.json();
  return normalizeRelease(parsed, rel);
}

export function normalizeRelease(parsed, rel) {
  const assets = (rel.assets || [])
    .map(function (a) {
      return { name: a.name, size: Number(a.size) || 0, browserDownloadUrl: a.browser_download_url || null };
    })
    .filter(function (a) {
      return a.browserDownloadUrl;
    });
  const cover = assets.find(function (a) {
    return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(a.name);
  });
  return {
    ok: true,
    owner: parsed.owner,
    repo: parsed.repo,
    tag: parsed.tag || rel.tag_name || null,
    tagName: rel.tag_name || null,
    name: rel.name || rel.tag_name || null,
    publishedAt: rel.published_at || null,
    body: rel.body || "",
    htmlUrl: rel.html_url || null,
    assets: assets,
    cover: cover ? cover.browserDownloadUrl : null,
  };
}
