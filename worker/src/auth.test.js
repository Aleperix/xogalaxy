import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { Auth, isOwner } from "./auth.js";

async function makeTestToken({ exp = Math.floor(Date.now() / 1000) + 3600, aud = "test-client-id", iss = "accounts.google.com", sub = "google-user-1", name = "Alice" } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = { alg: "RS256", kid: "test-kid", typ: "JWT" };
  const payload = { iss, aud, exp, sub, name, picture: "https://pic.example/a.png" };
  const enc = (obj) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const data = enc(header) + "." + enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return { token: data + "." + sig64, jwk };
}

describe("auth verify", () => {
  beforeEach(async () => {
    await reset();
    await env.XOGALAXY_KV.put(
      "auth:jwks",
      JSON.stringify({ keys: [], expires: Date.now() + 3600 * 1000 })
    );
  });

  it("acepta un ID token valido firmado con las claves del JWKS cacheado", async () => {
    const { token, jwk } = await makeTestToken();
    await env.XOGALAXY_KV.put(
      "auth:jwks",
      JSON.stringify({
        keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
        expires: Date.now() + 3600 * 1000,
      })
    );
    const auth = new Auth(env);
    const profile = await auth.verify(token, "test-client-id");
    expect(profile).toMatchObject({ sub: "google-user-1", name: "Alice" });
  });

  it("rechaza aud incorrecta", async () => {
    const { token, jwk } = await makeTestToken();
    await env.XOGALAXY_KV.put(
      "auth:jwks",
      JSON.stringify({
        keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
        expires: Date.now() + 3600 * 1000,
      })
    );
    const auth = new Auth(env);
    await expect(auth.verify(token, "otro-client")).rejects.toThrow("bad audience");
  });

  it("rechaza tokens expirados", async () => {
    const { token, jwk } = await makeTestToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    await env.XOGALAXY_KV.put(
      "auth:jwks",
      JSON.stringify({
        keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
        expires: Date.now() + 3600 * 1000,
      })
    );
    const auth = new Auth(env);
    await expect(auth.verify(token, "test-client-id")).rejects.toThrow("token expired");
  });

  it("rechaza issuer que no es de Google", async () => {
    const { token, jwk } = await makeTestToken({ iss: "evil.example.com" });
    await env.XOGALAXY_KV.put(
      "auth:jwks",
      JSON.stringify({
        keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
        expires: Date.now() + 3600 * 1000,
      })
    );
    const auth = new Auth(env);
    await expect(auth.verify(token, "test-client-id")).rejects.toThrow("bad issuer");
  });

  it("rechaza firma invalida (kid desconocido)", async () => {
    const { token } = await makeTestToken();
    const auth = new Auth(env);
    await expect(auth.verify(token, "test-client-id")).rejects.toThrow("unknown kid");
  });
});

describe("auth isOwner", () => {
  it("reconoce subs del owner", () => {
    const envLike = { OWNER_SUBS: "aaa, bbb" };
    expect(isOwner(envLike, "bbb")).toBe(true);
    expect(isOwner(envLike, "ccc")).toBe(false);
    expect(isOwner({}, "aaa")).toBe(false);
  });
});
