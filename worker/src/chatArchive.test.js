import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as archive from "./chatArchive.js";

const DAY = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(12, 0, 0, 0);
  return d;
};

describe("chatArchive D1", () => {
  beforeEach(async () => {
    await reset();
    await archive.migrate(env.DB);
  });

  it("inserta y agrupa días excluyendo borrados", async () => {
    const ayer = DAY(-1).getTime();
    const hoy = DAY(0).getTime();
    await archive.insertMessages(env.DB, "general", [
      { id: 1, nickname: "A", body: "viejo", createdAt: ayer },
      { id: 2, nickname: "B", body: "hola", createdAt: hoy },
      { id: 3, nickname: "C", body: "spam", createdAt: hoy, deleted: true },
    ]);

    const days = await archive.listDays(env.DB, "general");
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ day: DAY(0).toISOString().slice(0, 10), count: 1 });
    expect(days[1].count).toBe(1);
  });

  it("listByDay pagina con nextCursor", async () => {
    const t = DAY(0).getTime();
    const msgs = [];
    for (let i = 1; i <= 5; i++) msgs.push({ id: i, nickname: "U" + i, body: "msg " + i, createdAt: t });
    await archive.insertMessages(env.DB, "general", msgs);

    const p1 = await archive.listByDay(env.DB, "general", DAY(0).toISOString().slice(0, 10), 0, 3);
    expect(p1.messages).toHaveLength(3);
    expect(p1.nextCursor).toBe(3);

    const p2 = await archive.listByDay(env.DB, "general", DAY(0).toISOString().slice(0, 10), p1.nextCursor, 3);
    expect(p2.messages).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    expect(p2.messages[0].body).toBe("msg 4");
  });

  it("markDeleted oculta el mensaje del archivo", async () => {
    const t = DAY(0).getTime();
    await archive.insertMessages(env.DB, "general", [
      { id: 7, nickname: "Malo", body: "spam", createdAt: t },
      { id: 8, nickname: "Bueno", body: "ok", createdAt: t },
    ]);
    await archive.markDeleted(env.DB, "general", 7);
    const page = await archive.listByDay(env.DB, "general", DAY(0).toISOString().slice(0, 10));
    expect(page.messages.map((m) => m.id)).toEqual([8]);
    const days = await archive.listDays(env.DB, "general");
    expect(days[0].count).toBe(1);
  });
});

describe("Room.exportSince", () => {
  beforeEach(async () => {
    await reset();
  });

  it("devuelve solo los mensajes posteriores al cursor", async () => {
    const stub = env.ROOM.getByName("general");
    const a = await stub.sendMessage("general", "A", "uno");
    await stub.sendMessage("general", "B", "dos");
    await stub.modDelete("general", a.id);

    const batch = await stub.exportSince("general", 0);
    expect(batch).toHaveLength(2);
    expect(batch[0].deleted).toBe(true);

    const rest = await stub.exportSince("general", batch[batch.length - 1].id);
    expect(rest).toHaveLength(0);
  });
});

describe("exportNightly", () => {
  beforeEach(async () => {
    await reset();
  });

  it("exporta mensajes nuevos a D1 y el cursor evita re-exportar", async () => {
    const stub = env.ROOM.getByName("general");
    await stub.sendMessage("general", "Alice", "hola archivo", {
      sub: "u1",
      name: "Alice",
      picture: null,
    });

    const first = await archive.exportNightly(env, ["general"]);
    expect(first.general).toMatchObject({ ok: true, exported: 1 });

    const page = await archive.listByDay(env.DB, "general", new Date().toISOString().slice(0, 10));
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0]).toMatchObject({ nickname: "Alice", body: "hola archivo" });
    expect(page.messages[0].author).toMatchObject({ sub: "u1", name: "Alice" });

    const second = await archive.exportNightly(env, ["general"]);
    expect(second.general).toMatchObject({ ok: true, exported: 0 });
  });

  it("respeta el cursor aunque haya huecos de ids", async () => {
    const stub = env.ROOM.getByName("general");
    const m1 = await stub.sendMessage("general", "A", "1");
    const m2 = await stub.sendMessage("general", "B", "2");

    const first = await archive.exportNightly(env, ["general"]);
    expect(first.general.exported).toBe(2);
    expect(m2.id).toBeGreaterThan(m1.id);

    await stub.sendMessage("general", "C", "3");
    const third = await archive.exportNightly(env, ["general"]);
    expect(third.general.exported).toBe(1);
  });
});

describe("chat archive HTTP", () => {
  beforeEach(async () => {
    await reset();
  });

  async function seed() {
    const stub = env.ROOM.getByName("general");
    await stub.sendMessage("general", "Alice", "mensaje archivable");
    return archive.exportNightly(env, ["general"]);
  }

  it("GET /chat/archive/days y /chat/archive funcionan públicos", async () => {
    await seed();
    const daysRes = await exports.default.fetch("http://x.test/chat/archive/days?room=general");
    expect(daysRes.status).toBe(200);
    const { days } = await daysRes.json();
    expect(days.length).toBeGreaterThanOrEqual(1);

    const listRes = await exports.default.fetch(`http://x.test/chat/archive?room=general&day=${days[0].day}`);
    expect(listRes.status).toBe(200);
    const page = await listRes.json();
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].body).toBe("mensaje archivable");
  });

  it("GET /chat/archive exige day con formato YYYY-MM-DD", async () => {
    await archive.migrate(env.DB);
    const res = await exports.default.fetch("http://x.test/chat/archive?room=general&day=nope");
    expect(res.status).toBe(400);
  });

  it("POST /chat/archive/mod/delete exige auth y borra del archivo y del vivo", async () => {
    await seed();
    const page = await archive.listByDay(env.DB, "general", new Date().toISOString().slice(0, 10));
    const id = page.messages[0].id;

    const noAuth = await exports.default.fetch("http://x.test/chat/archive/mod/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: "general", id }),
    });
    expect(noAuth.status).toBe(401);

    const del = await exports.default.fetch("http://x.test/chat/archive/mod/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-mod-key" },
      body: JSON.stringify({ room: "general", id }),
    });
    expect(del.status).toBe(200);

    const after = await archive.listByDay(env.DB, "general", new Date().toISOString().slice(0, 10));
    expect(after.messages).toHaveLength(0);

    const history = await (await exports.default.fetch("http://x.test/chat/history?room=general")).json();
    expect(history.messages).toHaveLength(0);
  });
});
