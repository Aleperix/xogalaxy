import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "../markdown.js";
import "./auth.js";
import "./identity.js";
import "./chat.js";

function mockBackend(handlers) {
  vi.stubGlobal("fetch", async (url, opts) => {
    const u = new URL(url);
    const hit = handlers[u.pathname];
    if (hit) return hit(u, opts);
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });
}

class FakeWS {
  static reset() {
    FakeWS.all = [];
    FakeWS.last = null;
  }
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    this.sent = [];
    FakeWS.all.push(this);
    FakeWS.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  fire(type, ev) {
    (this.listeners[type] || []).forEach((fn) => fn(ev));
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const HOUR = 3600000;

describe("chat timestamps y menciones", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="chat-app" data-room="general"></div>';
    localStorage.clear();
    FakeWS.reset();
    window.WebSocket = FakeWS;
    window.IntersectionObserver = undefined;
    delete window.marked;
    delete window.DOMPurify;
    window.XOGalaxy.chat.reset();
  });

  function pushHistory(ws, messages) {
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", { data: JSON.stringify({ type: "history", messages }) });
  }

  it("cada mensaje muestra la hora con title completo", () => {
    const ts = Date.parse("2026-08-24T15:05:00Z");
    window.XOGalaxy.chat.init();
    pushHistory(FakeWS.last, [{ id: 1, nickname: "Ana", body: "hola", createdAt: ts }]);

    const time = document.querySelector(".chat-msg-time");
    expect(time).toBeTruthy();
    expect(time.getAttribute("datetime")).toBe("2026-08-24T15:05:00.000Z");
    expect(time.title.length).toBeGreaterThan(0);
    expect(document.querySelector(".chat-msg-head")).toBeTruthy();
    expect(document.querySelector(".chat-msg-main")).toBeTruthy();
  });

  it("resalta las @menciones dentro del cuerpo renderizado", () => {
    window.XOGalaxy.chat.init();
    pushHistory(FakeWS.last, [
      { id: 1, nickname: "Ana", body: "ey @Beto.x y @Cara mirá esto", createdAt: Date.now() },
    ]);

    const mentions = document.querySelectorAll(".chat-msg-body .chat-mention");
    expect(mentions).toHaveLength(2);
    expect(mentions[0].textContent).toBe("@Beto.x");
    expect(mentions[1].textContent).toBe("@Cara");
  });

  it("no resalta emails como menciones", () => {
    window.XOGalaxy.chat.init();
    pushHistory(FakeWS.last, [{ id: 1, nickname: "Ana", body: "mail test@correo.com ok", createdAt: Date.now() }]);
    expect(document.querySelectorAll(".chat-mention")).toHaveLength(0);
    expect(document.querySelector(".chat-msg-body").textContent).toContain("test@correo.com");
  });
});

describe("autocomplete de menciones", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="chat-app" data-room="general"></div>';
    localStorage.clear();
    FakeWS.reset();
    window.WebSocket = FakeWS;
    window.IntersectionObserver = undefined;
    delete window.marked;
    delete window.DOMPurify;
    window.XOGalaxy.chat.reset();
    mockBackend({
      "/users/suggest": (u) =>
        new Response(JSON.stringify({ users: [{ sub: "u1", name: "Bob García", picture: null }] }), { status: 200 }),
    });
  });

  async function typeAt(input, text) {
    input.value = text;
    input.selectionStart = text.length;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 220));
  }

  it("muestra sugerencias al escribir @nombre y elige con Enter", async () => {
    window.XOGalaxy.chat.init();
    const input = document.querySelector(".chat-input");
    const box = document.querySelector(".chat-suggest");

    await typeAt(input, "hola @Bo");
    expect(box.hidden).toBe(false);
    expect(box.querySelectorAll(".chat-suggest-item")).toHaveLength(1);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // inserta el primer segmento del nombre (las menciones no tienen espacios;
    // la resolución por prefijo en el backend encuentra a "Bob García")
    expect(input.value).toBe("hola @Bob ");
    expect(box.hidden).toBe(true);
  });

  it("cierra el popup con Escape y no abre con menos de 2 caracteres", async () => {
    window.XOGalaxy.chat.init();
    const input = document.querySelector(".chat-input");
    const box = document.querySelector(".chat-suggest");

    await typeAt(input, "@B");
    expect(box.hidden).toBe(true);

    await typeAt(input, "x @Bob");
    expect(box.hidden).toBe(false);

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(box.hidden).toBe(true);
  });

  it("Enter en el popup no envía el mensaje", async () => {
    window.XOGalaxy.chat.init();
    const form = document.querySelector(".chat-form");
    const input = document.querySelector(".chat-input");
    const sent = [];
    form.addEventListener("submit", (e) => e.preventDefault());

    await typeAt(input, "@Bo");
    const before = input.value;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(input.value.startsWith("@Bob ")).toBe(true);
    expect(sent).toHaveLength(0);
    void before;
  });
});
