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
  var LAST_READ_KEY = "xogalaxy.chat.lastRead";
  var MAX_MSGS = 200;
  var MAX_RETRY = 15000;
  var ONLINE_CLASS = "chat-online";
  var OFFLINE_CLASS = "chat-offline";
  var BADGE_SELECTOR = '.nav-link[href="#chat"] [data-chat-badge]';

  function create() {
    var app = utils.qs("#chat-app");
    if (!app) return null;

    var room = (app.getAttribute("data-room") || "general").slice(0, 64);
    var nickname = null;
    function currentProfileName() {
      var p = X.auth.getProfile();
      return (p && p.name && p.name.trim()) || null;
    }
    nickname = currentProfileName() || X.identity.guestName();

    var root = utils.el("div", "xogalaxy-chat");
    var status = utils.el("div", "chat-status");
    var statusText = utils.el("span", "chat-status-text", "conectando…");
    var session = utils.el("div", "chat-session");
    status.appendChild(statusText);
    status.appendChild(session);
    var list = utils.el("ol", "chat-msgs");
    var form = utils.el("form", "chat-form");
    var nickInput = utils.el("input", "chat-nick");
    nickInput.maxLength = 32;
    nickInput.placeholder = "Tu nombre";
    nickInput.value = nickname;
    nickInput.setAttribute("aria-label", "Tu nombre");
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
      statusText.textContent = text;
      root.classList.toggle(ONLINE_CLASS, cls === "online");
      root.classList.toggle(OFFLINE_CLASS, cls === "offline");
    }

    function reconnect() {
      if (ws) {
        var old = ws;
        ws = null;
        try {
          old.close();
        } catch (err) {}
      }
      closed = false;
      retries = 0;
      global.setTimeout(connect, 200);
    }

    function openMyProfile() {
      var p = X.auth.getProfile();
      if (p) {
        if (X.posts && X.posts.showProfile) {
          X.posts.showProfile({ sub: p.sub, name: p.name, picture: p.picture });
        }
        return;
      }
      if (X.posts && X.posts.showProfile) {
        X.posts.showProfile({ visitor: X.identity.visitorId(), name: X.identity.guestName() });
      }
    }

    function renderSession() {
      session.innerHTML = "";
      var p = X.auth.getProfile();
      if (p) {
        var id = utils.el("button", "chat-session-id");
        id.type = "button";
        id.title = "Ver mi perfil";
        id.setAttribute("aria-label", "Ver mi perfil");
        if (p.picture) {
          var img = utils.el("img", "chat-avatar");
          img.src = p.picture;
          img.alt = p.name || "";
          img.width = 24;
          img.height = 24;
          id.appendChild(img);
        }
        var who = utils.el("span", "chat-who", p.name || "verificado");
        id.appendChild(who);
        id.addEventListener("click", openMyProfile);
        session.appendChild(id);
        var logout = utils.el("button", "chat-logout");
        logout.type = "button";
        logout.title = "Cerrar sesión";
        logout.setAttribute("aria-label", "Cerrar sesión");
        logout.innerHTML = '<i data-lucide="log-out"></i>';
        logout.addEventListener("click", function () {
          X.auth.logout();
        });
        session.appendChild(logout);
        if (X.core && X.core.initIcons) X.core.initIcons();
        nickInput.hidden = true;
        return;
      }
      var googleSlot = utils.el("div", "chat-google");
      session.appendChild(googleSlot);
      X.auth.renderButton(googleSlot);
      var hint = utils.el("span", "chat-guest", "Como " + X.identity.guestName());
      session.appendChild(hint);
      nickInput.hidden = false;
    }

    function findMessage(id) {
      for (var i = 0; i < list.children.length; i++) {
        if (list.children[i].getAttribute("data-id") === String(id)) return list.children[i];
      }
      return null;
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
      var nameText = (author && author.name) || message.nickname;
      var meta;
      if (author && author.sub) {
        meta = utils.el("button", "chat-msg-meta chat-msg-user chat-msg-verified", nameText);
        meta.type = "button";
        meta.title = "Ver perfil";
        meta.setAttribute("aria-label", "Ver perfil de " + nameText);
        meta.addEventListener("click", function () {
          if (X.posts && X.posts.showProfile) {
            X.posts.showProfile({ sub: author.sub, name: author.name, picture: author.picture });
          }
        });
      } else {
        meta = utils.el("span", "chat-msg-meta", nameText);
      }
      var body = utils.el("span", "chat-msg-body");
      try {
        body.innerHTML = X.markdown.render(message.body, { sanitize: true });
      } catch (err) {
        body.textContent = message.body;
      }
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
        var messages = data.messages || [];
        messages.forEach(append);
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

    nickInput.addEventListener("change", function () {
      if (X.auth.getProfile()) return;
      var value = X.identity.setGuestName(nickInput.value);
      nickInput.value = value;
      if (value !== nickname) {
        nickname = value;
        reconnect();
      }
    });

    var unbindAuth = X.auth.onAuthChange(function () {
      renderSession();
      var name = currentProfileName();
      if (name) {
        if (name !== nickname) {
          nickname = name;
          nickInput.value = name;
          reconnect();
        }
      } else {
        var guest = X.identity.guestName();
        if (guest !== nickname) {
          nickname = guest;
          nickInput.value = guest;
          reconnect();
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

    renderSession();
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
