/**
 * XO Galaxy — chunk stats.
 * Contadores propios: posts (feed público Blogger), comentarios, seguidores y
 * visitas (backend propio). El contador de seguidores es real: se lee de D1
 * (sesiones de Google) junto con la lista de avatares, y el botón Seguir/Siguiendo
 * gestiona la relación de quien está logueado. init() se llama en la carga real
 * (visitas = HIT); refresh() tras cada navegación SPA (GET, no infla).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;
  var pendingFollow = false;

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
    api.comments
      .total()
      .then(function (d) {
        utils.animateStat(utils.qs("#stat-comments"), parseInt(d.total, 10));
      })
      .catch(function () {
        var el = utils.qs("#stat-comments");
        if (el) el.textContent = "—";
      });
  }

  function renderAvatars(list) {
    var row = utils.qs("#follow-avatars");
    if (!row) return;
    row.innerHTML = "";
    list.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "follow-avatar";
      b.title = (f.name || "Seguidor") + " · ver aportes";
      b.setAttribute("data-sub", f.sub || "");
      b.addEventListener("click", function () {
        if (X.posts && X.posts.showProfile) X.posts.showProfile({ sub: f.sub, name: f.name, picture: f.picture });
      });
      if (f.picture) {
        var img = document.createElement("img");
        img.src = f.picture;
        img.alt = "";
        img.loading = "lazy";
        b.appendChild(img);
      } else {
        b.textContent = (f.name || "?").charAt(0).toUpperCase();
      }
      row.appendChild(b);
    });
  }

  function loadFollowers() {
    api
      .followers()
      .then(function (d) {
        utils.animateStat(utils.qs("#stat-followers"), parseInt(d.count, 10));
        renderAvatars(d.followers || []);
      })
      .catch(function () {
        var el = utils.qs("#stat-followers");
        if (el) el.textContent = "—";
      });
  }

  function setFollowButton(following) {
    var btn = utils.qs("#follow-btn");
    if (!btn) return;
    btn.classList.toggle("following", following);
    btn.innerHTML = following
      ? '<i data-lucide="user-check"/>Siguiendo'
      : '<i data-lucide="user-plus"/>Seguir';
    if (X.core && X.core.initIcons) X.core.initIcons();
  }

  function renderFollowState() {
    var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
    if (!token) {
      setFollowButton(false);
      return;
    }
    api
      .followersMe(token)
      .then(function (d) {
        setFollowButton(!!d.following);
      })
      .catch(function () {
        setFollowButton(false);
      });
  }

  function setFollow(wantFollowing) {
    var btn = utils.qs("#follow-btn");
    if (btn) btn.disabled = true;
    var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
    var req = wantFollowing ? api.followersFollow(token) : api.followersUnfollow(token);
    return req
      .then(function (d) {
        utils.animateStat(utils.qs("#stat-followers"), parseInt(d.count, 10));
        setFollowButton(wantFollowing);
        loadFollowers();
      })
      .catch(function () {})
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  function onFollowClick() {
    if (!X.auth || !X.auth.getToken || !X.auth.getToken()) {
      pendingFollow = true;
      X.auth.login();
      return;
    }
    var btn = utils.qs("#follow-btn");
    var following = !!(btn && btn.classList.contains("following"));
    setFollow(!following);
  }

  function onAuth(profile) {
    renderFollowState();
    if (profile && pendingFollow) {
      pendingFollow = false;
      setFollow(true);
    }
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
    renderFollowState();
  }

  function init() {
    var btn = utils.qs("#follow-btn");
    if (btn) btn.addEventListener("click", onFollowClick);
    if (X.auth && X.auth.onAuthChange) X.auth.onAuthChange(onAuth);
    loadPosts();
    loadComments();
    loadFollowers();
    loadVisits(true);
    renderFollowState();
  }

  X.hooks.add("swap", refresh);
  X.stats = { init: init, refresh: refresh };
})(window);
