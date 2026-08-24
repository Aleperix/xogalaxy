/**
 * XO Galaxy — chunk lightbox.
 * Visor de imágenes a pantalla completa para el contenido renderizado
 * (.post-body, .chat-msg-body, .cmt-body, .pt-post-body, .pt-preview).
 * Click en imagen abre el overlay; agrupa todas las imágenes visibles del
 * documento para navegar con ←/→. Ignora imágenes dentro de enlaces (covers,
 * thumbs clickeables). ESC o click fuera cierra; click en la imagen hace zoom.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;

  var ALLOW_SELECTOR =
    ".post-body img, .chat-msg-body img, .cmt-body img, .pt-post-body img, .pt-preview img";

  var backdrop = null;
  var imgEl = null;
  var caption = null;
  var counter = null;
  var group = [];
  var idx = 0;
  var open = false;
  var lastFocus = null;

  function collect() {
    return utils.qsa(ALLOW_SELECTOR).filter(function (img) {
      if (!img.src) return false;
      if (img.closest("a[href]")) return false;
      if (img.closest(".lb-backdrop")) return false;
      return true;
    });
  }

  function render() {
    var item = group[idx];
    if (!item) return;
    imgEl.src = item.currentSrc || item.src;
    imgEl.alt = item.alt || "";
    imgEl.classList.remove("lb-zoom");
    var text = (item.alt || "").trim();
    caption.textContent = text;
    caption.hidden = !text;
    counter.textContent = group.length > 1 ? idx + 1 + " / " + group.length : "";
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight" && idx < group.length - 1) {
      e.preventDefault();
      idx += 1;
      render();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      idx -= 1;
      render();
    }
  }

  function close() {
    if (!open) return;
    open = false;
    global.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", trapFocus, true);
    document.body.classList.remove("lb-open");
    if (backdrop) backdrop.remove();
    backdrop = null;
    imgEl = null;
    caption = null;
    counter = null;
    group = [];
    if (lastFocus && lastFocus.focus) {
      try {
        lastFocus.focus();
      } catch (err) {}
    }
    lastFocus = null;
  }

  function trapFocus(e) {
    if (!open || !backdrop) return;
    if (backdrop.contains(e.target)) return;
    e.stopPropagation();
    var btn = utils.qs(".lb-close", backdrop);
    if (btn) btn.focus();
  }

  function navBtn(cls, icon, label) {
    var b = utils.el("button", cls);
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.innerHTML = '<i data-lucide="' + icon + '"/>';
    return b;
  }

  function show(target) {
    group = collect();
    idx = group.indexOf(target);
    if (idx < 0) {
      group.unshift(target);
      idx = 0;
    }
    lastFocus = global.document.activeElement;

    backdrop = utils.el("div", "lb-backdrop");
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Visor de imágenes");

    var closeB = navBtn("lb-close", "x", "Cerrar");
    closeB.addEventListener("click", function (e) {
      e.stopPropagation();
      close();
    });

    imgEl = utils.el("img", "lb-img");
    imgEl.alt = "";
    imgEl.addEventListener("click", function () {
      imgEl.classList.toggle("lb-zoom");
    });

    caption = utils.el("p", "lb-caption");
    counter = utils.el("span", "lb-counter");

    var prev = navBtn("lb-nav lb-prev", "chevron-left", "Imagen anterior");
    prev.addEventListener("click", function (e) {
      e.stopPropagation();
      if (idx > 0) {
        idx -= 1;
        render();
      }
    });
    var next = navBtn("lb-nav lb-next", "chevron-right", "Imagen siguiente");
    next.addEventListener("click", function (e) {
      e.stopPropagation();
      if (idx < group.length - 1) {
        idx += 1;
        render();
      }
    });

    backdrop.appendChild(imgEl);
    backdrop.appendChild(closeB);
    backdrop.appendChild(prev);
    backdrop.appendChild(next);
    backdrop.appendChild(counter);
    backdrop.appendChild(caption);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });

    document.body.appendChild(backdrop);
    document.body.classList.add("lb-open");
    open = true;
    render();

    if (group.length < 2) {
      prev.hidden = true;
      next.hidden = true;
    }
    if (X.core && X.core.initIcons) X.core.initIcons();
    global.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", trapFocus, true);
    closeB.focus();
  }

  function mark() {
    utils.qsa(ALLOW_SELECTOR).forEach(function (img) {
      var ok = !!img.src && !img.closest("a[href]");
      img.classList.toggle("lb-thumb", ok);
    });
  }

  function onDocClick(e) {
    if (open) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var img = e.target.closest ? e.target.closest(ALLOW_SELECTOR) : null;
    if (!img || img.closest("a[href]")) return;
    e.preventDefault();
    show(img);
  }

  function init() {
    document.addEventListener("click", onDocClick);
    mark();
    X.hooks.add("swap", mark);
  }

  function reset() {
    close();
  }

  X.lightbox = { init: init, reset: reset, _isOpen: function () { return open; } };
})(window);
