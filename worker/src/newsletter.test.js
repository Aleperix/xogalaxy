import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as newsletter from "./newsletter.js";
import * as posts from "./posts.js";
import { sendNewsletterDigest } from "./index.js";

function request(path, opts) {
  return exports.default.fetch("http://xogalaxy-backend.test" + path, opts || {});
}

function post(path, body) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

describe("newsletter storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await newsletter.migrate(env.DB);
  });

  it("subscribe crea un suscriptor pending con email normalizado y prefs", async () => {
    const { subscriber, fresh, alreadyActive } = await newsletter.subscribe(env.DB, {
      email: "  Ana@X.com ",
      name: "Ana",
      prefs: { topics: ["juegos"], frequency: "monthly" },
    });
    expect(fresh).toBe(true);
    expect(alreadyActive).toBe(false);
    expect(subscriber.email).toBe("ana@x.com");
    expect(subscriber.status).toBe(newsletter.SUB_STATUS.PENDING);
    expect(subscriber.prefs).toEqual({ topics: ["juegos"], frequency: "monthly" });
    expect(subscriber.token).toBeTruthy();
  });

  it("subscribe rechaza emails inválidos", async () => {
    await expect(newsletter.subscribe(env.DB, { email: "nope" })).rejects.toThrow("email inválido");
    await expect(newsletter.subscribe(env.DB, { email: "a@b" })).rejects.toThrow("email inválido");
  });

  it("re-suscribir con pending regenera token y no duplica", async () => {
    const first = await newsletter.subscribe(env.DB, { email: "a@x.com", name: "A" });
    const res = await newsletter.subscribe(env.DB, { email: "a@x.com", name: "A2" });
    expect(res.fresh).toBe(true);
    expect(res.subscriber.status).toBe(newsletter.SUB_STATUS.PENDING);
    expect(res.subscriber.name).toBe("A2");
    expect(res.subscriber.token).not.toBe(first.subscriber.token);
    expect((await newsletter.exportAll(env.DB)).subscribers).toHaveLength(1);
  });

  it("confirm pasa pending → active y queda idempotente", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const active = await newsletter.confirm(env.DB, subscriber.token);
    expect(active).toMatchObject({ status: "active" });
    expect(active.confirmedAt).toBeTruthy();
    expect((await newsletter.confirm(env.DB, subscriber.token)).status).toBe("active");
  });

  it("confirm con token inválido devuelve null", async () => {
    expect(await newsletter.confirm(env.DB, "bogus")).toBeNull();
  });

  it("unsubscribe deja unsubscribed y bloquea confirmaciones", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    await newsletter.confirm(env.DB, subscriber.token);
    const s = await newsletter.unsubscribe(env.DB, subscriber.token);
    expect(s.status).toBe(newsletter.SUB_STATUS.UNSUBSCRIBED);
    expect(await newsletter.confirm(env.DB, subscriber.token)).toBeNull();
  });

  it("re-suscribir después de darse de baja vuelve a pending", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const oldToken = subscriber.token;
    await newsletter.unsubscribe(env.DB, oldToken);
    const res = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    expect(res.fresh).toBe(true);
    expect(res.subscriber.status).toBe(newsletter.SUB_STATUS.PENDING);
    expect(res.subscriber.token).not.toBe(oldToken);
  });

  it("suscribirse ya activo devuelve alreadyActive sin tocar nada", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    await newsletter.confirm(env.DB, subscriber.token);
    const res = await newsletter.subscribe(env.DB, { email: "a@x.com", prefs: { topics: ["x"] } });
    expect(res.alreadyActive).toBe(true);
    expect(res.subscriber.prefs.topics).toEqual([]);
  });

  it("setPreferences actualiza temas y frecuencia; token inválido null", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const s = await newsletter.setPreferences(env.DB, subscriber.token, { topics: ["tutoriales"], frequency: "monthly" });
    expect(s.prefs).toEqual({ topics: ["tutoriales"], frequency: "monthly" });
    expect(await newsletter.setPreferences(env.DB, "bogus", { topics: [] })).toBeNull();
  });

  it("activeSubscribers filtra por frecuencia y vencimiento", async () => {
    const a = (await newsletter.subscribe(env.DB, { email: "a@x.com" })).subscriber;
    const b = (await newsletter.subscribe(env.DB, { email: "b@x.com", prefs: { frequency: "monthly" } })).subscriber;
    await newsletter.confirm(env.DB, a.token);
    await newsletter.confirm(env.DB, b.token);
    expect(await newsletter.activeSubscribers(env.DB, { frequency: "weekly" })).toHaveLength(1);
    expect(await newsletter.activeSubscribers(env.DB, { frequency: "monthly" })).toHaveLength(1);
    await newsletter.logSend(env.DB, b.id, "s", "m", "sent");
    expect(await newsletter.activeSubscribers(env.DB, { frequency: "monthly", dueBefore: Date.now() - 1000 })).toHaveLength(0);
    expect(
      await newsletter.activeSubscribers(env.DB, { frequency: "monthly", dueBefore: Date.now() + 30 * 86400000 })
    ).toHaveLength(1);
  });

  it("logSend registra el envío y solo actualiza last_sent_at en éxito", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    await newsletter.logSend(env.DB, subscriber.id, "s1", "m1", "failed");
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).lastSentAt).toBeNull();
    await newsletter.logSend(env.DB, subscriber.id, "s2", "m2", "sent");
    const s = await newsletter.getByEmail(env.DB, "a@x.com");
    expect(s.lastSentAt).toBeTruthy();
    const data = await newsletter.exportAll(env.DB);
    expect(data.sends).toHaveLength(2);
  });

  it("exportAll/importAll round-trip idempotente", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com", name: "Ana" });
    await newsletter.confirm(env.DB, subscriber.token);
    await newsletter.logSend(env.DB, subscriber.id, "s", "m", "sent");
    const data = await newsletter.exportAll(env.DB);

    await reset();
    await newsletter.migrate(env.DB);
    expect(await newsletter.importAll(env.DB, data)).toBe(1);
    expect(await newsletter.importAll(env.DB, data)).toBe(1);
    const s = await newsletter.getByEmail(env.DB, "a@x.com");
    expect(s).toMatchObject({ name: "Ana", status: "active" });
    expect((await newsletter.exportAll(env.DB)).sends).toHaveLength(1);
  });
});

describe("newsletter HTTP", () => {
  beforeEach(async () => {
    await reset();
    await newsletter.migrate(env.DB);
  });

  it("POST /subscribe valida email y crea el suscriptor", async () => {
    expect((await post("/subscribe", { email: "nope" })).status).toBe(400);
    const res = await post("/subscribe", { email: "Ana@X.com", name: "Ana", prefs: { topics: ["juegos"], frequency: "weekly" } });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const s = await newsletter.getByEmail(env.DB, "ana@x.com");
    expect(s).toMatchObject({ status: "pending", name: "Ana" });
  });

  it("POST /subscribe ya activo responde ok sin duplicar", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    await newsletter.confirm(env.DB, subscriber.token);
    const res = await post("/subscribe", { email: "a@x.com" });
    expect(res.status).toBe(200);
    expect((await newsletter.exportAll(env.DB)).subscribers).toHaveLength(1);
  });

  it("POST /subscribe está rate-limitado", async () => {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await post("/subscribe", { email: `u${i}@x.com` });
    }
    expect(last.status).toBe(429);
  });

  it("GET /subscribe/confirm activa al suscriptor", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const res = await request("/subscribe/confirm?t=" + encodeURIComponent(subscriber.token));
    expect(res.status).toBe(200);
    expect((await res.text())).toContain("Suscripción confirmada");
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).status).toBe("active");
  });

  it("GET /subscribe/confirm con token inválido devuelve 400", async () => {
    const res = await request("/subscribe/confirm?t=bogus");
    expect(res.status).toBe(400);
  });

  it("GET /unsubscribe da de baja de un clic", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    await newsletter.confirm(env.DB, subscriber.token);
    const res = await request("/unsubscribe?t=" + encodeURIComponent(subscriber.token));
    expect(res.status).toBe(200);
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).status).toBe("unsubscribed");
  });

  it("GET /preferences muestra el form con las preferencias actuales", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com", prefs: { topics: ["juegos"], frequency: "weekly" } });
    const res = await request("/preferences?t=" + encodeURIComponent(subscriber.token));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('name="topics" value="juegos" checked');
    expect(body).toContain("Semanal");
  });

  it("POST /preferences JSON actualiza y responde HTML", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const res = await post("/preferences?t=" + encodeURIComponent(subscriber.token), {
      prefs: { topics: ["nostalgia"], frequency: "monthly" },
    });
    expect(res.status).toBe(200);
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).prefs).toEqual({
      topics: ["nostalgia"],
      frequency: "monthly",
    });
  });

  it("POST /preferences form-encoded actualiza", async () => {
    const { subscriber } = await newsletter.subscribe(env.DB, { email: "a@x.com" });
    const form = new FormData();
    form.append("topics", "juegos");
    form.append("topics", "tutoriales");
    form.append("frequency", "monthly");
    const res = await request("/preferences?t=" + encodeURIComponent(subscriber.token), { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).prefs.topics).toEqual(["juegos", "tutoriales"]);
  });
});

describe("newsletter digest", () => {
  beforeEach(async () => {
    await reset();
    await newsletter.migrate(env.DB);
    await posts.migrate(env.DB);
  });

  it("envía a los activos con posts recientes aprobados y loguea", async () => {
    const p = await posts.createPost(env.DB, { title: "Revivir", body: "body", author: { name: "A" } });
    await posts.reviewPost(env.DB, p.id, posts.POST_STATUS.APPROVED);
    await posts.setPostUrl(env.DB, p.id, "https://xogalax.blogspot.com/2026/revivir.html");

    const a = (await newsletter.subscribe(env.DB, { email: "a@x.com", prefs: { topics: ["juegos"] } })).subscriber;
    const b = (await newsletter.subscribe(env.DB, { email: "b@x.com", prefs: { frequency: "monthly" } })).subscriber;
    const c = (await newsletter.subscribe(env.DB, { email: "c@x.com" })).subscriber;
    await newsletter.confirm(env.DB, a.token);
    await newsletter.confirm(env.DB, b.token);
    await newsletter.confirm(env.DB, c.token);
    await newsletter.logSend(env.DB, c.id, "recién", "m", "sent");

    const result = await sendNewsletterDigest(env);
    expect(result.posts).toBe(1);
    expect(result.targets).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const sends = (await newsletter.exportAll(env.DB)).sends;
    expect(sends).toHaveLength(3);
    expect(sends.filter((s) => s.status === "sent")).toHaveLength(3);
    expect((await newsletter.getByEmail(env.DB, "a@x.com")).lastSentAt).toBeTruthy();
    expect((await newsletter.getByEmail(env.DB, "b@x.com")).lastSentAt).toBeTruthy();
  });

  it("salta a los que ya recibieron dentro del período", async () => {
    const a = (await newsletter.subscribe(env.DB, { email: "a@x.com" })).subscriber;
    await newsletter.confirm(env.DB, a.token);
    await newsletter.logSend(env.DB, a.id, "hace poco", "m", "sent");
    const result = await sendNewsletterDigest(env);
    expect(result.sent).toBe(0);
    expect(result.targets).toBe(0);
  });
});
