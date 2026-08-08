/**
 * XO Galaxy — markdown.
 * Wrapper sobre marked (vendored en web/vendor) + DOMPurify (vendored).
 * render(text, {gfm, breaks, sanitize}): con sanitize:true se purifica el HTML
 * resultante (obligatorio para contenido de usuarios: chat, aportes anónimos).
 * Si marked no está disponible degrada a texto escapado (sin XSS).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});

  function render(text, opts) {
    opts = opts || {};
    var md = String(text == null ? "" : text);
    var html;
    if (opts.sanitize && !(global.DOMPurify && DOMPurify.sanitize)) {
      return X.core.utils.escHtml(md);
    }
    if (global.marked && global.marked.parse) {
      try {
        html = global.marked.parse(md, {
          gfm: opts.gfm !== false,
          breaks: opts.breaks !== false,
        });
      } catch (err) {
        html = X.core.utils.escHtml(md);
      }
    } else {
      html = X.core.utils.escHtml(md);
    }
    if (opts.sanitize && global.DOMPurify && DOMPurify.sanitize) {
      html = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "a", "b", "i", "em", "strong", "code", "pre", "blockquote", "p", "br", "hr",
          "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "img", "span", "div",
          "table", "thead", "tbody", "tr", "th", "td", "del", "ins", "mark", "sup", "sub",
          "figure", "figcaption", "details", "summary",
        ],
        ALLOWED_ATTR: [
          "href", "src", "alt", "title", "width", "height", "class", "target", "rel",
          "colspan", "rowspan", "datetime",
        ],
        FORBID_TAGS: ["style", "form", "input", "button", "iframe", "script", "object", "embed", "svg", "math"],
        FORBID_ATTR: ["style"],
      });
      html = html
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/<(script|iframe|object|embed|svg|math|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
        .replace(/<(script|iframe|object|embed|svg|math|style)\b[^>]*\/?>/gi, "");
    }
    return html;
  }

  X.markdown = {
    render: render,
    ready: function () {
      return !!(global.marked && global.marked.parse);
    },
  };
})(window);
