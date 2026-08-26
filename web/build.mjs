/**
 * XO Galaxy — build del frontend.
 * Concatena los scripts clásicos (core, api, router, chunks, app) en web/dist/app.js,
 * listo para inyectarse en el template de Blogger (ver inject.mjs).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ORDER = ["vendor/marked.min.js", "vendor/dompurify.min.js", "src/core.js", "src/api.js", "src/router.js", "src/markdown.js", "src/msg-style.js", "src/chunks/auth.js", "src/chunks/identity.js", "src/chunks/onboarding.js", "src/chunks/newsletter.js", "src/chunks/stats.js", "src/chunks/chat.js", "src/chunks/comments.js", "src/chunks/posts.js", "src/chunks/engagement.js", "src/chunks/lightbox.js", "src/chunks/chat-archive.js", "src/chunks/notifications.js", "src/app.js"];

const parts = ORDER.map((f) => readFileSync(join(ROOT, f), "utf8").trim());
const banner = "/* XO Galaxy app.js — generado por web/build.mjs. No editar a mano. */\n";
mkdirSync(join(ROOT, "dist"), { recursive: true });
const out = resolve(join(ROOT, "dist", "app.js"));
writeFileSync(out, banner + parts.join("\n\n") + "\n");
console.log("built:", out, (parts.join("\n\n").length + banner.length) + " bytes");
