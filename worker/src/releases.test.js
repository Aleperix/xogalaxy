import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exports } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { parseReleaseUrl, buildApiUrl, normalizeRelease } from "./releases.js";

function mockGithub(payload, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === "https://api.github.com" && url.pathname.includes("/releases")) {
      return new Response(JSON.stringify(payload), { status });
    }
    throw new Error(`No mock for ${request.method} ${url.href}`);
  });
}

const RELEASE = {
  tag_name: "v1.1.5",
  name: "TumbleBoy Reborn v1.1.5",
  published_at: "2026-08-07T00:00:00Z",
  body: "# Cambios\n\n- targetSdk 35",
  html_url: "https://github.com/Aleperix/tumbleboy-reborn/releases/tag/v1.1.5",
  assets: [
    { name: "tumbleboy-reborn-ARM64.apk", size: 18868077, browser_download_url: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk" },
    { name: "portada.png", size: 1200, browser_download_url: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/portada.png" },
  ],
};

describe("releases helpers", () => {
  it("parseReleaseUrl valida github.com y extrae owner/repo/tag", () => {
    expect(parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases/tag/v1.1.5")).toEqual({
      owner: "Aleperix",
      repo: "tumbleboy-reborn",
      tag: "v1.1.5",
    });
    expect(parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases/latest")).toEqual({
      owner: "Aleperix",
      repo: "tumbleboy-reborn",
      tag: null,
    });
    expect(parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases")).toEqual({
      owner: "Aleperix",
      repo: "tumbleboy-reborn",
      tag: null,
    });
  });

  it("rechaza URLs que no son de github releases", () => {
    expect(() => parseReleaseUrl("https://example.com/x/y/releases")).toThrow();
    expect(() => parseReleaseUrl("https://github.com/aleperix")).toThrow();
    expect(() => parseReleaseUrl("nope")).toThrow();
  });

  it("rechaza URLs de descarga directa (assets), no de páginas", () => {
    expect(() =>
      parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases/latest/download/tumbleboy-reborn-ARM64.apk")
    ).toThrow();
    expect(() =>
      parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk")
    ).toThrow();
    expect(() => parseReleaseUrl("https://github.com/Aleperix/tumbleboy-reborn/releases/expanded_assets/v1.1.5")).toThrow();
  });

  it("buildApiUrl mapea latest y tags", () => {
    expect(buildApiUrl({ owner: "A", repo: "b", tag: null })).toBe("https://api.github.com/repos/A/b/releases/latest");
    expect(buildApiUrl({ owner: "A", repo: "b", tag: "v1.1.5" })).toBe("https://api.github.com/repos/A/b/releases/tags/v1.1.5");
  });

  it("normalizeRelease mapea assets, detecta portada y no incluye URL del release", () => {
    const data = normalizeRelease({ owner: "Aleperix", repo: "tumbleboy-reborn", tag: null }, RELEASE);
    expect(data.tagName).toBe("v1.1.5");
    expect(data.cover).toContain("portada.png");
    expect(data.assets).toHaveLength(2);
    expect(data.assets[0]).toEqual({
      name: "tumbleboy-reborn-ARM64.apk",
      size: 18868077,
      browserDownloadUrl: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk",
    });
  });
});

describe("GET /releases HTTP", () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxy devuelve la release normalizada y cachea 1h", async () => {
    mockGithub(RELEASE);
    const res = await exports.default.fetch(
      "http://xogalaxy-backend.test/releases?url=" +
        encodeURIComponent("https://github.com/Aleperix/tumbleboy-reborn/releases/tag/v1.1.5")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const data = await res.json();
    expect(data).toMatchObject({ owner: "Aleperix", repo: "tumbleboy-reborn", tagName: "v1.1.5" });
    expect(data.assets).toHaveLength(2);
  });

  it("404 de GitHub -> 502", async () => {
    mockGithub({ message: "Not Found" }, 404);
    const res = await exports.default.fetch(
      "http://xogalaxy-backend.test/releases?url=" + encodeURIComponent("https://github.com/Aleperix/tumbleboy-reborn/releases")
    );
    expect(res.status).toBe(502);
  });

  it("exige url válida y solo GET", async () => {
    const noUrl = await exports.default.fetch("http://xogalaxy-backend.test/releases");
    expect(noUrl.status).toBe(400);

    const bad = await exports.default.fetch(
      "http://xogalaxy-backend.test/releases?url=" + encodeURIComponent("https://evil.example.com/x/releases")
    );
    expect(bad.status).toBe(502);

    const post = await exports.default.fetch("http://xogalaxy-backend.test/releases", { method: "POST" });
    expect(post.status).toBe(405);
  });
});
