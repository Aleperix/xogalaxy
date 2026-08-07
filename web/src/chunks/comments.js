/**
 * XO Galaxy — chunk comentarios.
 * Comentarios propios del backend (D1). Montado en #comments-app dentro de
 * section#comments[data-post-id]. Lazy: primero solo el contador; la lista y
 * el formulario se cargan al abrir la caja. Con login Google los comentarios
 * se publican directo; anónimos quedan pendientes de aprobación del owner.
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;
  var api = X.api;

  var instances = [];

  function create(section) {
    var app = utils.qs("#comments-app", section);
    if (!app) return null;

    var postId = section.getAttribute("data-post-id") || "";
    if (!postId) return null;

    var root = utils.el("div", "xogalaxy-comments");
    var head = utils.el("div", "cmts-head");
    var title = utils.el("h3", "cmts-title", "Comentarios");
    var toggle = utils.el("button", "cmts-toggle");
    toggle.type = "button";
    toggle.textContent = "Cargando…";
    head.appendChild(title);
    head.appendChild(toggle);
    var list = utils.el("ol", "cmts-list");
    list.hidden = true;
    var status = utils.el("p", "cmts-status");
    status.hidden = true;
    var formWrap = utils.el("div", "cmts-form-wrap");
    formWrap.hidden = true;
    root.appendChild(head);
    root.appendChild(status);
    root.appendChild(list);
    root.appendChild(formWrap);
    app.appendChild(root);

    var expanded = false;
    var loaded = false;
    var count = 0;

    function setStatus(text, cls) {
      status.textContent = text;
      status.hidden = !text;
      status.className = "cmts-status" + (cls ? " " + cls : "");
    }

    function fmtCount(n) {
      var label = n > 0 ? "Ver " + utils.fmt(n) + " comentario" + (n === 1 ? "" : "s") : "Dejar un comentario";
      return label;
    }

    function applyCount(n) {
      count = n;
      toggle.textContent = fmtCount(n);
      utils.qsa("[data-comments-count]", document).forEach(function (el) {
        el.textContent = utils.fmt(n);
      });
    }

    function commentEl(c) {
      var li = utils.el("li", "cmt");
      li.setAttribute("data-id", String(c.id));
      var header = utils.el("div", "cmt-header");
      if (c.author && c.author.picture) {
        var img = utils.el("img", "cmt-avatar");
        img.src = c.author.picture;
        img.alt = c.author.name || "";
        img.width = 32;
        img.height = 32;
        header.appendChild(img);
      }
      var name = utils.el("span", "cmt-name", (c.author && c.author.name) || "Anónimo");
      if (c.author && c.author.sub) name.classList.add("cmt-verified");
      header.appendChild(name);
      var when = utils.el("time", "cmt-when");
      try {
        when.textContent = new Date(c.createdAt).toLocaleString();
      } catch (err) {}
      header.appendChild(when);
      var body = utils.el("div", "cmt-body", c.body);
      li.appendChild(header);
      li.appendChild(body);
      return li;
    }

    function renderList(items) {
      list.innerHTML = "";
      (items || []).forEach(function (c) {
        list.appendChild(commentEl(c));
      });
      list.hidden = false;
    }

    function loadList() {
      if (loaded) return Promise.resolve();
      loaded = true;
      setStatus("Cargando comentarios…");
      return api.comments
        .list(postId)
        .then(function (d) {
          renderList(d.comments || []);
          applyCount((d.comments || []).length);
          setStatus("");
        })
        .catch(function (err) {
          setStatus("No se pudieron cargar los comentarios.", "error");
          return Promise.reject(err);
        });
    }

    function loadCount() {
      api.comments
        .count(postId)
        .then(function (d) {
          applyCount(Number(d.count) || 0);
        })
        .catch(function () {
          toggle.textContent = "Comentarios";
        });
    }

    // ---- identidad ----
    var authArea = utils.el("div", "cmts-auth");
    var googleSlot = utils.el("div", "cmts-google");
    var anonRow = utils.el("div", "cmts-anon");
    var nameInput = utils.el("input", "cmts-name");
    nameInput.maxLength = 40;
    nameInput.placeholder = "Tu nombre";
    nameInput.autocomplete = "name";
    var hint = utils.el("p", "cmts-hint", "Los comentarios anónimos quedan en espera de aprobación.");
    anonRow.appendChild(nameInput);
    anonRow.appendChild(hint);
    var textarea = utils.el("textarea", "cmts-body");
    textarea.maxLength = 4000;
    textarea.placeholder = "Escribí tu comentario…";
    textarea.setAttribute("aria-label", "Comentario");
    var submit = utils.el("button", "cmts-submit", "Publicar");
    submit.type = "submit";
    var logoutBtn = utils.el("button", "cmts-logout", "Salir");
    logoutBtn.type = "button";
    var form = utils.el("form", "cmts-form");
    form.appendChild(authArea);
    form.appendChild(textarea);
    form.appendChild(submit);
    formWrap.appendChild(form);

    function renderAuth() {
      authArea.innerHTML = "";
      var p = X.auth.getProfile();
      if (p) {
        if (p.picture) {
          var img = utils.el("img", "cmts-avatar");
          img.src = p.picture;
          img.alt = p.name || "";
          img.width = 32;
          img.height = 32;
          authArea.appendChild(img);
        }
        var who = utils.el("span", "cmts-who", "Comentando como " + (p.name || "verificado"));
        authArea.appendChild(who);
        authArea.appendChild(logoutBtn);
        anonRow.hidden = true;
        return;
      }
      authArea.appendChild(googleSlot);
      X.auth.renderButton(googleSlot);
      authArea.appendChild(anonRow);
      anonRow.hidden = false;
    }

    function submitForm() {
      var body = textarea.value.trim().slice(0, 4000);
      if (!body) return;
      var p = X.auth.getProfile();
      var payload = { postId: postId, body: body };
      if (p) {
        payload.token = X.auth.getToken();
      } else {
        payload.name = nameInput.value.trim().slice(0, 40) || "Anónimo";
      }
      submit.disabled = true;
      api.comments
        .create(payload)
        .then(function (d) {
          textarea.value = "";
          if (d.comment && d.comment.status !== "approved") {
            setStatus("Gracias. Tu comentario quedó en espera de aprobación.", "pending");
          } else {
            setStatus("");
          }
          loadCount();
          return loadList().catch(function () {});
        })
        .catch(function (err) {
          setStatus("No se pudo publicar. Intentá de nuevo.", "error");
        })
        .finally(function () {
          submit.disabled = false;
        });
    }

    // ---- panel de moderación (owner) ----
    var modWrap = utils.el("div", "cmts-mod");
    root.appendChild(modWrap);

    function renderMod() {
      modWrap.innerHTML = "";
      var p = X.auth.getProfile();
      if (!p || !p.isOwner) {
        modWrap.hidden = true;
        return;
      }
      modWrap.hidden = false;
      var btn = utils.el("button", "cmts-mod-toggle", "Moderar pendientes");
      btn.type = "button";
      modWrap.appendChild(btn);
      var modList = utils.el("ol", "cmts-mod-list");
      modList.hidden = true;
      modWrap.appendChild(modList);

      btn.addEventListener("click", function () {
        if (!modList.hidden) {
          modList.hidden = true;
          return;
        }
        api.comments
          .modPending(X.auth.getToken())
          .then(function (d) {
            var items = d.comments || [];
            if (!items.length) {
              modList.innerHTML = "";
              var none = utils.el("li", "cmt-none", "No hay comentarios pendientes.");
              modList.appendChild(none);
              modList.hidden = false;
              return;
            }
            modList.innerHTML = "";
            items.forEach(function (c) {
              var li = commentEl(c);
              var actions = utils.el("div", "cmt-actions");
              var approve = utils.el("button", "cmt-approve", "Aprobar");
              approve.type = "button";
              var reject = utils.el("button", "cmt-reject", "Rechazar");
              reject.type = "button";
              actions.appendChild(approve);
              actions.appendChild(reject);
              li.appendChild(actions);
              approve.addEventListener("click", function () {
                api.comments
                  .modReview(c.id, "approve", X.auth.getToken())
                  .then(function () {
                    li.remove();
                    loadCount();
                  })
                  .catch(function () {});
              });
              reject.addEventListener("click", function () {
                api.comments
                  .modReview(c.id, "reject", X.auth.getToken())
                  .then(function () {
                    li.remove();
                  })
                  .catch(function () {});
              });
              modList.appendChild(li);
            });
            modList.hidden = false;
          })
          .catch(function () {
            modList.innerHTML = "";
            var none = utils.el("li", "cmt-none", "No se pudo cargar la moderación.");
            modList.appendChild(none);
            modList.hidden = false;
          });
      });
    }

    var unbindAuth = X.auth.onAuthChange(function () {
      renderAuth();
      renderMod();
    });

    // ---- eventos ----
    toggle.addEventListener("click", function () {
      if (expanded) return;
      expanded = true;
      toggle.textContent = "Comentarios";
      loadList().catch(function () {});
      formWrap.hidden = false;
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submitForm();
    });

    logoutBtn.addEventListener("click", function () {
      X.auth.logout();
    });

    renderAuth();
    renderMod();
    loadCount();

    return {
      root: root,
      destroy: function () {
        unbindAuth();
      },
    };
  }

  var live = [];

  function init() {
    utils.qsa("section#comments[data-post-id]").forEach(function (section) {
      if (section.getAttribute("data-xogalaxy-mounted")) return;
      section.setAttribute("data-xogalaxy-mounted", "1");
      var inst = create(section);
      if (inst) live.push(inst);
    });
  }

  function reset() {
    live.forEach(function (inst) {
      inst.destroy();
    });
    live = [];
  }

  X.hooks.add("swap", init);
  X.comments = { init: init, reset: reset };
})(window);
