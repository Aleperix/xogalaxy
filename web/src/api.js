/**
 * XO Galaxy — API client del backend propio.
 * URL base configurable: window.XOGALAXY_CONFIG.backend o la del worker.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var config = global.XOGALAXY_CONFIG || {};
  var BACKEND = config.backend || "https://backend.xogalaxy.workers.dev";

  function parse(res) {
    return res.json().catch(function () {
      return {};
    });
  }

  function apiError(res, data) {
    var err = new Error((data && data.error) || "HTTP " + res.status);
    err.status = res.status;
    return err;
  }

  function get(url, headers) {
    return fetch(BACKEND + url, { headers: Object.assign({ accept: "application/json" }, headers || {}) }).then(function (r) {
      return parse(r).then(function (d) {
        if (!r.ok) throw apiError(r, d);
        return d;
      });
    });
  }

  function post(url, body, headers) {
    return fetch(BACKEND + url, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json", accept: "application/json" }, headers || {}),
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return parse(r).then(function (d) {
        if (!r.ok) throw apiError(r, d);
        return d;
      });
    });
  }

  function followers() {
    return get("/followers");
  }

  function followersFollow(token) {
    return post("/followers/follow", { token: token || null });
  }

  function followersUnfollow(token) {
    return post("/followers/unfollow", { token: token || null });
  }

  function followersMe(token) {
    return get("/followers/me", { "X-XOGALAXY-Token": token || "" });
  }

  function visits(hit) {
    return get("/visits" + (hit ? "?hit=1" : ""));
  }

  function chatHistory(room, limit) {
    var url = "/chat/history?room=" + encodeURIComponent(room || "general");
    if (limit) url += "&limit=" + limit;
    return get(url);
  }

  function chatSend(room, nickname, body, token) {
    return post("/chat/message", { room: room, nickname: nickname, body: body, token: token || null });
  }

  // ---- autenticación (Google ID token) ----
  function authVerify(token) {
    return post("/auth/verify", { token: token }).then(function (d) {
      return { sub: d.sub, name: d.name, picture: d.picture, isOwner: !!d.isOwner };
    });
  }
  function authConfig() {
    return get("/auth/config");
  }

  // ---- comentarios ----
  function commentsList(postId) {
    return get("/comments?postId=" + encodeURIComponent(postId));
  }
  function commentsCount(postId) {
    return get("/comments?postId=" + encodeURIComponent(postId) + "&count=1");
  }
  function commentsCounts(ids) {
    return get("/comments/counts?ids=" + encodeURIComponent(ids.join(",")));
  }
  function commentsTotal() {
    return get("/comments/total");
  }
  function commentsCreate(data) {
    return post("/comments", data);
  }
  function commentsModPending(token) {
    return get("/comments/mod/pending", { "X-XOGALAXY-Token": token });
  }
  function commentsModReview(id, action, token) {
    return post("/comments/mod/review", { id: id, action: action }, { "X-XOGALAXY-Token": token });
  }
  function commentsDelete(id, token) {
    return post("/comments/delete", { id: id, token: token || null });
  }

  // ---- aportes (tool de posts) ----
  function postsCreate(data) {
    return post("/posts", data);
  }
  function postsPending(token) {
    return get("/posts/pending", { "X-XOGALAXY-Token": token });
  }
  function postsApproved(token) {
    return get("/posts/approved", { "X-XOGALAXY-Token": token });
  }
  function postsMy(token, visitor) {
    if (token) return get("/posts/my", { "X-XOGALAXY-Token": token });
    var q = visitor ? "?visitor=" + encodeURIComponent(visitor) : "";
    return get("/posts/my" + q);
  }
  function postsByAuthor(sub, token) {
    var url = "/posts/by-author?sub=" + encodeURIComponent(sub);
    if (token) return get(url, { "X-XOGALAXY-Token": token });
    return get(url);
  }
  function postsReview(id, action, token) {
    return post("/posts/mod/review", { id: id, action: action }, { "X-XOGALAXY-Token": token });
  }
  function postsDelete(id, token) {
    return post("/posts/delete", { id: id, token: token || null });
  }
  function postsSetUrl(id, url, token) {
    return post("/posts/url", { id: id, url: url }, { "X-XOGALAXY-Token": token });
  }

  // ---- releases (proxy GitHub) ----
  function release(url) {
    return get("/releases?url=" + encodeURIComponent(url));
  }

  // ---- engagement (ratings + reacciones) ----
  function ratingGet(target, user) {
    var url = "/rating?target=" + encodeURIComponent(target);
    if (user) url += "&user=" + encodeURIComponent(user);
    return get(url);
  }
  function ratingSet(target, value, user, token) {
    return post("/rating", { target: target, value: value, user: user, token: token || null });
  }
  function reactionGet(target) {
    return get("/reaction?target=" + encodeURIComponent(target));
  }
  function reactionSet(target, type, user, token) {
    return post("/reaction", { target: target, type: type, user: user, token: token || null });
  }
  function engagement(targets, user) {
    var url = "/engagement?targets=" + encodeURIComponent(targets.join(","));
    if (user) url += "&user=" + encodeURIComponent(user);
    return get(url);
  }

  X.api = {
    followers: followers,
    followersFollow: followersFollow,
    followersUnfollow: followersUnfollow,
    followersMe: followersMe,
    visits: visits,
    chatHistory: chatHistory,
    chatSend: chatSend,
    authVerify: authVerify,
    authConfig: authConfig,
    comments: {
      list: commentsList,
      count: commentsCount,
      counts: commentsCounts,
      total: commentsTotal,
      create: commentsCreate,
      modPending: commentsModPending,
      modReview: commentsModReview,
      remove: commentsDelete,
    },
    posts: {
      create: postsCreate,
      modPending: postsPending,
      modApproved: postsApproved,
      my: postsMy,
      byAuthor: postsByAuthor,
      modReview: postsReview,
      remove: postsDelete,
      setUrl: postsSetUrl,
    },
    release: release,
    rating: { get: ratingGet, set: ratingSet },
    reaction: { get: reactionGet, set: reactionSet },
    engagement: engagement,
  };
  X.config = { backend: BACKEND };
})(window);
