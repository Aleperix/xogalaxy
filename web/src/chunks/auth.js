/**
 * XO Galaxy — chunk auth.
 * Login con Google Identity Services (GIS). El ID token se guarda solo en
 * memoria (nada de localStorage); el perfil verificado llega del backend
 * (/auth/verify). Se corre X.hooks.run("auth") tras login/logout para que
 * comentarios y chat refresquen su identidad.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var config = global.XOGALAXY_CONFIG || {};
  var CLIENT_ID = config.googleClientId || "";

  var token = null;
  var profile = null;
  var initialized = false;
  var loading = false;
  var pendingButtons = [];
  var listeners = [];

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
    emit();
  }

  function handleCredential(res) {
    if (!res || !res.credential) return;
    token = res.credential;
    X.api
      .authVerify(token)
      .then(function (p) {
        setProfile(p);
      })
      .catch(function () {
        token = null;
        setProfile(null);
      });
  }

  function initGoogle() {
    if (!global.google || !global.google.accounts) return;
    initialized = true;
    global.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    pendingButtons.forEach(function (btn) {
      renderButton(btn);
    });
    pendingButtons = [];
  }

  function loadScript() {
    if (loading) return;
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

  function renderButton(el) {
    if (!el) return;
    if (!initialized) {
      pendingButtons.push(el);
      loadScript();
      return;
    }
    try {
      global.google.accounts.id.renderButton(el, {
        theme: "outline",
        size: "medium",
        text: "continue_with",
        shape: "pill",
      });
    } catch (err) {}
  }

  function login() {
    if (!initialized) {
      loadScript();
      return;
    }
    try {
      global.google.accounts.id.prompt(handleCredential);
    } catch (err) {}
  }

  function logout() {
    token = null;
    setProfile(null);
    if (initialized) {
      try {
        global.google.accounts.id.disableAutoSelect();
      } catch (err) {}
    }
  }

  function init() {
    if (!CLIENT_ID) return;
    loadScript();
  }

  function onAuthChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

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
      CLIENT_ID = id;
    },
  };
})(window);
