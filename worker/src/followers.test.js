import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";

const frameHtml = (label, count) =>
  `<!doctype html><html><body><div class="kSROCb">${label} (${count})</div></body></html>`;

function mockBloggerFrame(label, count) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      url.origin === "https://www.blogger.com" &&
      url.pathname.startsWith("/followers/frame/")
    ) {
      return new Response(frameHtml(label, count), {
        headers: { "Content-Type": "text/html" },
      });
    }
    throw new Error(`No mock for ${request.method} ${url.href}`);
  });
}

describe("GET /followers", () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses the count and serves the second request from cache", async () => {
    const spy = mockBloggerFrame("Seguidores", 12);

    const first = await (await exports.default.fetch("http://xogalaxy-backend.test/followers")).json();
    expect(first).toMatchObject({ count: 12, source: "blogger", cached: false });

    const second = await (await exports.default.fetch("http://xogalaxy-backend.test/followers")).json();
    expect(second).toMatchObject({ count: 12, cached: true });

    expect(spy.mock.calls.length).toBe(1);
  });

  it("works with a different locale label", async () => {
    mockBloggerFrame("Followers", 7);
    const res = await exports.default.fetch("http://xogalaxy-backend.test/followers?lang=en");
    const data = await res.json();
    expect(data.count).toBe(7);
  });

  it("returns 502 when Blogger fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin === "https://www.blogger.com") {
        return new Response("boom", { status: 500 });
      }
      throw new Error(`No mock for ${request.method} ${url.href}`);
    });

    const res = await exports.default.fetch("http://xogalaxy-backend.test/followers");
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("followers unavailable");
  });
});
