/**
 * XO Galaxy — chunk stats.
 * Contadores propios: posts (feed público Blogger), seguidores y visitas (backend propio).
 * init() se llama en la carga real (visitas = HIT); refresh() tras cada navegación SPA (GET, no infla).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  function loadPosts() {
    fetch("/feeds/posts/summary?alt=json&max-results=0")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var total = parseInt(data.feed && data.feed.openSearch$totalResults && data.feed.openSearch$totalResults.$t, 10);
        utils.animateStat(utils.qs("#stat-posts"), total);
      })
      .catch(function () {
        var el = utils.qs("#stat-posts");
        if (el) el.textContent = "—";
      });
  }

  function loadComments() {
    fetch("/feeds/comments/default?alt=json&max-results=0")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var total = parseInt(data.feed && data.feed.openSearch$totalResults && data.feed.openSearch$totalResults.$t, 10);
        utils.animateStat(utils.qs("#stat-comments"), total);
      })
      .catch(function () {
        var el = utils.qs("#stat-comments");
        if (el) el.textContent = "—";
      });
  }

  function loadFollowers() {
    api
      .followers()
      .then(function (d) {
        utils.animateStat(utils.qs("#stat-followers"), parseInt(d.count, 10));
      })
      .catch(function () {
        var el = utils.qs("#stat-followers");
        if (el) el.textContent = "—";
      });
  }

  function loadVisits(hit) {
    api
      .visits(hit)
      .then(function (d) {
        utils.animateStat(utils.qs("#stat-visits"), parseInt(d.value, 10));
      })
      .catch(function () {});
  }

  function refresh() {
    loadPosts();
    loadComments();
    loadFollowers();
    loadVisits(false);
  }

  function init() {
    loadPosts();
    loadComments();
    loadFollowers();
    loadVisits(true);
  }

  X.hooks.add("swap", refresh);
  X.stats = { init: init, refresh: refresh };
})(window);
