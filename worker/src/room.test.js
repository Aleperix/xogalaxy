import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, reset, runInDurableObject } from "cloudflare:test";
import { exports } from "cloudflare:workers";

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

  it("relaya reacciones a la sala sin persistir", async () => {
    const stub = env.ROOM.getByName("wstest");
    const fakeWs = {
      deserializeAttachment: () => ({ nickname: "Alice", room: "wstest" }),
      send: () => {},
    };
    const sent = [];

    await runInDurableObject(stub, async (instance, state) => {
      const peer = { send: (p) => sent.push(p) };
      const spy = vi.spyOn(instance.ctx, "getWebSockets").mockReturnValue([fakeWs, peer]);
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "reaction", messageId: 7, reaction: "❤" }));
      expect(spy).toHaveBeenCalledWith("wstest");
    });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({ type: "reaction", messageId: 7, reaction: "❤" });

    const history = await (await exports.default.fetch("http://x.test/chat/history?room=wstest")).json();
    expect(history.messages).toHaveLength(0);
  });

  it("no relaya reacciones inválidas", async () => {
    const stub = env.ROOM.getByName("wstest");
    const fakeWs = {
      deserializeAttachment: () => ({ nickname: "Alice", room: "wstest" }),
      send: () => {},
    };

    await runInDurableObject(stub, async (instance, state) => {
      const broadcast = vi.spyOn(instance, "broadcast");
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "reaction", messageId: "x", reaction: "" }));
      await instance.webSocketMessage(fakeWs, JSON.stringify({ type: "reaction", messageId: 1, reaction: "   " }));
      expect(broadcast).not.toHaveBeenCalled();
    });
  });
});
