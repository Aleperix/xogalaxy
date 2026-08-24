import { beforeEach, describe, expect, it } from "vitest";
import "../core.js";
import "../api.js";
import "./chat-archive.js";

const X = () => window.XOGalaxy;

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

function route(url) {
  const u = String(url);
  if (u.includes("/chat/archive/days")) {
    return { days: [{ day: "2026-08-23", count: 2 }, { day: "2026-08-22", count: 5 }] };
  }
  if (u.includes("/chat/archive?") && !u.includes("cursor=")) {
    return {
      room: "general",
      day: "2026-08-23",
      messages: [
        { id: 1, nickname: "Alice", body: "primer mensaje", createdAt: Date.parse("2026-08-23T03:15:00Z"), author: { sub: "s1", name: "Alice", picture: null } },
        { id: 2, nickname: "Bob", body: "segundo mensaje", createdAt: Date.parse("2026-08-23T04:20:00Z"), author: null },
      ],
      nextCursor: 2,
    };
  }
  if (u.includes("/chat/archive?")) {
    return {
      room: "general",
      day: "2026-08-23",
      messages: [{ id: 3, nickname: "Cara", body: "tercer mensaje", createdAt: Date.parse("2026-08-23T05:00:00Z"), author: null }],
      nextCursor: null,
    };
  }
  return {};
}

describe("chunk chat-archive", () => {
  let calls;

  beforeEach(() => {
    document.body.innerHTML = "";
    X().chatArchive.reset();
    calls = [];
    global.fetch = (url, opts) => {
      calls.push({ url: String(url), opts });
      const data = route(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      });
    };
    X().markdown = { render: (t) => t };
    X().auth = {
      getProfile: () => ({ sub: "owner-sub", name: "Owner", isOwner: true }),
      getToken: () => "token-test",
      onAuthChange: () => {},
    };
  });

  it("no hace nada sin el mount point #chat-archive", async () => {
    X().chatArchive.init();
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("carga días y auto-selecciona el más reciente con sus mensajes", async () => {
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-archive" }));
    X().chatArchive.init();
    await flush();
    await flush();

    expect(calls.some((c) => c.url.includes("/chat/archive/days"))).toBe(true);
    const pills = document.querySelectorAll(".ca-day");
    expect(pills).toHaveLength(2);
    expect(pills[0].classList.contains("active")).toBe(true);
    const msgs = document.querySelectorAll(".ca-msg");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].getAttribute("data-id")).toBe("1");
    expect(msgs[0].textContent).toContain("primer mensaje");
  });

  it("el owner ve el botón de borrado y al confirmar quita el mensaje", async () => {
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-archive" }));
    window.confirm = () => true;
    X().chatArchive.init();
    await flush();
    await flush();

    const del = document.querySelector(".ca-del");
    expect(del).toBeTruthy();
    del.click();
    await flush();
    await flush();

    expect(calls.some((c) => c.opts && c.opts.headers && c.opts.headers["X-XOGALAXY-Token"] === "token-test")).toBe(true);
    expect(document.querySelectorAll(".ca-msg")).toHaveLength(1);
  });

  it("un visitante no ve botones de borrado", async () => {
    X().auth.getProfile = () => null;
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-archive" }));
    X().chatArchive.init();
    await flush();
    await flush();

    expect(document.querySelector(".ca-del")).toBeNull();
  });

  it('"Cargar más" pagina con el cursor', async () => {
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-archive" }));
    X().chatArchive.init();
    await flush();
    await flush();

    const more = document.querySelector(".ca-more");
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    await flush();

    expect(calls.some((c) => c.url.includes("cursor=2"))).toBe(true);
    expect(document.querySelectorAll(".ca-msg")).toHaveLength(3);
    expect(more.hidden).toBe(true);
  });

  it("sin días archivados muestra el estado vacío", async () => {
    global.fetch = (url) => {
      calls.push({ url: String(url) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ days: [] }),
      });
    };
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "chat-archive" }));
    X().chatArchive.init();
    await flush();
    await flush();

    const status = document.querySelector(".ca-status");
    expect(status.textContent).toContain("Todavía no hay mensajes archivados");
    expect(document.querySelector(".ca-list")).toBeNull();
  });
});
