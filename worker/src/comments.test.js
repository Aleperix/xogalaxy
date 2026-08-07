import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as comments from "./comments.js";

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

describe("comments storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await comments.migrate(env.DB);
  });

  it("anonimo queda pending, autenticado approved", async () => {
    const anon = await comments.createComment(env.DB, {
      postId: "p1",
      body: "hola anonimo",
      author: { sub: null, name: "Pepe" },
    });
    expect(anon.status).toBe("pending");

    const auth = await comments.createComment(env.DB, {
      postId: "p1",
      body: "hola google",
      author: { sub: "s1", name: "Alice", picture: "https://pic" },
    });
    expect(auth.status).toBe("approved");
  });

  it("listComments solo devuelve aprobados y count cuenta aprobados", async () => {
    await comments.createComment(env.DB, { postId: "p1", body: "a", author: { sub: null, name: "X" } });
    await comments.createComment(env.DB, { postId: "p1", body: "b", author: { sub: "s1", name: "A" } });
    const list = await comments.listComments(env.DB, "p1");
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("b");
    expect(await comments.countComments(env.DB, "p1")).toBe(1);
  });

  it("reviewComment aprueba pendientes y deleteComment borra", async () => {
    const c = await comments.createComment(env.DB, { postId: "p1", body: "x", author: { sub: null, name: "X" } });
    const approved = await comments.reviewComment(env.DB, c.id, "approved");
    expect(approved.status).toBe("approved");
    expect(await comments.countComments(env.DB, "p1")).toBe(1);

    await comments.deleteComment(env.DB, c.id, null);
    expect(await comments.countComments(env.DB, "p1")).toBe(0);
  });

  it("deleteComment como dueño solo borra el propio", async () => {
    const mine = await comments.createComment(env.DB, { postId: "p1", body: "mio", author: { sub: "s1", name: "A" } });
    await comments.createComment(env.DB, { postId: "p1", body: "otro", author: { sub: "s2", name: "B" } });
    await comments.deleteComment(env.DB, mine.id, "s1");
    const list = await comments.listComments(env.DB, "p1");
    expect(list).toHaveLength(1);
    expect(list[0].author.sub).toBe("s2");
  });

  it("exportAll e importComments redondean", async () => {
    const c = await comments.createComment(env.DB, { postId: "p1", body: "x", author: { sub: null, name: "X" } });
    const dump = await comments.exportAll(env.DB);
    expect(dump).toHaveLength(1);

    await reset();
    await comments.migrate(env.DB);
    const imported = await comments.importComments(env.DB, dump);
    expect(imported).toBe(1);
    expect(await comments.countComments(env.DB, "p1")).toBe(0);
    expect(await comments.pendingComments(env.DB)).toHaveLength(1);
    expect(c.id).toBeDefined();
  });
});

describe("comments HTTP", () => {
  beforeEach(async () => {
    await reset();
  });

  it("anonimo queda pending y el owner lo aprueba", async () => {
    const post = await exports.default.fetch("http://xogalaxy-backend.test/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "p1", body: "hola", name: "Pepe" }),
    });
    expect(post.status).toBe(201);
    const { comment } = await post.json();
    expect(comment.status).toBe("pending");

    const pub = await (await exports.default.fetch("http://xogalaxy-backend.test/comments?postId=p1")).json();
    expect(pub.comments).toHaveLength(0);

    const pending = await (
      await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/pending", {
        headers: { Authorization: "Bearer test-mod-key" },
      })
    ).json();
    expect(pending.comments).toHaveLength(1);

    const review = await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-mod-key" },
      body: JSON.stringify({ id: comment.id, action: "approve" }),
    });
    expect(review.status).toBe(200);

    const after = await (await exports.default.fetch("http://xogalaxy-backend.test/comments?postId=p1")).json();
    expect(after.comments).toHaveLength(1);
    expect(after.comments[0].body).toBe("hola");

    const count = await (await exports.default.fetch("http://xogalaxy-backend.test/comments?postId=p1&count=1")).json();
    expect(count.count).toBe(1);
  });

  it("con token de Google se publica directo", async () => {
    const token = await seedJwks();
    const post = await exports.default.fetch("http://xogalaxy-backend.test/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "p2", body: "directo", token }),
    });
    expect(post.status).toBe(201);
    const { comment } = await post.json();
    expect(comment.status).toBe("approved");
    expect(comment.author).toMatchObject({ sub: "google-user-1", name: "Alice" });
  });

  it("mod pending/review exige Bearer MOD_KEY", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/pending");
    expect(res.status).toBe(401);
  });

  it("el owner (token Google) modera sin MOD_KEY", async () => {
    const token = await seedJwks();
    await exports.default.fetch("http://xogalaxy-backend.test/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "p4", body: "pendiente", name: "Pepe" }),
    });
    const pending = await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/pending", {
      headers: { "X-XOGALAXY-Token": token },
    });
    expect(pending.status).toBe(200);
    const { comments: pendientes } = await pending.json();
    expect(pendientes).toHaveLength(1);

    const review = await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XOGALAXY-Token": token },
      body: JSON.stringify({ id: pendientes[0].id, action: "approve" }),
    });
    expect(review.status).toBe(200);
  });

  it("token de no-owner no modera", async () => {
    const token = await seedJwks({ sub: "someone-else", name: "Intruso" });
    const res = await exports.default.fetch("http://xogalaxy-backend.test/comments/mod/pending", {
      headers: { "X-XOGALAXY-Token": token },
    });
    expect(res.status).toBe(401);
  });

  it("counts y total", async () => {
    const token = await seedJwks();
    await exports.default.fetch("http://xogalaxy-backend.test/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "p3", body: "x", token }),
    });
    const counts = await (
      await exports.default.fetch("http://xogalaxy-backend.test/comments/counts?ids=p3,otro")
    ).json();
    expect(counts.counts).toEqual({ p3: 1, otro: 0 });
    const total = await (await exports.default.fetch("http://xogalaxy-backend.test/comments/total")).json();
    expect(total.total).toBe(1);
  });

  it("auth/verify devuelve perfil + isOwner", async () => {
    const token = await seedJwks();
    const res = await exports.default.fetch("http://xogalaxy-backend.test/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ sub: "google-user-1", name: "Alice", isOwner: true });
  });

  it("export/import redondean via HTTP", async () => {
    const token = await seedJwks();
    await exports.default.fetch("http://xogalaxy-backend.test/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId: "p9", body: "respaldame", token }),
    });
    const exp = await (
      await exports.default.fetch("http://xogalaxy-backend.test/comments/export", {
        headers: { Authorization: "Bearer test-mod-key" },
      })
    ).json();
    expect(exp.comments).toHaveLength(1);

    await reset();
    const imp = await exports.default.fetch("http://xogalaxy-backend.test/comments/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-mod-key" },
      body: JSON.stringify({ comments: exp.comments }),
    });
    expect(imp.status).toBe(200);
    const { imported } = await imp.json();
    expect(imported).toBe(1);
  });
});
