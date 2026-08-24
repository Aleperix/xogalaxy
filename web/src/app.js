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
    X.core.initShare();
    X.auth.init();
    X.router.init();
    X.stats.init();
    X.chat.init();
    X.comments.init();
    X.posts.init();
    X.engagement.init();
    X.lightbox.init();
    X.newsletter.init();
    X.onboarding.init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  X.app = { boot: boot };
})(window);
