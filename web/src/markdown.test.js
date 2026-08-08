import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./core.js";
import "./markdown.js";

const VENDOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../vendor");

function loadVendored() {
  const code =
    fs.readFileSync(path.join(VENDOR_DIR, "marked.min.js"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(VENDOR_DIR, "dompurify.min.js"), "utf8");
  new Function(code)();
}

describe("markdown", () => {
  beforeEach(() => {
    delete window.marked;
    delete window.DOMPurify;
  });

  it("sin marked degrada a texto escapado", () => {
    expect(window.XOGalaxy.markdown.render("<script>alert(1)</script>")).toContain("&lt;script&gt;");
  });

  it("render con marked produce HTML común", () => {
    loadVendored();
    const html = window.XOGalaxy.markdown.render("# Título\n\n**negrita** y `code`", { sanitize: true });
    expect(html).toContain("<h1>Título</h1>");
    expect(html).toContain("<strong>negrita</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("breaks:true convierte saltos de línea en <br>", () => {
    loadVendored();
    const html = window.XOGalaxy.markdown.render("una línea\notra", { sanitize: true });
    expect(html).toContain("<br>");
  });

  it("sanitize purga script, iframes y onclick", () => {
    loadVendored();
    const html = window.XOGalaxy.markdown.render(
      "texto <script>alert(1)</script> <iframe src='https://evil'></iframe> <img src=x onclick=alert(1)>",
      { sanitize: true }
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("onclick");
    expect(html).toContain("texto");
  });

  it("sin sanitize deja pasar el HTML crudo (uso del preview propio)", () => {
    loadVendored();
    const html = window.XOGalaxy.markdown.render("**x**", { sanitize: false });
    expect(html).toContain("<strong>x</strong>");
  });
});
