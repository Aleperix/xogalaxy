import { beforeEach, describe, expect, it } from "vitest";
import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import * as engagement from "./engagement.js";

describe("engagement storage (D1)", () => {
  beforeEach(async () => {
    await reset();
    await engagement.migrate(env.DB);
  });

  it("rate upserta y acumula, avg redondeado", async () => {
    const a = await engagement.rate(env.DB, { target: "post:1", user: "u1", value: 5 });
    expect(a).toMatchObject({ target: "post:1", count: 1, avg: 5, value: 5 });

    const b = await engagement.rate(env.DB, { target: "post:1", user: "u2", value: 3 });
    expect(b).toMatchObject({ count: 2, avg: 4, value: 3 });

    const re = await engagement.rate(env.DB, { target: "post:1", user: "u1", value: 1 });
    expect(re).toMatchObject({ count: 2, avg: 2, value: 1 });
  });

  it("rate con value 0 borra el voto del usuario", async () => {
    await engagement.rate(env.DB, { target: "post:1", user: "u1", value: 4 });
    const cleared = await engagement.rate(env.DB, { target: "post:1", user: "u1", value: 0 });
    expect(cleared).toMatchObject({ count: 0, avg: 0, value: 0 });
  });

  it("ratingSummary con user incluye el valor propio", async () => {
    await engagement.rate(env.DB, { target: "game:t", user: "u9", value: 3 });
    expect(await engagement.ratingSummary(env.DB, "game:t", "u9")).toMatchObject({ count: 1, value: 3 });
    expect(await engagement.ratingSummary(env.DB, "game:t")).toMatchObject({ count: 1, value: 0 });
  });

  it("react togglea por PK (target, user, type)", async () => {
    const on = await engagement.react(env.DB, { target: "post:1", user: "u1", type: "❤" });
    expect(on.counts).toEqual({ "❤": 1 });

    const second = await engagement.react(env.DB, { target: "post:1", user: "u2", type: "👍" });
    expect(second.counts).toEqual({ "❤": 1, "👍": 1 });

    const off = await engagement.react(env.DB, { target: "post:1", user: "u1", type: "❤" });
    expect(off.counts).toEqual({ "👍": 1 });
  });

  it("react no deja duplicados del mismo usuario/tipo", async () => {
    await engagement.react(env.DB, { target: "t", user: "u1", type: "x" });
    await engagement.react(env.DB, { target: "t", user: "u1", type: "x" });
    const counts = await engagement.reactionCounts(env.DB, "t");
    expect(counts.counts).toEqual({});
  });

  it("exportAll/importAll round-trip (idempotente)", async () => {
    await engagement.rate(env.DB, { target: "post:1", user: "u1", value: 4 });
    await engagement.react(env.DB, { target: "post:1", user: "u1", type: "❤" });
    const data = await engagement.exportAll(env.DB);
    expect(data.ratings).toHaveLength(1);
    expect(data.reactions).toHaveLength(1);

    await reset();
    await engagement.migrate(env.DB);
    const imported = await engagement.importAll(env.DB, data);
    expect(imported).toBe(2);
    expect(await engagement.ratingSummary(env.DB, "post:1", "u1")).toMatchObject({ count: 1, value: 4 });
    expect(await engagement.reactionCounts(env.DB, "post:1")).toMatchObject({ counts: { "❤": 1 } });

    const again = await engagement.importAll(env.DB, data);
    expect(again).toBe(2);
    expect(await engagement.reactionCounts(env.DB, "post:1")).toMatchObject({ counts: { "❤": 1 } });
  });

  it("sanitizers acotan target/user/type", () => {
    expect(engagement.sanitizeUser("a b/c:;*")).toBe("abc");
    expect(engagement.sanitizeUser("").length).toBe(0);
    expect(engagement.sanitizeTarget("  hi  ")).toBe("hi");
    expect(engagement.sanitizeType("a".repeat(100))).toHaveLength(32);
  });
});

describe("engagement HTTP", () => {
  beforeEach(async () => {
    await reset();
    await engagement.migrate(env.DB);
  });

  function fetchPost(path, body) {
    return exports.default.fetch("http://xogalaxy-backend.test" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  it("POST /rating upserta y GET /rating devuelve el resumen", async () => {
    const post = await fetchPost("/rating", { target: "post:1", user: "u1", value: 5 });
    expect(post.status).toBe(200);
    const posted = await post.json();
    expect(posted).toMatchObject({ target: "post:1", count: 1, avg: 5, value: 5 });
    expect(post.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const get = await exports.default.fetch("http://xogalaxy-backend.test/rating?target=post:1");
    expect(await get.json()).toMatchObject({ target: "post:1", count: 1, avg: 5 });
  });

  it("POST /reaction togglea y GET /reaction lista counts", async () => {
    const on = await fetchPost("/reaction", { target: "chat:general:7", user: "u1", type: "❤" });
    expect((await on.json()).counts).toEqual({ "❤": 1 });

    const get = await exports.default.fetch(
      "http://xogalaxy-backend.test/reaction?target=" + encodeURIComponent("chat:general:7")
    );
    expect(await get.json()).toMatchObject({ counts: { "❤": 1 } });

    const off = await fetchPost("/reaction", { target: "chat:general:7", user: "u1", type: "❤" });
    expect((await off.json()).counts).toEqual({});
  });

  it("GET /engagement batch devuelve ratings y reacciones por target", async () => {
    await fetchPost("/rating", { target: "game:t", user: "u1", value: 4 });
    await fetchPost("/reaction", { target: "game:t", user: "u1", type: "🔥" });

    const res = await exports.default.fetch(
      "http://xogalaxy-backend.test/engagement?targets=game:t,otro&user=u1"
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ratings["game:t"]).toMatchObject({ count: 1, avg: 4, value: 4 });
    expect(data.ratings["otro"]).toMatchObject({ count: 0, avg: 0, value: 0 });
    expect(data.reactions["game:t"].counts).toEqual({ "🔥": 1 });
  });

  it("valida entradas: sin target, value fuera de rango, sin user", async () => {
    expect((await fetchPost("/rating", { target: "", user: "u", value: 3 })).status).toBe(400);
    expect((await fetchPost("/rating", { target: "t", user: "u", value: 9 })).status).toBe(400);
    expect((await fetchPost("/rating", { target: "t", value: 3 })).status).toBe(400);
    expect((await fetchPost("/rating", { target: "t", user: "u", value: 1.5 })).status).toBe(400);
    expect((await fetchPost("/reaction", { target: "t", user: "u", type: "" })).status).toBe(400);
    expect((await fetchPost("/reaction", { target: "t", type: "x" })).status).toBe(400);
    expect((await exports.default.fetch("http://xogalaxy-backend.test/engagement")).status).toBe(400);
  });
});
