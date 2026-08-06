import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./stats.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chunk stats", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div><p id="stat-posts">—</p></div><div><p id="stat-comments">—</p></div>' +
      '<div><p id="stat-followers">—</p></div><div><p id="stat-visits">—</p></div>';
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  });

  it("init carga posts, comentarios, seguidores y visitas con HIT", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      calls.push(u.pathname + u.search);
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "3" } } }), { status: 200 });
      }
      if (u.pathname === "/feeds/comments/default") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "5" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(JSON.stringify({ count: 12 }), { status: 200 });
      }
      if (u.pathname === "/visits") {
        return new Response(JSON.stringify({ value: 56, hit: u.search === "?hit=1" }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();

    expect(document.getElementById("stat-posts").textContent).toBe("3");
    expect(document.getElementById("stat-comments").textContent).toBe("5");
    expect(document.getElementById("stat-followers").textContent).toBe("12");
    expect(document.getElementById("stat-visits").textContent).toBe("56");
    expect(calls).toContain("/visits?hit=1");
    vi.unstubAllGlobals();
  });

  it("refresh tras navegación SPA usa GET (no infla visitas)", async () => {
    const visits = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "5" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(JSON.stringify({ count: 20 }), { status: 200 });
      }
      if (u.pathname === "/visits") {
        visits.push(u.search);
        return new Response(JSON.stringify({ value: 99 }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();
    visits.length = 0;
    window.XOGalaxy.stats.refresh();
    await flush();

    expect(visits).not.toContain("?hit=1");
    expect(document.getElementById("stat-visits").textContent).toBe("99");
    vi.unstubAllGlobals();
  });

  it("marca '—' si el backend de seguidores falla", async () => {
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "1" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(null, { status: 502 });
      }
      if (u.pathname === "/visits") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();

    expect(document.getElementById("stat-followers").textContent).toBe("—");
    vi.unstubAllGlobals();
  });
});
