import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, reset, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as profiles from "./profiles.js";

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

describe("chat Room DO", () => {
  beforeEach(async () => {
    await reset();
  });

  it("persiste y devuelve mensajes por sala", async () => {
    const stub = env.ROOM.getByName("general");
    const msg = await stub.sendMessage("general", "Alice", "hola");
    expect(msg).toMatchObject({ nickname: "Alice", body: "hola" });

    const history = await stub.history("general");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: msg.id, nickname: "Alice", body: "hola" });
    expect(history[0].createdAt).toBeGreaterThan(0);
  });

  it("aísla las salas", async () => {
    const stub = env.ROOM.getByName("general");
    await stub.sendMessage("general", "A", "x");
    await stub.sendMessage("otra", "B", "y");
    const history = await stub.history("general");
    expect(history).toHaveLength(1);
    expect(history[0].body).toBe("x");
  });

  it("updateAuthor reescribe el nombre y foto de los mensajes del autor", async () => {
    const stub = env.ROOM.getByName("general");
    const mine = await stub.sendMessage("general", "Alexis Peña", "hola", {
      sub: "u1",
      name: "Alexis Peña",
      picture: "https://pic.example/a.png",
    });
    await stub.sendMessage("general", "Bob", "otro", { sub: "u2", name: "Bob", picture: null });

    const res = await stub.updateAuthor("u1", "Aleperix", "https://p/new.png");
    expect(res).toEqual({ ok: true });

    const history = await stub.history("general");
    const updated = history.find((m) => m.id === mine.id);
    expect(updated.author).toMatchObject({ sub: "u1", name: "Aleperix", picture: "https://p/new.png" });
    const bob = history.find((m) => m.author && m.author.sub === "u2");
    expect(bob.author).toMatchObject({ sub: "u2", name: "Bob" });
  });

  it("verifiedAuthor mergea el perfil editado de D1 sobre los claims de Google", async () => {
    const { token } = await makeTestToken();
    const stub = env.ROOM.getByName("general");

    await runInDurableObject(stub, async (instance) => {
      const p = await instance.verifiedAuthor(token);
      expect(p).toMatchObject({ sub: "google-user-1", name: "Alice", picture: "https://pic.example/a.png" });
    });

    await profiles.migrate(env.DB);
    await profiles.upsertProfile(env.DB, {
      sub: "google-user-1",
      name: "Alice C.",
      bio: "",
      picture: "https://p/new.png",
    });

    await runInDurableObject(stub, async (instance) => {
      const p = await instance.verifiedAuthor(token);
      expect(p).toMatchObject({ sub: "google-user-1", name: "Alice C.", picture: "https://p/new.png" });
    });
  });
});

describe("chat HTTP", () => {
  beforeEach(async () => {
    await reset();
  });

  it("POST /chat/message + GET /chat/history", async () => {
    const post = await exports.default.fetch("http://x.test/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", nickname: "Bob", body: "ola k ase" }),
    });
    expect(post.status).toBe(200);
    const { message } = await post.json();
    expect(message.body).toBe("ola k ase");

    const history = await (await exports.default.fetch("http://x.test/chat/history?room=general")).json();
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({ nickname: "Bob", body: "ola k ase" });
  });

  it("valida nickname y body", async () => {
    const res = await exports.default.fetch("http://x.test/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", nickname: "", body: "  " }),
    });
    expect(res.status).toBe(400);
  });

  it("mod delete exige auth y borra el mensaje del historial", async () => {
    const post = await exports.default.fetch("http://x.test/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", nickname: "Mal", body: "spam" }),
    });
    const { message } = await post.json();

    const noAuth = await exports.default.fetch("http://x.test/chat/mod/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", id: message.id }),
    });
    expect(noAuth.status).toBe(401);

    const del = await exports.default.fetch("http://x.test/chat/mod/delete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-mod-key",
      },
      body: JSON.stringify({ room: "general", id: message.id }),
    });
    expect(del.status).toBe(200);

    const history = await (await exports.default.fetch("http://x.test/chat/history?room=general")).json();
    expect(history.messages).toHaveLength(0);
  });
});

describe("chat WebSocket", () => {
  beforeEach(async () => {
    await reset();
  });

  it("webSocketMessage persiste y difunde el mensaje con el nick de la conexión", async () => {
    const stub = env.ROOM.getByName("wstest");
    const sent = [];
    const fakeWs = {
      deserializeAttachment: () => ({ nickname: "Alice", room: "wstest" }),
      send: (payload) => sent.push(payload),
    };

    await runInDurableObject(stub, async (instance, state) => {
      const spy = vi.spyOn(instance.ctx, "getWebSockets").mockReturnValue([fakeWs]);
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "chat", body: "hola" }));
      expect(spy).toHaveBeenCalledWith("wstest");
    });

    expect(sent).toHaveLength(1);
    const broadcast = JSON.parse(sent[0]);
    expect(broadcast.type).toBe("message");
    expect(broadcast.message).toMatchObject({ nickname: "Alice", body: "hola" });

    const history = await (await exports.default.fetch("http://x.test/chat/history?room=wstest")).json();
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({ nickname: "Alice", body: "hola" });
  });

  it("ignora mensajes no-chat o sin body", async () => {
    const stub = env.ROOM.getByName("wstest");
    const fakeWs = { deserializeAttachment: () => ({ nickname: "Alice", room: "wstest" }) };

    await runInDurableObject(stub, async (instance, state) => {
      const sendMessage = vi.spyOn(instance, "sendMessage");
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "ping" }));
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "chat", body: "   " }));
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

});
