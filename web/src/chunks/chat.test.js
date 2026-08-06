import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./chat.js";

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

function chatApp() {
  return document.querySelector(".chat-form");
}

describe("chunk chat", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="chat-app" data-room="general"></div>';
    FakeWS.reset();
    window.WebSocket = FakeWS;
    window.XOGalaxy.chat.reset();
  });

  it("no hace nada sin #chat-app", () => {
    document.body.innerHTML = "";
    expect(() => window.XOGalaxy.chat.init()).not.toThrow();
    expect(document.querySelector(".xogalaxy-chat")).toBeNull();
  });

  it("renderiza historia, appendea mensajes y aplica borrados", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    expect(ws).toBeTruthy();
    expect(ws.url).toContain("/chat/ws?room=general");

    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "hola", createdAt: 1 },
        { id: 2, nickname: "Beto", body: "qué tal", createdAt: 2 },
      ] }),
    });
    expect(document.querySelectorAll(".chat-msg").length).toBe(2);

    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 3, nickname: "Ana", body: "otra", createdAt: 3 } }) });
    expect(document.querySelectorAll(".chat-msg").length).toBe(3);

    ws.fire("message", { data: JSON.stringify({ type: "deleted", id: 2 }) });
    expect(document.querySelectorAll(".chat-msg").length).toBe(2);
    expect(document.querySelector('.chat-msg[data-id="1"] .chat-msg-body').textContent).toBe("hola");
  });

  it("escapa HTML en nick y cuerpo (XSS)", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "<img src=x onerror=alert(1)>", body: "<b>negrita</b>", createdAt: 1 },
      ] }),
    });
    const li = document.querySelector(".chat-msg");
    expect(li.innerHTML).toContain("&lt;img");
    expect(li.innerHTML).toContain("&lt;b&gt;");
    expect(li.querySelector("img")).toBeNull();
  });

  it("envía por WS y limpia el input", () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const input = document.querySelector(".chat-input");
    input.value = "mensaje de prueba";
    chatApp().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "chat", body: "mensaje de prueba" });
    expect(input.value).toBe("");
  });

  it("cae a REST si el WS no puede conectarse", async () => {
    window.WebSocket = class {
      constructor() {
        throw new Error("no ws");
      }
      addEventListener() {}
      send() {}
      close() {}
    };
    vi.stubGlobal("fetch", async (url, opts) => {
      const u = new URL(url);
      if (u.pathname === "/chat/history") {
        return new Response(JSON.stringify({ room: "general", messages: [
          { id: 7, nickname: "Leo", body: "por REST", createdAt: 7 },
        ] }), { status: 200 });
      }
      if (u.pathname === "/chat/message" && opts && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        return new Response(JSON.stringify({ message: { id: 8, nickname: body.nickname, body: body.body, createdAt: 8 } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });

    window.XOGalaxy.chat.init();
    await flush();
    expect(document.querySelectorAll(".chat-msg").length).toBe(1);

    const input = document.querySelector(".chat-input");
    input.value = "envío offline";
    chatApp().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(document.querySelectorAll(".chat-msg").length).toBe(2);
    expect(document.querySelector(".chat-msg[data-id='8'] .chat-msg-body").textContent).toBe("envío offline");
    vi.unstubAllGlobals();
  });

  it("acumula no-leídos mientras el chat está oculto y los limpia al verse", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    expect(badge.hasAttribute("hidden")).toBe(true);

    window.XOGalaxy.chat.setVisible(false);
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 1, nickname: "Ana", body: "hola", createdAt: 1 } }) });
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 2, nickname: "Ana", body: "otra", createdAt: 2 } }) });

    expect(badge.hasAttribute("hidden")).toBe(false);
    expect(badge.textContent).toBe("2");

    window.XOGalaxy.chat.setVisible(true);
    expect(badge.hasAttribute("hidden")).toBe(true);

    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 3, nickname: "Ana", body: "vista", createdAt: 3 } }) });
    expect(badge.hasAttribute("hidden")).toBe(true);
  });

  it("no acumula no-leídos con el chat visible", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 1, nickname: "Ana", body: "hola", createdAt: 1 } }) });
    expect(badge.hasAttribute("hidden")).toBe(true);
  });
});
