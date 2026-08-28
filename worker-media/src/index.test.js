import { beforeEach, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";

const BASE = "http://xogalaxy-media.test";

describe("media worker (R2 images)", () => {
  beforeEach(async () => {
    await reset();
  });

  it("sirve una imagen con cache immutable y CORS abierto", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    await env.IMAGES.put("images/a1b2c3d4.jpg", bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });
    const res = await exports.default.fetch(BASE + "/images/a1b2c3d4.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    const ab = await res.arrayBuffer();
    expect(Array.from(new Uint8Array(ab))).toEqual(Array.from(bytes));
  });

  it("usa content-type por extensión si el objeto no lo trae", async () => {
    await env.IMAGES.put("images/pic.webp", new Uint8Array([1]));
    const res = await exports.default.fetch(BASE + "/images/pic.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("404 sin key de asset (no images/ ni videos/)", async () => {
    const res = await exports.default.fetch(BASE + "/favicon.ico");
    expect(res.status).toBe(404);
  });

  it("404 para archivo inexistente", async () => {
    const res = await exports.default.fetch(BASE + "/images/zzzzzz.jpg");
    expect(res.status).toBe(404);
  });

  it("404 para path traversal", async () => {
    const res = await exports.default.fetch(BASE + "/images/../secret.jpg");
    expect(res.status).toBe(404);
  });

  it("405 para POST", async () => {
    const res = await exports.default.fetch(BASE + "/images/upload", { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("soporta HEAD como GET", async () => {
    await env.IMAGES.put("images/h.jpg", new Uint8Array([1]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const res = await exports.default.fetch(BASE + "/images/h.jpg", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("refleja el Origin del cliente", async () => {
    await env.IMAGES.put("images/o.jpg", new Uint8Array([1]), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const res = await exports.default.fetch(BASE + "/images/o.jpg", {
      headers: { Origin: "https://xogalax.blogspot.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://xogalax.blogspot.com");
    expect(res.headers.get("Vary")).toContain("Origin");
  });
});