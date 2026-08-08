import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./auth.js";
import "./engagement.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function engagementHost(target, attrs) {
  const host = document.createElement("div");
  host.setAttribute("data-engagement", target);
  for (const k in attrs || {}) host.setAttribute(k, attrs[k]);
  document.body.appendChild(host);
  return host;
}

describe("chunk engagement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    try {
      localStorage.removeItem("xogalaxy.visitor");
    } catch (err) {}
    window.XOGalaxy.auth.logout();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  it("sin data-engagement no hace nada", () => {
    document.body.innerHTML = "<div></div>";
    expect(() => window.XOGalaxy.engagement.init()).not.toThrow();
    expect(document.querySelector(".xogalaxy-engagement")).toBeNull();
  });

  it("monta estrellas y reacciones y carga el estado", async () => {
    mockBackend({
      "/engagement": (u) => {
        expect(u.searchParams.get("targets")).toBe("post:1");
        expect(u.searchParams.get("user")).toBeTruthy();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ratings: { "post:1": { target: "post:1", count: 12, avg: 4, value: 5 } },
              reactions: { "post:1": { counts: { "❤": 3, "👍": 1 } } },
            }),
            { status: 200 }
          )
        );
      },
    });
    engagementHost("post:1");
    window.XOGalaxy.engagement.init();
    await flush();

    const stars = document.querySelectorAll(".engage-star");
    expect(stars).toHaveLength(5);
    expect(document.querySelectorAll(".engage-star.on")).toHaveLength(4);
    expect(document.querySelector(".engage-star.mine").getAttribute("data-value")).toBe("5");
    expect(document.querySelector(".engage-label").textContent).toContain("4.0");
    expect(document.querySelector(".engage-label").textContent).toContain("12 votos");

    const reacts = document.querySelectorAll(".engage-react");
    expect(reacts).toHaveLength(3);
    expect(reacts[0].querySelector(".engage-react-count").textContent).toBe("3");
    expect(reacts[1].querySelector(".engage-react-count").textContent).toBe("1");
    expect(reacts[2].querySelector(".engage-react-count").textContent).toBe("0");
  });

  it("data-reactions y data-rating=0 configuran el widget", async () => {
    mockBackend({
      "/engagement": () =>
        Promise.resolve(
          new Response(JSON.stringify({ ratings: {}, reactions: {} }), { status: 200 })
        ),
    });
    engagementHost("post:9", { "data-rating": "0", "data-reactions": "🎮,🎲" });
    window.XOGalaxy.engagement.init();
    await flush();

    expect(document.querySelector(".engage-stars")).toBeNull();
    const reacts = document.querySelectorAll(".engage-react");
    expect(reacts).toHaveLength(2);
    expect(reacts[0].getAttribute("data-type")).toBe("🎮");
  });

  it("click en estrella envía el voto (toggle a 0 si es la propia)", async () => {
    const calls = [];
    mockBackend({
      "/engagement": () =>
        Promise.resolve(
          new Response(JSON.stringify({ ratings: { p: { count: 1, avg: 5, value: 5 } }, reactions: {} }), { status: 200 })
        ),
      "/rating": (u, opts) => {
        calls.push(JSON.parse(opts.body));
        return Promise.resolve(
          new Response(JSON.stringify({ target: "p", count: 1, avg: 5, value: calls[0].value }), { status: 200 })
        );
      },
    });
    engagementHost("p");
    window.XOGalaxy.engagement.init();
    await flush();

    const star5 = document.querySelector('.engage-star[data-value="5"]');
    star5.click();
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ target: "p", value: 0 });

    const star3 = document.querySelector('.engage-star[data-value="3"]');
    star3.click();
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ target: "p", value: 3 });
  });

  it("click en reacción togglea y actualiza el contador", async () => {
    let active = false;
    mockBackend({
      "/engagement": () =>
        Promise.resolve(new Response(JSON.stringify({ ratings: {}, reactions: {} }), { status: 200 })),
      "/reaction": (u, opts) => {
        active = !active;
        return Promise.resolve(
          new Response(JSON.stringify({ counts: active ? { "❤": 1 } : {} }), { status: 200 })
        );
      },
    });
    engagementHost("p");
    window.XOGalaxy.engagement.init();
    await flush();

    const btn = document.querySelector('.engage-react[data-type="❤"]');
    const count = btn.querySelector(".engage-react-count");
    btn.click();
    await flush();
    expect(count.textContent).toBe("1");
    btn.click();
    await flush();
    expect(count.textContent).toBe("0");
  });

  it("scan(container) procesa contenedores dinámicos y es idempotente", async () => {
    mockBackend({
      "/engagement": () =>
        Promise.resolve(new Response(JSON.stringify({ ratings: {}, reactions: {} }), { status: 200 })),
    });
    const holder = document.createElement("div");
    document.body.appendChild(holder);
    window.XOGalaxy.engagement.scan(holder);
    expect(document.querySelector(".xogalaxy-engagement")).toBeNull();

    const host = engagementHost("dynamic");
    holder.appendChild(host);
    window.XOGalaxy.engagement.scan(holder);
    await flush();
    expect(document.querySelector(".xogalaxy-engagement")).toBeTruthy();

    window.XOGalaxy.engagement.scan(holder);
    expect(document.querySelectorAll(".xogalaxy-engagement")).toHaveLength(1);
  });

  it("userId usa el sub de Google si hay sesión", async () => {
    const auth = window.XOGalaxy.auth;
    auth._setToken("t");
    auth._setProfile({ sub: "google-user-1", name: "Alice", picture: null, isOwner: false });
    expect(window.XOGalaxy.engagement.userId()).toBe("google-user-1");
    auth.logout();
    const v = window.XOGalaxy.engagement.userId();
    expect(v).toMatch(/^v_/);
    expect(window.XOGalaxy.engagement.userId()).toBe(v);
  });
});
