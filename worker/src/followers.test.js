import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
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

async function seed() {
  await reset();
  await followers.migrate(env.DB);
  await followers.follow(env.DB, { sub: "google-user-1", name: "Alice", picture: "https://pic.example/a.png" });
}

function post(path, body) {
  return exports.default.fetch("http://xogalaxy-backend.test" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

describe("followers storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await followers.migrate(env.DB);
  });

  it("follow upserta y cuenta", async () => {
    await followers.follow(env.DB, { sub: "u1", name: "Ana", picture: "p1" });
    await followers.follow(env.DB, { sub: "u2", name: "Bob", picture: "p2" });
    await followers.follow(env.DB, { sub: "u1", name: "Ana v2", picture: "p1b" });
    expect(await followers.countFollowers(env.DB)).toBe(2);
    expect((await followers.getFollower(env.DB, "u1")).name).toBe("Ana v2");
  });

  it("unfollow borra y isFollowing refleja el estado", async () => {
    await followers.follow(env.DB, { sub: "u1", name: "Ana", picture: "p1" });
    expect(await followers.isFollowing(env.DB, "u1")).toBe(true);
    await followers.unfollow(env.DB, "u1");
    expect(await followers.isFollowing(env.DB, "u1")).toBe(false);
    expect(await followers.countFollowers(env.DB)).toBe(0);
  });

  it("listFollowers respeta el límite y el orden de alta", async () => {
    for (let i = 1; i <= 5; i++) {
      await followers.follow(env.DB, { sub: "u" + i, name: "U" + i, picture: null });
    }
    const list = await followers.listFollowers(env.DB, 2);
    expect(list.map((f) => f.sub)).toEqual(["u1", "u2"]);
  });

  it("exportAll/importAll round-trip idempotente", async () => {
    await followers.follow(env.DB, { sub: "u1", name: "Ana", picture: "p1" });
    const data = await followers.exportAll(env.DB);
    expect(data).toHaveLength(1);

    await reset();
    await followers.migrate(env.DB);
    expect(await followers.importAll(env.DB, data)).toBe(1);
    expect(await followers.countFollowers(env.DB)).toBe(1);
    expect(await followers.importAll(env.DB, data)).toBe(1);
    expect(await followers.countFollowers(env.DB)).toBe(1);
  });
});

describe("followers HTTP", () => {
  beforeEach(async () => {
    await reset();
    await followers.migrate(env.DB);
  });

  it("GET /followers devuelve count y la lista pública", async () => {
    await followers.follow(env.DB, { sub: "u1", name: "Ana", picture: "p1" });
    const res = await exports.default.fetch("http://xogalaxy-backend.test/followers");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.followers[0]).toMatchObject({ sub: "u1", name: "Ana" });
  });

  it("POST /followers/follow con token válido sigue y devuelve count", async () => {
    const { token } = await makeTestToken({ sub: "new-user", name: "Nueva" });
    const res = await post("/followers/follow", { token });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, following: true, count: 1 });
    expect(data.follower).toMatchObject({ sub: "new-user", name: "Nueva" });
  });

  it("POST /followers/follow con token inválido devuelve 401", async () => {
    const res = await post("/followers/follow", { token: "no-valid" });
    expect(res.status).toBe(401);
  });

  it("POST /followers/unfollow deja de seguir", async () => {
    await seed();
    const res = await post("/followers/unfollow", { token: "no-valid" });
    expect(res.status).toBe(401);

    const { token } = await makeTestToken();
    const ok = await post("/followers/unfollow", { token });
    expect(await ok.json()).toMatchObject({ ok: true, following: false, count: 0 });
  });

  it("GET /followers/me refleja el estado propio", async () => {
    const { token } = await makeTestToken();
    const before = await exports.default.fetch(
      "http://xogalaxy-backend.test/followers/me?token=" + encodeURIComponent(token)
    );
    expect((await before.json())).toMatchObject({ following: false });

    await post("/followers/follow", { token });
    const after = await exports.default.fetch(
      "http://xogalaxy-backend.test/followers/me?token=" + encodeURIComponent(token)
    );
    expect((await after.json())).toMatchObject({ following: true, follower: { sub: "google-user-1" } });
  });

  it("rate-limita follow", async () => {
    const { token } = await makeTestToken();
    let last;
    for (let i = 0; i < 31; i++) {
      last = await post("/followers/follow", { token });
    }
    expect(last.status).toBe(429);
  });
});
