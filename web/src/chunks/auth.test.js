import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./auth.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chunk auth", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    window.XOGalaxy.auth.logout();
    window.XOGalaxy.auth._setClientId("");
    window.google = undefined;
  });

  it("sin client id, init no carga el script GSI", () => {
    window.XOGalaxy.auth.init();
    expect(document.querySelector('script[src*="accounts.google.com/gsi/client"]')).toBeNull();
  });

  it("renderButton carga GSI y al cargar inicializa y pinta el botón", () => {
    let initCalled = false;
    let painted = null;
    window.google = {
      accounts: {
        id: {
          initialize() {
            initCalled = true;
          },
          renderButton(el) {
            painted = el;
          },
          prompt() {},
        },
      },
    };
    window.XOGalaxy.auth._setClientId("cid");
    const slot = document.createElement("div");
    document.body.appendChild(slot);

    const appended = [];
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node);
      return node;
    });

    window.XOGalaxy.auth.renderButton(slot);
    expect(appended.length).toBe(1);
    expect(appended[0].getAttribute("src")).toBe("https://accounts.google.com/gsi/client");
    expect(painted).toBeNull();

    appended[0].onload();
    expect(initCalled).toBe(true);
    expect(painted).toBe(slot);
  });

  it("_handleCredential verifica en el backend, guarda token y emite auth", async () => {
    let emitted = null;
    const unsub = window.XOGalaxy.auth.onAuthChange((p) => {
      emitted = p;
    });
    vi.stubGlobal("fetch", async (url, opts) => {
      const u = new URL(url);
      expect(u.pathname).toBe("/auth/verify");
      expect(opts.method).toBe("POST");
      return new Response(JSON.stringify({ sub: "s1", name: "Ana", picture: "p.png", isOwner: true }), { status: 200 });
    });

    window.XOGalaxy.auth._handleCredential({ credential: "jwt.abc" });
    await flush();

    expect(window.XOGalaxy.auth.getToken()).toBe("jwt.abc");
    expect(window.XOGalaxy.auth.getProfile()).toMatchObject({ sub: "s1", isOwner: true });
    expect(window.XOGalaxy.auth.isOwner()).toBe(true);
    expect(emitted).toMatchObject({ sub: "s1" });

    unsub();
  });

  it("logout limpia token y perfil y vuelve a emitir", async () => {
    window.google = {
      accounts: {
        id: {
          initialize() {},
          renderButton() {},
          disableAutoSelect() {},
        },
      },
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ sub: "s1", name: "Ana", picture: "p", isOwner: false }), { status: 200 })
    );
    window.XOGalaxy.auth._handleCredential({ credential: "jwt" });
    await flush();
    expect(window.XOGalaxy.auth.getProfile()).toBeTruthy();

    window.XOGalaxy.auth.logout();
    expect(window.XOGalaxy.auth.getToken()).toBeNull();
    expect(window.XOGalaxy.auth.getProfile()).toBeNull();
  });

  it("token inválido no deja perfil seteado", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    window.XOGalaxy.auth._handleCredential({ credential: "bad" });
    await flush();
    expect(window.XOGalaxy.auth.getProfile()).toBeNull();
    expect(window.XOGalaxy.auth.getToken()).toBeNull();
  });
});
