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

  // ---- Tema claro/oscuro (oscuro por defecto, persistido en localStorage, sin auto) ----
  var THEME_KEY = "xogalaxy.theme";
  function currentTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || "dark";
    } catch (err) {
      return "dark";
    }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (err) {}
    var btn = qs("#theme-toggle");
    if (!btn) return;
    var dark = theme === "dark";
    btn.setAttribute("aria-label", dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
    var icon = btn.querySelector("[data-lucide]");
    if (icon) icon.setAttribute("data-lucide", dark ? "sun" : "moon");
    initIcons();
  }
  function setupTheme() {
    applyTheme(currentTheme());
    var btn = qs("#theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
      });
    }
  }

  // ---- Compartir en redes (botones .share-btn dentro de .share-row) ----
  var SHARE_TARGETS = {
    facebook: function (i) { return "https://www.facebook.com/sharer/sharer.php?u=" + enc(i.url); },
    x: function (i) { return "https://twitter.com/intent/tweet?url=" + enc(i.url) + "&text=" + enc(i.title); },
    whatsapp: function (i) { return "https://api.whatsapp.com/send?text=" + enc(i.title) + "%20" + enc(i.url); },
    telegram: function (i) { return "https://t.me/share/url?url=" + enc(i.url) + "&text=" + enc(i.title); },
    linkedin: function (i) { return "https://www.linkedin.com/sharing/share-offsite/?url=" + enc(i.url); },
  };
  function enc(s) {
    return encodeURIComponent(s == null ? "" : String(s));
  }
  function shareInfo(row) {
    var c = qs('link[rel="canonical"]');
    var url = (row && row.getAttribute("data-share-url")) || (c && c.getAttribute("href")) || location.href;
    var title = (row && row.getAttribute("data-share-title")) || document.title;
    return { url: url, title: title };
  }
  function sharePopup(url) {
    var w = Math.min(600, (global.screen && screen.width) || 600) - 40;
    var h = Math.min(520, (global.screen && screen.height) || 520) - 60;
    global.open(url, "_blank", "width=" + w + ",height=" + h + ",noopener,noreferrer");
  }
  function fallbackCopy(text) {
    var ta = el("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (err) {}
    document.body.removeChild(ta);
  }
  function copyFeedback(btn) {
    var svg = btn.querySelector("svg");
    var prev = svg ? svg.innerHTML : "";
    var label = btn.getAttribute("aria-label");
    if (svg) svg.innerHTML = '<path d="M20 6 9 17l-5-5"/>';
    btn.setAttribute("aria-label", "Enlace copiado");
    global.setTimeout(function () {
      if (svg) svg.innerHTML = prev;
      if (label) btn.setAttribute("aria-label", label);
    }, 1600);
  }
  function initShare() {
    if (!qsa(".share-row").length) return;
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".share-btn") : null;
      if (!btn) return;
      var row = btn.closest(".share-row");
      var info = shareInfo(row);
      var net = btn.getAttribute("data-share");
      if (net === "copy") {
        var done = function () {
          copyFeedback(btn);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(info.url).then(done, done);
        } else {
          fallbackCopy(info.url);
          done();
        }
        return;
      }
      if (net === "native") {
        if (navigator.share) {
          navigator
            .share({ title: info.title, url: info.url })
            .catch(function () {});
        } else {
          var done2 = function () {
            copyFeedback(btn);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(info.url).then(done2, done2);
          } else {
            fallbackCopy(info.url);
            done2();
          }
        }
        return;
      }
      var target = SHARE_TARGETS[net];
      if (target) sharePopup(target(info));
    });
  }

  X.core = {
    hooks: { add: addHook, run: runHooks },
    utils: { qs: qs, qsa: qsa, el: el, escHtml: escHtml, fmt: fmt, animateStat: animateStat, getJSON: getJSON, postJSON: postJSON, getText: getText },
    initIcons: initIcons,
    decorateTitle: decorateTitle,
    initFeedButton: initFeedButton,
    initShare: initShare,
    setupNav: setupNav,
    loadMore: loadMore,
    cleanupDownloadCache: cleanupDownloadCache,
    setupTheme: setupTheme,
  };
  X.hooks = { add: addHook, run: runHooks };
})(window);
