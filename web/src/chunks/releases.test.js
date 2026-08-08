import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../core.js";
import "../api.js";
import "../markdown.js";
import "./releases.js";

const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vendor");

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function loadVendored() {
  const code =
    fs.readFileSync(path.join(VENDOR_DIR, "marked.min.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(VENDOR_DIR, "dompurify.min.js"), "utf8");
  new Function(code)();
}

const PROXY_DATA = {
  ok: true,
  owner: "Aleperix",
  repo: "tumbleboy-reborn",
  tagName: "v1.1.5",
  name: "TumbleBoy Reborn v1.1.5",
  body: "# Cambios\n\n- Fix comentarios\n- **Nuevo** widget",
  htmlUrl: "https://github.com/Aleperix/tumbleboy-reborn/releases/tag/v1.1.5",
  cover: null,
  assets: [
    { name: "tumbleboy-reborn-ARM64.apk", size: 18868077, browserDownloadUrl: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk" },
  ],
};

function mockBackend(handlers, spy) {
  vi.stubGlobal("fetch", async (url, opts) => {
    const u = new URL(url);
    const method = (opts && opts.method) || "GET";
    if (spy) spy(u.pathname + u.search);
    const hit = handlers[u.pathname];
    if (hit) return hit(u, opts, method);
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

function bodyWithLink() {
  document.body.innerHTML = `<article class="post">
    <p>Descargá <a href="https://github.com/Aleperix/tumbleboy-reborn/releases/latest">la última versión</a> acá.</p>
  </article>`;
}

describe("chunk releases", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    try {
      sessionStorage.clear();
    } catch (err) {}
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  it("sin enlaces a releases no hace nada", async () => {
    document.body.innerHTML = "<p>sin enlaces</p>";
    const spy = vi.fn();
    mockBackend({}, spy);
    window.XOGalaxy.releases.init();
    await flush();
    expect(document.querySelector(".release-card")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("convierte el enlace en una card con descargas y changelog", async () => {
    loadVendored();
    bodyWithLink();
    mockBackend({
      "/releases": (u) => {
        expect(u.searchParams.get("url")).toBe("https://github.com/Aleperix/tumbleboy-reborn/releases/latest");
        return Promise.resolve(new Response(JSON.stringify(PROXY_DATA), { status: 200 }));
      },
    });
    window.XOGalaxy.releases.init();
    await flush();
    await flush();

    const card = document.querySelector(".release-card");
    expect(card).toBeTruthy();
    expect(card.querySelector(".release-name").textContent).toBe("TumbleBoy Reborn v1.1.5");
    expect(card.querySelector(".release-tag").textContent).toBe("v1.1.5");
    const link = document.querySelector('a[href*="github.com"]');
    expect(link.style.display).toBe("none");
    const dl = document.querySelector(".release-download");
    expect(dl.getAttribute("href")).toBe(
      "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk"
    );
    expect(dl.querySelector(".release-size").textContent).toContain("MB");
    const body = document.querySelector(".release-body");
    expect(body.innerHTML).toContain("<h1>Cambios</h1>");
    expect(body.querySelector("strong").textContent).toBe("Nuevo");
  });

  it("si el proxy falla usa api.github.com como fallback", async () => {
    bodyWithLink();
    mockBackend({
      "/releases": () => Promise.reject(new Error("down")),
      "/repos/Aleperix/tumbleboy-reborn/releases/latest": (u) => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tag_name: "v1.1.4",
              name: "v1.1.4",
              body: "directo",
              assets: [{ name: "x.apk", size: 100, browser_download_url: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.4/x.apk" }],
            }),
            { status: 200 }
          )
        );
      },
    });
    window.XOGalaxy.releases.init();
    await flush();
    await flush();

    expect(document.querySelector(".release-tag").textContent).toBe("v1.1.4");
  });

  it("cachea en sessionStorage y no refetch al re-escanear", async () => {
    let calls = 0;
    mockBackend({
      "/releases": () => {
        calls += 1;
        return Promise.resolve(new Response(JSON.stringify(PROXY_DATA), { status: 200 }));
      },
    });
    bodyWithLink();
    window.XOGalaxy.releases.init();
    await flush();
    await flush();
    expect(calls).toBe(1);

    const cached = window.XOGalaxy.releases._readCache("https://github.com/Aleperix/tumbleboy-reborn/releases/latest");
    expect(cached).toBeTruthy();

    document.body.innerHTML = "";
    bodyWithLink();
    window.XOGalaxy.releases.init();
    await flush();
    expect(calls).toBe(1);
  });

  it("scan(container) procesa contenedores dinámicos (chat)", async () => {
    mockBackend({
      "/releases": () => Promise.resolve(new Response(JSON.stringify(PROXY_DATA), { status: 200 })),
    });
    const holder = document.createElement("div");
    holder.innerHTML = `<p><a href="https://github.com/Aleperix/tumbleboy-reborn/releases/latest">v1.1.5</a></p>`;
    document.body.appendChild(holder);
    window.XOGalaxy.releases.scan(holder);
    await flush();
    await flush();
    expect(document.querySelector(".release-card")).toBeTruthy();
  });
});
