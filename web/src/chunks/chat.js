/**
 * XO Galaxy — chunk chat.
 * Chat propio sobre el backend (Durable Object Room, WS Hibernation).
 * Se monta en #chat-app (con data-room opcional). Si no existe, no hace nada.
 * Modo offline: si el WS no conecta, historia y envío caen a REST.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  var BACKEND = X.config.backend;
  var WS_BASE = BACKEND.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  var NICK_KEY = "xogalaxy.nick";
  var MAX_MSGS = 200;
  var MAX_RETRY = 15000;
  var ONLINE_CLASS = "chat-online";
  var OFFLINE_CLASS = "chat-offline";

  function create() {
    var app = utils.qs("#chat-app");
    if (!app) return null;

    var room = (app.getAttribute("data-room") || "general").slice(0, 64);
    var defaultNick = app.getAttribute("data-nick") || "Anónimo";
    var nickname = null;
    try {
      nickname = localStorage.getItem(NICK_KEY) || defaultNick;
    } catch (err) {
      nickname = defaultNick;
    }

    var root = utils.el("div", "xogalaxy-chat");
    var status = utils.el("p", "chat-status", "conectando…");
    var list = utils.el("ol", "chat-msgs");
    var form = utils.el("form", "chat-form");
    var nickInput = utils.el("input", "chat-nick");
    nickInput.maxLength = 32;
    nickInput.placeholder = "Nick";
    nickInput.value = nickname;
    nickInput.setAttribute("aria-label", "Tu apodo");
    var textInput = utils.el("input", "chat-input");
    textInput.maxLength = 1000;
    textInput.placeholder = "Escribí un mensaje…";
    textInput.autocomplete = "off";
    textInput.setAttribute("aria-label", "Mensaje");
    var sendBtn = utils.el("button", "chat-send", "Enviar");
    sendBtn.type = "submit";
    form.appendChild(nickInput);
    form.appendChild(textInput);
    form.appendChild(sendBtn);
    root.appendChild(status);
    root.appendChild(list);
    root.appendChild(form);
    app.appendChild(root);

    var ws = null;
    var retries = 0;
    var closed = false;
    var online = false;

    function setStatus(text, cls) {
      status.textContent = text;
      root.classList.toggle(ONLINE_CLASS, cls === "online");
      root.classList.toggle(OFFLINE_CLASS, cls === "offline");
    }

    function msgEl(message) {
      var li = utils.el("li", "chat-msg");
      li.setAttribute("data-id", String(message.id));
      var meta = utils.el("span", "chat-msg-meta", message.nickname);
      var body = utils.el("span", "chat-msg-body", message.body);
      li.appendChild(meta);
      li.appendChild(body);
      return li;
    }

    function append(message) {
      var li = msgEl(message);
      list.appendChild(li);
      while (list.children.length > MAX_MSGS) list.removeChild(list.firstChild);
      list.scrollTop = list.scrollHeight;
    }

    function removeMessage(id) {
      var found = null;
      for (var i = 0; i < list.children.length; i++) {
        if (list.children[i].getAttribute("data-id") === String(id)) {
          found = list.children[i];
          break;
        }
      }
      if (found) list.removeChild(found);
    }

    function onWsMessage(ev) {
      var data;
      try {
        data = JSON.parse(ev.data);
      } catch (err) {
        return;
      }
      if (data.type === "history") {
        list.innerHTML = "";
        (data.messages || []).forEach(append);
      } else if (data.type === "message") {
        append(data.message);
      } else if (data.type === "deleted") {
        removeMessage(data.id);
      }
    }

    function connect() {
      if (closed) return;
      var url = WS_BASE + "/chat/ws?room=" + encodeURIComponent(room) + "&nick=" + encodeURIComponent(nickname);
      var socket = null;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        goOffline();
        return;
      }
      ws = socket;
      socket.addEventListener("open", function () {
        online = true;
        retries = 0;
        setStatus("en línea", "online");
      });
      socket.addEventListener("message", onWsMessage);
      socket.addEventListener("close", function () {
        ws = null;
        if (closed) return;
        online = false;
        var delay = Math.min(1000 * Math.pow(2, retries), MAX_RETRY);
        retries += 1;
        setStatus("sin conexión — reintentando…", "offline");
        global.setTimeout(connect, delay);
      });
      socket.addEventListener("error", function () {
        setStatus("sin conexión — reintentando…", "offline");
      });
    }

    function goOffline() {
      online = false;
      setStatus("solo lectura — sin conexión", "offline");
      api.chatHistory(room)
        .then(function (d) {
          list.innerHTML = "";
          (d.messages || []).forEach(append);
        })
        .catch(function () {});
    }

    function send(body) {
      if (online && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "chat", body: body }));
        return Promise.resolve();
      }
      return api.chatSend(room, nickname, body).then(function (d) {
        if (d && d.message) append(d.message);
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var body = textInput.value.trim().slice(0, 1000);
      if (!body) return;
      textInput.value = "";
      send(body).catch(function () {
        setStatus("no se pudo enviar — reintentá", "offline");
      });
    });

    nickInput.addEventListener("change", function () {
      var value = nickInput.value.trim().slice(0, 32) || defaultNick;
      nickInput.value = value;
      try {
        localStorage.setItem(NICK_KEY, value);
      } catch (err) {}
      if (value !== nickname) {
        nickname = value;
        if (ws) {
          var old = ws;
          ws = null;
          try {
            old.close();
          } catch (err) {}
          closed = false;
          retries = 0;
          global.setTimeout(connect, 200);
        }
      }
    });

    connect();
    return { root: root, close: function () { closed = true; if (ws) try { ws.close(); } catch (err) {} } };
  }

  var instance = null;
  function init() {
    if (instance || !utils.qs("#chat-app")) return;
    instance = create();
  }

  function reset() {
    if (instance) {
      instance.close();
      instance = null;
    }
  }

  X.chat = { init: init, reset: reset };
})(window);
