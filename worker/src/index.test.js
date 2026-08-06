import { beforeEach, describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";

describe("Worker routes", () => {
  beforeEach(async () => {
    await reset();
  });

  it("GET /health returns ok", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.service).toBe("xogalaxy-backend");
  });

  it("GET /visits starts at 0, increments on hit, reads without incrementing", async () => {
    const before = await (await exports.default.fetch("http://xogalaxy-backend.test/visits")).json();
    expect(before.value).toBe(0);

    const hit = await (await exports.default.fetch("http://xogalaxy-backend.test/visits?hit=1")).json();
    expect(hit).toMatchObject({ value: 1, hit: true });

    const after = await (await exports.default.fetch("http://xogalaxy-backend.test/visits")).json();
    expect(after).toMatchObject({ value: 1, hit: false });
  });

  it("rejects disallowed origins", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/health", {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(403);
  });

  it("answers OPTIONS preflight for allowed origins", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/visits", {
      method: "OPTIONS",
      headers: { Origin: "https://xogalax.blogspot.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://xogalax.blogspot.com");
  });

  it("OPTIONS preflight allows POST for chat", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/chat/message", {
      method: "OPTIONS",
      headers: { Origin: "https://xogalax.blogspot.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("*");
  });

  it("echoes CORS for allowed origins", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/visits", {
      headers: { Origin: "https://xogalaxy.pages.dev" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://xogalaxy.pages.dev");
  });

  it("404 for unknown paths", async () => {
    const res = await exports.default.fetch("http://xogalaxy-backend.test/nope");
    expect(res.status).toBe(404);
  });
});
