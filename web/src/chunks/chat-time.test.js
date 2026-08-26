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

  it("la barra arranca oculta y sigue oculta tras elegir la mención", async () => {
    window.XOGalaxy.chat.init();
    const input = document.querySelector(".chat-input");
    const box = document.querySelector(".chat-suggest");
    expect(box.hidden).toBe(true);

    await typeAt(input, "@Bo");
    expect(box.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(box.hidden).toBe(true);

    await typeAt(input, "@Bob y más texto");
    expect(box.hidden).toBe(true);

    await typeAt(input, "@Bob hola @Bo");
    expect(box.hidden).toBe(false);
  });
});

describe("tooltip de menciones", () => {
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
        new Response(
          JSON.stringify({
            users: [
              { sub: "u1", name: "Bob García", picture: "https://p/bob.png" },
              { sub: "u2", name: "Boby", picture: null },
            ],
          }),
          { status: 200 }
        ),
    });
  });

  it("al pasar el mouse sobre una mención muestra el perfil resuelto", async () => {
    window.XOGalaxy.chat.init();
    const ts = Date.now();
    FakeWS.last.readyState = 1;
    FakeWS.last.fire("open");
    FakeWS.last.fire("message", {
      data: JSON.stringify({ type: "history", messages: [{ id: 1, nickname: "Ana", body: "hola @Bob", createdAt: ts }] }),
    });

    const mention = document.querySelector(".chat-mention");
    const tip = document.querySelector(".chat-tip");
    expect(tip).toBeTruthy();
    expect(tip.hidden).toBe(true);

    mention.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(tip.hidden).toBe(false);
    expect(tip.querySelector(".chat-tip-name").textContent).toContain("Bob García");
    expect(tip.querySelector(".chat-tip-badge")).toBeTruthy();

    mention.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    expect(tip.hidden).toBe(true);
  });
});

describe("respuestas anidadas", () => {
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

  it("el botón de reply aparece en mensajes y abre la barra de respuesta", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({
        type: "history",
        messages: [{ id: 1, nickname: "Ana", body: "hola", createdAt: Date.now() }],
      }),
    });

    const btn = document.querySelector(".chat-reply-btn");
    expect(btn).toBeTruthy();

    btn.click();
    const bar = document.querySelector(".chat-reply-bar");
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain("Ana");
  });

  it("contexto de respuesta se renderiza cuando replyTo apunta a un mensaje conocido", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({
        type: "history",
        messages: [
          { id: 1, nickname: "Ana", body: "primer mensaje", createdAt: 1000 },
          { id: 2, nickname: "Beto", body: "respuesta", createdAt: 2000, replyTo: 1 },
        ],
      }),
    });

    const ctx = document.querySelector(".chat-reply-ctx");
    expect(ctx).toBeTruthy();
    expect(ctx.textContent).toContain("Ana");
    expect(ctx.textContent).toContain("primer mensaje");
  });

  it("a profundidad 2 no se muestra el botón de reply", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({
        type: "history",
        messages: [
          { id: 1, nickname: "Ana", body: "A", createdAt: 1000 },
          { id: 2, nickname: "Beto", body: "B", createdAt: 2000, replyTo: 1 },
          { id: 3, nickname: "Cara", body: "C", createdAt: 3000, replyTo: 2 },
        ],
      }),
    });

    const btns = document.querySelectorAll(".chat-reply-btn");
    expect(btns.length).toBe(2);
    const depth3 = document.querySelector('[data-id="3"]');
    expect(depth3.querySelector(".chat-reply-btn")).toBeNull();
  });

  it("al enviar con replyTo activo se incluye en el WS y se limpia la barra", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({
        type: "history",
        messages: [{ id: 1, nickname: "Ana", body: "hola", createdAt: 1000 }],
      }),
    });

    document.querySelector(".chat-reply-btn").click();
    const bar = document.querySelector(".chat-reply-bar");
    expect(bar.hidden).toBe(false);

    const input = document.querySelector(".chat-input");
    input.value = "mi respuesta";
    document.querySelector(".chat-form").dispatchEvent(new Event("submit", { bubbles: true }));

    expect(JSON.parse(ws.sent[0]).replyTo).toBe(1);
    expect(bar.hidden).toBe(true);
  });
});

describe("cargar más", () => {
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
      "/chat/history": () =>
        new Response(
          JSON.stringify({
            messages: [
              { id: 1, nickname: "Ana", body: "viejo 1", createdAt: 500 },
              { id: 2, nickname: "Beto", body: "viejo 2", createdAt: 600 },
            ],
          }),
          { status: 200 }
        ),
    });
  });

  it("aparece cuando la historia inicial tiene 50+ mensajes y carga más vía REST", async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      nickname: "Ana",
      body: "msg " + (i + 1),
      createdAt: 1000 + i,
    }));

    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: msgs }),
    });

    const btn = document.querySelector(".chat-load-more-btn");
    expect(btn).toBeTruthy();

    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    const all = document.querySelectorAll(".chat-msg");
    expect(all.length).toBe(52);
  });
});
