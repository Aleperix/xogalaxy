import { beforeEach, describe, expect, it } from "vitest";
import "./core.js";

describe("core utils", () => {
  it("escHtml escapa caracteres HTML", () => {
    const { escHtml } = window.XOGalaxy.core.utils;
    expect(escHtml("<b>x & y</b>")).toBe("&lt;b&gt;x &amp; y&lt;/b&gt;");
    expect(escHtml('"a" & \'b\'')).toBe("&quot;a&quot; &amp; &#39;b&#39;");
  });

  it("fmt abrevia miles", () => {
    const { fmt } = window.XOGalaxy.core.utils;
    expect(fmt(12)).toBe("12");
    expect(fmt(999)).toBe("999");
    expect(fmt(1200)).toBe("1.2k");
    expect(fmt(12345)).toBe("12.3k");
  });

  it("hooks registran y ejecutan suscritores", () => {
    const seen = [];
    window.XOGalaxy.core.hooks.add("swap", () => seen.push(1));
    window.XOGalaxy.core.hooks.add("swap", () => seen.push(2));
    window.XOGalaxy.core.hooks.run("swap");
    expect(seen).toEqual([1, 2]);
  });

  it("un hook que lanza error no rompe el resto", () => {
    const seen = [];
    window.XOGalaxy.core.hooks.add("swap", () => {
      throw new Error("boom");
    });
    window.XOGalaxy.core.hooks.add("swap", () => seen.push("ok"));
    window.XOGalaxy.core.hooks.run("swap");
    expect(seen).toEqual(["ok"]);
  });
});

describe("core DOM helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("animateStat escribe el valor final con reduce-motion", () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const el = document.createElement("div");
    document.body.appendChild(el);
    window.XOGalaxy.core.utils.animateStat(el, 42);
    expect(el.textContent).toBe("42");
  });

  it("decorateTitle separa la primera palabra y no se repite", () => {
    document.body.innerHTML = '<h1 id="site-title">XO Galaxy Test</h1>';
    window.XOGalaxy.core.decorateTitle();
    const h1 = document.getElementById("site-title");
    expect(h1.querySelector(".text-signal").textContent).toBe("XO");
    expect(h1.getAttribute("data-decorated")).toBe("1");
    window.XOGalaxy.core.decorateTitle();
    expect(h1.querySelectorAll(".text-signal").length).toBe(1);
  });

  it("cleanupDownloadCache elimina recetas expiradas de cualquier juego", () => {
    localStorage.setItem("tbr_viejo", JSON.stringify({ t: Date.now() - 40 * 24 * 3600e3 }));
    localStorage.setItem("tbr_nuevo", JSON.stringify({ t: Date.now() }));
    localStorage.setItem("htb_viejo", JSON.stringify({ t: Date.now() - 40 * 24 * 3600e3 }));
    localStorage.setItem("xogalaxy.theme", "dark");
    window.XOGalaxy.core.cleanupDownloadCache();
    expect(localStorage.getItem("tbr_viejo")).toBeNull();
    expect(localStorage.getItem("tbr_nuevo")).not.toBeNull();
    expect(localStorage.getItem("htb_viejo")).toBeNull();
    expect(localStorage.getItem("xogalaxy.theme")).toBe("dark");
  });
});

describe("tema claro/oscuro", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<button id="theme-toggle" type="button"><i data-lucide="sun"></i></button>';
    localStorage.removeItem("xogalaxy.theme");
    document.documentElement.removeAttribute("data-theme");
  });

  it("aplica oscuro por defecto y persiste el cambio", () => {
    window.XOGalaxy.core.setupTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.getElementById("theme-toggle").click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("xogalaxy.theme")).toBe("light");
    expect(document.getElementById("theme-toggle").getAttribute("aria-label")).toBe("Cambiar a modo oscuro");
  });

  it("respeta el tema guardado en localStorage", () => {
    localStorage.setItem("xogalaxy.theme", "light");
    window.XOGalaxy.core.setupTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
