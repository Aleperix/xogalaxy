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
  var LAST_READ_KEY = "xogalaxy.chat.lastRead";
  var MAX_MSGS = 200;
  var MAX_RETRY = 15000;
  var ONLINE_CLASS = "chat-online";
  var OFFLINE_CLASS = "chat-offline";
  var BADGE_SELECTOR = '.nav-link[href="#chat"] [data-chat-badge]';
  var REACTION_TYPES = ["❤", "👍", "🔥"];

  function create() {
    var app = utils.qs("#chat-app");
    if (!app) return null;

    var room = (app.getAttribute("data-room") || "general").slice(0, 64);
    var defaultNick = app.getAttribute("data-nick") || "Anónimo";
    var nickname = null;
    var customNick = null;
    function currentProfileName() {
      var p = X.auth.getProfile();
      return (p && p.name && p.name.trim()) || null;
    }
    try {
      customNick = localStorage.getItem(NICK_KEY);
      nickname = customNick || currentProfileName() || defaultNick;
    } catch (err) {
      nickname = currentProfileName() || defaultNick;
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
    var unread = 0;
    var visible = false;
    var lastRead = readLastRead();

    function saveLastRead(ts) {
      lastRead = ts;
      try {
        localStorage.setItem(LAST_READ_KEY, String(ts));
      } catch (err) {}
    }

    function readLastRead() {
      try {
        var raw = localStorage.getItem(LAST_READ_KEY);
        if (raw === null) return null;
        var n = parseInt(raw, 10);
        return isNaN(n) ? null : n;
      } catch (err) {
        return null;
      }
    }

    function renderBadge() {
      var badge = utils.qs(BADGE_SELECTOR);
      if (!badge) return;
      if (unread > 0) {
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.removeAttribute("hidden");
      } else {
        badge.setAttribute("hidden", "");
      }
    }

    function clearUnread() {
      if (unread === 0) return;
      unread = 0;
      renderBadge();
    }

    function onIncoming(message) {
      if (visible) {
        saveLastRead(message.createdAt);
        clearUnread();
        return;
      }
      unread += 1;
      renderBadge();
    }

    function setVisible(v) {
      visible = !!v;
      if (visible) {
        saveLastRead(Date.now());
        clearUnread();
      }
    }

    function isInViewport() {
      var rect = app.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return false;
      return (
        rect.top < (global.innerHeight || 0) &&
        rect.bottom > 0 &&
        rect.left < (global.innerWidth || 0) &&
        rect.right > 0
      );
    }

    function setStatus(text, cls) {
      status.textContent = text;
      root.classList.toggle(ONLINE_CLASS, cls === "online");
      root.classList.toggle(OFFLINE_CLASS, cls === "offline");
    }

    function msgTarget(id) {
      return "chat:" + room + ":" + id;
    }

    function findMessage(id) {
      for (var i = 0; i < list.children.length; i++) {
        if (list.children[i].getAttribute("data-id") === String(id)) return list.children[i];
      }
      return null;
    }

    function reactionsRow(id) {
      var wrap = utils.el("div", "chat-reactions");
      REACTION_TYPES.forEach(function (type) {
        var b = utils.el("button", "chat-react");
        b.type = "button";
        b.setAttribute("data-id", String(id));
        b.setAttribute("data-type", type);
        b.setAttribute("aria-pressed", "false");
        var emoji = utils.el("span", "chat-react-emoji", type);
        var count = utils.el("span", "chat-react-count", "");
        b.appendChild(emoji);
        b.appendChild(count);
        wrap.appendChild(b);
      });
      return wrap;
    }

    function applyCounts(li, counts) {
      Array.prototype.forEach.call(utils.qsa(".chat-react", li), function (b) {
        var type = b.getAttribute("data-type");
        var c = (counts || {})[type] || 0;
        utils.qs(".chat-react-count", b).textContent = c ? String(c) : "";
      });
    }

    function loadCounts() {
      var ids = [];
      for (var i = 0; i < list.children.length && ids.length < 50; i++) {
        var id = Number(list.children[i].getAttribute("data-id"));
        if (Number.isInteger(id)) ids.push(id);
      }
      if (!ids.length) return;
      api
        .engagement(ids.map(function (id) {
          return msgTarget(id);
        }))
        .then(function (d) {
          ids.forEach(function (id) {
            var li = findMessage(id);
            if (li && d.reactions && d.reactions[msgTarget(id)]) {
              applyCounts(li, d.reactions[msgTarget(id)].counts);
            }
          });
        })
        .catch(function () {});
    }

    function refreshCounts(id) {
      if (!Number.isInteger(id) || !findMessage(id)) return;
      api.reaction
        .get(msgTarget(id))
        .then(function (d) {
          var li = findMessage(id);
          if (li) applyCounts(li, d.counts);
        })
        .catch(function () {});
    }

    function msgEl(message) {
      var li = utils.el("li", "chat-msg");
      li.setAttribute("data-id", String(message.id));
      var author = message.author;
      if (author && author.picture) {
        var img = utils.el("img", "chat-msg-avatar");
        img.src = author.picture;
        img.alt = author.name || "";
        img.width = 28;
        img.height = 28;
        li.appendChild(img);
      }
      var meta = utils.el("span", "chat-msg-meta", (author && author.name) || message.nickname);
      if (author && author.sub) meta.classList.add("chat-msg-verified");
      var body = utils.el("span", "chat-msg-body");
      try {
        body.innerHTML = X.markdown.render(message.body, { sanitize: true });
      } catch (err) {
        body.textContent = message.body;
      }
      li.appendChild(meta);
      li.appendChild(body);
      li.appendChild(reactionsRow(message.id));
      return li;
    }

    function append(message) {
      var li = msgEl(message);
      list.appendChild(li);
      if (X.releases && X.releases.scan) {
        var bodyEl = utils.qs(".chat-msg-body", li);
        if (bodyEl) X.releases.scan(bodyEl);
      }
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
        var messages = data.messages || [];
        messages.forEach(append);
        loadCounts();
        var maxTs = messages.reduce(function (m, x) {
          return x.createdAt > m ? x.createdAt : m;
        }, 0);
        if (lastRead === null) {
          saveLastRead(maxTs || Date.now());
          unread = 0;
        } else if (visible) {
          saveLastRead(Math.max(lastRead, maxTs));
          unread = 0;
        } else {
          unread = messages.filter(function (x) {
            return x.createdAt > lastRead;
          }).length;
        }
        renderBadge();
      } else if (data.type === "message") {
        append(data.message);
        onIncoming(data.message);
      } else if (data.type === "deleted") {
        removeMessage(data.id);
      } else if (data.type === "reaction") {
        refreshCounts(Number(data.messageId));
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
          loadCounts();
        })
        .catch(function () {});
    }

    function send(body) {
      var token = X.auth.getToken();
      if (online && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "chat", body: body, token: token }));
        return Promise.resolve();
      }
      return api.chatSend(room, nickname, body, token).then(function (d) {
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

    list.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".chat-react") : null;
      if (!btn) return;
      var id = Number(btn.getAttribute("data-id"));
      var type = btn.getAttribute("data-type");
      if (!Number.isInteger(id) || !type) return;
      X.engagement
        .toggle(msgTarget(id), type)
        .then(function (d) {
          var li = findMessage(id);
          if (li) applyCounts(li, d.counts);
        })
        .catch(function () {});
      if (online && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "reaction", messageId: id, reaction: type }));
      }
    });

    nickInput.addEventListener("change", function () {
      var value = nickInput.value.trim().slice(0, 32) || defaultNick;
      nickInput.value = value;
      customNick = value;
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

    var unbindAuth = X.auth.onAuthChange(function () {
      if (!customNick) {
        var name = currentProfileName();
        if (name && name !== nickname) {
          nickname = name;
          nickInput.value = name;
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
      }
    });

    root.addEventListener("focusin", function () {
      setVisible(true);
    });
    root.addEventListener("click", function () {
      setVisible(true);
    });

    function onDocClick(e) {
      var link = e.target.closest ? e.target.closest('.nav-link[href="#chat"]') : null;
      if (!link) return;
      setVisible(true);
    }
    document.addEventListener("click", onDocClick);

    function onViewportChange() {
      setVisible(isInViewport());
    }

    var observer = null;
    var useFallback = typeof global.IntersectionObserver !== "function";
    if (!useFallback) {
      observer = new global.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          setVisible(entry.isIntersecting);
        });
      });
      observer.observe(app);
    } else {
      global.addEventListener("scroll", onViewportChange);
      global.addEventListener("resize", onViewportChange);
      onViewportChange();
    }

    connect();
    return {
      root: root,
      setVisible: setVisible,
      close: function () {
        closed = true;
        if (unbindAuth) {
          unbindAuth();
          unbindAuth = null;
        }
        if (ws) {
          try {
            ws.close();
          } catch (err) {}
        }
        document.removeEventListener("click", onDocClick);
        if (observer) {
          try {
            observer.disconnect();
          } catch (err) {}
        }
        if (useFallback) {
          global.removeEventListener("scroll", onViewportChange);
          global.removeEventListener("resize", onViewportChange);
        }
      },
    };
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

  function setVisible(visible) {
    if (instance) instance.setVisible(visible);
  }

  X.chat = { init: init, reset: reset, setVisible: setVisible };
})(window);
