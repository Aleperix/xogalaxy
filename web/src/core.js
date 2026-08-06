/**
 * XO Galaxy — core.
 * Utilidades + registro de hooks del SPA. Script clásico (sin imports/exports):
 * se concatena en web/dist/app.js junto a api/router/chunks y se inyecta en el template.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});

  // ---- hooks (suscritores de ciclo de vida del SPA) ----
  var hooks = {};
  function addHook(name, fn) {
    (hooks[name] = hooks[name] || []).push(fn);
  }
  function runHooks(name, ctx) {
    (hooks[name] || []).forEach(function (fn) {
      try {
        fn(ctx);
      } catch (err) {
        if (global.console && console.error) console.error("[xogalaxy] hook", name, err);
      }
    });
  }

  // ---- DOM helpers ----
  function qs(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function qsa(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function escHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) {
    if (n >= 1000) return Math.round((n / 1000) * 10) / 10 + "k";
    return String(n);
  }
  function reduceMotion() {
    return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---- fetch helpers ----
  function getJSON(url, opts) {
    return fetch(url, Object.assign({ headers: { accept: "application/json" } }, opts)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function postJSON(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(data),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function getText(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  // ---- UI helpers (reutilizados por chunks y tras cada navegación SPA) ----
  function animateStat(el2, target) {
    if (!el2 || isNaN(target)) return;
    if (reduceMotion()) {
      el2.textContent = fmt(target);
      return;
    }
    var duration = 1200,
      startTime = null;
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el2.textContent = fmt(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
      else el2.textContent = fmt(target);
    }
    requestAnimationFrame(step);
  }

  function initIcons() {
    if (global.lucide && lucide.createIcons) {
      try {
        lucide.createIcons();
      } catch (err) {}
    }
  }

  function decorateTitle() {
    var titleEl = qs("#site-title");
    if (!titleEl || titleEl.getAttribute("data-decorated")) return;
    var raw = titleEl.textContent.replace(/\s+/g, " ").trim();
    var parts = raw.split(" ");
    if (parts.length > 1) {
      var first = parts.shift();
      titleEl.innerHTML =
        '<span class="text-signal">' + escHtml(first) + '</span><span class="text-ink"> ' + escHtml(parts.join(" ")) + "</span>";
    } else if (raw) {
      titleEl.innerHTML = '<span class="text-signal">' + escHtml(raw) + "</span>";
    }
    titleEl.setAttribute("data-decorated", "1");
  }

  function initFeedButton() {
    var btn = qs('.hero-actions a[href*="#feed"]');
    if (!btn) return;
    var isHome = (location.pathname || "/").replace(/\/+$/, "") === "";
    btn.setAttribute("href", isHome ? "#feed" : location.origin + "/#feed");
  }

  function setupNav() {
    var navToggle = qs(".nav-toggle");
    var navBackdrop = document.getElementById("nav-backdrop");
    if (!navToggle || !navBackdrop) return;
    function setNav(open) {
      document.body.classList.toggle("nav-open", open);
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    }
    navToggle.addEventListener("click", function () {
      setNav(!document.body.classList.contains("nav-open"));
    });
    navBackdrop.addEventListener("click", function () {
      setNav(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("nav-open")) setNav(false);
    });
    var nav = document.getElementById("main-nav");
    if (nav) {
      nav.addEventListener("click", function (e) {
        if (e.target.closest("a")) setNav(false);
      });
    }
  }

  // ---- Cargar entradas anteriores (AJAX, sin recargar) ----
  function loadMore(link) {
    link.textContent = "Cargando…";
    getText(link.href)
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var container = qs(".blog-posts");
        var frag = doc.querySelector(".blog-posts");
        if (container && frag) {
          Array.prototype.forEach.call(frag.children, function (node) {
            container.appendChild(node);
          });
        }
        var next = doc.querySelector(".load-more a");
        var lm = qs(".load-more");
        if (lm) {
          if (next) {
            lm.innerHTML = "";
            var a = document.createElement("a");
            a.href = next.href;
            a.textContent = "Cargar entradas anteriores ↓";
            lm.appendChild(a);
          } else {
            lm.parentNode.removeChild(lm);
          }
        }
        X.hooks.run("swap");
      })
      .catch(function () {
        link.textContent = "No se pudo cargar. Intentá de nuevo.";
      });
  }

  // ---- Limpieza de cachés de descargas (tbr_*) ----
  function cleanupDownloadCache() {
    var PREFIX = "tbr_",
      MAX_AGE = 30 * 24 * 3600e3,
      MAX_BYTES = 2 * 1024 * 1024;
    try {
      var now = Date.now(),
        total = 0,
        changed = false;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        var raw = localStorage.getItem(k);
        total += raw ? raw.length : 0;
        var rec = null;
        try {
          rec = JSON.parse(raw);
        } catch (err) {}
        if (rec && rec.t && now - rec.t > MAX_AGE) {
          localStorage.removeItem(k);
          changed = true;
        }
      }
      if (!changed && total > MAX_BYTES) localStorage.clear();
    } catch (err) {}
  }

  X.core = {
    hooks: { add: addHook, run: runHooks },
    utils: { qs: qs, qsa: qsa, el: el, escHtml: escHtml, fmt: fmt, animateStat: animateStat, getJSON: getJSON, postJSON: postJSON, getText: getText },
    initIcons: initIcons,
    decorateTitle: decorateTitle,
    initFeedButton: initFeedButton,
    setupNav: setupNav,
    loadMore: loadMore,
    cleanupDownloadCache: cleanupDownloadCache,
  };
  X.hooks = { add: addHook, run: runHooks };
})(window);
