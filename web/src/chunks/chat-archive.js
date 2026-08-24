/**
 * XO Galaxy — archivo nocturno del chat.
 * Se monta en #chat-archive (página /p/archivo-del-chat.html). Muestra los
 * días archivados, lista los mensajes de un día con paginación "cargar más"
 * y permite al owner borrar mensajes del archivo (y del chat vivo).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  var ROOM = "general";
  var initialized = false;

  function reset() {
    initialized = false;
  }

  function fmtTime(ts) {
    try {
      return new Date(Number(ts)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (err) {
      return "";
    }
  }

  function msgEl(message, onDelete) {
    var li = utils.el("li", "ca-msg");
    li.setAttribute("data-id", String(message.id));
    var author = message.author;
    if (author && author.picture) {
      var img = utils.el("img", "ca-avatar");
      img.src = author.picture;
      img.alt = "";
      img.width = 28;
      img.height = 28;
      img.loading = "lazy";
      li.appendChild(img);
    }
    var main = utils.el("div", "ca-main");
    var head = utils.el("div", "ca-head");
    var nameText = (author && author.name) || message.nickname || "Anónimo";
    if (author && author.sub) {
      var who = utils.el("button", "ca-user");
      who.type = "button";
      who.textContent = nameText;
      who.title = "Ver perfil";
      who.addEventListener("click", function () {
        if (X.posts && X.posts.showProfile) {
          X.posts.showProfile({ sub: author.sub, name: author.name, picture: author.picture });
        }
      });
      head.appendChild(who);
    } else {
      head.appendChild(utils.el("span", "ca-user", nameText));
    }
    head.appendChild(utils.el("time", "ca-time", fmtTime(message.createdAt)));
    main.appendChild(head);
    var body = utils.el("div", "chat-msg-body ca-body");
    try {
      body.innerHTML = X.markdown.render(message.body, { sanitize: true });
    } catch (err) {
      body.textContent = message.body;
    }
    main.appendChild(body);
    li.appendChild(main);
    if (typeof onDelete === "function") {
      var del = utils.el("button", "ca-del");
      del.type = "button";
      del.innerHTML = '<i data-lucide="trash-2"></i>';
      del.setAttribute("aria-label", "Borrar mensaje del archivo");
      del.title = "Borrar del archivo";
      del.addEventListener("click", function () {
        if (!global.confirm("¿Borrar este mensaje del archivo?")) return;
        del.disabled = true;
        onDelete(message.id, li, del);
      });
      li.appendChild(del);
    }
    return li;
  }

  function init() {
    if (initialized) return;
    var host = utils.qs("#chat-archive");
    if (!host) return;
    initialized = true;

    var daysWrap = utils.el("div", "ca-days-wrap");
    var status = utils.el("p", "ca-status", "Cargando archivo…");
    host.appendChild(daysWrap);
    host.appendChild(status);

    var currentDay = null;
    var cursor = null;
    var list = null;
    var moreBtn = null;
    var loadingMore = false;

    function isOwner() {
      var p = X.auth.getProfile();
      return !!(p && p.isOwner);
    }

    function deleteMessage(id, li, btn) {
      api.archive
        .modDelete(ROOM, id, X.auth.getToken())
        .then(function () {
          li.remove();
          refreshDays();
        })
        .catch(function () {
          btn.disabled = false;
        });
    }

    function ensureList() {
      if (!list) {
        list = utils.el("ol", "ca-list");
        host.appendChild(list);
      }
      if (!moreBtn) {
        moreBtn = utils.el("button", "ca-more", "Cargar más");
        moreBtn.type = "button";
        moreBtn.hidden = true;
        moreBtn.addEventListener("click", function () {
          loadPage(false);
        });
        host.appendChild(moreBtn);
      }
      cursor = null;
    }

    function renderMessages(data, append) {
      var messages = data.messages || [];
      cursor = data.nextCursor || null;
      for (var i = 0; i < messages.length; i++) {
        list.appendChild(msgEl(messages[i], isOwner() ? deleteMessage : null));
      }
      if (!messages.length && !append) {
        list.appendChild(utils.el("li", "ca-none", "No hay mensajes archivados para este día."));
      }
      moreBtn.hidden = !cursor;
      loadingMore = false;
      if (X.core && X.core.initIcons) X.core.initIcons();
    }

    function loadPage(reset) {
      if (!currentDay) return;
      if (reset) {
        ensureList();
        list.innerHTML = "";
        status.textContent = "Cargando mensajes…";
      } else {
        if (loadingMore || !cursor) return;
        loadingMore = true;
        moreBtn.disabled = true;
      }
      api.archive
        .list(ROOM, currentDay, reset ? 0 : cursor)
        .then(function (data) {
          status.textContent = "";
          renderMessages(data, !reset);
          moreBtn.disabled = false;
        })
        .catch(function () {
          status.textContent = "No se pudo cargar el archivo. Intentá de nuevo más tarde.";
          loadingMore = false;
          moreBtn.disabled = false;
          moreBtn.hidden = true;
        });
    }

    function markActive() {
      var pills = utils.qsa(".ca-day", daysWrap);
      for (var i = 0; i < pills.length; i++) {
        pills[i].classList.toggle("active", pills[i].getAttribute("data-day") === currentDay);
      }
    }

    function selectDay(day) {
      currentDay = day;
      markActive();
      loadPage(true);
    }

    function refreshDays() {
      api.archive
        .days(ROOM)
        .then(function (d) {
          var days = d.days || [];
          daysWrap.innerHTML = "";
          if (!days.length) {
            status.textContent = "Todavía no hay mensajes archivados. El archivo se actualiza todas las noches.";
            if (list) list.remove();
            if (moreBtn) moreBtn.remove();
            list = null;
            moreBtn = null;
            currentDay = null;
            return;
          }
          var keep = currentDay && days.some(function (x) {
            return x.day === currentDay;
          });
          days.forEach(function (item) {
            var pill = utils.el("button", "ca-day", item.day + " · " + item.count);
            pill.type = "button";
            pill.setAttribute("data-day", item.day);
            pill.addEventListener("click", function () {
              selectDay(item.day);
            });
            daysWrap.appendChild(pill);
          });
          if (!keep) {
            currentDay = days[0].day;
            markActive();
            loadPage(true);
          } else {
            markActive();
          }
        })
        .catch(function () {
          status.textContent = "No se pudo cargar el archivo. Intentá de nuevo más tarde.";
        });
    }

    X.auth.onAuthChange(function () {
      if (currentDay && list) loadPage(true);
    });

    refreshDays();
  }

  X.chatArchive = { init: init, reset: reset };
})(window);
