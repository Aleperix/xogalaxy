import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./auth.js";
import "./identity.js";
import "./engagement.js";
import "./comments.js";

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

function commentsApp() {
  return document.querySelector("#comments-app");
}

describe("chunk comments", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section id="comments" class="comments" data-post-id="p123">
        <h2>Comentarios</h2>
        <div id="comments-app"></div>
      </section>
    `;
    window.XOGalaxy.auth.logout();
    window.XOGalaxy.comments.reset();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  it("no hace nada sin section[data-post-id]", () => {
    document.body.innerHTML = '<div id="comments-app"></div>';
    expect(() => window.XOGalaxy.comments.init()).not.toThrow();
    expect(document.querySelector(".xogalaxy-comments")).toBeNull();
  });

  it("solo carga el contador al inicio (lazy)", async () => {
    const calls = [];
    mockBackend({
      "/comments": (u) => {
        calls.push(u.search);
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ postId: "p123", count: 3 }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ postId: "p123", comments: [] }), { status: 200 }));
      },
    });
    window.XOGalaxy.comments.init();
    await flush();

    expect(document.querySelector(".cmts-toggle").textContent).toContain("3");
    expect(calls.every((s) => s.includes("count=1"))).toBe(true);
    expect(document.querySelector(".cmts-list").hidden).toBe(true);
  });

  it("abrir la caja carga la lista y muestra el formulario", async () => {
    mockBackend({
      "/comments": (u) => {
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ count: 2 }), { status: 200 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comments: [
                { id: 1, postId: "p123", author: { sub: "s1", name: "Ana", picture: "p.png" }, body: "hola", status: "approved", createdAt: 1700000000000 },
                { id: 2, postId: "p123", author: { sub: null, name: "Pepe" }, body: "<b>xss</b>", status: "approved", createdAt: 1700000000000 },
              ],
            }),
            { status: 200 }
          )
        );
      },
    });
    window.XOGalaxy.comments.init();
    await flush();

    document.querySelector(".cmts-toggle").click();
    await flush();

    expect(document.querySelectorAll(".cmt").length).toBe(2);
    expect(document.querySelector(".cmts-form-wrap").hidden).toBe(false);
    const xss = document.querySelector('.cmt[data-id="2"] .cmt-body');
    expect(xss.innerHTML).toContain("&lt;b&gt;");
    expect(document.querySelector('.cmt[data-id="1"] .cmt-name.cmt-verified')).toBeTruthy();
    expect(document.querySelector('.cmt[data-id="1"] .cmt-avatar')).toBeTruthy();
  });

  it("publicar anónimo manda name y avisa que quedó en espera", async () => {
    mockBackend({
      "/comments": (u, opts, method) => {
        if (method === "POST") {
          const body = JSON.parse(opts.body);
          expect(body.token).toBeFalsy();
          expect(body.postId).toBe("p123");
          return Promise.resolve(
            new Response(JSON.stringify({ comment: { id: 9, status: "pending" } }), { status: 201 })
          );
        }
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ count: 0 }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ comments: [] }), { status: 200 }));
      },
    });
    window.XOGalaxy.comments.init();
    await flush();

    document.querySelector(".cmts-toggle").click();
    await flush();

    const input = document.querySelector(".cmts-name");
    input.value = "Visitante";
    const textarea = document.querySelector(".cmts-body");
    textarea.value = "Mi comentario";
    document.querySelector(".cmts-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector(".cmts-status").textContent).toContain("espera de aprobación");
    expect(textarea.value).toBe("");
  });

  it("con login Google publica con token y se publica directo", async () => {
    mockBackend({
      "/comments": (u, opts, method) => {
        if (method === "POST") {
          const body = JSON.parse(opts.body);
          expect(body.token).toBe("jwt.gg");
          return Promise.resolve(
            new Response(JSON.stringify({ comment: { id: 5, status: "approved" } }), { status: 201 })
          );
        }
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ count: 1 }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ comments: [] }), { status: 200 }));
      },
    });
    vi.stubGlobal("fetch", async (url, opts) => {
      const u = new URL(url);
      if (u.pathname === "/auth/verify") {
        return new Response(JSON.stringify({ sub: "s1", name: "Ana", picture: "p", isOwner: true }), { status: 200 });
      }
      if (u.pathname === "/comments" && opts && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        expect(body.token).toBe("jwt.gg");
        return new Response(JSON.stringify({ comment: { id: 5, status: "approved" } }), { status: 201 });
      }
      if (u.pathname === "/comments") {
        return new Response(JSON.stringify({ count: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    window.XOGalaxy.auth._handleCredential({ credential: "jwt.gg" });
    await flush();

    window.XOGalaxy.comments.init();
    await flush();
    document.querySelector(".cmts-toggle").click();
    await flush();

    expect(window.XOGalaxy.auth.isOwner()).toBe(true);
    expect(document.querySelector(".cmts-mod-toggle")).toBeTruthy();

    document.querySelector(".cmts-body").value = "directo";
    document.querySelector(".cmts-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelector(".cmts-status").textContent).toBe("");
  });

  it("el owner modera pendientes (aprueba y rechaza)", async () => {
    window.XOGalaxy.auth._setProfile({ sub: "owner", name: "Dueño", isOwner: true });
    window.XOGalaxy.auth._setToken("jwt.owner");
    mockBackend({
      "/comments": (u) => {
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ count: 0 }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ comments: [] }), { status: 200 }));
      },
      "/comments/mod/pending": () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ comments: [{ id: 11, postId: "p123", author: { sub: null, name: "Pepe" }, body: "moderar", status: "pending", createdAt: 1700000000000 }] }),
            { status: 200 }
          )
        ),
      "/comments/mod/review": (u, opts) => {
        const body = JSON.parse(opts.body);
        expect(opts.headers["X-XOGALAXY-Token"]).toBe("jwt.owner");
        return Promise.resolve(new Response(JSON.stringify({ comment: { id: body.id, status: "approved" } }), { status: 200 }));
      },
    });

    window.XOGalaxy.comments.init();
    await flush();

    const modBtn = document.querySelector(".cmts-mod-toggle");
    expect(modBtn).toBeTruthy();
    modBtn.click();
    await flush();

    expect(document.querySelectorAll(".cmts-mod-list .cmt").length).toBe(1);
    document.querySelector(".cmt-approve").click();
    await flush();
    expect(document.querySelectorAll(".cmts-mod-list .cmt").length).toBe(0);
  });

  it("monta reacciones por comentario (target comment:<id>, sin rating)", async () => {
    mockBackend({
      "/comments": (u) => {
        if (u.searchParams.get("count") === "1") {
          return Promise.resolve(new Response(JSON.stringify({ count: 1 }), { status: 200 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comments: [{ id: 7, postId: "p123", body: "ok", status: "approved", createdAt: 1700000000000 }],
            }),
            { status: 200 }
          )
        );
      },
      "/engagement": () =>
        Promise.resolve(
          new Response(JSON.stringify({ ratings: {}, reactions: { "comment:7": { counts: { "👍": 1 } } } }), { status: 200 })
        ),
    });

    window.XOGalaxy.comments.init();
    await flush();
    document.querySelector(".cmts-toggle").click();
    await flush();

    const host = document.querySelector('.cmt[data-id="7"] .cmt-engage');
    expect(host).toBeTruthy();
    expect(host.getAttribute("data-engagement")).toBe("comment:7");
    expect(host.getAttribute("data-rating")).toBe("0");
    expect(host.querySelector(".engage-stars")).toBeNull();
    const btn = host.querySelector('.engage-react[data-type="👍"]');
    expect(btn).toBeTruthy();
    await flush();
    expect(btn.querySelector(".engage-react-count").textContent).toBe("1");
  });
});
