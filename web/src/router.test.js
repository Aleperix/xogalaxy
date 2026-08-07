import { beforeEach, describe, expect, it, vi } from "vitest";
import "./core.js";
import "./api.js";
import "./chunks/auth.js";
import "./chunks/comments.js";
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

  it("tras navegar por SPA, el hook swap monta los comentarios propios", async () => {
    const { fetch } = globalThis;
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/con-comentarios.html") {
        return new Response(
          "<html><head><title>Con comentarios</title></head><body><main class=\"main-layout\">" +
            "<section id=\"comments\" data-post-id=\"p1\"><div id=\"comments-app\"></div></section>" +
            "</main></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      if (u.pathname === "/comments") {
        return new Response(JSON.stringify({ postId: "p1", count: 2 }), { status: 200 });
      }
      return fetch(url);
    });

    await window.XOGalaxy.router.navigate("/con-comentarios.html");
    await flush();

    const mounted = document.querySelector("section#comments[data-post-id='p1'] .xogalaxy-comments");
    expect(mounted).toBeTruthy();
    expect(document.querySelector("section#comments .cmts-toggle").textContent).toContain("2");
    vi.unstubAllGlobals();
  });

  it("no re-ejecuta scripts del HTML al navegar por SPA", async () => {
    const { fetch } = globalThis;
    vi.stubGlobal("fetch", async (url) => {
      if (String(url).includes("/con-otro-script")) {
        return new Response(
          "<html><head><title>Otro</title></head><body><main class=\"main-layout\">" +
            "<script>var otro = 1;</script>" +
            "<p>sin comentarios</p></main></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      return fetch(url);
    });
    const createSpy = vi.spyOn(document, "createElement");

    await window.XOGalaxy.router.navigate("/con-otro-script.html");
    await flush();

    expect(createSpy.mock.calls.filter((c) => c[0] === "script")).toHaveLength(0);
    vi.unstubAllGlobals();
    createSpy.mockRestore();
  });

  it("no intercepta un link al mismo path con hash (#comments)", () => {
    const spy = vi.spyOn(window.XOGalaxy.router, "navigate").mockResolvedValue();
    const link = document.createElement("a");
    link.href = "/#comments";
    link.textContent = "comentarios";
    document.body.appendChild(link);

    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
