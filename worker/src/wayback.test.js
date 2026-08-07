import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";

const SITEMAP_XML = `<?xml version="1.0"?><urlset><url><loc>https://xogalax.blogspot.com/2026/08/post-uno.html</loc></url><url><loc>https://xogalax.blogspot.com/2026/08/post-dos.html</loc></url></urlset>`;

function mockFetchForScheduled() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === "https://xogalax.blogspot.com" && url.pathname === "/sitemap.xml") {
      return new Response(SITEMAP_XML, { headers: { "Content-Type": "application/xml" } });
    }
    if (url.origin === "https://web.archive.org") {
      return new Response("Saved", { status: 200 });
    }
    throw new Error(`No mock for ${request.method} ${url.href}`);
  });
}

describe("scheduled (Wayback nightly)", () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("guarda portada + URLs del sitemap en web.archive.org/save", async () => {
    const spy = mockFetchForScheduled();

    const results = await exports.default.scheduled({ cron: "17 4 * * *" }, {});

    expect(results.wayback).toEqual([
      { url: "https://xogalax.blogspot.com/", status: 200, ok: true },
      { url: "https://xogalax.blogspot.com/2026/08/post-uno.html", status: 200, ok: true },
      { url: "https://xogalax.blogspot.com/2026/08/post-dos.html", status: 200, ok: true },
    ]);
    expect(results.backup.ok).toBe(true);

    const waybackCalls = spy.mock.calls
      .filter(([input]) => new URL(input).origin === "https://web.archive.org")
      .map(([input]) => input);
    expect(waybackCalls).toEqual([
      "https://web.archive.org/save/https%3A%2F%2Fxogalax.blogspot.com%2F",
      "https://web.archive.org/save/https%3A%2F%2Fxogalax.blogspot.com%2F2026%2F08%2Fpost-uno.html",
      "https://web.archive.org/save/https%3A%2F%2Fxogalax.blogspot.com%2F2026%2F08%2Fpost-dos.html",
    ]);
  });

  it("sigue guardando la portada aunque el sitemap falle", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === "https://xogalax.blogspot.com") {
        return new Response("boom", { status: 500 });
      }
      if (url.origin === "https://web.archive.org") {
        return new Response("Saved", { status: 200 });
      }
      throw new Error(`No mock for ${request.method} ${url.href}`);
    });

    const results = await exports.default.scheduled({ cron: "17 4 * * *" }, {});
    expect(results.wayback).toEqual([
      { url: "https://xogalax.blogspot.com/", status: 200, ok: true },
    ]);
  });
});
