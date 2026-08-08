import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as posts from "./posts.js";

async function seedJwks(overrides = {}) {
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

describe("posts storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await posts.migrate(env.DB);
  });

  it("createPost siempre queda pending", async () => {
    const anon = await posts.createPost(env.DB, {
      title: "Mi aporte",
      body: "# Título\n\ntexto",
      author: { sub: null, name: "Pepe" },
    });
    expect(anon.status).toBe("pending");
    expect(anon.title).toBe("Mi aporte");

    const auth = await posts.createPost(env.DB, {
      title: "Con Google",
      body: "x",
      author: { sub: "s1", name: "Alice", picture: "https://pic" },
    });
    expect(auth.status).toBe("pending");
    expect(auth.author).toMatchObject({ sub: "s1", name: "Alice" });
  });

  it("pendingPosts y approvedPosts separan por estado", async () => {
    await posts.createPost(env.DB, { title: "a", body: "x", author: { sub: null, name: "X" } });
    const b = await posts.createPost(env.DB, { title: "b", body: "x", author: { sub: null, name: "X" } });
    await posts.reviewPost(env.DB, b.id, "approved");

    const pending = await posts.pendingPosts(env.DB);
    expect(pending).toHaveLength(1);
    expect(pending[0].title).toBe("a");

    const approved = await posts.approvedPosts(env.DB);
    expect(approved).toHaveLength(1);
    expect(approved[0].title).toBe("b");
  });

  it("reviewPost aprueba, fija approved_at y setPostUrl guarda el enlace", async () => {
    const p = await posts.createPost(env.DB, { title: "a", body: "x", author: { sub: null, name: "X" } });
    const approved = await posts.reviewPost(env.DB, p.id, "approved");
    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBeTruthy();

    const withUrl = await posts.setPostUrl(env.DB, p.id, "https://xogalax.blogspot.com/2026/08/a.html");
    expect(withUrl.postUrl).toBe("https://xogalax.blogspot.com/2026/08/a.html");

    const again = await posts.reviewPost(env.DB, p.id, "rejected");
    expect(again).toBeNull();
  });

  it("deletePost como owner borra cualquier post, como autor solo su pending", async () => {
    const mine = await posts.createPost(env.DB, { title: "mio", body: "x", author: { sub: "s1", name: "A" } });
    const other = await posts.createPost(env.DB, { title: "otro", body: "x", author: { sub: "s2", name: "B" } });

    await posts.deletePost(env.DB, mine.id, "s1");
    expect(await posts.pendingPosts(env.DB)).toHaveLength(1);
    expect((await posts.pendingPosts(env.DB))[0].id).toBe(other.id);

    await posts.deletePost(env.DB, other.id, null);
    expect(await posts.pendingPosts(env.DB)).toHaveLength(0);
  });

  it("exportAll e importPosts redondean", async () => {
    const p = await posts.createPost(env.DB, { title: "a", body: "x", author: { sub: null, name: "X" } });
    const dump = await posts.exportAll(env.DB);
    expect(dump).toHaveLength(1);

    await reset();
    await posts.migrate(env.DB);
    const imported = await posts.importPosts(env.DB, dump);
    expect(imported).toBe(1);
    expect((await posts.pendingPosts(env.DB))[0].id).toBe(p.id);
  });
});

describe("posts HTTP", () => {
  beforeEach(async () => {
    await reset();
  });

  it("enviar un aporte anónimo queda pending y exige título y body", async () => {
    const ok = await exports.default.fetch("http://xogalaxy-backend.test/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Aporte", body: "# Hola", name: "Pepe" }),
    });
    expect(ok.status).toBe(201);
    const { post } = await ok.json();
    expect(post.status).toBe("pending");
    expect(post.author.name).toBe("Pepe");

    const bad = await exports.default.fetch("http://xogalaxy-backend.test/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", body: "" }),
    });
    expect(bad.status).toBe(400);
  });

  it("el owner aprueba, fija la URL y ve la bandeja", async () => {
    const token = await seedJwks();
    const created = await (
      await exports.default.fetch("http://xogalaxy-backend.test/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Aporte", body: "texto", token }),
      })
    ).json();
    expect(created.post.status).toBe("pending");

    const pending = await exports.default.fetch("http://xogalaxy-backend.test/posts/pending", {
      headers: { "X-XOGALAXY-Token": token },
    });
    expect(pending.status).toBe(200);
    expect((await pending.json()).posts).toHaveLength(1);

    const review = await exports.default.fetch("http://xogalaxy-backend.test/posts/mod/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XOGALAXY-Token": token },
      body: JSON.stringify({ id: created.post.id, action: "approve" }),
    });
    expect(review.status).toBe(200);

    const url = await exports.default.fetch("http://xogalaxy-backend.test/posts/url", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XOGALAXY-Token": token },
      body: JSON.stringify({ id: created.post.id, url: "https://xogalax.blogspot.com/p/x.html" }),
    });
    expect(url.status).toBe(200);
    expect((await url.json()).post.postUrl).toBe("https://xogalax.blogspot.com/p/x.html");

    const approved = await (
      await exports.default.fetch("http://xogalaxy-backend.test/posts/approved", {
        headers: { "X-XOGALAXY-Token": token },
      })
    ).json();
    expect(approved.posts).toHaveLength(1);
    expect(approved.posts[0].postUrl).toBe("https://xogalax.blogspot.com/p/x.html");
  });

  it("pending/approved exigen owner y un no-owner no modera", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/posts/pending");
    expect(res.status).toBe(401);

    const intruder = await seedJwks({ sub: "someone-else", name: "Intruso" });
    const res2 = await exports.default.fetch("http://xogalaxy-backend.test/posts/pending", {
      headers: { "X-XOGALAXY-Token": intruder },
    });
    expect(res2.status).toBe(401);
  });

  it("el autor borra su propio aporte pending", async () => {
    const token = await seedJwks();
    const created = await (
      await exports.default.fetch("http://xogalaxy-backend.test/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Aporte", body: "texto", token }),
      })
    ).json();

    const del = await exports.default.fetch("http://xogalaxy-backend.test/posts/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XOGALAXY-Token": token },
      body: JSON.stringify({ id: created.post.id }),
    });
    expect(del.status).toBe(200);

    const pending = await (
      await exports.default.fetch("http://xogalaxy-backend.test/posts/pending", {
        headers: { "X-XOGALAXY-Token": token },
      })
    ).json();
    expect(pending.posts).toHaveLength(0);
  });
});
