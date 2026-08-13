import { beforeEach, describe, expect, it, vi } from "vitest";
import { env, reset } from "cloudflare:test";
import { sendEmail, normalizeFrom } from "./email.js";
import * as emails from "./emails.js";

function baseEnv(extra) {
  return { ...env, EMAIL_PROVIDER: undefined, EMAIL_FROM_DOMAIN: "xogalaxy.com", ...(extra || {}) };
}

describe("email adapter", () => {
  beforeEach(async () => {
    await reset();
  });

  it("sin provider usa mock y devuelve messageId", async () => {
    const info = await sendEmail(baseEnv(), { to: "a@b.com", subject: "s", html: "<p>h</p>", text: "h" });
    expect(info.provider).toBe("mock");
    expect(info.messageId).toMatch(/^mock-/);
  });

  it("gmail sin credenciales lanza error claro", async () => {
    await expect(sendEmail(baseEnv({ EMAIL_PROVIDER: "gmail" }), { to: "a@b.com" })).rejects.toThrow(
      "GMAIL_USER/GMAIL_APP_PASSWORD"
    );
  });

  it("cloudflare sin binding EMAIL lanza error claro", async () => {
    await expect(sendEmail(baseEnv({ EMAIL_PROVIDER: "cloudflare" }), { to: "a@b.com" })).rejects.toThrow("binding EMAIL");
  });

  it("resend sin API key lanza error claro", async () => {
    await expect(sendEmail(baseEnv({ EMAIL_PROVIDER: "resend" }), { to: "a@b.com" })).rejects.toThrow("RESEND_API_KEY");
  });

  it("resend envía vía REST con fetch y devuelve el messageId", async () => {
    const spy = vi.fn(async (url, init) => {
      expect(String(url)).toBe("https://api.resend.com/emails");
      const body = JSON.parse(init.body);
      expect(body.to).toEqual(["a@b.com"]);
      expect(body.subject).toBe("hola");
      expect(body.from).toContain("xogalaxy.com");
      return new Response(JSON.stringify({ id: "re_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const orig = globalThis.fetch;
    globalThis.fetch = spy;
    try {
      const info = await sendEmail(
        baseEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }),
        { to: "a@b.com", subject: "hola", html: "<p>h</p>", text: "h", fromName: "XO Galaxy" }
      );
      expect(info).toMatchObject({ provider: "resend", messageId: "re_123" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("resend falla con HTTP != 2xx", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => new Response("boom", { status: 422 });
    try {
      await expect(
        sendEmail(baseEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "k" }), { to: "a@b.com", subject: "s" })
      ).rejects.toThrow(/422/);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("emails templates", () => {
  it("confirmEmail incluye el enlace de confirmación y saluda por nombre", () => {
    const sub = { name: "María", email: "m@x.com", token: "t123" };
    const mail = emails.confirmEmail(sub, { confirmUrl: "https://xogalax.blogspot.com/subscribe/confirm?t=t123", baseUrl: "https://xogalax.blogspot.com" });
    expect(mail.subject).toContain("Confirmá");
    expect(mail.html).toContain("Hola María");
    expect(mail.html).toContain("subscribe/confirm?t=t123");
    expect(mail.text).toContain("subscribe/confirm?t=t123");
  });

  it("digestEmail personaliza temas y frecuencia y enlaza baja/preferencias", () => {
    const sub = {
      name: "Leo",
      prefs: { topics: ["juegos", "nostalgia"], frequency: "weekly" },
    };
    const mail = emails.digestEmail(sub, [{ title: "El clásico XO", postUrl: "https://x/a.html", body: "abc" }], {
      unsubscribeUrl: "https://x/unsub",
      prefsUrl: "https://x/prefs",
    });
    expect(mail.subject).toBe("Novedades XO Galaxy · semanal");
    expect(mail.html).toContain("Hola Leo");
    expect(mail.html).toContain("Juegos, Nostalgia y Lost media");
    expect(mail.html).toContain("El clásico XO");
    expect(mail.html).toContain("https://x/unsub");
    expect(mail.html).toContain("https://x/prefs");
  });

  it("digestEmail sin posts avisa que no hay novedades", () => {
    const mail = emails.digestEmail({ name: "", prefs: { topics: [], frequency: "monthly" } }, [], {
      unsubscribeUrl: "u",
      prefsUrl: "p",
    });
    expect(mail.subject).toBe("Novedades XO Galaxy · mensual");
    expect(mail.html).toContain("no hay novedades");
  });

  it("escapa HTML en los datos del usuario", () => {
    const mail = emails.confirmEmail({ name: "<b>x</b>", email: "a@b.com" }, { confirmUrl: "https://x/c?t=a&b", baseUrl: "https://x" });
    expect(mail.html).not.toContain("<b>x</b>");
    expect(mail.html).toContain("&lt;b&gt;");
    expect(mail.html).not.toContain("https://x/c?t=a&b");
    expect(mail.html).toContain("https://x/c?t=a&amp;b");
  });

  it("parsePrefs filtra temas desconocidos y normaliza frecuencia", () => {
    expect(emails.parsePrefs({ topics: ["juegos", "spam"], frequency: "monthly" })).toEqual({
      topics: ["juegos"],
      frequency: "monthly",
    });
    expect(emails.parsePrefs({ topics: "juegos", frequency: "diario" })).toEqual({ topics: [], frequency: "weekly" });
  });
});
