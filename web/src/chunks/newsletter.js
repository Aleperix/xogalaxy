/**
 * XO Galaxy — chunk newsletter.
 * Reemplaza el form de follow.it por la suscripción propia (doble opt-in).
 * El form (#newsletter-form) manda email → POST /subscribe; un panel extensible
 * agrega nombre + temas + frecuencia. Estados: pendiente de confirmación,
 * ya activo, error. Todo queda servido por el backend propio.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var FORM_SEL = "#newsletter-form";
  var PANEL_CLS = "newsletter-panel";
  var STATUS_CLS = "newsletter-status";
  var MOUNTED = "data-xogalaxy-newsletter";

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var TOPICS = [
    ["juegos", "Juegos"],
    ["actividades", "Actividades"],
    ["tutoriales", "Tutoriales"],
    ["nostalgia", "Nostalgia y Lost media"],
  ];

  function createEl(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildPanel() {
    var panel = createEl("div", PANEL_CLS);
    panel.hidden = true;

    var row = createEl("div", "newsletter-panel-row");

    var nameLabel = createEl("label", "newsletter-field");
    nameLabel.appendChild(createEl("span", "newsletter-field-label", "Nombre"));
    var name = createEl("input", "newsletter-input");
    name.type = "text";
    name.name = "name";
    name.maxLength = 40;
    name.placeholder = "Opcional";
    nameLabel.appendChild(name);

    var freqLabel = createEl("label", "newsletter-field");
    freqLabel.appendChild(createEl("span", "newsletter-field-label", "Frecuencia"));
    var freq = createEl("select", "newsletter-input");
    freq.name = "frequency";
    var optWeekly = createEl("option", null, "Semanal");
    optWeekly.value = "weekly";
    var optMonthly = createEl("option", null, "Mensual");
    optMonthly.value = "monthly";
    freq.appendChild(optWeekly);
    freq.appendChild(optMonthly);
    freqLabel.appendChild(freq);

    row.appendChild(nameLabel);
    row.appendChild(freqLabel);
    panel.appendChild(row);

    var topics = createEl("div", "newsletter-topics");
    TOPICS.forEach(function (pair) {
      var label = createEl("label", "newsletter-topic");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "topics";
      cb.value = pair[0];
      label.appendChild(cb);
      label.appendChild(document.createTextNode(pair[1]));
      topics.appendChild(label);
    });
    panel.appendChild(topics);

    return panel;
  }

  function setState(form, message, ok) {
    var status = form.parentNode.querySelector("." + STATUS_CLS);
    if (!status) return;
    status.textContent = message || "";
    status.hidden = !message;
    status.classList.toggle("is-error", ok === false);
    status.classList.toggle("is-ok", ok === true);
  }

  function payloadFrom(form, panel) {
    var data = {
      email: (form.querySelector('input[name="email"]').value || "").trim(),
    };
    if (panel && !panel.hidden) {
      var nameInput = panel.querySelector('input[name="name"]');
      data.name = (nameInput && nameInput.value || "").trim();
      var topics = Array.prototype.slice
        .call(panel.querySelectorAll('input[name="topics"]:checked'))
        .map(function (cb) {
          return cb.value;
        });
      var freq = panel.querySelector('select[name="frequency"]');
      data.prefs = { topics: topics, frequency: (freq && freq.value) || "weekly" };
    }
    return data;
  }

  function onSubmit(e) {
    e.preventDefault();
    var form = e.target;
    var button = form.querySelector('button[type="submit"]');
    var extras = form.parentNode.querySelector(".newsletter-extras");
    var panel = extras ? extras.querySelector("." + PANEL_CLS) : null;

    var data = payloadFrom(form, panel);
    if (!EMAIL_RE.test(data.email)) {
      setState(form, "Poné un correo válido.", false);
      return;
    }

    if (button) button.disabled = true;
    setState(form, "Un momento…", null);
    X.api.newsletter.subscribe(data).then(
      function (res) {
        if (button) button.disabled = false;
        setState(form, res.message || "¡Listo! Revisá tu casilla para confirmar.", true);
        var emailInput = form.querySelector('input[name="email"]');
        if (emailInput) emailInput.value = "";
      },
      function (err) {
        if (button) button.disabled = false;
        setState(form, (err && err.message) || "No se pudo suscribir. Probá de nuevo más tarde.", false);
      }
    );
  }

  function init() {
    document.querySelectorAll(FORM_SEL).forEach(function (form) {
      if (form.getAttribute(MOUNTED)) return;
      form.setAttribute(MOUNTED, "1");
      form.noValidate = true;

      var extras = createEl("div", "newsletter-extras");
      extras.hidden = true;
      form.parentNode.appendChild(extras);

      var panel = buildPanel();
      extras.appendChild(panel);

      var toggle = createEl("button", "newsletter-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Preferencias";
      toggle.addEventListener("click", function () {
        var open = !panel.hidden;
        panel.hidden = open;
        toggle.setAttribute("aria-expanded", String(!open));
        toggle.classList.toggle("is-open", !open);
        if (!open) {
          var name = panel.querySelector('input[name="name"]');
          if (name) name.focus();
        }
      });
      extras.appendChild(toggle);

      var status = createEl("p", STATUS_CLS);
      status.hidden = true;
      extras.appendChild(status);

      form.addEventListener("submit", onSubmit);
    });
  }

  X.hooks.add("swap", init);
  X.newsletter = { init: init };
})(window);
