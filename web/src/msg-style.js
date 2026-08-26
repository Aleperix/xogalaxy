/**
 * XO Galaxy — estilos de mensajes del chat.
 * renderMsg(raw): renderiza body del mensaje con colores y formatos via clases CSS.
 * Colores: msg-c0 a msg-cf. Formatos: msg-bold, msg-italic, msg-underline, msg-strike.
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

  var COLOR_CLASSES = {};
  Object.keys(COLORS).forEach(function (k) {
    COLOR_CLASSES[k] = "msg-c" + k;
  });

  var FORMAT_CLASSES = {
    l: "msg-bold",
    o: "msg-italic",
    n: "msg-underline",
    m: "msg-strike",
  };

  var MAX_MSG_LEN = 1000;
  var MAX_SPANS = 48;

  function buildSpan(classes, text) {
    var s = global.document.createElement("span");
    if (classes.length) s.className = classes.join(" ");
    s.textContent = text;
    return s;
  }

  function renderMsg(raw) {
    var doc = global.document;
    var frag = doc.createDocumentFragment();
    var text = String(raw == null ? "" : raw).slice(0, MAX_MSG_LEN);
    var re = /\u00a7([0-9a-fk-or])/gi;
    var colorClass = null;
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
      var cls = [];
      if (bold) cls.push("msg-bold");
      if (italic) cls.push("msg-italic");
      if (underline) cls.push("msg-underline");
      if (strike) cls.push("msg-strike");
      if (colorClass) cls.push(colorClass);
      frag.appendChild(buildSpan(cls, buf));
      spans += 1;
      buf = "";
    }

    while ((m = re.exec(text)) !== null) {
      buf += text.slice(idx, m.index);
      idx = m.index + m[0].length;
      flush();
      var code = m[1].toLowerCase();
      if (COLORS[code]) {
        colorClass = COLOR_CLASSES[code];
      } else if (FORMAT_CLASSES[code]) {
        var fc = FORMAT_CLASSES[code];
        if (fc === "msg-bold") bold = true;
        else if (fc === "msg-italic") italic = true;
        else if (fc === "msg-underline") underline = true;
        else if (fc === "msg-strike") strike = true;
      } else if (code === "r") {
        colorClass = null;
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

  X.msgStyle = {
    renderMsg: renderMsg,
    COLORS: COLORS,
    COLOR_CLASSES: COLOR_CLASSES,
    FORMAT_CLASSES: FORMAT_CLASSES,
    MAX_MSG_LEN: MAX_MSG_LEN,
  };
})(window);
