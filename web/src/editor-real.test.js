// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createEditor, htmlToMarkdown } from "./editor.js";

describe("editor real (sin mocks)", () => {
  it("instancia con tiptap real sin errores ni duplicates", () => {
    let warned = "";
    const orig = console.warn;
    console.warn = (...a) => { warned += a.join(" "); };
    try {
      const el = document.createElement("div");
      const editor = createEditor(el, {});
      expect(editor).toBeTruthy();
      expect(warned).not.toMatch(/Duplicate extension names/i);
    } finally {
      console.warn = orig;
    }
  });

  it("inserta imagenes como node <img> y las serializa a markdown (sin texto raw)", () => {
    const el = document.createElement("div");
    const editor = createEditor(el, {});
    editor.chain().focus().setImage({ src: "https://media.xogalaxy.workers.dev/images/abc.webp", alt: "" }).run();
    const html = editor.getHTML();
    expect(html).toContain('<img src="https://media.xogalaxy.workers.dev/images/abc.webp"');
    expect(html).not.toContain("![");
    const md = htmlToMarkdown(html);
    expect(md).toBe("![](https://media.xogalaxy.workers.dev/images/abc.webp)");
    editor.destroy();
  });

  it("activa heading por nivel H2/H3 de forma independiente", () => {
    const el = document.createElement("div");
    const editor = createEditor(el, {});
    editor.commands.setContent("<h2 id='a'>dos</h2><h3>tres</h3>");
    editor.chain().focus().setTextSelection({ from: 1, to: 2 }).run();
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
    expect(editor.isActive("heading", { level: 3 })).toBe(false);
    editor.chain().focus().setTextSelection({ from: 7, to: 8 }).run();
    expect(editor.isActive("heading", { level: 3 })).toBe(true);
    expect(editor.isActive("heading", { level: 2 })).toBe(false);
    editor.destroy();
  });

  it("convierte un enlace con titulo a markdown [texto](url \"title\")", () => {
    const el = document.createElement("div");
    const editor = createEditor(el, {});
    editor.chain().focus().setContent("<p>hola mundo</p>").selectAll().setLink({ href: "https://target.test", title: "Título" }).run();
    const html = editor.getHTML();
    expect(html).toContain('href="https://target.test" title="Título"');
    expect(htmlToMarkdown(html)).toContain('[hola mundo](https://target.test "Título")');
    editor.destroy();
  });

  it("envuelve una imagen en un enlace y serializa [![alt](src)](href)", () => {
    const el = document.createElement("div");
    const editor = createEditor(el, {});
    editor.chain().focus().setContent("<p>x</p>").setImage({ src: "https://media.xogalaxy.workers.dev/images/abc.webp", alt: "captura" }).run();
    let pos = null;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "image") { pos = p; return false; }
      return true;
    });
    expect(pos).not.toBeNull();
    const tr = editor.state.tr.delete(pos, pos + editor.state.doc.nodeAt(pos).nodeSize);
    editor.view.dispatch(tr);
    editor
      .chain()
      .focus()
      .insertContentAt(pos, {
        type: "image",
        attrs: { src: "https://media.xogalaxy.workers.dev/images/abc.webp", alt: "captura" },
        marks: [{ type: "link", attrs: { href: "https://source.test", title: "Fuente" } }],
      })
      .run();
    const html = editor.getHTML();
    expect(html).toMatch(/<a[^>]*href="https:\/\/source\.test"[^>]*title="Fuente"[^>]*><img src="https:\/\/media\.xogalaxy\.workers\.dev\/images\/abc\.webp"/);
    const md = htmlToMarkdown(html);
    expect(md).toContain('[![captura](https://media.xogalaxy.workers.dev/images/abc.webp)](https://source.test "Fuente")');
    editor.destroy();
  });
});