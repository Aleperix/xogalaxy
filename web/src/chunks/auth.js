/**
 * XO Galaxy — chunk auth.
 * Login con Google Identity Services (GIS). El client id se resuelve de forma
 * perezosa: primero window.XOGALAXY_CONFIG.googleClientId, luego el cache de
 * sessionStorage y por último GET /auth/config del backend (sin secretos).
 * El ID token y el perfil verificado se guardan en sessionStorage (por pestaña,
 * se limpian al cerrarla o al logout) para que la sesión sobreviva recargas;
 * auto_select de GIS renueva el token cuando expira. Se corre X.hooks.run("auth")
 * tras login/logout para que comentarios y chat refresquen su identidad.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var STORAGE_KEY = "xogalaxy_client_id";
  var TOKEN_KEY = "xogalaxy_token";
  var PROFILE_KEY = "xogalaxy_profile";

  var CLIENT_ID = "";
  var token = null;
  var profile = null;
  var initialized = false;
  var loading = false;
  var pendingButtons = [];
  var mountedButtons = [];
  var autoPrompted = false;
  var listeners = [];
  var ensuring = null;

  function emit() {
    X.hooks.run("auth");
    listeners.forEach(function (fn) {
      try {
        fn(profile);
      } catch (err) {}
    });
  }

  function setProfile(p) {
    profile = p || null;
    try {
      if (profile) global.sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else global.sessionStorage.removeItem(PROFILE_KEY);
    } catch (err) {}
    emit();
  }

  function setToken(t) {
    token = t || null;
    try {
      if (token) global.sessionStorage.setItem(TOKEN_KEY, token);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch (err) {}
  }

  function handleCredential(res) {
    if (!res || !res.credential) return;
    setToken(res.credential);
    X.api
      .authVerify(token)
      .then(function (p) {
        setProfile(p);
      })
      .catch(function () {
        setToken(null);
        setProfile(null);
      });
  }

  function restoreSession() {
    var t = null;
    var p = null;
    try {
      t = global.sessionStorage.getItem(TOKEN_KEY);
      var raw = global.sessionStorage.getItem(PROFILE_KEY);
      p = raw ? JSON.parse(raw) : null;
    } catch (err) {}
    if (!t || !p) return;
    token = t;
    setProfile(p);
    X.api
      .authVerify(t)
      .then(function (np) {
        setProfile(np);
      })
      .catch(function () {
        setToken(null);
        setProfile(null);
      });
  }

  function readConfigId() {
    var c = global.XOGALAXY_CONFIG || {};
    return c.googleClientId || "";
  }

  function readCachedId() {
    try {
      return global.sessionStorage.getItem(STORAGE_KEY) || "";
    } catch (err) {
      return "";
    }
  }

  function cacheId(id) {
    try {
      if (id) global.sessionStorage.setItem(STORAGE_KEY, id);
      else global.sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {}
  }

  function ensureClientId() {
    if (CLIENT_ID) return Promise.resolve(CLIENT_ID);
    if (ensuring) return ensuring;
    var fromConfig = readConfigId();
    if (fromConfig) {
      CLIENT_ID = fromConfig;
      return Promise.resolve(CLIENT_ID);
    }
    var fromCache = readCachedId();
    if (fromCache) {
      CLIENT_ID = fromCache;
      return Promise.resolve(CLIENT_ID);
    }
    ensuring = X.api
      .authConfig()
      .then(function (d) {
        CLIENT_ID = (d && d.clientId) || "";
        cacheId(CLIENT_ID);
        return CLIENT_ID;
      })
      .catch(function () {
        CLIENT_ID = "";
        return "";
      })
      .finally(function () {
        ensuring = null;
      });
    return ensuring;
  }

  function gisTheme() {
    var root = document.documentElement;
    return root && root.getAttribute("data-theme") === "light" ? "outline" : "filled_black";
  }

  function initGoogle() {
    if (!global.google || !global.google.accounts || !CLIENT_ID) return;
    initialized = true;
    global.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredential,
      auto_select: true,
      cancel_on_tap_outside: true,
      theme: gisTheme(),
    });
    var btns = pendingButtons;
    pendingButtons = [];
    btns.forEach(function (el) {
      renderGoogleButton(el);
    });
  }

  function applyGisTheme() {
    if (!initialized) return;
    initGoogle();
    mountedButtons.forEach(function (el) {
      renderGoogleButton(el);
    });
  }

  function loadScript() {
    if (loading || initialized || !CLIENT_ID) return;
    loading = true;
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = function () {
      loading = false;
      initGoogle();
    };
    s.onerror = function () {
      loading = false;
    };
    try {
      document.head.appendChild(s);
    } catch (err) {
      loading = false;
    }
  }

  function ensureReady() {
    return ensureClientId().then(function (id) {
      if (id) loadScript();
    });
  }

  function renderGoogleButton(el) {
    if (!el) return;
    if (!el.classList.contains("xogalaxy-google-slot")) {
      el.classList.add("xogalaxy-google-slot");
      mountedButtons.push(el);
    }
    try {
      el.innerHTML = "";
      global.google.accounts.id.renderButton(el, {
        theme: gisTheme(),
        size: "medium",
        text: "continue_with",
        shape: "pill",
      });
    } catch (err) {}
  }

  function renderButton(el) {
    if (!el) return;
    if (initialized && CLIENT_ID) {
      renderGoogleButton(el);
      return;
    }
    pendingButtons.push(el);
    if (CLIENT_ID) loadScript();
    else ensureReady();
  }

  function login() {
    ensureReady().then(function () {
      if (!initialized) return;
      try {
        global.google.accounts.id.prompt();
      } catch (err) {}
    });
  }

  function logout() {
    setToken(null);
    setProfile(null);
    if (initialized) {
      try {
        global.google.accounts.id.disableAutoSelect();
      } catch (err) {}
    }
  }

  function init() {
    restoreSession();
    ensureReady();
    if (!autoPrompted) {
      autoPrompted = true;
      global.setTimeout(function () {
        if (!profile) login();
      }, 1500);
    }
  }

  function onAuthChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  X.hooks.add("theme", applyGisTheme);

  X.auth = {
    init: init,
    login: login,
    logout: logout,
    renderButton: renderButton,
    onAuthChange: onAuthChange,
    getProfile: function () {
      return profile;
    },
    getToken: function () {
      return token;
    },
    isOwner: function () {
      return !!(profile && profile.isOwner);
    },
    _setProfile: setProfile,
    _setToken: function (t) {
      token = t || null;
    },
    _handleCredential: handleCredential,
    _setClientId: function (id) {
      CLIENT_ID = id || "";
      ensuring = null;
      cacheId(CLIENT_ID);
    },
    _resetAutoPrompt: function () {
      autoPrompted = false;
    },
    _resetForTests: function () {
      initialized = false;
      loading = false;
      pendingButtons = [];
      mountedButtons = [];
      autoPrompted = false;
    },
  };
})(window);
