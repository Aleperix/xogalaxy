import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./notifications.js";

const X = () => window.XOGalaxy;

function mockBackend(handlers) {
  vi.stubGlobal("fetch", async (url, opts) => {
    const u = new URL(url);
    const hit = handlers[u.pathname];
    if (hit) return hit(u, opts);
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

let authProfile;

describe("chunk notifications", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    X().notifications.reset();
    X().auth = {
      getProfile: () => authProfile,
      getToken: () => (authProfile ? "token-test" : null),
      onAuthChange: () => {},
    };
    authProfile = { sub: "u1", name: "Alice", isOwner: false };
  });

  it("no hace nada sin .main-nav", () => {
    mockBackend({});
    X().notifications.init();
    expect(document.querySelector(".notif-toggle")).toBeNull();
  });

  it("agrega el botón al nav y muestra el badge con no leídas", async () => {
    document.body.innerHTML = '<nav class="main-nav"></nav>';
    let readCalls = 0;
    mockBackend({
      "/notifications": () =>
        new Response(
          JSON.stringify({
            items: [
              { id: 1, type: "mention_chat", actor: { name: "Bob", picture: null }, excerpt: "hola @Alice", ref: "chat", createdAt: Date.now() - 60000, read: false },
            ],
            unread: 1,
          }),
          { status: 200 }
        ),
      "/notifications/read": () => {
        readCalls += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    X().notifications.init();
    await flush();

    const btn = document.querySelector(".notif-toggle");
    expect(btn).toBeTruthy();
    const badge = document.querySelector("[data-notif-badge]");
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe("1");

    btn.click();
    const panel = document.querySelector(".notif-panel");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll(".notif-item")).toHaveLength(1);
    expect(panel.querySelector(".notif-item").classList.contains("unread")).toBe(true);
    await flush();
    expect(readCalls).toBe(1);
  });

  it("sin notificaciones el badge queda oculto y el panel muestra estado vacío", async () => {
    document.body.innerHTML = '<nav class="main-nav"></nav>';
    mockBackend({
      "/notifications": () => new Response(JSON.stringify({ items: [], unread: 0 }), { status: 200 }),
    });
    X().notifications.init();
    await flush();

    expect(document.querySelector("[data-notif-badge]").hidden).toBe(true);
    document.querySelector(".notif-toggle").click();
    const panel = document.querySelector(".notif-panel");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("No tenés notificaciones");
  });

  it("anónimos no polléa ni ve badge", async () => {
    document.body.innerHTML = '<nav class="main-nav"></nav>';
    let polled = 0;
    authProfile = null;
    mockBackend({
      "/notifications": () => {
        polled += 1;
        return new Response(JSON.stringify({ items: [], unread: 0 }), { status: 200 });
      },
    });
    X().notifications.init();
    await flush();
    expect(polled).toBe(0);
    expect(document.querySelector(".notif-toggle")).toBeTruthy();
    expect(document.querySelector("[data-notif-badge]").hidden).toBe(true);
  });

  it("click en una notificación de chat navega a #chat y cierra el panel", async () => {
    document.body.innerHTML = '<nav class="main-nav"></nav>';
    window.location.hash = "";
    mockBackend({
      "/notifications": () =>
        new Response(
          JSON.stringify({
            items: [
              { id: 5, type: "mention_chat", actor: { name: "Bob", picture: null }, excerpt: "ey", ref: "chat", createdAt: Date.now(), read: true },
            ],
            unread: 0,
          }),
          { status: 200 }
        ),
    });
    X().notifications.init();
    await flush();

    document.querySelector(".notif-toggle").click();
    document.querySelector(".notif-item").click();
    expect(window.location.hash).toBe("#chat");
    expect(document.querySelector(".notif-panel").hidden).toBe(true);
  });
});
