import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import * as images from "./images.js";

async function makeJwt(overrides = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  await env.XOGALAXY_KV.put(
    "auth:jwks",
    JSON.stringify({
      keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
      expires: Date.now() + 3600 * 1000,
    })
  );
  const header = { alg: "RS256", kid: "test-kid", typ: "JWT" };
  const payload = Object.assign(
    {
      iss: "accounts.google.com",
      aud: "test-client-id",
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: "google-user-1",
      name: "Alice",
      picture: "https://pic.example/a.png",
    },
    overrides
  );
  const enc = (obj) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const data = enc(header) + "." + enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return data + "." + sig64;
}

describe("images upload (R2)", () => {
  beforeEach(async () => {
    await reset();
  });

  async function uploadRequest(token, file, filename = "foto.png") {
    const fd = new FormData();
    if (file) fd.append("file", file, filename);
    const headers = {};
    if (token) headers["X-XOGALAXY-Token"] = token;
    const req = new Request("https://xogalaxy.workers.dev/images/upload", { method: "POST", headers, body: fd });
    return images.handleImageUpload(req, env, "https://xogalaxy.com");
  }

  it("rechaza método no POST", async () => {
    const req = new Request("https://xogalaxy.workers.dev/images/upload", { method: "GET" });
    const res = await images.handleImageUpload(req, env, "https://xogalaxy.com");
    expect(res.status).toBe(405);
  });

  it("rechaza sin perfil Google (403)", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" });
    const res = await uploadRequest("", file);
    expect(res.status).toBe(403);
    const d = await res.json();
    expect(d.error).toContain("solo cuentas Google");
  });

  it("rechaza tipo no permitido (400)", async () => {
    const token = await makeJwt();
    const file = new File([new Uint8Array([1, 2, 3])], "foto.txt", { type: "text/plain" });
    const res = await uploadRequest(token, file, "foto.txt");
    expect(res.status).toBe(400);
  });

  it("rechaza archivo ausente (400)", async () => {
    const token = await makeJwt();
    const res = await uploadRequest(token, null);
    expect(res.status).toBe(400);
  });

  it("sube, guarda en R2 y devuelve URL con key estable", async () => {
    const token = await makeJwt();

    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([bytes], "foto.jpg", { type: "image/jpeg" });
    const res1 = await uploadRequest(token, file);
    expect(res1.status).toBe(200);
    const d1 = await res1.json();
    expect(d1.url).toMatch(/^https:\/\/media\.xogalaxy\.workers\.dev\/images\/[a-f0-9]+\.jpg$/);
    expect(d1.key).toMatch(/^images\/[a-f0-9]+\.jpg$/);

    const res2 = await uploadRequest(token, file);
    expect(res2.status).toBe(200);
    const d2 = await res2.json();
    expect(d1.key).toBe(d2.key);

    const stored = await env.IMAGES.get(d1.key);
    expect(Array.from(new Uint8Array(await stored.arrayBuffer()))).toEqual(Array.from(bytes));
    const head1 = await env.IMAGES.head(d1.key);
    expect(head1).toBeTruthy();
    expect(head1.httpMetadata.contentType).toBe("image/jpeg");
  });
});