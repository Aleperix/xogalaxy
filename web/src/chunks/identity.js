/**
 * XO Galaxy — chunk identity.
 * Identidad del visitante sin registro:
 *   visitorId()    → id persistido por navegador (xogalaxy.visitor).
 *   guestName()    → "Invitado-XXXX" persistido (xogalaxy.guestNick).
 *   setGuestName() → cambia el nombre del invitado (lo persiste).
 *   userId()       → sub de Google si hay sesión, si no visitorId().
 * Con sesión de Google la identidad es el sub; sin sesión, el visitante
 * anónimo mantiene nombre e historial propios en el navegador.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});

  var VISITOR_KEY = "xogalaxy.visitor";
  var GUEST_KEY = "xogalaxy.guestNick";

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

  function guestName() {
    var name = null;
    try {
      name = localStorage.getItem(GUEST_KEY);
    } catch (err) {}
    if (!name) {
      name = "Invitado-" + String(Math.floor(1000 + Math.random() * 9000));
      try {
        localStorage.setItem(GUEST_KEY, name);
      } catch (err) {}
    }
    return name;
  }

  function setGuestName(name) {
    var n = String(name || "")
      .trim()
      .slice(0, 32);
    try {
      if (n) localStorage.setItem(GUEST_KEY, n);
      else localStorage.removeItem(GUEST_KEY);
    } catch (err) {}
    return n || guestName();
  }

  function userId() {
    var p = X.auth ? X.auth.getProfile() : null;
    return (p && p.sub) || visitorId();
  }

  X.identity = {
    visitorId: visitorId,
    guestName: guestName,
    setGuestName: setGuestName,
    userId: userId,
  };
})(window);
