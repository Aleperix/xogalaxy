import { describe, expect, it, vi } from "vitest";

vi.mock("@tiptap/core", () => ({
  Editor: class {
    constructor(cfg) {
      this.cfg = cfg;
      this.chain = () => ({ focus: () => this, run: () => {} });
      this.commands = {};
      this.storage = {};
    }
  },
}));
vi.mock("@tiptap/starter-kit", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-image", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-placeholder", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-character-count", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-dropcursor", () => ({ default: { configure: () => ({}) } }));
vi.mock("@tiptap/extension-underline", () => ({ default: {} }));
vi.mock("@tiptap/extension-history", () => ({ default: {} }));
vi.mock("@tiptap/extension-mention", () => ({ default: { configure: () => ({}) } }));

import { htmlToMarkdown, createEditor } from "./editor.js";

describe("editor htmlToMarkdown", () => {
  it("convierte heading, bold y lista a markdown", () => {
    const md = htmlToMarkdown("<h2>Mi post</h2><p><strong>hola</strong> mundo</p><ul><li>a</li><li>b</li></ul>");
    expect(md).toContain("## Mi post");
    expect(md).toContain("**hola** mundo");
    expect(md).toMatch(/- {1,3}a/);
    expect(md).toMatch(/- {1,3}b/);
  });

  it("mencion con data-label se convierte a @nombre", () => {
    const md = htmlToMarkdown('<p>Hola <span class="tiptap-mention" data-label="Luna">@Luna</span> como va</p>');
    expect(md).toContain("@Luna");
    expect(md).not.toContain("tiptap-mention");
  });

  it("imagen marca con alt se convierte a markdown", () => {
    const md = htmlToMarkdown('<p><img src="https://cdn.x/r2/pic.webp" alt="mi foto"></p>');
    expect(md).toContain("![mi foto](https://cdn.x/r2/pic.webp)");
  });

  it("code block se convierte con fences", () => {
    const md = htmlToMarkdown("<pre><code>const a = 1;</code></pre>");
    expect(md).toContain("```");
    expect(md).toContain("const a = 1;");
  });

  it("cita se convierte a blockquote", () => {
    const md = htmlToMarkdown("<blockquote><p>Una idea</p></blockquote>");
    expect(md).toContain("> Una idea");
  });

  it("devuelve string vacío con null", () => {
    expect(htmlToMarkdown(null)).toBe("");
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("editor createEditor", () => {
  it("instancia sin explotar (mocks vacíos, sin DOM real)", () => {
    const editor = createEditor({}, { maxChars: 10 });
    expect(typeof editor).toBe("object");
  });
});