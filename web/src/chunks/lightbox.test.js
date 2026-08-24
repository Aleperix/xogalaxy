import { beforeEach, describe, expect, it } from "vitest";
import "../core.js";
import "./lightbox.js";

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function stubDom() {
  document.body.innerHTML = `
    <main>
      <article class="post-body">
        ${esc("<p>hola</p>")}
        <img id="a" src="https://example.com/a.png" alt="Captura A"/>
        <a href="https://example.com/post"><img id="b" src="https://example.com/b.png" alt="Con link"/></a>
      </article>
      <div class="chat-msg-body"><img id="c" src="https://example.com/c.png"/></div>
      <span class="chat-avatar-wrap"><img id="d" src="https://example.com/d.png"/></span>
    </main>
  `;
}

describe("chunk lightbox", () => {
  let initialized = false;
  beforeEach(() => {
    document.body.innerHTML = "";
    window.XOGalaxy.lightbox.reset();
    if (!initialized) {
      window.XOGalaxy.lightbox.init();
      initialized = true;
    }
  });

  it("no abre al hacer click en una imagen dentro de un enlace", () => {
    stubDom();
    const link = document.querySelector("a[href]");
    link.addEventListener("click", (e) => e.preventDefault());
    const img = document.querySelector("#b");
    img.click();
    expect(document.querySelector(".lb-backdrop")).toBeNull();
  });

  it("abre el visor al click en imagen de post y arma el grupo", () => {
    stubDom();
    document.querySelector("#a").click();
    const backdrop = document.querySelector(".lb-backdrop");
    expect(backdrop).toBeTruthy();
    expect(document.querySelector(".lb-img").src).toContain("a.png");
    // grupo: a y c son elegibles; b está dentro de un enlace
    expect(document.querySelector(".lb-counter").textContent).toBe("1 / 2");
    expect(document.body.classList.contains("lb-open")).toBe(true);
  });

  it("navega con siguiente/anterior y cierra con ESC", () => {
    stubDom();
    document.querySelector("#a").click();
    document.querySelector(".lb-next").click();
    expect(document.querySelector(".lb-img").src).toContain("c.png");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.querySelector(".lb-img").src).toContain("a.png");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".lb-backdrop")).toBeNull();
    expect(document.body.classList.contains("lb-open")).toBe(false);
  });

  it("click en la imagen alterna zoom, click fuera cierra", () => {
    stubDom();
    document.querySelector("#c").click();
    const img = document.querySelector(".lb-img");
    img.click();
    expect(img.classList.contains("lb-zoom")).toBe(true);
    img.click();
    expect(img.classList.contains("lb-zoom")).toBe(false);
    document.querySelector(".lb-backdrop").click();
    expect(document.querySelector(".lb-backdrop")).toBeNull();
  });

  it("marca con lb-thumb solo las imágenes elegibles", () => {
    stubDom();
    window.XOGalaxy.hooks.run("swap");
    expect(document.querySelector("#a").classList.contains("lb-thumb")).toBe(true);
    expect(document.querySelector("#b").classList.contains("lb-thumb")).toBe(false);
    expect(document.querySelector("#c").classList.contains("lb-thumb")).toBe(true);
    expect(document.querySelector("#d").classList.contains("lb-thumb")).toBe(false); // no está en contenedores permitidos
  });

  it("muestra el alt como caption y oculta botones de navegación si hay una sola", () => {
    document.body.innerHTML = `<main><div class="post-body"><img id="solo" src="https://example.com/solo.png" alt="Unica foto"/></div></main>`;
    document.querySelector("#solo").click();
    expect(document.querySelector(".lb-caption").textContent).toBe("Unica foto");
    expect(document.querySelector(".lb-caption").hidden).toBe(false);
    expect(document.querySelector(".lb-prev").hidden).toBe(true);
    expect(document.querySelector(".lb-next").hidden).toBe(true);
  });
});
