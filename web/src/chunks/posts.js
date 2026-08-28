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
  var STATUS = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };
  var STATUS_LABEL = { pending: "pendiente", approved: "aprobado", rejected: "rechazado" };
  var live = [];
  var modalOpenCount = 0;

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

  var MENTION_RE = /(^|\s)(@[\p{L}\p{N}][\p{L}\p{N}_.-]{1,31})/gu;
  function highlightMentions(el) {
    var walker = global.document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (textNode) {
      if (!textNode.nodeValue || textNode.nodeValue.indexOf("@") === -1) return;
      MENTION_RE.lastIndex = 0;
      if (!MENTION_RE.test(textNode.nodeValue)) return;
      MENTION_RE.lastIndex = 0;
      var frag = global.document.createDocumentFragment();
      var last = 0;
      var m;
      while ((m = MENTION_RE.exec(textNode.nodeValue)) !== null) {
        if (m.index > last) frag.appendChild(global.document.createTextNode(textNode.nodeValue.slice(last, m.index)));
        var span = global.document.createElement("span");
        span.className = "chat-mention";
        span.textContent = m[2];
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < textNode.nodeValue.length) frag.appendChild(global.document.createTextNode(textNode.nodeValue.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function renderMarkdown(text, sanitize) {
    if (X.markdown && X.markdown.render) {
      try {
        return X.markdown.render(text, { gfm: true, breaks: false, sanitize: !!sanitize });
      } catch (err) {}
    }
    return utils.escHtml(text);
  }

  function postCard(p) {
    var card = utils.el("div", "pt-post");
    if (p.status === STATUS.PENDING) card.classList.add("pt-post-pending");
    if (p.status === STATUS.REJECTED) card.classList.add("pt-post-rejected");
    var h = utils.el("div", "pt-post-head");
    var t = utils.el("h3", "pt-post-title", p.title);
    var meta = utils.el("div", "pt-post-meta");
    var authorWrap = utils.el("span", "pt-post-author-wrap");
    authorWrap.style.cursor = "pointer";
    authorWrap.style.display = "inline-flex";
    authorWrap.style.alignItems = "center";
    authorWrap.style.gap = "5px";
    if (p.author && p.author.picture) {
      var avatar = utils.el("img", "pt-post-avatar");
      avatar.src = p.author.picture;
      avatar.alt = p.author.name || "";
      authorWrap.appendChild(avatar);
    }
    var nameSpan = utils.el("span", "pt-post-author-name", (p.author && p.author.name) || "Anónimo");
    authorWrap.appendChild(nameSpan);
    authorWrap.addEventListener("click", function () {
      if (p.author && (p.author.sub || p.author.visitor)) {
        X.posts.showProfile({ sub: p.author.sub, visitor: p.author.visitor, name: p.author.name, picture: p.author.picture });
      }
    });
    meta.appendChild(authorWrap);
    var badge = utils.el("span", "pt-post-status " + p.status, STATUS_LABEL[p.status] || p.status);
    h.appendChild(t);
    h.appendChild(meta);
    h.appendChild(badge);
    card.appendChild(h);
    var body = utils.el("div", "pt-post-body");
    body.innerHTML = renderMarkdown(p.body, true);
    highlightMentions(body);
    card.appendChild(body);
    var when = utils.el("time", "pt-post-when");
    try {
      when.textContent = new Date(p.createdAt).toLocaleString();
    } catch (err) {}
    card.appendChild(when);
    return card;
  }

  function create(container) {
    var root = utils.el("div", "post-tool");

    var head = utils.el("div", "pt-head");
    var title = utils.el("h2", "pt-title", "Aportá un post");
    var intro = utils.el(
      "p",
      "pt-intro",
      "Escribí tu aporte en Markdown: un juego, una actividad, un tutorial o un hallazgo perdido (lost media) de la era XO. Quedará en revisión y, si se aprueba, se publicará en el blog."
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

    var editorWrap = utils.el("div", "pt-editor-wrap");
    var bar = utils.el("div", "pt-toolbar");
    var charCount = utils.el("span", "pt-char-count");
    charCount.textContent = "0 / " + POST_BODY_MAX;

    var editorContainer = utils.el("div", "pt-editor");
    var fallbackBody = utils.el("textarea", "pt-body-fallback");
    fallbackBody.hidden = true;
    fallbackBody.maxLength = POST_BODY_MAX;
    fallbackBody.placeholder = "Escribí tu aporte…";
    editorWrap.appendChild(bar);
    editorWrap.appendChild(editorContainer);
    editorWrap.appendChild(fallbackBody);
    editorWrap.appendChild(charCount);

    var status = utils.el("p", "pt-status");
    status.hidden = true;
    var submit = utils.el("button", "pt-submit", "Enviar aporte");
    submit.type = "submit";

    form.appendChild(titleInput);
    form.appendChild(editorWrap);
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

    // ---- mis aportes (historial + filtros) ----
    var myWrap = utils.el("div", "pt-my");
    var myToggle = utils.el("button", "pt-my-toggle", "Mis aportes");
    myToggle.type = "button";
    var myList = utils.el("div", "pt-my-list");
    myList.hidden = true;
    myWrap.appendChild(myToggle);
    myWrap.appendChild(myList);
    root.appendChild(myWrap);

    container.appendChild(root);

    // ---- Tiptap editor (lazy load) ----
    var editor = null;
    var uploading = false;
    var htmlToMd = null;

    function updateCharCount() {
      if (!editor) return;
      var count = editor.storage.characterCount.characters();
      charCount.textContent = count + " / " + POST_BODY_MAX;
      charCount.className = "pt-char-count" + (count > POST_BODY_MAX ? " over" : count > POST_BODY_MAX * 0.9 ? " warn" : "");
    }

    function buildToolbar() {
      if (!editor) return;
      bar.innerHTML = "";
      var btns = [
        { label: "B", cmd: function () { editor.chain().focus().toggleBold().run(); }, active: "bold", title: "Negrita" },
        { label: "I", cmd: function () { editor.chain().focus().toggleItalic().run(); }, active: "italic", title: "Cursiva" },
        { label: "U", cmd: function () { editor.chain().focus().toggleUnderline().run(); }, active: "underline", title: "Subrayado" },
        { label: "S", cmd: function () { editor.chain().focus().toggleStrike().run(); }, active: "strike", title: "Tachado" },
        null,
        { label: "H2", cmd: function () { editor.chain().focus().toggleHeading({ level: 2 }).run(); }, active: "heading", title: "Título 2" },
        { label: "H3", cmd: function () { editor.chain().focus().toggleHeading({ level: 3 }).run(); }, active: "heading", title: "Título 3" },
        null,
        { label: "•", cmd: function () { editor.chain().focus().toggleBulletList().run(); }, active: "bulletList", title: "Lista" },
        { label: "1.", cmd: function () { editor.chain().focus().toggleOrderedList().run(); }, active: "orderedList", title: "Lista numerada" },
        { label: ">", cmd: function () { editor.chain().focus().toggleBlockquote().run(); }, active: "blockquote", title: "Cita" },
        null,
        { label: "&lt;/&gt;", cmd: function () { editor.chain().focus().toggleCodeBlock().run(); }, active: "codeBlock", title: "Bloque de código" },
        { label: "—", cmd: function () { editor.chain().focus().setHorizontalRule().run(); }, title: "Línea" },
        null,
        { label: "📎", cmd: function () { var url = global.prompt("URL de la imagen:"); if (url) editor.chain().focus().setImage({ src: url }).run(); }, title: "Imagen" },
        { label: "↩", cmd: function () { editor.chain().focus().undo().run(); }, title: "Deshacer" },
        { label: "↪", cmd: function () { editor.chain().focus().redo().run(); }, title: "Rehacer" },
      ];
      btns.forEach(function (def) {
        if (!def) {
          var sep = utils.el("span", "pt-toolbar-sep");
          bar.appendChild(sep);
          return;
        }
        var b = utils.el("button", "", "");
        b.type = "button";
        b.innerHTML = def.label;
        b.title = def.title;
        b.setAttribute("aria-label", def.title);
        b.addEventListener("click", function (e) {
          e.preventDefault();
          def.cmd();
        });
        if (def.active) {
          editor.on("selectionUpdate", function () {
            b.classList.toggle("active", editor.isActive(def.active));
          });
        }
        bar.appendChild(b);
      });
    }

    var MAX_IMG_DIM = 1600;

    function prepareImage(file) {
      if (!file || !file.type.startsWith("image/")) return Promise.resolve(file);
      if (file.type === "image/gif") return Promise.resolve(file);
      if (!window.Image || !document.createElement("canvas").getContext) return Promise.resolve(file);
      return new Promise(function (resolve) {
        var url;
        try { url = URL.createObjectURL(file); } catch (err) { resolve(file); return; }
        var img = new window.Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          var ratio = Math.min(1, MAX_IMG_DIM / w, MAX_IMG_DIM / h);
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * ratio));
          canvas.height = Math.max(1, Math.round(h * ratio));
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (blob) {
            if (blob && blob.type === "image/webp" && blob.size > 0) resolve(blob);
            else resolve(file);
          }, "image/webp", 0.86);
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
      });
    }

    function imageNodePos(src) {
      var pos = null;
      editor.state.doc.descendants(function (node, p) {
        if (node.type.name === "image" && node.attrs.src === src) { pos = p; return false; }
        return true;
      });
      return pos;
    }

    function uploadImageFile(file) {
      if (uploading || !file || !file.type.startsWith("image/")) return;
      uploading = true;
      var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
      if (!token) { uploading = false; return; }
      var previewUrl = URL.createObjectURL(file);
      setStatus("Subiendo imagen…");
      editor.chain().focus().setImage({ src: previewUrl, alt: "Subiendo…" }).run();
      prepareImage(file)
        .then(function (blob) { return X.api.images.upload(blob, token); })
        .then(function (d) {
          var pos = imageNodePos(previewUrl);
          if (pos !== null) {
            var tr = editor.state.tr;
            tr.setNodeAttribute(pos, "src", d.url);
            tr.setNodeAttribute(pos, "alt", "");
            editor.view.dispatch(tr);
            editor.chain().focus().run();
          }
          setStatus("");
        })
        .catch(function () {
          var pos = imageNodePos(previewUrl);
          if (pos !== null) {
            var node = editor.state.doc.nodeAt(pos);
            var end = pos + (node ? node.nodeSize : 1);
            var tr = editor.state.tr;
            tr.delete(pos, end);
            editor.view.dispatch(tr);
          }
          setStatus("No se pudo subir la imagen.", "error");
        })
        .finally(function () {
          URL.revokeObjectURL(previewUrl);
          uploading = false;
        });
    }

    var TIPTAP_URL =
      (window.XOGALAXY_CONFIG && window.XOGALAXY_CONFIG.tiptap) || "https://backend.xogalaxy.workers.dev/dist/tiptap.js";

    function loadTiptap(callback) {
      if (editor) { callback(); return; }
      import(TIPTAP_URL).then(function (mod) {
        editor = mod.createEditor(editorContainer, {
          maxChars: POST_BODY_MAX,
          suggestUsers: function (q) {
            return X.api.suggest(q.query || q).then(function (d) {
              return (d.users || []).map(function (u) {
                return { id: u.sub, label: (u.name || "").split(/\s+/)[0].slice(0, 32), picture: u.picture || "" };
              });
            });
          },
          onUpdate: function () { updateCharCount(); },
        });
        htmlToMd = mod.htmlToMarkdown;
        buildToolbar();
        editorContainer.addEventListener("drop", function (e) {
          var files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) { e.preventDefault(); uploadImageFile(files[0]); }
        });
        editorContainer.addEventListener("paste", function (e) {
          var files = e.clipboardData && e.clipboardData.files;
          if (files && files.length) { e.preventDefault(); uploadImageFile(files[0]); }
        });
        callback();
      }).catch(function () { callback(); });
    }

    loadTiptap(function () {});

    function setStatus(text, cls) {
      status.textContent = text;
      status.hidden = !text;
      status.className = "pt-status" + (cls ? " " + cls : "");
    }

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
      var body = "";
      if (editor) {
        var html = editor.getHTML();
        body = (htmlToMd ? htmlToMd(html) : html).trim().slice(0, POST_BODY_MAX);
      } else if (fallbackBody) {
        body = fallbackBody.value.trim().slice(0, POST_BODY_MAX);
      }
      if (!t || !body) {
        setStatus("Completá el título y el contenido.", "error");
        return;
      }
      var p = X.auth.getProfile();
      var payload = { title: t, body: body };
      if (p) payload.token = X.auth.getToken();
      else {
        payload.name = nameInput.value.trim().slice(0, 40) || "";
        if (X.identity && X.identity.visitorId) payload.visitor = X.identity.visitorId();
      }
      submit.disabled = true;
      X.api.posts
        .create(payload)
        .then(function (d) {
          titleInput.value = "";
          if (editor) editor.commands.setContent("<p></p>");
          updateCharCount();
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

    // ---- bandeja ----
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
            var card = postCard(post);
            var actions = utils.el("div", "pt-actions");
            var approve = utils.el("button", "pt-approve", "Aprobar");
            approve.type = "button";
            var reject = utils.el("button", "pt-reject", "Rechazar");
            reject.type = "button";
            actions.appendChild(approve);
            actions.appendChild(reject);
            card.appendChild(actions);
            approve.addEventListener("click", function () {
              approve.disabled = true;
              approve.textContent = "Publicando…";
              X.api.posts
                .modReview(post.id, "approve", token)
                .then(function (d) {
                  if (d && d.published) {
                    approve.textContent = "Publicado en Blogger ✓";
                    approve.style.color = "var(--signal)";
                  } else if (d && d.error) {
                    approve.textContent = "Aprobado (Blogger: " + d.error.slice(0, 40) + ")";
                    approve.style.color = "var(--orbit)";
                  } else {
                    approve.textContent = "Aprobado";
                  }
                  setTimeout(function () {
                    card.remove();
                    renderTray();
                  }, 1200);
                })
                .catch(function () {
                  approve.disabled = false;
                  approve.textContent = "Aprobar";
                });
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
            var card = postCard(post);
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

    // ---- mis aportes ----
    var myFilter = "all";

    function renderMyList() {
      myList.innerHTML = "";
      var filters = utils.el("div", "pt-filters");
      [
        { key: "all", label: "Todos" },
        { key: STATUS.PENDING, label: "Pendientes" },
        { key: STATUS.APPROVED, label: "Aprobados" },
        { key: STATUS.REJECTED, label: "Rechazados" },
      ].forEach(function (s) {
        var b = utils.el("button", "pt-filter" + (myFilter === s.key ? " active" : ""), s.label);
        b.type = "button";
        b.addEventListener("click", function () {
          myFilter = s.key;
          renderMyList();
        });
        filters.appendChild(b);
      });
      myList.appendChild(filters);
      var list = utils.el("div", "pt-my-items");
      myList.appendChild(list);

      var p = X.auth.getProfile();
      var token = p ? X.auth.getToken() : null;
      var visitor = X.identity && X.identity.visitorId ? X.identity.visitorId() : "";
      X.api.posts
        .my(token, visitor)
        .then(function (d) {
          var items = (d.posts || []).filter(function (post) {
            return myFilter === "all" || post.status === myFilter;
          });
          list.innerHTML = "";
          if (!items.length) {
            list.appendChild(
              utils.el(
                "p",
                "pt-none",
                myFilter === "all" ? "Todavía no hiciste aportes." : "No hay aportes en este estado."
              )
            );
            return;
          }
          items.forEach(function (post) {
            list.appendChild(postCard(post));
          });
        })
        .catch(function () {
          list.innerHTML = "";
          list.appendChild(utils.el("p", "pt-none", "No se pudieron cargar tus aportes."));
        });
    }

    myToggle.addEventListener("click", function () {
      myList.hidden = !myList.hidden;
      if (!myList.hidden) renderMyList();
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

  // ---- perfil + aportes (dialog) ----
  function currentMe() {
    var p = X.auth.getProfile();
    if (p) return { sub: p.sub, visitor: null, name: p.name, picture: p.picture };
    return { sub: null, visitor: X.identity.visitorId(), name: X.identity.guestName(), picture: null };
  }

  function profileIcon(target) {
    var i = utils.el("span", "pt-avatar-lg");
    if (target.picture) {
      var img = utils.el("img", "pt-avatar-lg-img");
      img.src = target.picture;
      img.alt = target.name || "";
      img.loading = "lazy";
      i.appendChild(img);
    } else {
      i.textContent = (target.name || "?").charAt(0).toUpperCase();
    }
    return i;
  }

  function buildFollowButton() {
    var btn = utils.el("button", "pt-profile-follow");
    btn.type = "button";
    var state = false;
    var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
    function paint(following) {
      state = following;
      btn.classList.toggle("following", following);
      btn.innerHTML = following
        ? '<i data-lucide="user-check"/>Siguiendo'
        : '<i data-lucide="user-plus"/>Seguir';
      if (X.core && X.core.initIcons) X.core.initIcons();
    }
    btn.addEventListener("click", function () {
      if (!token) {
        if (X.auth && X.auth.login) X.auth.login();
        return;
      }
      btn.disabled = true;
      var req = state ? X.api.followersUnfollow(token) : X.api.followersFollow(token);
      req
        .then(function (d) {
          paint(!!d.following);
        })
        .catch(function () {})
        .then(function () {
          btn.disabled = false;
        });
    });
    if (token) {
      X.api.followersMe(token)
        .then(function (d) {
          paint(!!d.following);
        })
        .catch(function () {
          paint(false);
        });
    } else {
      paint(false);
    }
    return btn;
  }

  function showProfile(target) {
    target = target || {};
    var me = currentMe();
    var self =
      (target.sub && me.sub && target.sub === me.sub) ||
      (target.visitor && me.visitor && target.visitor === me.visitor);

    var backdrop = utils.el("div", "pt-modal-backdrop");
    var modal = utils.el("div", "pt-modal pt-profile-modal");
    var head = utils.el("div", "pt-modal-head");
    var title = utils.el("h3", "pt-modal-title", "Perfil");
    var close = utils.el("button", "pt-modal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Cerrar");
    head.appendChild(title);
    head.appendChild(close);
    var body = utils.el("div", "pt-modal-body");
    body.appendChild(utils.el("p", "pt-none", "Cargando…"));
    modal.appendChild(head);
    modal.appendChild(body);
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-label", "Perfil");
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    var lastFocus = document.activeElement;
    modalOpenCount += 1;
    document.body.classList.add("pt-open");

    function closeModal() {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      modalOpenCount -= 1;
      if (modalOpenCount <= 0) {
        modalOpenCount = 0;
        document.body.classList.remove("pt-open");
      }
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", trapFocus, true);
      if (lastFocus && lastFocus.focus) {
        try {
          lastFocus.focus();
        } catch (err) {}
      }
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeModal();
      }
    }
    function trapFocus(e) {
      if (backdrop.contains(e.target)) return;
      e.stopPropagation();
      var first = utils.qs(".pt-modal-close", backdrop);
      if (first) first.focus();
    }
    close.addEventListener("click", closeModal);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", trapFocus, true);
    close.focus();

    var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
    var visitor = me.visitor;
    var profile = null;

    function renderHeader() {
      var headEl = utils.el("div", "pt-profile-head");
      var nameRow = utils.el("div", "pt-profile-id");
      var n = utils.el("span", "pt-profile-name", profile.name || target.name || "Anónimo");
      nameRow.appendChild(n);
      if (target.sub) {
        var badge = utils.el("span", "pt-profile-badge", "verificado");
        nameRow.appendChild(badge);
      }
      if (profile.isOwner) {
        var ownerBadge = utils.el("span", "pt-profile-badge pt-profile-badge-owner", "owner");
        nameRow.appendChild(ownerBadge);
      }
      headEl.appendChild(profileIcon({ name: profile.name || target.name, picture: profile.picture || target.picture }));
      headEl.appendChild(nameRow);
      if (profile.bio) {
        var bio = utils.el("p", "pt-profile-bio", profile.bio);
        headEl.appendChild(bio);
      }
      return headEl;
    }

    function renderPosts(list, emptyText) {
      var wrap = utils.el("div", "pt-profile-posts");
      if (!list.length) {
        wrap.appendChild(utils.el("p", "pt-none", emptyText));
        return wrap;
      }
      list.forEach(function (post) {
        wrap.appendChild(postCard(post));
      });
      return wrap;
    }

    function renderSelf() {
      body.innerHTML = "";
      body.appendChild(renderHeader());

      var editBtn = utils.el("button", "pt-profile-edit", "Editar perfil");
      editBtn.type = "button";
      body.appendChild(editBtn);

      var form = utils.el("form", "pt-profile-form");
      form.hidden = true;
      var nameInput = utils.el("input", "pt-name pt-profile-field");
      nameInput.maxLength = 40;
      nameInput.value = profile.name || "";
      var bioInput = utils.el("textarea", "pt-profile-bio-input pt-profile-field");
      bioInput.maxLength = 300;
      bioInput.placeholder = "Un poco sobre vos… (opcional)";
      bioInput.value = profile.bio || "";
      var picInput = utils.el("input", "pt-name pt-profile-field");
      picInput.maxLength = 500;
      picInput.placeholder = "URL de tu foto (opcional)";
      picInput.value = profile.picture || "";
      var formStatus = utils.el("p", "pt-status");
      formStatus.hidden = true;
      var formBar = utils.el("div", "pt-profile-formbar");
      var save = utils.el("button", "pt-submit", "Guardar");
      save.type = "submit";
      var cancel = utils.el("button", "pt-cancel", "Cancelar");
      cancel.type = "button";
      formBar.appendChild(save);
      formBar.appendChild(cancel);
      form.appendChild(nameInput);
      form.appendChild(bioInput);
      form.appendChild(picInput);
      form.appendChild(formStatus);
      form.appendChild(formBar);
      body.appendChild(form);

      editBtn.addEventListener("click", function () {
        form.hidden = false;
        editBtn.hidden = true;
        nameInput.focus();
      });
      cancel.addEventListener("click", function () {
        form.hidden = true;
        editBtn.hidden = false;
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        save.disabled = true;
        formStatus.hidden = false;
        formStatus.textContent = "Guardando…";
        formStatus.className = "pt-status";
        var payload = {
          name: nameInput.value.trim(),
          bio: bioInput.value.trim(),
          picture: picInput.value.trim(),
        };
        if (token) payload.token = token;
        else payload.visitor = visitor;
        X.api.profiles
          .save(payload)
          .then(function () {
            if (token) {
              var p = X.auth.getProfile();
              if (p) X.auth._setProfile(Object.assign({}, p, payload));
              else if (X.auth._emit) X.auth._emit();
            } else {
              if (X.identity && X.identity.setGuestName) {
                X.identity.setGuestName(payload.name);
              }
              if (X.auth._emit) X.auth._emit();
            }
            closeModal();
            showProfile({ sub: target.sub, visitor: target.visitor, name: payload.name, picture: payload.picture });
          })
          .catch(function () {
            formStatus.textContent = "No se pudo guardar. Intentá de nuevo.";
            formStatus.className = "pt-status error";
            save.disabled = false;
          });
      });

      var sub = utils.el("h4", "pt-profile-sub", "Mis aportes");
      body.appendChild(sub);
      var myWrap = utils.el("div", "pt-profile-posts");
      myWrap.appendChild(utils.el("p", "pt-none", "Cargando…"));
      body.appendChild(myWrap);
      X.api.posts
        .my(token, token ? null : visitor)
        .then(function (d) {
          myWrap.innerHTML = "";
          myWrap.appendChild(renderPosts(d.posts || [], "Todavía no hiciste aportes."));
        })
        .catch(function () {
          myWrap.innerHTML = "";
          myWrap.appendChild(utils.el("p", "pt-none", "No se pudieron cargar tus aportes."));
        });
    }

    function renderOther() {
      body.innerHTML = "";
      body.appendChild(renderHeader());
      var token = X.auth && X.auth.getToken ? X.auth.getToken() : null;
      if (token) {
        body.appendChild(buildFollowButton());
      }
      var sub = utils.el("h4", "pt-profile-sub", "Aportes publicados");
      body.appendChild(sub);
      var listWrap = utils.el("div", "pt-profile-posts");
      listWrap.appendChild(utils.el("p", "pt-none", "Cargando…"));
      body.appendChild(listWrap);
      X.api.posts
        .byAuthor(target.sub, token)
        .then(function (d) {
          listWrap.innerHTML = "";
          listWrap.appendChild(renderPosts(d.posts || [], "Todavía no hay aportes publicados de esta persona."));
        })
        .catch(function () {
          listWrap.innerHTML = "";
          listWrap.appendChild(utils.el("p", "pt-none", "No se pudieron cargar los aportes."));
        });
    }

    function renderAnonOther() {
      body.innerHTML = "";
      body.appendChild(renderHeader());
      body.appendChild(utils.el("p", "pt-none", "Este visitante no tiene perfil público."));
    }

    var q = target.sub ? { sub: target.sub } : { visitor: target.visitor };
    X.api.profiles
      .get(q)
      .then(function (d) {
        if (d.profile) {
          profile = d.profile;
          self = typeof d.profile.isSelf === "boolean" ? d.profile.isSelf : self;
        } else {
          profile = { name: target.name || "Anónimo", bio: "", picture: target.picture || null, isOwner: false };
        }
        if (self) renderSelf();
        else if (target.sub) renderOther();
        else renderAnonOther();
      })
      .catch(function () {
        profile = { name: target.name || "Anónimo", bio: "", picture: target.picture || null, isOwner: false };
        if (self) renderSelf();
        else if (target.sub) renderOther();
        else renderAnonOther();
      });
  }

  function showAuthor(sub, name) {
    showProfile({ sub: sub, name: name });
  }

  function reset() {
    live.forEach(function (inst) {
      inst.destroy();
    });
    live = [];
  }

  X.hooks.add("swap", init);
  X.posts = { init: init, reset: reset, showProfile: showProfile, showAuthor: showAuthor };
})(window);
