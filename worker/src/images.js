/**
 * XO Galaxy — images upload (R2).
 * Solo cuentas Google (sub) pueden subir. El cliente ya envió la imagen
 * optimizada (resize + WebP vía canvas del navegador); el worker solo guarda
 * y deduplica por SHA-256. Keys: images/<sub>/<hash>.<ext>
 */

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024;
const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function sha256(data) {
  const input = data instanceof ArrayBuffer ? data : new Uint8Array(data);
  let bytes;
  try {
    if (globalThis.crypto && crypto.subtle) {
      const hashBuf = await crypto.subtle.digest("SHA-256", input);
      bytes = new Uint8Array(hashBuf);
    } else {
      bytes = input;
    }
  } catch (err) {
    bytes = input;
  }
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export async function handleImageUpload(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  if (!env.IMAGES) {
    return json({ error: "R2 not configured" }, 503, cors(origin));
  }
  const { Auth } = await import("./auth.js");
  const token = request.headers.get("X-XOGALAXY-Token") || "";
  let profile = null;
  if (token) {
    try {
      profile = await new Auth(env).verify(token, env.GOOGLE_CLIENT_ID);
    } catch (err) {
      profile = null;
    }
  }
  if (!profile || !profile.sub) {
    return json({ error: "solo cuentas Google pueden subir imágenes" }, 403, cors(origin));
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return json({ error: "invalid form data" }, 400, cors(origin));
  }
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return json({ error: "file required" }, 400, cors(origin));
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return json({ error: "tipo no permitido: " + file.type }, 400, cors(origin));
  }
  if (file.size > MAX_SIZE) {
    return json({ error: "máximo 5MB" }, 400, cors(origin));
  }

  try {
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    const ext = EXT_BY_TYPE[file.type] || "bin";
    const key = `images/${profile.sub}/${hash}.${ext}`;
    const existing = await env.IMAGES.head(key);
    if (!existing) {
      await env.IMAGES.put(key, buf, {
        httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
      });
    }
    return json({ url: `https://images.xogalaxy.com/${key}`, key }, 200, cors(origin));
  } catch (err) {
    return json({ error: "upload failed: " + err.message }, 500, cors(origin));
  }
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
}
function cors(origin) {
  return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,X-XOGALAXY-Token" };
}
