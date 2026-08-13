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
    window.XOGalaxy.auth._resetForTests();
    window.google = undefined;
    sessionStorage.clear();
    document.documentElement.setAttribute("data-theme", "dark");
  });

  it("sin client id, init no carga el script GSI", async () => {
    vi.stubGlobal("fetch", async (url) => {
      expect(String(url)).toContain("/auth/config");
      return new Response(JSON.stringify({ clientId: "" }), { status: 200 });
    });
    window.XOGalaxy.auth.init();
    await flush();
    await flush();
    expect(document.querySelector('script[src*="accounts.google.com/gsi/client"]')).toBeNull();
  });

  it("fetch a /auth/config resuelve el client id y no vuelve a pedirlo en la sesión", async () => {
    let hits = 0;
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      if (u.pathname === "/auth/config") {
        hits++;
        return new Response(JSON.stringify({ clientId: "cid-remote" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    window.XOGalaxy.auth.init();
    await flush();
    await flush();
    expect(hits).toBe(1);

    const slot = document.createElement("div");
    document.body.appendChild(slot);
    window.google = {
      accounts: { id: { initialize() {}, renderButton() {}, prompt() {} } },
    };
    window.XOGalaxy.auth.renderButton(slot);
    await flush();
    expect(hits).toBe(1);
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

  it("persiste token+perfil en sessionStorage al verificar", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ sub: "s1", name: "Ana", picture: "p", isOwner: false }), { status: 200 })
    );
    window.XOGalaxy.auth._handleCredential({ credential: "jwt.persist" });
    await flush();
    expect(sessionStorage.getItem("xogalaxy_token")).toBe("jwt.persist");
    expect(JSON.parse(sessionStorage.getItem("xogalaxy_profile"))).toMatchObject({ sub: "s1" });
  });

  it("init restaura sesión guardada y re-verifica en el backend", async () => {
    sessionStorage.setItem("xogalaxy_token", "stored.jwt");
    sessionStorage.setItem("xogalaxy_profile", JSON.stringify({ sub: "s9", name: "Sesi", picture: "", isOwner: false }));
    let verified = false;
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      if (u.pathname === "/auth/verify") {
        verified = true;
        return new Response(
          JSON.stringify({ sub: "s9", name: "Sesi", picture: "", isOwner: true }),
          { status: 200 }
        );
      }
      if (u.pathname === "/auth/config") {
        return new Response(JSON.stringify({ clientId: "" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    window.XOGalaxy.auth.init();
    expect(window.XOGalaxy.auth.getToken()).toBe("stored.jwt");
    expect(window.XOGalaxy.auth.getProfile()).toMatchObject({ sub: "s9" });
    await flush();
    await flush();
    expect(verified).toBe(true);
    expect(window.XOGalaxy.auth.getProfile()).toMatchObject({ sub: "s9", isOwner: true });
  });

  it("restore con token vencido limpia token, perfil y storage", async () => {
    sessionStorage.setItem("xogalaxy_token", "expired.jwt");
    sessionStorage.setItem("xogalaxy_profile", JSON.stringify({ sub: "s9", name: "Viejo" }));
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      if (u.pathname === "/auth/verify") {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      if (u.pathname === "/auth/config") {
        return new Response(JSON.stringify({ clientId: "" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    window.XOGalaxy.auth.init();
    expect(window.XOGalaxy.auth.getProfile()).toMatchObject({ sub: "s9" });
    await flush();
    await flush();
    expect(window.XOGalaxy.auth.getToken()).toBeNull();
    expect(window.XOGalaxy.auth.getProfile()).toBeNull();
    expect(sessionStorage.getItem("xogalaxy_token")).toBeNull();
    expect(sessionStorage.getItem("xogalaxy_profile")).toBeNull();
  });

  it("logout limpia sessionStorage", async () => {
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
    expect(sessionStorage.getItem("xogalaxy_token")).toBe("jwt");
    window.XOGalaxy.auth.logout();
    expect(sessionStorage.getItem("xogalaxy_token")).toBeNull();
    expect(sessionStorage.getItem("xogalaxy_profile")).toBeNull();
  });

  it("login llama a prompt de GIS (One Tap)", async () => {
    const prompt = vi.fn();
    window.google = {
      accounts: { id: { initialize() {}, renderButton() {}, prompt } },
    };
    window.XOGalaxy.auth._setClientId("cid");
    const appended = [];
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node);
      return node;
    });
    window.XOGalaxy.auth.renderButton(document.createElement("div"));
    appended[0].onload();
    window.XOGalaxy.auth.login();
    await flush();
    expect(prompt).toHaveBeenCalled();
  });

  it("init dispara el One Tap automático si no hay sesión", async () => {
    vi.useFakeTimers();
    const prompt = vi.fn();
    window.google = {
      accounts: { id: { initialize() {}, renderButton() {}, prompt } },
    };
    window.XOGalaxy.auth._resetAutoPrompt();
    window.XOGalaxy.auth._setClientId("cid");
    const appended = [];
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node);
      return node;
    });
    window.XOGalaxy.auth.renderButton(document.createElement("div"));
    appended[0].onload();
    window.XOGalaxy.auth.init();
    vi.advanceTimersByTime(1600);
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("renderButton usa el tema de la página y se actualiza al cambiar de tema", () => {
    const renders = [];
    window.google = {
      accounts: {
        id: {
          initialize() {},
          renderButton(el, opts) {
            renders.push(opts);
          },
          prompt() {},
        },
      },
    };
    window.XOGalaxy.auth._setClientId("cid");
    const appended = [];
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      appended.push(node);
      return node;
    });
    const slot = document.createElement("div");
    document.body.appendChild(slot);

    document.documentElement.setAttribute("data-theme", "dark");
    window.XOGalaxy.auth.renderButton(slot);
    appended[0].onload();
    expect(renders[0].theme).toBe("filled_black");

    document.documentElement.setAttribute("data-theme", "light");
    window.XOGalaxy.hooks.run("theme", "light");
    expect(renders[renders.length - 1].theme).toBe("outline");

    document.documentElement.setAttribute("data-theme", "dark");
    window.XOGalaxy.hooks.run("theme", "dark");
    expect(renders[renders.length - 1].theme).toBe("filled_black");
  });
});
