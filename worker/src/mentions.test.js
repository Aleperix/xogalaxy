import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as mentions from "./mentions.js";
import * as profiles from "./profiles.js";

async function seedProfile(sub, name, picture = null) {
  await profiles.upsertProfile(env.DB, { sub, name, bio: "", picture });
}

async function makeTestToken({ sub = "google-user-1", name = "Alice" } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const enc = (obj) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const data =
    enc({ alg: "RS256", kid: "test-kid", typ: "JWT" }) +
    "." +
    enc({ iss: "accounts.google.com", aud: "test-client-id", exp: Math.floor(Date.now() / 1000) + 3600, sub, name });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keyPair.privateKey, new TextEncoder().encode(data));
  const sig64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  await env.XOGALAXY_KV.put(
    "auth:jwks",
    JSON.stringify({
      keys: [{ kty: "RSA", kid: "test-kid", n: jwk.n, e: jwk.e }],
      expires: Date.now() + 3600 * 1000,
    })
  );
  return data + "." + sig64;
}

describe("extractMentionNames", () => {
  it("extrae nombres únicos con acentos y puntos", () => {
    expect(mentions.extractMentionNames("hola @Alice y @bob.x, repito @Alice")).toEqual(["Alice", "bob.x"]);
  });

  it("ignora arrobas sueltas o cortas", () => {
    expect(mentions.extractMentionNames("mail a@b @x sin mención")).toEqual([]);
  });
});

describe("resolveMentions / suggestUsers", () => {
  beforeEach(async () => {
    await reset();
    await mentions.migrate(env.DB);
    await profiles.migrate(env.DB);
    await seedProfile("u-alice", "Alice", "https://p/a.png");
    await seedProfile("u-bob", "Bob García");
    await seedProfile("u-carol", "Boca Juniors Fan");
    await profiles.upsertProfile(env.DB, { sub: null, visitor: "anon-1", name: "Anon Mención", bio: "" });
  });

  it("resuelve match exacto case-insensitive", async () => {
    const r = await mentions.resolveMentions(env.DB, "hola @ALICE!");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sub: "u-alice", name: "Alice" });
  });

  it("cae al prefijo cuando no hay match exacto y excluye anónimos", async () => {
    const r = await mentions.resolveMentions(env.DB, "@Anon no cuenta, @Bo sí");
    expect(r.map((x) => x.sub)).toEqual(["u-bob"]);
  });

  it("suggestUsers exige q>=2, prioriza prefijo y solo cuentas Google", async () => {
    expect(await mentions.suggestUsers(env.DB, "a")).toEqual([]);
    const r = await mentions.suggestUsers(env.DB, "bo");
    expect(r.map((u) => u.name)).toEqual(["Bob García", "Boca Juniors Fan"]);
  });
});

describe("notifyMentions", () => {
  beforeEach(async () => {
    await reset();
    await mentions.migrate(env.DB);
    await profiles.migrate(env.DB);
    await seedProfile("u-alice", "Alice");
    await seedProfile("u-bob", "Bob");
  });

  it("crea notificaciones salvo para el propio actor", async () => {
    const n = await mentions.notifyMentions(env.DB, {
      text: "@Bob y @Alice y @Nadie",
      type: "mention_chat",
      actor: { sub: "u-alice", name: "Alice", picture: null },
      excerpt: "mensaje largo que se recorta ".repeat(20),
      ref: "chat",
    });
    expect(n).toBe(1);
    const { items } = await mentions.listNotifications(env.DB, "u-bob");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "mention_chat", actor: { name: "Alice" }, ref: "chat", read: false });
    expect(items[0].excerpt.length).toBeLessThanOrEqual(140);
  });
});

describe("HTTP menciones/notificaciones", () => {
  beforeEach(async () => {
    await reset();
    await mentions.migrate(env.DB);
    await profiles.migrate(env.DB);
    await seedProfile("google-user-2", "Bob");
  });

  it("GET /users/suggest es público con cache corto", async () => {
    const res = await exports.default.fetch("http://x.test/users/suggest?q=bo");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
    const { users } = await res.json();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ name: "Bob" });
  });

  it("el chat notifica la mención de un usuario verificado", async () => {
    const token = await makeTestToken({ sub: "google-user-1", name: "Alice" });
    const post = await exports.default.fetch("http://x.test/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", nickname: "Alice", body: "ey @Bob mirá esto", token }),
    });
    expect(post.status).toBe(200);

    const bobToken = await makeTestToken({ sub: "google-user-2", name: "Bob" });
    const list = await exports.default.fetch("http://x.test/notifications", {
      headers: { "X-XOGALAXY-Token": bobToken },
    });
    expect(list.status).toBe(200);
    const data = await list.json();
    expect(data.unread).toBe(1);
    expect(data.items[0]).toMatchObject({ type: "mention_chat", excerpt: "ey @Bob mirá esto" });
  });

  it("GET /notifications exige token y POST /notifications/read marca todo leído", async () => {
    const noAuth = await exports.default.fetch("http://x.test/notifications");
    expect(noAuth.status).toBe(401);

    const token = await makeTestToken({ sub: "google-user-1", name: "Alice" });
    await seedProfile("google-user-1", "Alice");
    const created = await mentions.notifyMentions(env.DB, {
      text: "@Alice hola",
      type: "mention_post",
      actor: { name: "Bob" },
      excerpt: "hola",
      ref: "post:1",
    });
    expect(created).toBe(1);

    const read = await exports.default.fetch("http://x.test/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-XOGALAXY-Token": token },
      body: JSON.stringify({}),
    });
    expect(read.status).toBe(200);

    const data = await (await exports.default.fetch("http://x.test/notifications", { headers: { "X-XOGALAXY-Token": token } })).json();
    expect(data.unread).toBe(0);
    expect(data.items[0].read).toBe(true);
  });
});
