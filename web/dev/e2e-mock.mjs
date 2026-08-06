import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import http from "node:http";

const MESSAGES = [{ id: 1, nickname: "Ana", body: "bienvenida", createdAt: Date.now() }];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  const send = (obj) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  if (u.pathname === "/feeds/posts/summary") return send({ feed: { openSearch$totalResults: { $t: "3" } } });
  if (u.pathname === "/followers") return send({ count: 12 });
  if (u.pathname === "/visits") return send({ value: 77, hit: u.search === "?hit=1" });
  if (u.pathname === "/chat/history") return send({ room: "general", messages: MESSAGES });
  if (u.pathname === "/chat/message" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = JSON.parse(raw);
      MESSAGES.push({ id: 2, nickname: b.nickname, body: b.body, createdAt: Date.now() });
      send({ message: MESSAGES[MESSAGES.length - 1] });
    });
    return;
  }
  res.writeHead(404);
  res.end("{}");
});

await new Promise((r) => server.listen(8788, r));

const win = new Window({ url: "http://localhost/" });
const doc = win.document;
doc.body.innerHTML =
  '<h1 id="site-title">XO Galaxy Test</h1><div class="hero-actions"><a href="#feed">Ver posts</a></div>' +
  '<div><p id="stat-posts">—</p></div><div><p id="stat-followers">—</p></div><div><p id="stat-visits">—</p></div>' +
  '<main class="main-layout"><article class="post-single"><h2 class="post-title">T</h2></article></main>' +
  '<div id="chat-app" data-room="general"></div>';

win.XOGALAXY_CONFIG = { backend: "http://localhost:8788" };
win.fetch = (url, opts) => {
  const u = new URL(url, "http://localhost");
  return fetch("http://localhost:8788" + u.pathname + u.search, opts);
};

class StubWS {
  constructor(url) {
    this.readyState = 0;
    this.listeners = {};
    StubWS.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.fire("open", {});
      this.fire("message", { data: JSON.stringify({ type: "history", messages: MESSAGES }) });
    }, 50);
  }
  addEventListener(t, f) {
    (this.listeners[t] = this.listeners[t] || []).push(f);
  }
  fire(t, ev) {
    (this.listeners[t] || []).forEach((f) => f(ev));
  }
  send(d) {
    this.sent = this.sent || [];
    this.sent.push(d);
    const data = JSON.parse(d);
    if (data.type === "chat") {
      MESSAGES.push({ id: MESSAGES.length + 1, nickname: "NodeBot", body: data.body, createdAt: Date.now() });
      this.fire("message", { data: JSON.stringify({ type: "message", message: MESSAGES[MESSAGES.length - 1] }) });
    }
  }
  close() {}
}
win.WebSocket = StubWS;

win.eval(readFileSync("dist/app.js", "utf8"));
await new Promise((r) => setTimeout(r, 600));

const posts = doc.getElementById("stat-posts").textContent;
const followers = doc.getElementById("stat-followers").textContent;
const visits = doc.getElementById("stat-visits").textContent;
const msgs = [...doc.querySelectorAll(".chat-msg")].map((li) => li.textContent);
const status = doc.querySelector(".chat-status")?.textContent;

const input = doc.querySelector(".chat-input");
input.value = "hola desde bundle";
doc.querySelector(".chat-form").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 100));
const msgsAfter = doc.querySelectorAll(".chat-msg").length;

console.log(JSON.stringify({ posts, followers, visits, status, msgs, msgsAfter, wsUrl: StubWS.last.url }, null, 2));
win.close();
server.close();
