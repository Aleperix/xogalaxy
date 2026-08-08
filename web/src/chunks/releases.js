/**
 * XO Galaxy — chunk releases.
 * Detecta enlaces a GitHub Releases (a[href*="github.com/<owner>/<repo>/releases"])
 * en el contenido tras cada swap del router y los convierte en una card:
 * portada (asset imagen), botones de descarga con tamaño y changelog renderizado
 * con marked + DOMPurify. Los datos vienen del proxy /releases del backend
 * (cache CDN 1h) con fallback directo a api.github.com (repos públicos) y caché
 * local en sessionStorage (30 min). scan(container) permite re-escanear
 * contenedores dinámicos (p. ej. el chat en la Fase 6).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;

  var RELEASES_RE = /^https:\/\/github\.com\/[^/]+\/[^/?#]+\/releases/;
  var CACHE_TTL = 30 * 60 * 1000;

  function cacheKey(url) {
    return "xogalaxy.releases." + url;
  }

  function readCache(url) {
    try {
      var raw = global.sessionStorage.getItem(cacheKey(url));
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (rec && rec.t && Date.now() - rec.t < CACHE_TTL) return rec.data;
      global.sessionStorage.removeItem(cacheKey(url));
    } catch (err) {}
    return null;
  }

  function writeCache(url, data) {
    try {
      global.sessionStorage.setItem(cacheKey(url), JSON.stringify({ t: Date.now(), data: data }));
    } catch (err) {}
  }

  function parseGithub(href) {
    if (!RELEASES_RE.test(href)) return null;
    var m = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)\/releases/.exec(href);
    if (!m) return null;
    return { owner: m[1], repo: m[2], url: href };
  }

  function normalizeDirect(rel) {
    var assets = (rel.assets || [])
      .map(function (a) {
        return { name: a.name, size: Number(a.size) || 0, browserDownloadUrl: a.browser_download_url || null };
      })
      .filter(function (a) {
        return a.browserDownloadUrl;
      });
    var cover = assets.find(function (a) {
      return /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(a.name);
    });
    return {
      ok: true,
      tagName: rel.tag_name || null,
      name: rel.name || rel.tag_name || null,
      publishedAt: rel.published_at || null,
      body: rel.body || "",
      htmlUrl: rel.html_url || null,
      assets: assets,
      cover: cover ? cover.browserDownloadUrl : null,
    };
  }

  function loadRelease(link) {
    var info = parseGithub(link.href);
    if (!info) return Promise.reject(new Error("no release link"));
    var cached = readCache(info.url);
    if (cached) return Promise.resolve(cached);
    return X.api
      .release(info.url)
      .catch(function () {
        return fetch("https://api.github.com/repos/" + info.owner + "/" + info.repo + "/releases/latest", {
          headers: { accept: "application/vnd.github+json" },
        }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        }).then(normalizeDirect);
      })
      .then(function (data) {
        if (data && data.ok) writeCache(info.url, data);
        return data;
      });
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    var units = ["B", "KB", "MB", "GB"];
    var n = bytes;
    var i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return (i === 0 ? n : Math.round(n * 10) / 10) + " " + units[i];
  }

  function renderMd(text) {
    if (X.markdown && X.markdown.render) {
      try {
        return X.markdown.render(text, { gfm: true, breaks: true, sanitize: true });
      } catch (err) {}
    }
    return utils.escHtml(text);
  }

  function buildCard(link, data) {
    var card = utils.el("div", "release-card");
    if (data.cover) {
      var img = utils.el("img", "release-cover");
      img.src = data.cover;
      img.alt = "";
      img.loading = "lazy";
      card.appendChild(img);
    }
    var head = utils.el("div", "release-head");
    var title = utils.el("a", "release-name", data.name || data.tagName || "Release");
    title.href = data.htmlUrl || link.href;
    title.target = "_blank";
    title.rel = "noopener noreferrer";
    head.appendChild(title);
    if (data.tagName) {
      var tag = utils.el("span", "release-tag", data.tagName);
      head.appendChild(tag);
    }
    card.appendChild(head);

    var downloads = utils.el("div", "release-downloads");
    (data.assets || []).forEach(function (asset) {
      var a = utils.el("a", "release-download", asset.name);
      a.href = asset.browserDownloadUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("download", "");
      var size = utils.el("span", "release-size", fmtSize(asset.size));
      a.appendChild(size);
      downloads.appendChild(a);
    });
    if (downloads.children.length) card.appendChild(downloads);

    if (data.body) {
      var details = utils.el("details", "release-notes");
      var summary = utils.el("summary", "release-summary", "Changelog");
      var body = utils.el("div", "release-body");
      body.innerHTML = renderMd(data.body);
      details.appendChild(summary);
      details.appendChild(body);
      card.appendChild(details);
    }
    return card;
  }

  function enhance(link) {
    var holder = utils.el("div", "release-holder");
    link.setAttribute("data-release", "loading");
    link.style.display = "none";
    link.parentNode.insertBefore(holder, link.nextSibling);
    loadRelease(link)
      .then(function (data) {
        holder.appendChild(buildCard(link, data));
        link.setAttribute("data-release", "done");
      })
      .catch(function () {
        holder.remove();
        link.removeAttribute("data-release");
        link.style.display = "";
      });
  }

  function scan(root) {
    utils.qsa('a[href*="github.com/"][href*="/releases"]', root || document).forEach(function (link) {
      if (!link.href || !RELEASES_RE.test(link.href)) return;
      if (link.getAttribute("data-release")) return;
      if (link.closest(".release-card")) return;
      enhance(link);
    });
  }

  function init() {
    scan();
  }

  X.hooks.add("swap", init);
  X.releases = { init: init, scan: scan, _cacheKey: cacheKey, _readCache: readCache };
})(window);
