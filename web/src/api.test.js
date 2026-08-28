import { beforeEach, describe, expect, it, vi } from "vitest";
import "./core.js";
import "./api.js";
describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("comments.list/count/counts/total pegan al backend correcto", async () => {
    const seen = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      seen.push(u.pathname + u.search);
      return new Response("{}", { status: 200 });
    });
    await window.XOGalaxy.api.comments.list("p1");
    await window.XOGalaxy.api.comments.count("p1");
    await window.XOGalaxy.api.comments.counts(["p1", "p2"]);
    await window.XOGalaxy.api.comments.total();
    expect(seen).toEqual([
      "/comments?postId=p1",
      "/comments?postId=p1&count=1",
      "/comments/counts?ids=p1%2Cp2",
      "/comments/total",
    ]);
  });

  it("modPending/moderar mandan X-XOGALAXY-Token", async () => {
    const headersSeen = [];
    vi.stubGlobal("fetch", async (url, opts) => {
      const u = new URL(url);
      headersSeen.push({ path: u.pathname, token: opts.headers["X-XOGALAXY-Token"], method: (opts && opts.method) || "GET" });
      return new Response("{}", { status: 200 });
    });
    await window.XOGalaxy.api.comments.modPending("jwt.owner");
    await window.XOGalaxy.api.comments.modReview(7, "approve", "jwt.owner");
    expect(headersSeen).toEqual([
      { path: "/comments/mod/pending", token: "jwt.owner", method: "GET" },
      { path: "/comments/mod/review", token: "jwt.owner", method: "POST" },
    ]);
  });

  it("propaga el error del backend", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }));
    await expect(window.XOGalaxy.api.comments.create({ postId: "p1", body: "x" })).rejects.toThrow("rate limited");
  });

  it("authVerify normaliza el perfil", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ sub: "s1", name: "Ana", picture: "p", isOwner: true }), { status: 200 })
    );
    const profile = await window.XOGalaxy.api.authVerify("jwt");
    expect(profile).toEqual({ sub: "s1", name: "Ana", picture: "p", isOwner: true });
  });

  it("chatSend incluye token cuando se pasa", async () => {
    let sent = null;
    vi.stubGlobal("fetch", async (url, opts) => {
      sent = JSON.parse(opts.body);
      return new Response("{}", { status: 200 });
    });
    await window.XOGalaxy.api.chatSend("general", "Ana", "hola", "jwt");
    expect(sent).toEqual({ room: "general", nickname: "Ana", body: "hola", token: "jwt", replyTo: null });
  });

  it("images.upload manda FormData con el file y el token", async () => {
    let captured = null;
    vi.stubGlobal("fetch", async (url, opts) => {
      captured = { url, method: opts.method, token: opts.headers["X-XOGALAXY-Token"], body: opts.body };
      return new Response(JSON.stringify({ url: "https://media.xogalaxy.workers.dev/images/abc123.webp", key: "images/abc123.webp" }), { status: 200 });
    });
    const file = new File(["data"], "foto.png", { type: "image/png" });
    const d = await window.XOGalaxy.api.images.upload(file, "jwt.owner");
    expect(d.url).toBe("https://media.xogalaxy.workers.dev/images/abc123.webp");
    expect(captured.method).toBe("POST");
    expect(captured.token).toBe("jwt.owner");
    expect(captured.url).toContain("/images/upload");
    expect(captured.body instanceof FormData).toBe(true);
  });

  it("images.upload propaga error 403 de cuentas no-Google", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "solo cuentas Google pueden subir imágenes" }), { status: 403 })
    );
    await expect(window.XOGalaxy.api.images.upload(new File(["x"], "a.png", { type: "image/png" }), "")).rejects.toThrow(
      "solo cuentas Google"
    );
  });

  it("images.upload propaga 429 rate-limit", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "no toques el power-driverr" }), { status: 429 })
    );
    await expect(window.XOGalaxy.api.images.upload(new File(["x"], "a.png", { type: "image/png" }), "jwt")).rejects.toThrow(
      "no toques"
    );
  });

  it("suggest pega a /users/suggest con q>=2", async () => {
    const seen = [];
    vi.stubGlobal("fetch", async (url) => {
      const u = new URL(url);
      seen.push(u.pathname + u.search);
      return new Response(JSON.stringify({ users: [{ sub: "s1", name: "Ana", picture: "p" }] }), { status: 200 });
    });
    const d = await window.XOGalaxy.api.suggest("an");
    expect(d.users[0].name).toBe("Ana");
    expect(seen).toEqual(["/users/suggest?q=an"]);
  });
});
