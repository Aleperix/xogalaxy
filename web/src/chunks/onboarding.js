/**
 * XO Galaxy — chunk onboarding.
 * Tour guiado de primera visita: bienvenida + nombre + aceptación obligatoria
 * de Condiciones/Privacidad, login de Google opcional, CTA Seguir y atajos
 * (chat / participar / descargas). Se puede saltear en cualquier momento
 * (botón ×, ESC o clic fuera) y no vuelve a mostrarse (xogalaxy.onboardingDone).
 * La aceptación de términos se guarda en xogalaxy.termsAccepted.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var DONE_KEY = "xogalaxy.onboardingDone";
  var TERMS_KEY = "xogalaxy.termsAccepted";

  var host = null;
  var ring = null;
  var backdrop = null;
  var card = null;
  var tip = null;
  var idx = 0;
  var steps = null;
  var active = false;

  function storageGet(k) {
    try {
      return global.localStorage.getItem(k);
    } catch (err) {
      return null;
    }
  }
  function storageSet(k, v) {
    try {
      global.localStorage.setItem(k, v);
    } catch (err) {}
  }

  function isLoggedIn() {
    var p = X.auth && X.auth.getProfile ? X.auth.getProfile() : null;
    return !!p;
  }

  function isFollowing() {
    var b = X.core.utils.qs("#follow-btn");
    return !!(b && b.classList.contains("following"));
  }

  function termsUrl(label) {
    var links = X.core.utils.qsa(".footer-nav a");
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].textContent || "").trim();
      if (t.indexOf(label) >= 0 && links[i].href) return links[i].href;
    }
    var origin = global.location && global.location.origin ? global.location.origin : "";
    return origin + "/p/condiciones-de-uso.html";
  }

  function buildSteps() {
    var guest = X.identity && X.identity.guestName ? X.identity.guestName() : "";
    return [
      {
        mode: "card",
        title: "¡Bienvenido a XO Galaxy!",
        text: "Un espacio de nostalgia para revivir y modernizar las XO y su época: juegos, software y joyas (lost media) que volvemos a la vida.",
        body: "name-terms",
        name: guest,
        nextLabel: "Empezar",
      },
      {
        mode: "card",
        skip: isLoggedIn,
        title: "¿Tenés cuenta de Google?",
        text: "Iniciá sesión para usar tu nombre y foto en el chat y los aportes. Es opcional.",
        body: "google",
        nextLabel: "Siguiente",
        altLabel: "Ahora no",
      },
      {
        mode: "anchor",
        sel: "#follow-btn",
        skip: isFollowing,
        title: "Sumate a la comunidad",
        text: "Seguí a XO Galaxy para no perderte las novedades. Se cuenta como sesión de Google.",
        nextLabel: "Siguiente",
      },
      {
        mode: "anchor",
        sel: '#main-nav a[href="#chat"]',
        title: "Chat en vivo",
        text: "Charlá con la comunidad en tiempo real. Tu identidad se muestra en la fila de estado.",
        nextLabel: "Siguiente",
      },
      {
        mode: "anchor",
        sel: "#participar",
        title: "Cómo participar",
        text: "Suscribite al newsletter para recibir juegos y novedades, o mandanos tu tutorial, pregunta o hallazgo y lo sumamos al feed con tu nombre.",
        nextLabel: "Siguiente",
      },
      {
        mode: "anchor",
        sel: ".main-nav details.dropdown",
        title: "Descargas",
        text: "Juegos, actividades, libros y tutoriales listos para bajar a tu XO.",
        nextLabel: "Siguiente",
      },
      {
        mode: "card",
        title: "¡Todo listo!",
        text: "Explorá la comunidad, sumate a la conversación y hacé tu primer aporte.",
        nextLabel: "Empezar a explorar",
        last: true,
      },
    ];
  }

  function closeBtn() {
    var b = X.core.utils.el("button", "onb-close");
    b.type = "button";
    b.setAttribute("aria-label", "Saltear introducción");
    b.innerHTML = '<i data-lucide="x"/>';
    b.addEventListener("click", skip);
    return b;
  }

  function dots() {
    var d = X.core.utils.el("div", "onb-dots");
    steps.forEach(function (_, i) {
      d.appendChild(X.core.utils.el("span", "onb-dot" + (i === idx ? " active" : "")));
    });
    return d;
  }

  function actionsRow(step) {
    var row = X.core.utils.el("div", "onb-actions");
    if (idx > 0 && !step.last) {
      var back = X.core.utils.el("button", "onb-btn onb-btn-ghost", "Atrás");
      back.type = "button";
      back.addEventListener("click", function () {
        idx -= 1;
        render();
      });
      row.appendChild(back);
    }
    var next = X.core.utils.el("button", "onb-btn onb-btn-primary", step.nextLabel || "Siguiente");
    next.type = "button";
    next.id = "onb-next";
    next.addEventListener("click", function () {
      if (step.onNext && !step.onNext()) return;
      advance();
    });
    row.appendChild(next);
    if (step.altLabel) {
      var alt = X.core.utils.el("button", "onb-btn onb-btn-ghost", step.altLabel);
      alt.type = "button";
      alt.addEventListener("click", function () {
        advance();
      });
      row.appendChild(alt);
    }
    return row;
  }

  function nameTermsBody() {
    var step = steps[idx];
    var wrap = X.core.utils.el("div", "onb-form");
    var label = X.core.utils.el("label", "onb-field");
    label.appendChild(X.core.utils.el("span", "onb-label", "¿Cómo te llamás?"));
    var nameInput = X.core.utils.el("input", "onb-input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.placeholder = "Tu nombre";
    nameInput.value = step.name || "";
    label.appendChild(nameInput);
    wrap.appendChild(label);

    var check = X.core.utils.el("label", "onb-terms");
    var cb = X.core.utils.el("input", "onb-check");
    cb.type = "checkbox";
    var span = X.core.utils.el("span", null, "Acepto las ");
    var linkTerms = X.core.utils.el("a", "onb-link", "Condiciones de uso");
    linkTerms.href = termsUrl("Condiciones");
    linkTerms.target = "_blank";
    linkTerms.rel = "noopener";
    var linkPriv = X.core.utils.el("a", "onb-link", "Política de privacidad");
    linkPriv.href = termsUrl("Política");
    linkPriv.target = "_blank";
    linkPriv.rel = "noopener";
    span.appendChild(linkTerms);
    span.appendChild(document.createTextNode(" y la "));
    span.appendChild(linkPriv);
    span.appendChild(document.createTextNode("."));
    check.appendChild(cb);
    check.appendChild(span);
    wrap.appendChild(check);

    var status = X.core.utils.el("p", "onb-status");
    status.hidden = true;
    wrap.appendChild(status);

    step.onNext = function () {
      if (!nameInput.value.trim() || !cb.checked) {
        status.hidden = false;
        status.textContent = "Elegí un nombre y aceptá los términos para continuar.";
        return false;
      }
      if (X.identity && X.identity.setGuestName) X.identity.setGuestName(nameInput.value);
      storageSet(TERMS_KEY, "1");
      return true;
    };
    nameInput.addEventListener("input", function () {
      status.hidden = true;
    });
    cb.addEventListener("change", function () {
      status.hidden = true;
    });
    return wrap;
  }

  function googleBody() {
    var slot = X.core.utils.el("div", "onb-google");
    if (X.auth && X.auth.renderButton) X.auth.renderButton(slot);
    return slot;
  }

  function shell(step, className) {
    var node = X.core.utils.el("div", className);
    node.appendChild(closeBtn());
    node.appendChild(X.core.utils.el("h3", "onb-title", step.title));
    node.appendChild(X.core.utils.el("p", "onb-text", step.text));
    if (step.body === "name-terms") node.appendChild(nameTermsBody());
    if (step.body === "google") node.appendChild(googleBody());
    node.appendChild(dots());
    node.appendChild(actionsRow(step));
    return node;
  }

  function positionTip() {
    if (!active || !tip || !tip._target) return;
    var tr = tip._target.getBoundingClientRect();
    var w = Math.max(280, Math.min(380, window.innerWidth - 32));
    var th = tip.offsetHeight || 180;
    var gap = 10;
    var placeBelow = tr.bottom + th + gap + 8 <= window.innerHeight || tr.top < 180;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, tr.left + tr.width / 2 - w / 2));
    tip.style.left = left + "px";
    tip.style.top = (placeBelow ? tr.bottom + gap : Math.max(8, tr.top - th - gap)) + "px";
    tip.style.width = w + "px";
    ring.style.left = tr.left + "px";
    ring.style.top = tr.top + "px";
    ring.style.width = tr.width + "px";
    ring.style.height = tr.height + "px";
    ring.classList.toggle("onb-ring-below", placeBelow);
  }

  function scrollToStep(step) {
    if (step.mode !== "anchor") return;
    var target = step.sel ? X.core.utils.qs(step.sel) : null;
    if (!target) return;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function render() {
    if (!active || !host) return;
    if (card) {
      card.remove();
      card = null;
    }
    if (tip) {
      tip.remove();
      tip = null;
    }
    ring.classList.add("onb-hide");

    var step = steps[idx];
    var isMobile = window.innerWidth < 640;
    if (step.mode === "anchor" && !isMobile) {
      var target = step.sel ? X.core.utils.qs(step.sel) : null;
      if (target) {
        tip = shell(step, "onb-tip");
        tip._target = target;
        host.appendChild(tip);
        if (X.core && X.core.initIcons) X.core.initIcons();
        ring.classList.remove("onb-hide");
        positionTip();
        scrollToStep(step);
        return;
      }
    }
    card = shell(step, "onb-card" + (isMobile ? " onb-sheet" : ""));
    host.appendChild(card);
    if (X.core && X.core.initIcons) X.core.initIcons();
    scrollToStep(step);
  }

  function teardown() {
    if (host) host.remove();
    host = null;
    ring = null;
    backdrop = null;
    card = null;
    tip = null;
    active = false;
    steps = null;
    document.removeEventListener("keydown", onKey);
    global.removeEventListener("resize", onResize);
    document.removeEventListener("scroll", onScroll, true);
  }

  function advance() {
    if (idx >= steps.length - 1) {
      finish();
      return;
    }
    idx += 1;
    render();
  }

  function finish() {
    storageSet(DONE_KEY, "1");
    teardown();
  }

  function skip() {
    finish();
  }

  function onKey(e) {
    if (e.key === "Escape") skip();
  }
  function onResize() {
    positionTip();
  }
  function onScroll() {
    positionTip();
  }

  function buildHost() {
    host = X.core.utils.el("div", "onb-host");
    host.setAttribute("aria-live", "polite");
    backdrop = X.core.utils.el("div", "onb-backdrop");
    ring = X.core.utils.el("div", "onb-ring onb-hide");
    host.appendChild(backdrop);
    host.appendChild(ring);
    document.body.appendChild(host);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) skip();
    });
    document.addEventListener("keydown", onKey);
    global.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, true);
  }

  function start() {
    if (active) return;
    if (storageGet(DONE_KEY)) return;
    active = true;
    idx = 0;
    steps = buildSteps().filter(function (s) {
      return !(s.skip && s.skip());
    });
    buildHost();
    render();
  }

  function init() {
    if (storageGet(DONE_KEY)) return;
    global.setTimeout(start, 2600);
  }

  function reset() {
    teardown();
    try {
      global.localStorage.removeItem(DONE_KEY);
    } catch (err) {}
    try {
      global.localStorage.removeItem(TERMS_KEY);
    } catch (err) {}
  }

  X.hooks.add("swap", start);

  X.onboarding = {
    init: init,
    start: start,
    reset: reset,
    _isActive: function () {
      return active;
    },
    _idx: function () {
      return idx;
    },
    _stepCount: function () {
      return steps ? steps.length : 0;
    },
    _next: function () {
      advance();
    },
    _finish: function () {
      finish();
    },
  };
})(window);
