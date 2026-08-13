import { beforeEach, describe, expect, it } from "vitest";
import "../core.js";
import "./auth.js";
import "./identity.js";

describe("chunk identity", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem("xogalaxy.visitor");
      localStorage.removeItem("xogalaxy.guestNick");
    } catch (err) {}
    window.XOGalaxy.auth.logout();
  });

  it("visitorId es persistente por navegador", () => {
    const id = window.XOGalaxy.identity.visitorId();
    expect(id).toBeTruthy();
    expect(window.XOGalaxy.identity.visitorId()).toBe(id);
    expect(window.localStorage.getItem("xogalaxy.visitor")).toBe(id);
  });

  it("guestName genera Invitado-XXXX y persiste", () => {
    const name = window.XOGalaxy.identity.guestName();
    expect(name).toMatch(/^Invitado-\d{4}$/);
    expect(window.XOGalaxy.identity.guestName()).toBe(name);
  });

  it("setGuestName guarda el nuevo nombre (recortado a 32)", () => {
    const name = window.XOGalaxy.identity.setGuestName("  Jugador Anónimo 123456789012345678901234567890  ");
    expect(name).toBe("Jugador Anónimo 1234567890123456");
    expect(window.XOGalaxy.identity.guestName()).toBe(name);
  });

  it("setGuestName vacío regenera Invitado-XXXX", () => {
    const name = window.XOGalaxy.identity.setGuestName("");
    expect(name).toMatch(/^Invitado-\d{4}$/);
  });

  it("userId usa el sub de Google si hay sesión", () => {
    window.XOGalaxy.auth._setToken("jwt");
    window.XOGalaxy.auth._setProfile({ sub: "google-user-1", name: "Alice" });
    expect(window.XOGalaxy.identity.userId()).toBe("google-user-1");
    window.XOGalaxy.auth.logout();
  });

  it("userId sin sesión usa el visitorId", () => {
    const v = window.XOGalaxy.identity.visitorId();
    expect(window.XOGalaxy.identity.userId()).toBe(v);
  });
});
