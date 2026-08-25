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
    nickInput.maxLength = 64;
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
    var sugBox = utils.el("div", "chat-suggest");
    sugBox.hidden = true;
    sugBox.setAttribute("role", "listbox");
    sugBox.setAttribute("aria-label", "Sugerencias de usuarios");
    root.appendChild(sugBox);
    var tip = utils.el("div", "chat-tip");
    tip.hidden = true;
    root.appendChild(tip);
    app.appendChild(root);

    var sug = { open: false, items: [], index: 0, seq: 0, timer: null };

    function closeSuggest() {
      sug.open = false;
      sug.items = [];
      sug.index = 0;
      sug.seq += 1;
      if (sug.timer) {
        global.clearTimeout(sug.timer);
        sug.timer = null;
      }
      sugBox.hidden = true;
      sugBox.innerHTML = "";
    }

    function mentionQuery() {
      var caret = textInput.selectionStart == null ? textInput.value.length : textInput.selectionStart;
      var before = textInput.value.slice(0, caret);
      var m = before.match(/(^|\s)@([^\s@]{0,32})$/);
      return m ? m[2] : null;
    }

    function renderSuggest() {
      sugBox.innerHTML = "";
      sug.items.forEach(function (u, i) {
        var opt = utils.el("button", "chat-suggest-item" + (i === sug.index ? " active" : ""));
        opt.type = "button";
        opt.setAttribute("role", "option");
        opt.setAttribute("aria-selected", i === sug.index ? "true" : "false");
        if (u.picture) {
          var av = utils.el("img", "chat-suggest-avatar");
          av.src = u.picture;
          av.alt = "";
          av.width = 20;
          av.height = 20;
          opt.appendChild(av);
        }
        opt.appendChild(utils.el("span", "chat-suggest-name")).appendChild(X.nickStyle.render(u.name));
        opt.addEventListener("mousedown", function (e) {
          e.preventDefault();
          chooseSuggest(i);
        });
        sugBox.appendChild(opt);
      });
      sugBox.hidden = false;
      sug.open = true;
    }

    function chooseSuggest(i) {
      var user = sug.items[i];
      if (!user) return;
      var name = String(user.name || "").trim().split(/\s+/)[0].slice(0, 32);
      if (!name) {
        closeSuggest();
        return;
      }
      var caret = textInput.selectionStart == null ? textInput.value.length : textInput.selectionStart;
      var before = textInput.value.slice(0, caret).replace(/@[^\s@]*$/, "@" + name + " ");
      textInput.value = before + textInput.value.slice(caret);
      var pos = before.length;
      try {
        textInput.setSelectionRange(pos, pos);
      } catch (err) {}
      closeSuggest();
      textInput.focus();
    }

    function fetchSuggest(q) {
      var seq = ++sug.seq;
      api
        .suggest(q)
        .then(function (d) {
          if (seq !== sug.seq) return;
          var items = d.users || [];
          if (!items.length) {
            closeSuggest();
            return;
          }
          sug.items = items;
          sug.index = 0;
          renderSuggest();
        })
        .catch(function () {});
    }

    textInput.addEventListener("input", function () {
      var q = mentionQuery();
      if (q === null || q.length < 2) {
        closeSuggest();
        return;
      }
      if (sug.timer) global.clearTimeout(sug.timer);
      sug.timer = global.setTimeout(function () {
        sug.timer = null;
        fetchSuggest(q);
      }, 140);
    });

    textInput.addEventListener("keydown", function (e) {
      if (!sug.open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        sug.index = (sug.index + 1) % sug.items.length;
        renderSuggest();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        sug.index = (sug.index - 1 + sug.items.length) % sug.items.length;
        renderSuggest();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        chooseSuggest(sug.index);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSuggest();
      }
    });

    textInput.addEventListener("blur", function () {
      global.setTimeout(closeSuggest, 120);
    });

    var NICK_CODES = [
      ["0", "negro"], ["1", "azul oscuro"], ["2", "verde oscuro"], ["3", "cian oscuro"],
      ["4", "rojo oscuro"], ["5", "violeta"], ["6", "dorado"], ["7", "gris"],
      ["8", "gris oscuro"], ["9", "azul"], ["a", "verde"], ["b", "agua"],
      ["c", "rojo"], ["d", "rosa"], ["e", "amarillo"], ["f", "blanco"],
    ];
    var NICK_FORMATS = [
      ["l", "B", "Negrita"], ["o", "I", "Itálica"], ["n", "U", "Subrayado"],
      ["m", "S", "Tachado"], ["r", "⭯", "Reset"],
    ];
    var paletteBtn = utils.el("button", "chat-nick-style");
    paletteBtn.type = "button";
    paletteBtn.title = "Estilos del nombre";
    paletteBtn.setAttribute("aria-label", "Estilos del nombre");
    paletteBtn.textContent = "A";
    var paletteBox = utils.el("div", "nick-palette");
    paletteBox.hidden = true;
    var palRow = utils.el("div", "nick-palette-row");
    NICK_CODES.forEach(function (c) {
      var b = utils.el("button", "nick-code nick-color");
      b.type = "button";
      b.title = c[1];
      b.setAttribute("aria-label", "Color " + c[1]);
      b.style.setProperty("--swatch", X.nickStyle.COLORS[c[0]]);
      b.dataset.code = c[0];
      palRow.appendChild(b);
    });
    var fmtRow = utils.el("div", "nick-palette-row");
    NICK_FORMATS.forEach(function (f) {
      var b = utils.el("button", "nick-code nick-fmt");
      b.type = "button";
      b.title = f[2];
      b.setAttribute("aria-label", f[2]);
      b.textContent = f[1];
      b.dataset.code = f[0];
      fmtRow.appendChild(b);
    });
    paletteBox.appendChild(palRow);
    paletteBox.appendChild(fmtRow);

    function insertNickCode(code) {
      var ins = "§" + code;
      var start = nickInput.selectionStart == null ? nickInput.value.length : nickInput.selectionStart;
      var end = nickInput.selectionEnd == null ? start : nickInput.selectionEnd;
      var v = nickInput.value;
      if (v.length + ins.length > 64) return;
      nickInput.value = v.slice(0, start) + ins + v.slice(end);
      var pos = start + ins.length;
      try {
        nickInput.setSelectionRange(pos, pos);
      } catch (err) {}
      nickInput.focus();
    }

    paletteBtn.addEventListener("click", function () {
      paletteBox.hidden = !paletteBox.hidden;
    });
    paletteBox.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".nick-code") : null;
      if (!b) return;
      insertNickCode(b.dataset.code);
    });

    var nickWrap = utils.el("div", "chat-nick-wrap");
    form.removeChild(nickInput);
    nickWrap.appendChild(nickInput);
    nickWrap.appendChild(paletteBtn);
    nickWrap.appendChild(paletteBox);
    form.insertBefore(nickWrap, textInput);
    form.appendChild(textInput);
    form.appendChild(sendBtn);

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

    function fmtTime(ts) {
      try {
        var d = new Date(Number(ts));
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      } catch (err) {
        return "";
      }
    }

    function fmtFull(ts) {
      try {
        return new Date(Number(ts)).toLocaleString();
      } catch (err) {
        return "";
      }
    }

    function highlightMentions(el) {
      if (!el || typeof document.createTreeWalker !== "function") return;
      var walker = document.createTreeWalker(el, 4, null);
      var targets = [];
      var node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.indexOf("@") !== -1) {
          targets.push(node);
        }
      }
      var re;
      try {
        re = new RegExp("(^|\\s)(@[\\p{L}\\p{N}][\\p{L}\\p{N}_.-]{1,31})", "gu");
      } catch (err) {
        re = /(^|\s)(@[A-Za-z0-9][A-Za-z0-9_.-]{1,31})/g;
      }
      targets.forEach(function (n) {
        var rest = n.nodeValue;
        var frag = document.createDocumentFragment();
        var m;
        var idx = 0;
        re.lastIndex = 0;
        while ((m = re.exec(rest)) !== null) {
          var at = m.index;
          var tokenStart = at + m[1].length;
          if (tokenStart > idx) frag.appendChild(document.createTextNode(rest.slice(idx, tokenStart)));
          if (m[1]) frag.appendChild(document.createTextNode(m[1]));
          var span = document.createElement("span");
          span.className = "chat-mention";
          span.textContent = m[2];
          frag.appendChild(span);
          idx = m.index + m[0].length;
        }
        if (!idx) return;
        if (idx < rest.length) frag.appendChild(document.createTextNode(rest.slice(idx)));
        n.parentNode.replaceChild(frag, n);
      });
    }

    var tipCache = {};
    var tipHideTimer = null;

    function fillTip(user) {
      tip.innerHTML = "";
      if (!user) {
        tip.hidden = true;
        return;
      }
      if (user.picture) {
        var av = utils.el("img", "chat-tip-avatar");
        av.src = user.picture;
        av.alt = "";
        av.width = 30;
        av.height = 30;
        tip.appendChild(av);
      }
      var box = utils.el("div", "chat-tip-main");
      var row = utils.el("span", "chat-tip-name");
      row.appendChild(X.nickStyle.render(user.name));
      row.appendChild(utils.el("i", "chat-tip-badge"));
      box.appendChild(row);
      box.appendChild(utils.el("span", "chat-tip-handle", "cuenta verificada"));
      tip.appendChild(box);
      tip.hidden = false;
    }

    function positionTip(span) {
      var spanRect = span.getBoundingClientRect();
      var rootRect = root.getBoundingClientRect();
      tip.style.visibility = "hidden";
      tip.hidden = false;
      var tw = tip.offsetWidth || 180;
      var th = tip.offsetHeight || 46;
      var left = spanRect.left - rootRect.left;
      var top = spanRect.top - rootRect.top - th - 8;
      if (top < 4) top = spanRect.bottom - rootRect.top + 8;
      left = Math.max(6, Math.min(left, rootRect.width - tw - 6));
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.visibility = "";
    }

    function showTip(span) {
      var token = span.textContent.replace(/^@/, "").toLowerCase();
      global.clearTimeout(tipHideTimer);
      if (tipCache[token]) {
        fillTip(tipCache[token]);
        positionTip(span);
        return;
      }
      api
        .suggest(token)
        .then(function (d) {
          var users = d.users || [];
          var user = null;
          for (var i = 0; i < users.length; i++) {
            var n = String(users[i].name || "").toLowerCase();
            if (n === token || n.split(/\s+/)[0] === token) {
              user = users[i];
              break;
            }
          }
          tipCache[token] = user;
          fillTip(user);
          positionTip(span);
        })
        .catch(function () {});
    }

    function hideTip() {
      tipHideTimer = global.setTimeout(function () {
        tip.hidden = true;
      }, 120);
    }

    list.addEventListener("mouseover", function (e) {
      var m = e.target && e.target.closest ? e.target.closest(".chat-mention") : null;
      if (m) showTip(m);
    });
    list.addEventListener("mouseout", function (e) {
      var m = e.target && e.target.closest ? e.target.closest(".chat-mention") : null;
      if (m) hideTip();
    });
    list.addEventListener("click", function (e) {
      var m = e.target && e.target.closest ? e.target.closest(".chat-mention") : null;
      if (!m) return;
      var token = m.textContent.replace(/^@/, "").toLowerCase();
      var user = tipCache[token];
      if (user && X.posts && X.posts.showProfile) {
        X.posts.showProfile({ sub: user.sub, name: user.name, picture: user.picture });
      }
    });

    function msgEl(message) {      var li = utils.el("li", "chat-msg");
      li.setAttribute("data-id", String(message.id));
      var author = message.author;
      if (author && author.picture) {
        var img = utils.el("img", "chat-msg-avatar");
        img.src = author.picture;
        img.alt = "";
        img.width = 28;
        img.height = 28;
        img.loading = "lazy";
        li.appendChild(img);
      }
      var main = utils.el("div", "chat-msg-main");
      var head = utils.el("div", "chat-msg-head");
      var nameText = (author && author.name) || message.nickname;
      var meta;
      if (author && author.sub) {
        meta = utils.el("button", "chat-msg-meta chat-msg-user chat-msg-verified");
        meta.type = "button";
        meta.title = "Ver perfil";
        meta.setAttribute("aria-label", "Ver perfil de " + X.nickStyle.plain(nameText));
        meta.appendChild(X.nickStyle.render(nameText));
        meta.addEventListener("click", function () {
          if (X.posts && X.posts.showProfile) {
            X.posts.showProfile({ sub: author.sub, name: author.name, picture: author.picture });
          }
        });
      } else {
        meta = utils.el("span", "chat-msg-meta");
        meta.appendChild(X.nickStyle.render(nameText));
      }
      head.appendChild(meta);
      var time = utils.el("time", "chat-msg-time", fmtTime(message.createdAt));
      time.setAttribute("datetime", new Date(Number(message.createdAt)).toISOString());
      time.title = fmtFull(message.createdAt);
      head.appendChild(time);
      main.appendChild(head);
      var body = utils.el("span", "chat-msg-body");
      try {
        body.innerHTML = X.markdown.render(message.body, { sanitize: true });
      } catch (err) {
        body.textContent = message.body;
      }
      highlightMentions(body);
      main.appendChild(body);
      li.appendChild(main);
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
      } else if (data.type === "cleared") {
        list.innerHTML = "";
        unread = 0;
        renderBadge();
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
      closeSuggest();
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
