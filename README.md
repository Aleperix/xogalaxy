# XO Galaxy

Sistema propio de XO Galaxy sobre Cloudflare: chat, visitas, seguidores y respaldo total del blog de Blogger (`https://xogalax.blogspot.com`). El blog siempre funciona sin Cloudflare (server-rendered por Blogger); Cloudflare lo mejora, nunca lo reemplaza.

## Estructura

```
worker/   Backend en Cloudflare Workers (endpoints, Durable Objects, cron)
web/      Frontend app.js (Router SPA, chunks core/stats/chat)
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

## Fases

0. Backend base: `/followers`, `/visits`, `/health`, KV, DO Stats, tests, deploy. ✅ planificado
1. Respaldo total + espejo (GitHub + R2/imágenes + Pages + Wayback) — R2 pausado, Wayback en marcha
2. Chat + moderación (DO Room, Hibernation API) ✅ deployado — archivo nocturno a D1 pendiente
3. Frontend `app.js` (Router, hooks, chunks)
4. Template v16 (multi-proveedor, chat UI, modo claro, comentarios nativos)
5. PWA sobre el espejo (manifest, service worker, offline, cola de chat)
6. Deploy + validación en vivo
7. Panel de contenido (OAuth Blogger, pageviews)
8. Telemetría (reseñas/votos sobre comentarios nativos)

## Seguridad

- Código 100% público; secretos solo vía `wrangler secret put` / `.dev.vars` (nunca comprometidos).
- Validación estricta de orígenes y rate-limit por IP hasheada en fases de chat/moderación.
