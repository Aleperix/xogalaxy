/**
 * XO Galaxy — boot.
 * Inicializa core, router y chunks (stats + chat) al cargar la página.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});

  function boot() {
    X.core.cleanupDownloadCache();
    X.core.setupTheme();
    X.core.setupNav();
    X.core.decorateTitle();
    X.core.initIcons();
    X.core.initFeedButton();
    X.router.init();
    X.stats.init();
    X.chat.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  X.app = { boot: boot };
})(window);
