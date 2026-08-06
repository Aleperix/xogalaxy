/**
 * XO Galaxy — API client del backend propio.
 * URL base configurable: window.XOGALAXY_CONFIG.backend o la del worker.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var config = global.XOGALAXY_CONFIG || {};
  var BACKEND = config.backend || "https://backend.xogalaxy.workers.dev";

  function followers() {
    return fetch(BACKEND + "/followers").then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function visits(hit) {
    return fetch(BACKEND + "/visits" + (hit ? "?hit=1" : "")).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function chatHistory(room, limit) {
    var url = BACKEND + "/chat/history?room=" + encodeURIComponent(room || "general");
    if (limit) url += "&limit=" + limit;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function chatSend(room, nickname, body) {
    return fetch(BACKEND + "/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ room: room, nickname: nickname, body: body }),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  X.api = { followers: followers, visits: visits, chatHistory: chatHistory, chatSend: chatSend };
  X.config = { backend: BACKEND };
})(window);
