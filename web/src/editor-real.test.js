// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createEditor } from "./editor.js";

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
});