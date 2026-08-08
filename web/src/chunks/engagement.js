/**
 * XO Galaxy — chunk engagement (estrellas + reacciones).
 * Se monta en cualquier contenedor con [data-engagement="<target>"]:
 *   data-reactions="❤,👍,🔥"  tipos de reacción (default ❤,👍,🔥)
 *   data-rating="0"           desactiva las estrellas (default activas)
 * scan(container) procesa contenedores dinámicos (posts tras swap).
 * Identidad: sub de Google si hay sesión; si no, un id de visitante
 * persistido en localStorage (xogalaxy.visitor).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  var VISITOR_KEY = "xogalaxy.visitor";
  var DEFAULT_REACTIONS = ["❤", "👍", "🔥"];
  var READY_ATTR = "data-engagement-ready";

  function visitorId() {
    var v = null;
    try {
      v = localStorage.getItem(VISITOR_KEY);
    } catch (err) {}
    if (!v) {
      v = "v_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try {
        localStorage.setItem(VISITOR_KEY, v);
      } catch (err) {}
    }
    return v;
  }

  function userId() {
    var p = X.auth.getProfile();
    return (p && p.sub) || visitorId();
  }

  function starsEl() {
    var wrap = utils.el("div", "engage-stars");
    for (var i = 1; i <= 5; i++) {
      var b = utils.el("button", "engage-star");
      b.type = "button";
      b.textContent = "★";
      b.setAttribute("data-value", String(i));
      b.setAttribute("aria-label", "Puntuar " + i + " de 5");
      wrap.appendChild(b);
    }
    return wrap;
  }

  function reactionsEl(types) {
    var wrap = utils.el("div", "engage-reactions");
    types.forEach(function (type) {
      var b = utils.el("button", "engage-react");
      b.type = "button";
      b.setAttribute("data-type", type);
      b.setAttribute("aria-pressed", "false");
      var emoji = utils.el("span", "engage-react-emoji", type);
      var count = utils.el("span", "engage-react-count", "0");
      b.appendChild(emoji);
      b.appendChild(count);
      wrap.appendChild(b);
    });
    return wrap;
  }

  function mount(host) {
    if (!host || host.getAttribute(READY_ATTR) === "1") return;
    var target = host.getAttribute("data-engagement");
    if (!target) return;
    host.setAttribute(READY_ATTR, "1");

    var types = (host.getAttribute("data-reactions") || DEFAULT_REACTIONS.join(","))
      .split(",")
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    var withRating = host.getAttribute("data-rating") !== "0";
    var user = userId();

    var root = utils.el("div", "xogalaxy-engagement");
    var rating = null;
    var reactions = null;
    if (withRating) {
      rating = utils.el("div", "engage-block");
      var stars = starsEl();
      var label = utils.el("span", "engage-label", "…");
      rating.appendChild(stars);
      rating.appendChild(label);
      root.appendChild(rating);
    }
    if (types.length) {
      reactions = reactionsEl(types);
      root.appendChild(reactions);
    }
    host.appendChild(root);
    if (!rating && !reactions) return;

    function applyRating(d) {
      if (!rating || !d) return;
      var filled = Math.round(d.avg || 0);
      Array.prototype.forEach.call(stars.children, function (b) {
        var v = Number(b.getAttribute("data-value"));
        b.classList.toggle("on", v <= filled);
        b.classList.toggle("mine", d.value === v);
      });
      label.textContent =
        (d.avg ? d.avg.toFixed(1) : "0.0") + " (" + utils.fmt(d.count) + (d.count === 1 ? " voto" : " votos") + ")";
      root.setAttribute("data-my-rating", String(d.value || 0));
    }

    function applyReactions(d) {
      if (!reactions || !d) return;
      var counts = d.counts || {};
      Array.prototype.forEach.call(reactions.children, function (b) {
        var type = b.getAttribute("data-type");
        utils.qs(".engage-react-count", b).textContent = String(counts[type] || 0);
      });
    }

    api
      .engagement([target], user)
      .then(function (d) {
        applyRating(d.ratings && d.ratings[target]);
        applyReactions(d.reactions && d.reactions[target]);
      })
      .catch(function () {});

    root.addEventListener("click", function (e) {
      var star = e.target.closest ? e.target.closest(".engage-star") : null;
      if (star) {
        var value = Number(star.getAttribute("data-value"));
        var current = Number(root.getAttribute("data-my-rating") || 0);
        api.rating
          .set(target, current === value ? 0 : value, user, X.auth.getToken())
          .then(applyRating)
          .catch(function () {});
        return;
      }
      var btn = e.target.closest ? e.target.closest(".engage-react") : null;
      if (btn) {
        api.reaction
          .set(target, btn.getAttribute("data-type"), user, X.auth.getToken())
          .then(applyReactions)
          .catch(function () {});
      }
    });
  }

  function scan(container) {
    var scope = container || document;
    var hosts = utils.qsa("[" + READY_ATTR + "]", scope);
    utils.qsa("[data-engagement]", scope).forEach(function (el) {
      mount(el);
    });
    return hosts.length;
  }

  function init() {
    scan(document);
  }

  function toggle(target, type) {
    var user = userId();
    return api.reaction.set(target, type, user, X.auth.getToken());
  }

  X.engagement = {
    init: init,
    scan: scan,
    mount: mount,
    userId: userId,
    toggle: toggle,
    visitorId: visitorId,
  };
})(window);
