/**
 * XO Galaxy — images upload (R2).
 * Solo cuentas Google (sub) pueden subir. Imágenes ≤5MB, convertidas a WebP,
 * deduplicadas por SHA-256. Keys: images/<sub>/<hash>.webp
 */

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024;
const MAX_DIMENSION = 1600;

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

async function resizeWebp(blob, maxDim) {
  const bmp = await createImageBitmap(blob);
  let w = bmp.width;
  let h = bmp.height;
  if (w > maxDim || h > maxDim) {
    const ratio = Math.min(maxDim / w, maxDim / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
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
    const originalBlob = new Blob([await file.arrayBuffer()], { type: file.type });
    const webpBlob = await resizeWebp(originalBlob, MAX_DIMENSION);
    const buf = await webpBlob.arrayBuffer();
    const hash = await sha256(buf);
    const key = `images/${profile.sub}/${hash}.webp`;
    const existing = await env.IMAGES.head(key);
    if (!existing) {
      await env.IMAGES.put(key, buf, {
        httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
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
