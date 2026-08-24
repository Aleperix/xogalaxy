/**
 * XO Galaxy — notificaciones de menciones.
 * Botón campana en la navegación con badge de no leídas + panel con la lista.
 * Solo activo para cuentas Google (los anónimos no tienen identidad que
 * notificar). Polling cada 60s; al abrir el panel se marca todo como leído.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  var POLL_MS = 60000;
  var initialized = false;
  var timer = null;

  function timeAgo(ts) {
    var s = Math.max(1, Math.floor((Date.now() - Number(ts)) / 1000));
    if (s < 60) return "ahora";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " h";
    var d = Math.floor(h / 24);
    if (d < 7) return d + " d";
    try {
      return new Date(Number(ts)).toLocaleDateString();
    } catch (err) {
      return "";
    }
  }

  function typeLabel(type) {
    if (type === "mention_post") return "te mencionó en un aporte";
    return "te mencionó en el chat";
  }

  function targetHash(ref, type) {
    if (type === "mention_chat") return "#chat";
    if (ref && ref.indexOf("post:") === 0) return "#feed";
    return "#chat";
  }

  function init() {
    if (initialized) return;
    var nav = utils.qs(".main-nav");
    if (!nav || !api.notifications) return;
    initialized = true;

    var btn = utils.el("button", "nav-link notif-toggle");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<i data-lucide="bell"></i>Notificaciones';
    var badge = utils.el("span", "nav-badge");
    badge.setAttribute("data-notif-badge", "0");
    badge.hidden = true;
    btn.appendChild(badge);
    nav.appendChild(btn);
    if (X.core && X.core.initIcons) X.core.initIcons();

    var panel = utils.el("div", "notif-panel");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Notificaciones");
    document.body.appendChild(panel);

    var unreadCount = 0;
    var itemsCache = [];

    function renderBadge() {
      if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        badge.removeAttribute("hidden");
      } else {
        badge.setAttribute("hidden", "");
        badge.setAttribute("data-notif-badge", "0");
      }
    }

    function itemEl(n) {
      var li = utils.el("button", "notif-item" + (n.read ? "" : " unread"));
      li.type = "button";
      if (n.actor && n.actor.picture) {
        var av = utils.el("img", "notif-avatar");
        av.src = n.actor.picture;
        av.alt = "";
        av.width = 28;
        av.height = 28;
        av.loading = "lazy";
        li.appendChild(av);
      }
      var main = utils.el("span", "notif-main");
      var head = utils.el("span", "notif-head");
      head.appendChild(utils.el("b", "notif-actor", n.actor && n.actor.name ? n.actor.name : "Alguien"));
      head.appendChild(utils.el("span", "notif-type", typeLabel(n.type)));
      main.appendChild(head);
      if (n.excerpt) {
        main.appendChild(utils.el("span", "notif-excerpt", n.excerpt));
      }
      li.appendChild(main);
      li.appendChild(utils.el("time", "notif-when", timeAgo(n.createdAt)));
      li.addEventListener("click", function () {
        global.location.hash = targetHash(n.ref, n.type);
        closePanel();
      });
      return li;
    }

    function renderPanel() {
      panel.innerHTML = "";
      panel.appendChild(utils.el("p", "notif-title", "Notificaciones"));
      if (!itemsCache.length) {
        panel.appendChild(utils.el("p", "notif-empty", "No tenés notificaciones. Cuando alguien te mencione con @nombre en el chat o en un aporte, va a aparecer acá."));
        return;
      }
      var list = utils.el("ol", "notif-list");
      itemsCache.forEach(function (n) {
        list.appendChild(itemEl(n));
      });
      panel.appendChild(list);
    }

    function openPanel() {
      renderPanel();
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (unreadCount > 0) {
        var token = X.auth.getToken();
        api.notifications
          .read(token)
          .then(function () {
            unreadCount = 0;
            renderBadge();
            itemsCache.forEach(function (n) {
              n.read = true;
            });
            var rows = utils.qsa(".notif-item", panel);
            for (var i = 0; i < rows.length; i++) rows[i].classList.remove("unread");
          })
          .catch(function () {});
      }
    }

    function closePanel() {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    function refresh() {
      var p = X.auth.getProfile();
      var token = X.auth.getToken();
      if (!p || !p.sub || !token) {
        unreadCount = 0;
        itemsCache = [];
        renderBadge();
        closePanel();
        return;
      }
      api.notifications
        .get(token)
        .then(function (d) {
          unreadCount = d.unread || 0;
          itemsCache = d.items || [];
          renderBadge();
        })
        .catch(function () {});
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.hidden) openPanel();
      else closePanel();
    });

    document.addEventListener("click", function onDocClick(e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closePanel();
    });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape" && !panel.hidden) closePanel();
    });

    X.auth.onAuthChange(function () {
      refresh();
    });
    refresh();
    timer = global.setInterval(refresh, POLL_MS);
  }

  function reset() {
    if (timer) {
      global.clearInterval(timer);
      timer = null;
    }
    initialized = false;
  }

  X.notifications = { init: init, reset: reset };
})(window);
