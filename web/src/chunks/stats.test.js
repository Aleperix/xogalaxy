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
      '<div><p id="stat-followers">—</p></div><div><p id="stat-visits">—</p></div>' +
      '<div id="follow-avatars"></div><button id="follow-btn"><i data-lucide="user-plus"/>Seguir</button>';
    window.XOGalaxy.auth = {
      getToken: () => null,
      login: vi.fn(),
      onAuthChange: vi.fn(),
    };
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
      if (u.pathname === "/comments/total") {
        return new Response(JSON.stringify({ total: 5 }), { status: 200 });
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

  it("renderiza los avatares de los seguidores", async () => {
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "1" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(
          JSON.stringify({
            count: 2,
            followers: [
              { sub: "s1", name: "Ana", picture: "https://p.example/a.png" },
              { sub: "s2", name: "Bob", picture: null },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.pathname === "/visits") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();

    const avatars = document.querySelectorAll("#follow-avatars .follow-avatar");
    expect(avatars.length).toBe(2);
    expect(avatars[0].querySelector("img").src).toBe("https://p.example/a.png");
    expect(avatars[1].textContent).toBe("B");
    expect(avatars[0].dataset.sub).toBe("s1");
    vi.unstubAllGlobals();
  });

  it("onAuth vuelve a cargar la lista de seguidores (refresco del sidebar al editar el perfil)", async () => {
    let followersCalls = 0;
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "1" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        followersCalls += 1;
        return new Response(JSON.stringify({ count: 3, followers: [] }), { status: 200 });
      }
      if (u.pathname === "/visits") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();
    expect(followersCalls).toBe(1);

    const onAuth = window.XOGalaxy.auth.onAuthChange.mock.calls[0][0];
    onAuth(null);
    await flush();
    expect(followersCalls).toBeGreaterThan(1);
    vi.unstubAllGlobals();
  });

  it("sin sesión, click en Seguir dispara el login y queda pendiente de seguir", async () => {
    const reqs = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url, "http://localhost");
      reqs.push(u.pathname);
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "1" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(JSON.stringify({ count: 3, followers: [] }), { status: 200 });
      }
      if (u.pathname === "/followers/follow") {
        return new Response(JSON.stringify({ ok: true, count: 3, following: true }), { status: 200 });
      }
      if (u.pathname === "/followers/me") {
        return new Response(JSON.stringify({ following: true }), { status: 200 });
      }
      if (u.pathname === "/visits") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    document.getElementById("follow-btn").click();

    expect(window.XOGalaxy.auth.login).toHaveBeenCalled();
    const onAuth = window.XOGalaxy.auth.onAuthChange.mock.calls[0][0];
    window.XOGalaxy.auth.getToken = () => "tok";

    onAuth({ sub: "s1" });
    await flush();

    expect(reqs).toContain("/followers/follow");
    expect(document.getElementById("follow-btn").classList.contains("following")).toBe(true);
    expect(document.getElementById("stat-followers").textContent).toBe("3");
    vi.unstubAllGlobals();
  });

  it("con sesión, click alterna seguir/dejar de seguir", async () => {
    window.XOGalaxy.auth.getToken = () => "tok";

    const reqs = [];
    let following = false;
    vi.stubGlobal("fetch", async (url, init) => {
      const u = new URL(url, "http://localhost");
      const method = (init && init.method) || "GET";
      reqs.push(method + " " + u.pathname);
      if (u.pathname === "/feeds/posts/summary") {
        return new Response(JSON.stringify({ feed: { openSearch$totalResults: { $t: "1" } } }), { status: 200 });
      }
      if (u.pathname === "/followers") {
        return new Response(JSON.stringify({ count: following ? 2 : 1, followers: [] }), { status: 200 });
      }
      if (u.pathname === "/followers/follow") {
        following = true;
        return new Response(JSON.stringify({ ok: true, count: 2, following: true }), { status: 200 });
      }
      if (u.pathname === "/followers/unfollow") {
        following = false;
        return new Response(JSON.stringify({ ok: true, count: 1, following: false }), { status: 200 });
      }
      if (u.pathname === "/followers/me") {
        return new Response(JSON.stringify({ following }), { status: 200 });
      }
      if (u.pathname === "/visits") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.stats.init();
    await flush();
    document.getElementById("follow-btn").click();
    await flush();
    expect(reqs).toContain("POST /followers/follow");
    expect(document.getElementById("follow-btn").classList.contains("following")).toBe(true);

    document.getElementById("follow-btn").click();
    await flush();
    expect(reqs).toContain("POST /followers/unfollow");
    expect(document.getElementById("follow-btn").classList.contains("following")).toBe(false);
    vi.unstubAllGlobals();
  });
});
