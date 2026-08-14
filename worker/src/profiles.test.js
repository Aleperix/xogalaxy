import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as profiles from "./profiles.js";
import * as posts from "./posts.js";
import * as followers from "./followers.js";

async function makeTestToken({ sub = "google-user-1", name = "Alice" } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = { alg: "RS256", kid: "test-kid", typ: "JWT" };
  const payload = {
    iss: "accounts.google.com",
    aud: "test-client-id",
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub,
    name,
    picture: "https://pic.example/a.png",
  };
  const enc = (obj) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const data = enc(header) + "." + enc(payload);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  await env.XOGALAXY_KV.put(
    "auth:jwks",
    JSON.stringify({
      keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
      expires: Date.now() + 3600 * 1000,
    })
  );
  return { token: data + "." + sig64 };
}

function request(path, opts) {
  return exports.default.fetch("http://xogalaxy-backend.test" + path, opts || {});
}

function put(path, body) {
  return request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

describe("profiles storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await profiles.migrate(env.DB);
  });

  it("upsert crea y actualiza por sub", async () => {
    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Ana", bio: "hola", picture: "https://p/a.png" });
    let p = await profiles.getProfile(env.DB, { sub: "u1" });
    expect(p).toMatchObject({ sub: "u1", name: "Ana", bio: "hola" });

    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Ana v2", bio: "", picture: null });
    p = await profiles.getProfile(env.DB, { sub: "u1" });
    expect(p.name).toBe("Ana v2");
    expect(p.picture).toBeNull();
  });

  it("separa sub y visitor con ids compuestos", async () => {
    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Google", bio: "", picture: null });
    await profiles.upsertProfile(env.DB, { visitor: "v_abc", name: "Invitado", bio: "", picture: null });
    expect((await profiles.getProfile(env.DB, { sub: "u1" })).visitor).toBeNull();
    expect((await profiles.getProfile(env.DB, { visitor: "v_abc" })).sub).toBeNull();
    expect((await profiles.getProfile(env.DB, { visitor: "v_abc" })).name).toBe("Invitado");
  });

  it("sanitiza name, bio y picture", async () => {
    await profiles.upsertProfile(env.DB, {
      sub: "u1",
      name: "x".repeat(80),
      bio: "y".repeat(400),
      picture: "javascript:alert(1)",
    });
    const p = await profiles.getProfile(env.DB, { sub: "u1" });
    expect(p.name.length).toBeLessThanOrEqual(40);
    expect(p.bio.length).toBeLessThanOrEqual(300);
    expect(p.picture).toBeNull();
  });

  it("exportAll/importAll round-trip idempotente", async () => {
    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Ana", bio: "bio", picture: "https://p/a.png" });
    const data = await profiles.exportAll(env.DB);
    expect(data).toHaveLength(1);

    await reset();
    await profiles.migrate(env.DB);
    expect(await profiles.importAll(env.DB, data)).toBe(1);
    expect(await profiles.importAll(env.DB, data)).toBe(1);
    const p = await profiles.getProfile(env.DB, { sub: "u1" });
    expect(p).toMatchObject({ name: "Ana", bio: "bio" });
  });

  it("mergeIdentity pisa los claims de Google con el perfil editado", async () => {
    const claims = { sub: "u1", name: "Alice", picture: "https://pic.example/a.png" };
    const fallback = await profiles.mergeIdentity(env.DB, claims);
    expect(fallback).toMatchObject({ sub: "u1", name: "Alice", bio: "", picture: "https://pic.example/a.png" });

    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Alice C.", bio: "Fan", picture: "https://p/new.png" });
    const merged = await profiles.mergeIdentity(env.DB, claims);
    expect(merged).toMatchObject({ sub: "u1", name: "Alice C.", bio: "Fan", picture: "https://p/new.png" });
  });
});

describe("profiles HTTP", () => {
  beforeEach(async () => {
    await reset();
    await profiles.migrate(env.DB);
  });

  it("GET /profiles?sub devuelve el perfil público", async () => {
    await profiles.upsertProfile(env.DB, { sub: "u1", name: "Ana", bio: "bio", picture: "https://p/a.png" });
    const res = await request("/profiles?sub=u1");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile).toMatchObject({ sub: "u1", name: "Ana", bio: "bio", isOwner: false, isSelf: false });
  });

  it("GET /profiles?visitor devuelve el perfil del invitado", async () => {
    await profiles.upsertProfile(env.DB, { visitor: "v_abc", name: "Invitado", bio: "", picture: null });
    const res = await request("/profiles?visitor=v_abc");
    expect((await res.json()).profile).toMatchObject({ visitor: "v_abc", name: "Invitado" });
  });

  it("GET /profiles sin sub ni visitor devuelve 400; inexistente profile null", async () => {
    expect((await request("/profiles")).status).toBe(400);
    const res = await request("/profiles?sub=ghost");
    expect((await res.json()).profile).toBeNull();
  });

  it("GET marca isOwner e isSelf", async () => {
    const { token } = await makeTestToken();
    await profiles.upsertProfile(env.DB, { sub: "google-user-1", name: "Alice", bio: "", picture: null });
    const res = await request("/profiles?sub=google-user-1&token=" + encodeURIComponent(token));
    const data = await res.json();
    expect(data.profile).toMatchObject({ isOwner: true, isSelf: true });
  });

  it("PUT /profiles con token crea/actualiza el perfil de Google", async () => {
    const { token } = await makeTestToken();
    const res = await put("/profiles", { token, name: "Alice C.", bio: "Fan del blog", picture: "https://p/new.png" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.profile).toMatchObject({ sub: "google-user-1", name: "Alice C.", bio: "Fan del blog" });

    const got = await request("/profiles?sub=google-user-1");
    expect((await got.json()).profile.name).toBe("Alice C.");
  });

  it("PUT /profiles con visitor crea el perfil del invitado", async () => {
    const res = await put("/profiles", { visitor: "v_abc", name: "Leo", bio: "", picture: null });
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toMatchObject({ visitor: "v_abc", name: "Leo" });
  });

  it("PUT /profiles valida: token inválido 401, sin identidad 400, picture inválida 400", async () => {
    expect((await put("/profiles", { token: "bogus", name: "X" })).status).toBe(401);
    expect((await put("/profiles", { name: "X" })).status).toBe(400);
    const { token } = await makeTestToken();
    const bad = await put("/profiles", { token, name: "X", picture: "javascript:bad" });
    expect(bad.status).toBe(400);
  });

  it("PUT /profiles sincroniza el nombre en los posts del autor", async () => {
    await posts.migrate(env.DB);
    await posts.createPost(env.DB, {
      title: "T",
      body: "B",
      author: { sub: "google-user-1", name: "Alice", picture: null },
    });
    const { token } = await makeTestToken();
    const res = await put("/profiles", { token, name: "Alice C.", bio: "", picture: null });
    expect(res.status).toBe(200);
    const all = await posts.exportAll(env.DB);
    expect(all[0].author.name).toBe("Alice C.");
  });

  it("PUT /profiles actualiza el snapshot del seguidor", async () => {
    await followers.migrate(env.DB);
    await followers.follow(env.DB, { sub: "google-user-1", name: "Alice", picture: "https://pic.example/a.png" });
    const { token } = await makeTestToken();
    const res = await put("/profiles", { token, name: "Alice C.", bio: "", picture: "https://p/new.png" });
    expect(res.status).toBe(200);
    const f = await followers.getFollower(env.DB, "google-user-1");
    expect(f).toMatchObject({ name: "Alice C.", picture: "https://p/new.png" });
  });

  it("POST /auth/verify devuelve el perfil editado en D1, no los claims de Google", async () => {
    const { token } = await makeTestToken();
    const res = await post("/auth/verify", { token });
    expect(res.status).toBe(200);
    let data = await res.json();
    expect(data).toMatchObject({ sub: "google-user-1", name: "Alice", picture: "https://pic.example/a.png", bio: "" });

    await profiles.upsertProfile(env.DB, { sub: "google-user-1", name: "Alice C.", bio: "Fan del blog", picture: "https://p/new.png" });
    const res2 = await post("/auth/verify", { token });
    const data2 = await res2.json();
    expect(data2).toMatchObject({ name: "Alice C.", bio: "Fan del blog", picture: "https://p/new.png", isOwner: true });
  });

  it("rate-limita PUT /profiles", async () => {
    const { token } = await makeTestToken();
    let last;
    for (let i = 0; i < 31; i++) {
      last = await put("/profiles", { token, name: "X" });
    }
    expect(last.status).toBe(429);
  });
});
