import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../core.js";
import "../api.js";
import "../markdown.js";
import "./auth.js";
import "./engagement.js";
import "./releases.js";
import "./chat.js";

const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vendor");

function loadVendored() {
  const code =
    fs.readFileSync(path.join(VENDOR_DIR, "marked.min.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(VENDOR_DIR, "dompurify.min.js"), "utf8");
  new Function(code)();
}

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

function chatApp() {
  return document.querySelector(".chat-form");
}

describe("chunk chat", () => {
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
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "chat", body: "mensaje de prueba", token: null });
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
    window.XOGalaxy.chat.setVisible(true);
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 1, nickname: "Ana", body: "hola", createdAt: 1 } }) });
    expect(badge.hasAttribute("hidden")).toBe(true);
  });

  it("cuenta la historia más reciente que el último-leído guardado", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    localStorage.setItem("xogalaxy.chat.lastRead", "1000");
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "viejo", createdAt: 900 },
        { id: 2, nickname: "Beto", body: "nuevo", createdAt: 1500 },
        { id: 3, nickname: "Beto", body: "otro", createdAt: 2000 },
      ] }),
    });
    expect(badge.hasAttribute("hidden")).toBe(false);
    expect(badge.textContent).toBe("2");

    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "viejo", createdAt: 900 },
        { id: 2, nickname: "Beto", body: "nuevo", createdAt: 1500 },
        { id: 3, nickname: "Beto", body: "otro", createdAt: 2000 },
      ] }),
    });
    expect(badge.textContent).toBe("2");
  });

  it("sin último-leído guardado no marca la historia previa", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "viejo", createdAt: 900 },
        { id: 2, nickname: "Beto", body: "nuevo", createdAt: 1500 },
      ] }),
    });
    expect(badge.hasAttribute("hidden")).toBe(true);

    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 3, nickname: "Beto", body: "fresco", createdAt: 2000 } }) });
    expect(badge.hasAttribute("hidden")).toBe(false);
    expect(badge.textContent).toBe("1");
  });

  it("setVisible(true) persiste el último-leído y limpia el badge", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 1, nickname: "Ana", body: "hola", createdAt: 1 } }) });
    expect(badge.hasAttribute("hidden")).toBe(false);

    window.XOGalaxy.chat.setVisible(true);
    expect(badge.hasAttribute("hidden")).toBe(true);
    expect(Number(localStorage.getItem("xogalaxy.chat.lastRead"))).toBeGreaterThan(0);
  });

  it("usa isInViewport como fallback sin IntersectionObserver", () => {
    document.body.innerHTML =
      '<a class="nav-link" href="#chat">Chat<span class="nav-badge" data-chat-badge hidden>0</span></a>' +
      '<div id="chat-app" data-room="general"></div>';
    const app = document.getElementById("chat-app");
    app.getBoundingClientRect = () => ({ top: 10, bottom: 110, left: 0, right: 100, width: 100, height: 100 });

    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");

    const badge = document.querySelector("[data-chat-badge]");
    ws.fire("message", { data: JSON.stringify({ type: "message", message: { id: 1, nickname: "Ana", body: "hola", createdAt: 1 } }) });
    expect(badge.hasAttribute("hidden")).toBe(true);
  });

  it("renderiza markdown sanitizado en el cuerpo del mensaje", () => {
    loadVendored();
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "**negrita** y <img src=x onclick=alert(1)>", createdAt: 1 },
      ] }),
    });
    const body = document.querySelector(".chat-msg-body");
    expect(body.querySelector("strong").textContent).toBe("negrita");
    expect(body.innerHTML).not.toContain("onclick");
  });

  it("convierte enlaces de releases en card dentro del chat", async () => {
    loadVendored();
    mockBackend({
      "/releases": () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              owner: "Aleperix",
              repo: "tumbleboy-reborn",
              tagName: "v1.1.5",
              name: "TumbleBoy Reborn v1.1.5",
              body: "changelog",
              htmlUrl: "https://github.com/Aleperix/tumbleboy-reborn/releases/tag/v1.1.5",
              cover: null,
              assets: [
                { name: "tumbleboy-reborn-ARM64.apk", size: 100, browserDownloadUrl: "https://github.com/Aleperix/tumbleboy-reborn/releases/download/v1.1.5/tumbleboy-reborn-ARM64.apk" },
              ],
            }),
            { status: 200 }
          )
        ),
    });
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 1, nickname: "Ana", body: "Descargá [v1.1.5](https://github.com/Aleperix/tumbleboy-reborn/releases/latest)", createdAt: 1 },
      ] }),
    });
    await flush();
    await flush();
    const card = document.querySelector(".chat-msg .release-card");
    expect(card).toBeTruthy();
    expect(card.querySelector(".release-name").textContent).toBe("TumbleBoy Reborn v1.1.5");
  });

  it("reacción a un mensaje togglea counts y difunde por WS", async () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 5, nickname: "Ana", body: "hola", createdAt: 5 },
      ] }),
    });

    mockBackend({
      "/reaction": (u, opts) => {
        expect(JSON.parse(opts.body)).toMatchObject({ target: "chat:general:5", type: "❤" });
        return Promise.resolve(new Response(JSON.stringify({ counts: { "❤": 1 } }), { status: 200 }));
      },
    });

    const btn = document.querySelector('.chat-react[data-type="❤"]');
    btn.click();
    await flush();

    expect(btn.querySelector(".chat-react-count").textContent).toBe("1");
    const reactionFrame = ws.sent.find((s) => JSON.parse(s).type === "reaction");
    expect(reactionFrame).toBeTruthy();
    expect(JSON.parse(reactionFrame)).toEqual({ type: "reaction", messageId: 5, reaction: "❤" });
    vi.unstubAllGlobals();
  });

  it("el evento WS reaction refresca los counts del mensaje", async () => {
    window.XOGalaxy.chat.init();
    const ws = FakeWS.last;
    ws.readyState = 1;
    ws.fire("open");
    ws.fire("message", {
      data: JSON.stringify({ type: "history", messages: [
        { id: 3, nickname: "Ana", body: "hola", createdAt: 3 },
      ] }),
    });

    mockBackend({
      "/reaction": () => Promise.resolve(new Response(JSON.stringify({ counts: { "👍": 2 } }), { status: 200 })),
    });

    ws.fire("message", { data: JSON.stringify({ type: "reaction", messageId: 3, reaction: "👍" }) });
    await flush();

    const btn = document.querySelector('.chat-react[data-type="👍"]');
    expect(btn.querySelector(".chat-react-count").textContent).toBe("2");
    vi.unstubAllGlobals();
  });
});
