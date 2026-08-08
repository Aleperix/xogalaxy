import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../core.js";
import "../api.js";
import "./auth.js";
import "../markdown.js";
import "./posts.js";

const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vendor");

function flush(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

function loadVendored() {
  const code =
    fs.readFileSync(path.join(VENDOR_DIR, "marked.min.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(VENDOR_DIR, "dompurify.min.js"), "utf8");
  new Function(code)();
}

function mockBackend(handlers) {
  vi.stubGlobal("fetch", async (url, opts) => {
    const u = new URL(url);
    const method = (opts && opts.method) || "GET";
    const hit = handlers[u.pathname];
    if (hit) return hit(u, opts, method);
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

function tool() {
  return document.querySelector(".post-tool");
}

describe("chunk posts (tool de aportes)", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="post-tool"></div>`;
    window.XOGalaxy.auth.logout();
    window.XOGalaxy.posts.reset();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  it("no hace nada sin #post-tool", () => {
    document.body.innerHTML = "";
    expect(() => window.XOGalaxy.posts.init()).not.toThrow();
    expect(document.querySelector(".post-tool")).toBeNull();
  });

  it("monta el formulario con botones rápidos y preview debounced", async () => {
    loadVendored();
    window.XOGalaxy.posts.init();
    expect(document.querySelector(".pt-title-input")).toBeTruthy();
    expect(document.querySelectorAll(".pt-qbtn").length).toBe(9);

    const ta = document.querySelector(".pt-body");
    ta.value = "# Título\n\n**negrita**";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".pt-preview-toggle").click();
    await flush(200);

    expect(document.querySelector(".pt-preview").hidden).toBe(false);
    expect(document.querySelector(".pt-preview").innerHTML).toContain("<h1>Título</h1>");
  });

  it("los botones rápidos insertan markdown", () => {
    window.XOGalaxy.posts.init();
    const ta = document.querySelector(".pt-body");
    ta.value = "hola";
    ta.setSelectionRange(0, 4);
    document.querySelectorAll(".pt-qbtn")[1].click();
    expect(ta.value).toBe("**hola**");
  });

  it("enviar anónimo manda name sin token y avisa que quedó en revisión", async () => {
    mockBackend({
      "/posts": (u, opts, method) => {
        if (method === "POST") {
          const body = JSON.parse(opts.body);
          expect(body.token).toBeFalsy();
          expect(body.title).toBe("Mi aporte");
          expect(body.body).toBe("# Contenido");
          return Promise.resolve(
            new Response(JSON.stringify({ post: { id: 1, status: "pending" } }), { status: 201 })
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ posts: [] }), { status: 200 }));
      },
    });
    window.XOGalaxy.posts.init();
    const name = document.querySelector(".pt-name");
    name.value = "Visitante";
    document.querySelector(".pt-title-input").value = "Mi aporte";
    document.querySelector(".pt-body").value = "# Contenido";
    document.querySelector(".pt-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector(".pt-status").textContent).toContain("revisión");
    expect(document.querySelector(".pt-title-input").value).toBe("");
  });

  it("con login Google envía token y muestra la bandeja del owner", async () => {
    loadVendored();
    vi.stubGlobal("fetch", async (url, opts) => {
      const u = new URL(url);
      if (u.pathname === "/auth/verify") {
        return new Response(JSON.stringify({ sub: "owner", name: "Dueño", picture: "p", isOwner: true }), { status: 200 });
      }
      if (u.pathname === "/posts" && opts && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        expect(body.token).toBe("jwt.owner");
        return new Response(JSON.stringify({ post: { id: 2, status: "pending" } }), { status: 201 });
      }
      if (u.pathname === "/posts/pending") {
        return new Response(JSON.stringify({ posts: [{ id: 7, title: "Aporte 1", body: "<script>x</script> y **z**", author: { name: "Pepe" }, createdAt: 1700000000000, status: "pending" }] }), { status: 200 });
      }
      if (u.pathname === "/posts/approved") {
        return new Response(JSON.stringify({ posts: [{ id: 8, title: "Aprobado", body: "ok", author: { name: "Ana" }, createdAt: 1700000000000, status: "approved", postUrl: "" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    window.XOGalaxy.auth._setProfile({ sub: "owner", name: "Dueño", isOwner: true });
    window.XOGalaxy.auth._setToken("jwt.owner");
    window.XOGalaxy.posts.init();
    await flush();

    expect(window.XOGalaxy.auth.isOwner()).toBe(true);
    document.querySelector(".pt-mod-toggle").click();
    await flush();

    const pendingBody = document.querySelector(".pt-mod-pending .pt-post-body");
    expect(document.querySelector(".pt-mod-pending .pt-post-title").textContent).toBe("Aporte 1");
    expect(pendingBody.innerHTML).not.toContain("<script");
    expect(document.querySelector(".pt-mod-approved .pt-post-title").textContent).toBe("Aprobado");
    expect(document.querySelectorAll(".pt-copy").length).toBe(2);
    expect(document.querySelectorAll(".pt-approve").length).toBe(1);
  });

  it("el owner aprueba y guarda la URL del post publicado", async () => {
    let reviewed = null;
    let urlSaved = null;
    const store = [
      { id: 7, title: "Aporte 1", body: "x", author: { name: "Pepe" }, createdAt: 1700000000000, status: "pending", postUrl: "" },
    ];
    mockBackend({
      "/posts/pending": () =>
        Promise.resolve(
          new Response(JSON.stringify({ posts: store.filter((p) => p.status === "pending") }), { status: 200 })
        ),
      "/posts/approved": () =>
        Promise.resolve(
          new Response(JSON.stringify({ posts: store.filter((p) => p.status === "approved") }), { status: 200 })
        ),
      "/posts/mod/review": (u, opts) => {
        reviewed = JSON.parse(opts.body);
        const post = store.find((p) => p.id === reviewed.id);
        if (post) post.status = reviewed.action === "approve" ? "approved" : "rejected";
        return Promise.resolve(new Response(JSON.stringify({ post: {} }), { status: 200 }));
      },
      "/posts/url": (u, opts) => {
        urlSaved = JSON.parse(opts.body);
        const post = store.find((p) => p.id === urlSaved.id);
        if (post) post.postUrl = urlSaved.url;
        return Promise.resolve(new Response(JSON.stringify({ post: {} }), { status: 200 }));
      },
    });
    window.XOGalaxy.auth._setProfile({ sub: "owner", name: "Dueño", isOwner: true });
    window.XOGalaxy.auth._setToken("jwt.owner");
    window.XOGalaxy.posts.init();
    await flush();
    document.querySelector(".pt-mod-toggle").click();
    await flush();

    document.querySelector(".pt-approve").click();
    await flush();
    expect(reviewed).toEqual({ id: 7, action: "approve" });

    document.querySelector(".pt-mod-approved .pt-url").value = "https://xogalax.blogspot.com/2026/08/a.html";
    document.querySelector(".pt-save-url").click();
    await flush();
    expect(urlSaved).toEqual({ id: 7, url: "https://xogalax.blogspot.com/2026/08/a.html" });
  });
});
