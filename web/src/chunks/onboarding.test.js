import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./identity.js";
import "./auth.js";
import "./onboarding.js";

function flush(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

function stubDom() {
  document.body.innerHTML = `
    <div class="main-nav"><a href="#chat">Chat</a><details class="dropdown"><summary>Descargas</summary></details></div>
    <button id="follow-btn">Seguir</button>
    <section id="participar"><h2>Participar</h2></section>
    <footer>
      <nav class="footer-nav">
        <a href="/p/condiciones-de-uso.html">Condiciones de uso</a>
        <a href="/p/politica-de-privacidad.html">Política de privacidad</a>
      </nav>
    </footer>
  `;
}

describe("chunk onboarding (tour de primera visita)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.XOGalaxy.auth.logout();
    window.XOGalaxy.onboarding.reset();
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ clientId: "fake-client" }), { status: 200 })
    );
  });

  it("no arranca si ya está completado", () => {
    localStorage.setItem("xogalaxy.onboardingDone", "1");
    stubDom();
    window.XOGalaxy.onboarding.start();
    expect(document.querySelector(".onb-host")).toBeNull();
  });

  it("muestra la tarjeta de bienvenida con nombre y términos", () => {
    stubDom();
    window.XOGalaxy.onboarding.start();
    const host = document.querySelector(".onb-host");
    expect(host).toBeTruthy();
    expect(document.querySelector(".onb-title").textContent).toContain("Bienvenido");
    expect(document.querySelector(".onb-input").value.length).toBeGreaterThan(0);
    expect(document.querySelector(".onb-link").getAttribute("href")).toContain("condiciones-de-uso");
  });

  it("no avanza sin nombre y términos aceptados", () => {
    stubDom();
    window.XOGalaxy.onboarding.start();
    const input = document.querySelector(".onb-input");
    input.value = "";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(window.XOGalaxy.onboarding._idx()).toBe(0);
    expect(document.querySelector(".onb-status").hidden).toBe(false);
  });

  it("guarda nombre, acepta términos y avanza al paso de Google", () => {
    stubDom();
    window.XOGalaxy.onboarding.start();
    const input = document.querySelector(".onb-input");
    input.value = "Nico";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(window.XOGalaxy.identity.guestName()).toBe("Nico");
    expect(localStorage.getItem("xogalaxy.termsAccepted")).toBe("1");
    expect(window.XOGalaxy.onboarding._idx()).toBe(1);
    expect(document.querySelector(".onb-title").textContent).toContain("Google");
  });

  it("saltea el paso de Google si ya hay sesión", () => {
    stubDom();
    window.XOGalaxy.auth._setProfile({ sub: "g1", name: "Google", isOwner: false });
    window.XOGalaxy.onboarding.start();
    document.querySelector(".onb-input").value = "Nico";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(window.XOGalaxy.onboarding._idx()).toBe(1);
    expect(document.querySelector(".onb-title").textContent).toContain("comunidad");
  });

  it("usa tooltip anclado cuando el destino existe", () => {
    stubDom();
    window.XOGalaxy.auth._setProfile({ sub: "g1", name: "Google", isOwner: false });
    window.XOGalaxy.onboarding.start();
    const input = document.querySelector(".onb-input");
    input.value = "Nico";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(document.querySelector(".onb-tip")).toBeTruthy();
    expect(document.querySelector(".onb-tip")._target).toBe(document.querySelector("#follow-btn"));
  });

  it("hace scroll suave al destino en los pasos anclados", () => {
    const spy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = spy;
    stubDom();
    window.XOGalaxy.auth._setProfile({ sub: "g1", name: "Google", isOwner: false });
    window.XOGalaxy.onboarding.start();
    document.querySelector(".onb-input").value = "Nico";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(spy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(spy.mock.instances[0]).toBe(document.querySelector("#follow-btn"));
  });

  it("cae a tarjeta si el destino no existe", () => {
    document.body.innerHTML = `
      <div class="main-nav"><a href="#chat">Chat</a></div>
      <section id="participar"><h2>Participar</h2></section>
      <footer>
        <nav class="footer-nav">
          <a href="/p/condiciones-de-uso.html">Condiciones de uso</a>
          <a href="/p/politica-de-privacidad.html">Política de privacidad</a>
        </nav>
      </footer>
    `;
    window.XOGalaxy.auth._setProfile({ sub: "g1", name: "Google", isOwner: false });
    window.XOGalaxy.onboarding.start();
    const input = document.querySelector(".onb-input");
    input.value = "Nico";
    document.querySelector(".onb-check").checked = true;
    document.querySelector("#onb-next").click();
    expect(document.querySelector(".onb-tip")).toBeNull();
    expect(document.querySelector(".onb-card")).toBeTruthy();
  });

  it("el botón × saltea y marca como completado", () => {
    stubDom();
    window.XOGalaxy.onboarding.start();
    document.querySelector(".onb-close").click();
    expect(localStorage.getItem("xogalaxy.onboardingDone")).toBe("1");
    expect(document.querySelector(".onb-host")).toBeNull();
  });

  it("ESC también saltea", () => {
    stubDom();
    window.XOGalaxy.onboarding.start();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(localStorage.getItem("xogalaxy.onboardingDone")).toBe("1");
    expect(document.querySelector(".onb-host")).toBeNull();
  });

  it("el último paso cierra y marca completado", () => {
    stubDom();
    window.XOGalaxy.auth._setProfile({ sub: "g1", name: "Google", isOwner: false });
    window.XOGalaxy.onboarding.start();
    document.querySelector(".onb-input").value = "Nico";
    document.querySelector(".onb-check").checked = true;
    const next = () => document.querySelector("#onb-next").click();
    next();
    const steps = window.XOGalaxy.onboarding._stepCount();
    for (let i = 0; i < steps - 1; i++) next();
    expect(localStorage.getItem("xogalaxy.onboardingDone")).toBe("1");
    expect(document.querySelector(".onb-host")).toBeNull();
  });
});
