/**
 * XO Galaxy — media worker.
 * Sirve assets públicos de R2 (imágenes hoy, videos/avatars/thumbnails a futuro)
 * con cache immutable y CORS abierto. Sin auth: las URLs ya son hashes planos.
 * GET/HEAD <path>: key = "images/<hash>.<ext>" → env.IMAGES.get(key)
 */

const CONTENT_TYPE = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  svg: "image/svg+xml",
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method not allowed" }, 405, { "Access-Control-Allow-Origin": "*", Allow: "GET, HEAD, OPTIONS" });
    }
    const origin = request.headers.get("Origin");
    const cors = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { "Access-Control-Allow-Origin": "*" };

    const path = new URL(request.url).pathname.slice(1); // "images/abc123.jpg"

    // futuro: otros tipos de asset (videos/, avatars/, thumbs/) sin tocar backend
    let key = path;
    if (!key.startsWith("images/") && !key.startsWith("videos/")) {
      return json({ error: "not found" }, 404, cors);
    }
    if (key.includes("..") || key.includes("//")) {
      return json({ error: "not found" }, 404, cors);
    }

    let obj;
    try {
      obj = await env.IMAGES.get(key);
    } catch (err) {
      return json({ error: "media error" }, 500, cors);
    }
    if (!obj) {
      return json({ error: "not found" }, 404, cors);
    }

    const dot = key.lastIndexOf(".");
    const ext = dot !== -1 ? key.slice(dot + 1).toLowerCase() : "";
    const headers = {
      "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || CONTENT_TYPE[ext] || "application/octet-stream",
      "Cache-Control": (obj.httpMetadata && obj.httpMetadata.cacheControl) || "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": origin ? origin : "*",
      "Access-Control-Expose-Headers": "ETag",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ETag: obj.httpEtag || "",
    };
    if (origin) headers.Vary = "Origin";
    return new Response(obj.body, { headers });
  },
};