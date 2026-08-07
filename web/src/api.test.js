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
    expect(sent).toEqual({ room: "general", nickname: "Ana", body: "hola", token: "jwt" });
  });
});
