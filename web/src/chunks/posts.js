/**
 * XO Galaxy — chunk tool de aportes (posts).
 * Se monta en #post-tool (page publicar). Editor de posts en Markdown con
 * preview en vivo (debounced), botones rápidos, login Google y bandeja del
 * owner para aprobar/rechazar y copiar el HTML/Markdown listo para publicar
 * en Blogger (fijando la URL del post publicado).
 */
(function (global) {
  "use strict";

  var X = (global.XOGalaxy = global.XOGalaxy || {});
  var utils = X.core.utils;

  var DEBOUNCE_MS = 150;
  var POST_BODY_MAX = 20000;
  var POST_TITLE_MAX = 200;
  var live = [];

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      var ta = utils.el("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (err) {}
      document.body.removeChild(ta);
      done();
    }
  }

  function feedback(btn, label) {
    var prev = btn.getAttribute("aria-label") || btn.textContent;
    btn.textContent = label;
    global.setTimeout(function () {
      btn.textContent = prev;
    }, 1600);
  }

  function create(container) {
    var root = utils.el("div", "post-tool");

    var head = utils.el("div", "pt-head");
    var title = utils.el("h2", "pt-title", "Aportá un post");
    var intro = utils.el(
      "p",
      "pt-intro",
      "Escribí tu aporte en Markdown. Quedará en revisión y, si se aprueba, se publicará en el blog."
    );
    head.appendChild(title);
    head.appendChild(intro);
    root.appendChild(head);

    // ---- autoría ----
    var authArea = utils.el("div", "pt-auth");
    var googleSlot = utils.el("div", "pt-google");
    var nameInput = utils.el("input", "pt-name");
    nameInput.maxLength = 40;
    nameInput.placeholder = "Tu nombre (opcional)";
    nameInput.autocomplete = "name";
    var logoutBtn = utils.el("button", "pt-logout", "Salir");
    logoutBtn.type = "button";
    authArea.appendChild(googleSlot);
    authArea.appendChild(nameInput);
    root.appendChild(authArea);

    // ---- formulario ----
    var form = utils.el("form", "pt-form");
    var titleInput = utils.el("input", "pt-title-input");
    titleInput.maxLength = POST_TITLE_MAX;
    titleInput.placeholder = "Título del aporte";
    titleInput.setAttribute("aria-label", "Título");

    var bar = utils.el("div", "pt-bar");
    var quickButtons = [
      { label: "H2", snippet: "## ", wrap: null },
      { label: "N", snippet: "**", wrap: "**", bold: true },
      { label: "C", snippet: "`", wrap: "`" },
      { label: "L", snippet: "[texto](https://)", wrap: null },
      { label: "Img", snippet: "![alt](https://)", wrap: null },
      { label: "•", snippet: "- item", wrap: null },
      { label: "1.", snippet: "1. item", wrap: null },
      { label: ">", snippet: "> ", wrap: null },
      { label: "—", snippet: "\n---\n", wrap: null },
    ];
    quickButtons.forEach(function (q) {
      var b = utils.el("button", "pt-qbtn", q.label);
      b.type = "button";
      b.setAttribute("aria-label", "Insertar " + q.label);
      b.addEventListener("click", function () {
        insertSnippet(textarea, q.snippet, q.wrap);
      });
      bar.appendChild(b);
    });

    var textarea = utils.el("textarea", "pt-body");
    textarea.maxLength = POST_BODY_MAX;
    textarea.placeholder = "# Escribí en Markdown…";
    textarea.setAttribute("aria-label", "Contenido del aporte");

    var previewWrap = utils.el("div", "pt-preview-wrap");
    var previewToggle = utils.el("button", "pt-preview-toggle", "Vista previa");
    previewToggle.type = "button";
    var preview = utils.el("div", "pt-preview");
    preview.hidden = true;
    previewWrap.appendChild(previewToggle);
    previewWrap.appendChild(preview);

    var status = utils.el("p", "pt-status");
    status.hidden = true;
    var submit = utils.el("button", "pt-submit", "Enviar aporte");
    submit.type = "submit";

    form.appendChild(titleInput);
    form.appendChild(bar);
    form.appendChild(textarea);
    form.appendChild(previewWrap);
    form.appendChild(status);
    form.appendChild(submit);
    root.appendChild(form);

    // ---- bandeja del owner ----
    var modWrap = utils.el("div", "pt-mod");
    var modToggle = utils.el("button", "pt-mod-toggle", "Bandeja de aportes");
    modToggle.type = "button";
    var modList = utils.el("div", "pt-mod-list");
    modList.hidden = true;
    modWrap.appendChild(modToggle);
    modWrap.appendChild(modList);
    root.appendChild(modWrap);

    container.appendChild(root);

    function setStatus(text, cls) {
      status.textContent = text;
      status.hidden = !text;
      status.className = "pt-status" + (cls ? " " + cls : "");
    }

    function renderMarkdown(text, sanitize) {
      if (X.markdown && X.markdown.render) {
        try {
          return X.markdown.render(text, { gfm: true, breaks: false, sanitize: !!sanitize });
        } catch (err) {}
      }
      return utils.escHtml(text);
    }

    function renderPreview() {
      preview.innerHTML = renderMarkdown(textarea.value, false);
    }

    var debounceTimer = null;
    textarea.addEventListener("input", function () {
      if (debounceTimer) global.clearTimeout(debounceTimer);
      debounceTimer = global.setTimeout(function () {
        renderPreview();
      }, DEBOUNCE_MS);
    });

    previewToggle.addEventListener("click", function () {
      preview.hidden = !preview.hidden;
      previewToggle.textContent = preview.hidden ? "Vista previa" : "Ocultar vista";
      if (!preview.hidden) renderPreview();
    });

    // ---- identidad ----
    function renderAuth() {
      authArea.innerHTML = "";
      var p = X.auth.getProfile();
      if (p) {
        if (p.picture) {
          var img = utils.el("img", "pt-avatar");
          img.src = p.picture;
          img.alt = p.name || "";
          img.width = 32;
          img.height = 32;
          authArea.appendChild(img);
        }
        var who = utils.el("span", "pt-who", "Aportando como " + (p.name || "verificado"));
        authArea.appendChild(who);
        authArea.appendChild(logoutBtn);
        nameInput.hidden = true;
        return;
      }
      authArea.appendChild(googleSlot);
      X.auth.renderButton(googleSlot);
      authArea.appendChild(nameInput);
      nameInput.hidden = false;
    }

    function submitPost() {
      var t = titleInput.value.trim().slice(0, POST_TITLE_MAX);
      var body = textarea.value.trim().slice(0, POST_BODY_MAX);
      if (!t || !body) {
        setStatus("Completá el título y el contenido.", "error");
        return;
      }
      var p = X.auth.getProfile();
      var payload = { title: t, body: body };
      if (p) payload.token = X.auth.getToken();
      else payload.name = nameInput.value.trim().slice(0, 40) || "";
      submit.disabled = true;
      X.api.posts
        .create(payload)
        .then(function (d) {
          titleInput.value = "";
          textarea.value = "";
          renderPreview();
          if (d.post && d.post.status === "approved") setStatus("Publicado.", "pending");
          else setStatus("Gracias. Tu aporte quedó en revisión.", "pending");
          refreshTray();
        })
        .catch(function (err) {
          if (err && err.status === 429) setStatus("Demasiados envíos. Esperá un momento.", "error");
          else setStatus("No se pudo enviar. Intentá de nuevo.", "error");
        })
        .finally(function () {
          submit.disabled = false;
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submitPost();
    });

    logoutBtn.addEventListener("click", function () {
      X.auth.logout();
    });

    // ---- botones rápidos ----
    function insertSnippet(ta, snippet, wrap) {
      var start = ta.selectionStart == null ? 0 : ta.selectionStart;
      var end = ta.selectionEnd == null ? 0 : ta.selectionEnd;
      var sel = ta.value.slice(start, end);
      var val;
      if (wrap && sel) val = wrap + sel + wrap;
      else val = snippet;
      ta.value = ta.value.slice(0, start) + val + ta.value.slice(end);
      ta.focus();
      try {
        ta.setSelectionRange(start, start + val.length);
      } catch (err) {}
      renderPreview();
    }

    // ---- bandeja ----
    function postCard(p, pending) {
      var card = utils.el("div", "pt-post" + (pending ? " pt-post-pending" : ""));
      var h = utils.el("div", "pt-post-head");
      var t = utils.el("h3", "pt-post-title", p.title);
      var meta = utils.el("span", "pt-post-meta", (p.author && p.author.name) || "Anónimo");
      h.appendChild(t);
      h.appendChild(meta);
      card.appendChild(h);
      var body = utils.el("div", "pt-post-body");
      body.innerHTML = renderMarkdown(p.body, true);
      card.appendChild(body);
      var when = utils.el("time", "pt-post-when");
      try {
        when.textContent = new Date(p.createdAt).toLocaleString();
      } catch (err) {}
      card.appendChild(when);
      return card;
    }

    function renderTray() {
      modList.innerHTML = "";
      var p = X.auth.getProfile();
      if (!p || !p.isOwner) return;
      var token = X.auth.getToken();
      var section = utils.el("div", "pt-mod-section");
      var h = utils.el("h4", "pt-mod-sub", "Pendientes");
      section.appendChild(h);
      var pendingList = utils.el("div", "pt-mod-pending");
      var approvedH = utils.el("h4", "pt-mod-sub", "Aprobados");
      var approvedList = utils.el("div", "pt-mod-approved");
      section.appendChild(pendingList);
      section.appendChild(approvedH);
      section.appendChild(approvedList);
      modList.appendChild(section);

      X.api.posts
        .modPending(token)
        .then(function (d) {
          var items = d.posts || [];
          pendingList.innerHTML = "";
          if (!items.length) {
            pendingList.appendChild(utils.el("p", "pt-none", "No hay aportes pendientes."));
            return;
          }
          items.forEach(function (post) {
            var card = postCard(post, true);
            var actions = utils.el("div", "pt-actions");
            var approve = utils.el("button", "pt-approve", "Aprobar");
            approve.type = "button";
            var reject = utils.el("button", "pt-reject", "Rechazar");
            reject.type = "button";
            actions.appendChild(approve);
            actions.appendChild(reject);
            card.appendChild(actions);
            approve.addEventListener("click", function () {
              X.api.posts
                .modReview(post.id, "approve", token)
                .then(function () {
                  card.remove();
                  renderTray();
                })
                .catch(function () {});
            });
            reject.addEventListener("click", function () {
              X.api.posts
                .modReview(post.id, "reject", token)
                .then(function () {
                  card.remove();
                })
                .catch(function () {});
            });
            pendingList.appendChild(card);
          });
        })
        .catch(function () {
          pendingList.innerHTML = "";
          pendingList.appendChild(utils.el("p", "pt-none", "No se pudo cargar la bandeja."));
        });

      X.api.posts
        .modApproved(token)
        .then(function (d) {
          var items = d.posts || [];
          approvedList.innerHTML = "";
          if (!items.length) {
            approvedList.appendChild(utils.el("p", "pt-none", "No hay aportes aprobados."));
            return;
          }
          items.forEach(function (post) {
            var card = postCard(post, false);
            var row = utils.el("div", "pt-publish");
            var copyMd = utils.el("button", "pt-copy", "Copiar Markdown");
            copyMd.type = "button";
            var copyHtml = utils.el("button", "pt-copy", "Copiar HTML");
            copyHtml.type = "button";
            var urlInput = utils.el("input", "pt-url");
            urlInput.placeholder = "URL del post publicado en Blogger";
            urlInput.value = post.postUrl || "";
            var saveUrl = utils.el("button", "pt-save-url", "Guardar");
            saveUrl.type = "button";
            row.appendChild(copyMd);
            row.appendChild(copyHtml);
            row.appendChild(urlInput);
            row.appendChild(saveUrl);
            card.appendChild(row);
            copyMd.addEventListener("click", function () {
              copyText(post.body, function () {
                feedback(copyMd, "Copiado");
              });
            });
            copyHtml.addEventListener("click", function () {
              copyText(renderMarkdown(post.body, true), function () {
                feedback(copyHtml, "Copiado");
              });
            });
            saveUrl.addEventListener("click", function () {
              X.api.posts
                .setUrl(post.id, urlInput.value.trim(), token)
                .then(function () {
                  feedback(saveUrl, "Guardado");
                })
                .catch(function () {});
            });
            approvedList.appendChild(card);
          });
        })
        .catch(function () {});
    }

    function refreshTray() {
      if (!modList.hidden) renderTray();
    }

    modToggle.addEventListener("click", function () {
      modList.hidden = !modList.hidden;
      if (!modList.hidden) renderTray();
    });

    var unbindAuth = X.auth.onAuthChange(function () {
      renderAuth();
      if (!modList.hidden) renderTray();
    });

    renderAuth();
    renderTray();

    return {
      root: root,
      destroy: function () {
        unbindAuth();
      },
    };
  }

  function init() {
    utils.qsa("#post-tool").forEach(function (container) {
      if (container.getAttribute("data-xogalaxy-mounted")) return;
      container.setAttribute("data-xogalaxy-mounted", "1");
      var inst = create(container);
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
  X.posts = { init: init, reset: reset };
})(window);
