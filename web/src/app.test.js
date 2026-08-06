import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("dist/app.js smoke", () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<button class="nav-toggle">☰</button><div id="nav-backdrop"></div><nav id="main-nav"><a href="#x">x</a></nav>' +
      '<h1 id="site-title">XO Galaxy Test</h1><div class="hero-actions"><a href="#feed">Ver posts</a></div>' +
      '<button id="theme-toggle" type="button"><i data-lucide="sun"></i></button>' +
      '<p id="stat-posts"></p><p id="stat-comments"></p><p id="stat-followers"></p><p id="stat-visits"></p>' +
      '<main class="main-layout"><article class="post-single"><h2 class="post-title">T</h2></article></main>' +
      '<div id="chat-app" data-room="general"></div>';
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    window.WebSocket = class {
      constructor() {}
      addEventListener() {}
      send() {}
      close() {}
    };
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    localStorage.clear();
  });

  it("el bundle monta chat, core y expone la API del SPA", () => {
    const code = readFileSync(resolve(process.cwd(), "dist/app.js"), "utf8");
    expect(() => (0, eval)(code)).not.toThrow();

    expect(window.XOGalaxy).toBeTruthy();
    expect(typeof window.XOGalaxy.router.navigate).toBe("function");
    expect(typeof window.XOGalaxy.stats.init).toBe("function");
    expect(typeof window.XOGalaxy.chat.init).toBe("function");

    window.XOGalaxy.app.boot();

    expect(document.querySelector(".xogalaxy-chat")).toBeTruthy();
    expect(document.querySelector(".chat-form")).toBeTruthy();
    expect(document.getElementById("site-title").getAttribute("data-decorated")).toBe("1");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
