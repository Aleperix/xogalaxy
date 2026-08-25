/**
 * XO Galaxy — estilos de nick (códigos § estilo Minecraft).
 * Colores: §0-§9, §a-§f. Formatos: §l negrita, §o itálica, §n subrayado,
 * §m tachado, §r reset. Códigos desconocidos se descartan.
 * Todo el texto se inserta con textContent (sin riesgo XSS).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});

  var COLORS = {
    "0": "#3d3d4a",
    "1": "#5b5bff",
    "2": "#55ff55",
    "3": "#55ffff",
    "4": "#ff5555",
    "5": "#ff55ff",
    "6": "#ffaa00",
    "7": "#aaaaaa",
    "8": "#737373",
    "9": "#7c7cff",
    a: "#63ff63",
    b: "#6cf0f0",
    c: "#ff6b6b",
    d: "#ff6bff",
    e: "#ffff55",
    f: "#ffffff",
  };

  var MAX_LEN = 64;
  var MAX_SPANS = 24;

  function stateSpan(color, bold, italic, underline, strike, text) {
    var s = global.document.createElement("span");
    s.className = "nick-fx";
    if (color) s.style.color = color;
    if (bold) s.style.fontWeight = "700";
    if (italic) s.style.fontStyle = "italic";
    if (underline && strike) s.style.textDecoration = "underline line-through";
    else if (underline) s.style.textDecoration = "underline";
    else if (strike) s.style.textDecoration = "line-through";
    s.textContent = text;
    return s;
  }

  function render(raw) {
    var doc = global.document;
    var frag = doc.createDocumentFragment();
    var text = String(raw == null ? "" : raw).slice(0, MAX_LEN);
    var re = /§([0-9a-fk-or])/gi;
    var color = null;
    var bold = false;
    var italic = false;
    var underline = false;
    var strike = false;
    var idx = 0;
    var spans = 0;
    var buf = "";
    var m;

    function flush() {
      if (!buf || spans >= MAX_SPANS) {
        buf = "";
        return;
      }
      frag.appendChild(stateSpan(color, bold, italic, underline, strike, buf));
      spans += 1;
      buf = "";
    }

    while ((m = re.exec(text)) !== null) {
      buf += text.slice(idx, m.index);
      idx = m.index + m[0].length;
      flush();
      var code = m[1].toLowerCase();
      if (COLORS[code]) color = COLORS[code];
      else if (code === "l") bold = true;
      else if (code === "o") italic = true;
      else if (code === "n") underline = true;
      else if (code === "m") strike = true;
      else if (code === "r") {
        color = null;
        bold = false;
        italic = false;
        underline = false;
        strike = false;
      }
    }
    buf += text.slice(idx);
    flush();
    return frag;
  }

  function plain(raw) {
    return String(raw == null ? "" : raw)
      .replace(/§[0-9a-fk-or]/gi, "")
      .slice(0, MAX_LEN);
  }

  X.nickStyle = { render: render, plain: plain, COLORS: COLORS, MAX_LEN: MAX_LEN };
})(window);
