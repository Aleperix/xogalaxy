/**
 * XO Galaxy — router SPA (History API).
 * Navegación suave entre páginas del blog: fetch + swap de <main.main-layout>,
 * pushState/popstate, delegación de clics y hooks 'swap' tras cada intercambio.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var core = X.core;
  var MAIN_SELECTOR = "main.main-layout";

  function afterSwap() {
    core.initIcons();
    X.hooks.run("swap");
  }

  function navigate(url, replace) {
    return core.utils
      .getText(url)
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        var next = doc.querySelector(MAIN_SELECTOR);
        var current = document.querySelector(MAIN_SELECTOR);
        if (!next || !current) {
          location.href = url;
          return;
        }
        current.innerHTML = next.innerHTML;
        var t = doc.querySelector("title");
        if (t) document.title = t.textContent;

        var state = { url: url };
        if (replace) history.replaceState(state, "", url);
        else history.pushState(state, "", url);

        var hashIndex = url.indexOf("#");
        if (hashIndex >= 0) {
          var hash = url.slice(hashIndex);
          var target = document.querySelector(hash);
          if (target) target.scrollIntoView();
          else window.scrollTo(0, 0);
        } else {
          var postTitle = document.querySelector(".post-single .post-title");
          if (postTitle) postTitle.scrollIntoView({ block: "start" });
          else window.scrollTo(0, 0);
        }
        afterSwap();
      })
      .catch(function () {
        location.href = url;
      });
  }

  function onClick(e) {
    var lm = e.target.closest ? e.target.closest(".load-more a") : null;
    if (lm) {
      e.preventDefault();
      core.loadMore(lm);
      return;
    }
    var link = e.target.closest ? e.target.closest("a") : null;
    if (!link || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = link.target;
    if (t && t !== "_self") return;
    var href = link.getAttribute("href");
    if (!href) return;
    if (href.charAt(0) === "#") return;
    if (link.closest(".hero-actions")) return;
    var url;
    try {
      url = new URL(href, location.href);
    } catch (err) {
      return;
    }
    if (url.origin !== location.origin) return;
    e.preventDefault();
    X.router.navigate(url.pathname + url.search + url.hash);
  }

  function init() {
    window.addEventListener("popstate", function () {
      navigate(location.href, true);
    });
    document.addEventListener("click", onClick);
  }

  X.router = { init: init, navigate: navigate, afterSwap: afterSwap };
})(window);
