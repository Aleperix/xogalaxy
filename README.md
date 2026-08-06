# XO Galaxy

Sistema propio de XO Galaxy sobre Cloudflare: chat, visitas, seguidores y respaldo total del blog de Blogger (`https://xogalax.blogspot.com`). El blog siempre funciona sin Cloudflare (server-rendered por Blogger); Cloudflare lo mejora, nunca lo reemplaza.

## Estructura

```
worker/   Backend en Cloudflare Workers (endpoints, Durable Objects, cron)
web/      Frontend app.js (Router SPA, chunks core/stats/chat) + build
theme/    Template de Blogger (XML) + releases/
```

## Worker (`backend` → `https://backend.xogalaxy.workers.dev`)

| Ruta | Descripción |
|---|---|
| `GET /health` | Estado del servicio |
| `GET /followers` | Seguidores de Comunidad (frame de Blogger, cache KV 30 min) |
| `GET /visits` | Total de visitas (DO Stats SQLite) |
| `GET /visits?hit=1` | Incrementa visitas y devuelve total |
| `GET /chat/history?room=X` | Últimos 50 mensajes (máx 200) de una sala |
| `POST /chat/message` | Publica `{room, nickname, body}` en una sala |
| `POST /chat/mod/delete` | Borrado soft `{room, id}` (Bearer `MOD_KEY`) |
| `GET /chat/ws?room=X&nick=Y` | WebSocket Hibernation (chat en vivo) |

Orígenes permitidos vía `ALLOWED_ORIGINS` (CORS + validación). Extensible a dominios futuros.

### Local

```bash
cd worker
npm install
npm test        # vitest + pool workers
npm run check   # node --check sobre el código
npm run dev     # wrangler dev
```

### Deploy

```bash
cd worker
npx wrangler kv namespace create XOGALAXY_KV   # una vez; anotar el id
# completar el id en wrangler.jsonc
npx wrangler secret put MOD_KEY                # una vez; clave del borrado de chat
npm run deploy
```

## Frontend (`web/` → `web/dist/app.js`)

SPA propio embebido en el template de Blogger (progressive enhancement; el blog siempre renderiza server-side).

- `src/core.js` — utilidades DOM, hooks de ciclo de vida (`swap`), animación de contadores, iconos, nav, cachés locales.
- `src/api.js` — cliente del backend (`/followers`, `/visits`, `/chat/*`). Base configurable vía `window.XOGALAXY_CONFIG.backend`.
- `src/router.js` — router SPA (History API): fetch + swap de `<main.main-layout>`, `pushState`/`popstate`, delegación de clics.
- `src/chunks/stats.js` — contadores: posts (feed Blogger), comentarios (feed nativo), seguidores y visitas (backend). HIT solo en carga real; GET tras navegación SPA.
- `src/core.js` — además: `setupTheme()` con claro/oscuro persistido en `localStorage` (`xogalaxy.theme`, oscuro por defecto, sin auto).
- `src/chunks/chat.js` — chat propio: se monta en `#chat-app`, WS Hibernation con reconexión/backoff y fallback REST.
- `src/app.js` — boot.
- `build.mjs` — concatena los módulos en `web/dist/app.js`.
- `inject.mjs` — reemplaza `<!-- XOGALAXY_APP_SCRIPT -->` del template por el `<script>` con el bundle.
- `dev/harness.html` y `dev/e2e-mock.mjs` — QA manual con un mock local del backend.

```bash
cd web
npm install
npm test        # vitest + happy-dom
npm run build   # genera dist/app.js
node inject.mjs ../xogalaxy-template.xml salida.xml
```

## Fases

0. Backend base: `/followers`, `/visits`, `/health`, KV, DO Stats, tests, deploy. ✅ planificado
1. Respaldo total + espejo (GitHub + R2/imágenes + Pages + Wayback) — R2 pausado, Wayback en marcha
2. Chat + moderación (DO Room, Hibernation API) ✅ deployado — archivo nocturno a D1 pendiente
3. Frontend `app.js` (Router, hooks, chunks) ✅ en `web/` — inyección en template pendiente
4. Template v16 (multi-proveedor, chat UI, modo claro, comentarios nativos) — template editado en `releases/xogalaxy-template-v16.xml`, deploy pendiente
5. PWA sobre el espejo (manifest, service worker, offline, cola de chat)
6. Deploy + validación en vivo
7. Panel de contenido (OAuth Blogger, pageviews)
8. Telemetría (reseñas/votos sobre comentarios nativos)

## Fase 3.5 y 4 (web + template)

- Web: tema claro/oscuro (`setupTheme`) + contador de comentarios nativos vía `/feeds/comments/default`. ✅ commit `489533e`
- Template v16 (`xogalaxy-template-v16.xml`, generado con `inject.mjs`):
  - Chatango eliminado (lazy-iframe, chat-box, fallback, sala) → `#chat-app` con `data-room` para el chat propio.
  - Disqus eliminado (contadores, `.disqus-load`, `#disqus_thread`, API key, JSONP, count.js) → comentarios nativos de Blogger vía `commentPicker` con `#comments`, `.comment-form` y contadores `<data:post.numberOfComments/>` enlazando a `#comments`.
  - CountAPI eliminado → visitas vía backend.
  - Botón `#theme-toggle` en la nav (sun/moon) + variables CSS `[data-theme="light"]`; componentes migrados de `--void` a `--bg`.

## Seguridad

- Código 100% público; secretos solo vía `wrangler secret put` / `.dev.vars` (nunca comprometidos).
- Validación estricta de orígenes y rate-limit por IP hasheada en fases de chat/moderación.
