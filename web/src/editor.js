/**
 * XO Galaxy — Tiptap editor (lazy-loaded).
 * Exporta createEditor(el, opts) → Editor instance.
 * Se carga solo cuando #post-tool existe.
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Mention from "@tiptap/extension-mention";
import TurndownService from "turndown";

var turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

turndown.addRule("tiptapMention", {
  filter: function (node) {
    return node.classList && node.classList.contains("tiptap-mention");
  },
  replacement: function (content, node) {
    return "@" + (node.getAttribute("data-label") || node.textContent.replace(/^@/, ""));
  },
});

turndown.addRule("tiptapImage", {
  filter: "img",
  replacement: function (content, node) {
    var alt = node.getAttribute("alt") || "";
    var src = node.getAttribute("src") || "";
    return "![" + alt + "](" + src + ")";
  },
});

export function htmlToMarkdown(html) {
  return turndown.turndown(html || "").trim();
}

export function createEditor(el, opts) {
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true },
        dropcursor: { color: "var(--orbit)", width: 2 },
      }),
      Image.configure({ inline: true, allowBase64: false }),
      Placeholder.configure({
        placeholder: "Escribí tu aporte…",
      }),
      CharacterCount.configure({ limit: opts.maxChars || 20000 }),
      Mention.configure({
        HTMLAttributes: { class: "tiptap-mention" },
        suggestion: {
          char: "@",
          items: function (query) {
            return opts.suggestUsers ? opts.suggestUsers(query) : [];
          },
          render: function () {
            var component = null;
            var popup = null;
            return {
              onStart: function (props) {
                component = props;
                var items = props.items;
                var box = document.createElement("div");
                box.className = "pt-suggest";
                items.forEach(function (item, i) {
                  var btn = document.createElement("button");
                  btn.className = "pt-suggest-item";
                  btn.type = "button";
                  if (props.editor.storage.mention && props.editor.storage.mention.range) {
                    // selected via keyboard
                  }
                  btn.innerHTML =
                    '<img class="pt-suggest-avatar" src="' +
                    (item.picture || "") +
                    '" alt="" onerror="this.style.display=\'none\'">' +
                    '<span class="pt-suggest-name">' +
                    (item.label || item.id) +
                    "</span>";
                  btn.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    props.command({ id: item.id, label: item.label });
                  });
                  box.appendChild(btn);
                });
                var rect = props.clientRect && props.clientRect();
                if (rect) {
                  box.style.position = "fixed";
                  box.style.left = rect.left + "px";
                  box.style.top = rect.bottom + 4 + "px";
                }
                popup = box;
                document.body.appendChild(box);
              },
              onUpdate: function (props) {
                if (!popup) return;
                popup.innerHTML = "";
                props.items.forEach(function (item) {
                  var btn = document.createElement("button");
                  btn.className = "pt-suggest-item";
                  btn.type = "button";
                  btn.innerHTML =
                    '<img class="pt-suggest-avatar" src="' +
                    (item.picture || "") +
                    '" alt="" onerror="this.style.display=\'none\'">' +
                    '<span class="pt-suggest-name">' +
                    (item.label || item.id) +
                    "</span>";
                  btn.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    props.command({ id: item.id, label: item.label });
                  });
                  popup.appendChild(btn);
                });
              },
              onKeyDown: function (props) {
                if (props.event.key === "Escape") {
                  if (popup) popup.remove();
                  popup = null;
                  return true;
                }
                return false;
              },
              onExit: function () {
                if (popup) popup.remove();
                popup = null;
              },
            };
          },
          command: function (props) {
            var range = props.range;
            var editor = props.editor;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "mention", attrs: { id: props.id, label: props.label } },
                { type: "text", text: " " },
              ])
              .run();
          },
        },
      }),
    ],
    content: opts.content || "<p></p>",
    editorProps: {
      attributes: {
        class: "tiptap",
      },
    },
    onUpdate: function () {
      if (opts.onUpdate) opts.onUpdate();
    },
  });
}
