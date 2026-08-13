import { beforeEach, describe, expect, it, vi } from "vitest";
import "../core.js";
import "../api.js";
import "./newsletter.js";

function stubDom() {
  document.body.innerHTML = `
    <section class="newsletter" id="participar">
      <div class="container newsletter-inner">
        <p class="newsletter-text">Suscribite</p>
        <form id="newsletter-form" class="newsletter-form">
          <label class="sr-only" for="email">Correo electrónico</label>
          <input id="email" name="email" placeholder="tu@correo.com" type="email"/>
          <button type="submit">Suscribirme</button>
        </form>
      </div>
    </section>
  `;
}

function submitForm(body) {
  const form = document.querySelector("#newsletter-form");
  const input = form.querySelector('input[name="email"]');
  input.value = body.email || "";
  if (body.panel) {
    const toggle = document.querySelector(".newsletter-toggle");
    toggle.click();
    const panel = document.querySelector(".newsletter-panel");
    if (body.name) {
      const name = panel.querySelector('input[name="name"]');
      name.value = body.name;
    }
    (body.topics || []).forEach((t) => {
      panel.querySelector(`input[name="topics"][value="${t}"]`).checked = true;
    });
    if (body.frequency) {
      panel.querySelector('select[name="frequency"]').value = body.frequency;
    }
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("chunk newsletter (form propio)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("monta panel de preferencias, toggle y status una sola vez", () => {
    stubDom();
    window.XOGalaxy.newsletter.init();
    window.XOGalaxy.newsletter.init();
    expect(document.querySelectorAll(".newsletter-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".newsletter-toggle")).toHaveLength(1);
    expect(document.querySelectorAll(".newsletter-status")).toHaveLength(1);
    expect(document.querySelector(".newsletter-panel").hidden).toBe(true);
    expect(document.querySelectorAll('.newsletter-topics input[name="topics"]')).toHaveLength(4);
  });

  it("rechaza email inválido sin llamar a la API", () => {
    stubDom();
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    window.XOGalaxy.newsletter.init();
    submitForm({ email: "nope" });
    const status = document.querySelector(".newsletter-status");
    expect(status.hidden).toBe(false);
    expect(status.classList.contains("is-error")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("suscribe con solo email y muestra el mensaje de confirmación", async () => {
    stubDom();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "Revisá tu casilla para confirmar la suscripción." }), { status: 201 }))
    );
    window.XOGalaxy.newsletter.init();
    submitForm({ email: "ana@x.com" });
    await flush();
    const [url, init] = window.fetch.mock.calls[0];
    expect(String(url)).toContain("/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "ana@x.com" });
    const status = document.querySelector(".newsletter-status");
    expect(status.classList.contains("is-ok")).toBe(true);
    expect(status.textContent).toContain("Revisá tu casilla");
  });

  it("con el panel abierto envía nombre, temas y frecuencia", async () => {
    stubDom();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "ok" }), { status: 201 })));
    window.XOGalaxy.newsletter.init();
    submitForm({ email: "leo@x.com", panel: true, name: "Leo", topics: ["juegos", "nostalgia"], frequency: "monthly" });
    await flush();
    const [, init] = window.fetch.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      email: "leo@x.com",
      name: "Leo",
      prefs: { topics: ["juegos", "nostalgia"], frequency: "monthly" },
    });
  });

  it("muestra error si la API falla y rehabilita el botón", async () => {
    stubDom();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "too many requests" }), { status: 429 })));
    window.XOGalaxy.newsletter.init();
    submitForm({ email: "ana@x.com" });
    await flush();
    const status = document.querySelector(".newsletter-status");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(status.textContent).toContain("too many requests");
    expect(document.querySelector("#newsletter-form button").disabled).toBe(false);
  });
});
