/**
 * XO Galaxy — auth Google (ID token).
 * Verifica el JWT de Google Identity Services en el worker (sin secretos propios):
 * firma RS256 contra las claves públicas (JWKS), aud = client id, iss y exp.
 * Los JWKS se cachean en KV.
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISS = ["accounts.google.com", "https://accounts.google.com"];
const JWKS_KV_KEY = "auth:jwks";
const JWKS_TTL_SECONDS = 3600;

function b64urlToUint8(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parsePart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToUint8(part)));
}

export class Auth {
  constructor(env) {
    this.env = env;
  }

  async getJwks() {
    const kv = this.env.XOGALAXY_KV;
    if (kv) {
      try {
        const cached = await kv.get(JWKS_KV_KEY, "json");
        if (cached && cached.expires > Date.now() && Array.isArray(cached.keys)) {
          return cached.keys;
        }
      } catch (err) {
        console.error("jwks cache read error:", err);
      }
    }
    const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`jwks HTTP ${res.status}`);
    const data = await res.json();
    const keys = Array.isArray(data.keys) ? data.keys : [];
    if (kv) {
      try {
        await kv.put(JWKS_KV_KEY, JSON.stringify({ keys, expires: Date.now() + JWKS_TTL_SECONDS * 1000 }), {
          expirationTtl: JWKS_TTL_SECONDS,
        });
      } catch (err) {
        console.error("jwks cache write error:", err);
      }
    }
    return keys;
  }

  async verify(token, clientId) {
    if (!token || typeof token !== "string") throw new Error("token required");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed token");

    let header;
    let payload;
    try {
      header = parsePart(parts[0]);
      payload = parsePart(parts[1]);
    } catch (err) {
      throw new Error("bad token encoding");
    }

    if (header.alg !== "RS256") throw new Error("unexpected alg");
    if (payload.aud !== clientId) throw new Error("bad audience");
    if (!GOOGLE_ISS.includes(payload.iss)) throw new Error("bad issuer");
    if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error("token expired");

    const keys = await this.getJwks();
    const key = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
    if (!key) throw new Error("unknown kid");

    const pub = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: key.n, e: key.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pub,
      b64urlToUint8(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!ok) throw new Error("bad signature");

    return {
      sub: String(payload.sub || ""),
      name: String(payload.name || ""),
      picture: String(payload.picture || ""),
    };
  }
}

export function isOwner(env, sub) {
  const subs = (env.OWNER_SUBS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Boolean(sub && subs.includes(sub));
}
