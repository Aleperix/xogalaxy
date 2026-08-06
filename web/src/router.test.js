import { beforeEach, describe, expect, it, vi } from "vitest";
import "./core.js";
import "./api.js";
import "./router.js";

describe("router SPA", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<main class="main-layout"><article class="post-single"><h2 class="post-title">Actual</h2>' +
      '<p class="load-more"><a href="/pagina-2">más</a></p></article></main>';
    document.title = "Actual";
    history.replaceState({}, "", "/");
    window.XOGalaxy.router.init();
  });

  it("navigate intercambia main, actualiza título y pushState", async () => {
    const { fetch } = globalThis;
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("/post-nuevo")) {
        return new Response(
          "<html><head><title>Post nuevo</title></head><body><main class=\"main-layout\"><p>nuevo contenido</p></main></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      return fetch(url);
    });

    await window.XOGalaxy.router.navigate("/2026/08/post-nuevo.html");

    const main = document.querySelector("main.main-layout");
    expect(main.textContent).toContain("nuevo contenido");
    expect(document.title).toBe("Post nuevo");
    expect(location.pathname).toBe("/2026/08/post-nuevo.html");
    vi.unstubAllGlobals();
  });

  it("el clic en un link interno navega sin recargar", async () => {
    const spy = vi.spyOn(window.XOGalaxy.router, "navigate").mockResolvedValue();
    const link = document.createElement("a");
    link.href = "/2026/08/otro.html";
    link.textContent = "otro";
    document.body.appendChild(link);

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("no navega con metaKey ni hacia otros orígenes", () => {
    const spy = vi.spyOn(window.XOGalaxy.router, "navigate").mockResolvedValue();
    const meta = document.createElement("a");
    meta.href = "/con-meta";
    document.body.appendChild(meta);
    meta.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    expect(spy).not.toHaveBeenCalled();

    const ext = document.createElement("a");
    ext.href = "https://external.example/x";
    document.body.appendChild(ext);
    ext.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
