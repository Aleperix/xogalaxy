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
});