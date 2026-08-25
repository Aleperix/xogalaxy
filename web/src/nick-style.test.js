import { beforeEach, describe, expect, it } from "vitest";
import "./core.js";
import "./nick-style.js";

describe("nickStyle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function textOf(frag) {
    const wrap = document.createElement("span");
    wrap.appendChild(frag);
    return wrap;
  }

  it("colorea con códigos § y aplica formatos", () => {
    const el = textOf(window.XOGalaxy.nickStyle.render("§aBob§r x"));
    expect(el.textContent).toBe("Bob x");
    const spans = el.querySelectorAll("span.nick-fx");
    expect(spans[0].style.color).toBeTruthy();
    expect(spans[1].textContent).toBe(" x");
    expect(spans[1].style.color).toBe("");
  });

  it("negrita, itálica, subrayado y tachado se acumulan hasta §r", () => {
    const el = textOf(window.XOGalaxy.nickStyle.render("§l§o§n§mX§rY"));
    const s = el.querySelector("span");
    expect(s.style.fontWeight).toBe("700");
    expect(s.style.fontStyle).toBe("italic");
    expect(s.style.textDecoration).toContain("underline");
    expect(s.style.textDecoration).toContain("line-through");
    const spans = el.querySelectorAll("span.nick-fx");
    expect(spans[1].textContent).toBe("Y");
    expect(spans[1].style.fontWeight).toBe("");
  });

  it("descarta códigos desconocidos y escapa HTML", () => {
    const el = textOf(window.XOGalaxy.nickStyle.render('§z<img src=x>§cRojo'));
    expect(el.innerHTML).not.toContain("<img");
    expect(el.textContent).toBe("§z<img src=x>Rojo");
  });

  it("plain() quita los códigos y limita la longitud", () => {
    const ns = window.XOGalaxy.nickStyle;
    expect(ns.plain("§a§lBob")).toBe("Bob");
    expect(ns.plain("x".repeat(100)).length).toBe(64);
  });
});
