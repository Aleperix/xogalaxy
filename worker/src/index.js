import { Stats } from "./stats.js";
import { Room } from "./room.js";
import { getFollowers } from "./followers.js";
import { urlsFromSitemap, saveToWayback } from "./wayback.js";

export { Stats } from "./stats.js";
export { Room } from "./room.js";

const BLOG_ID = "6925527308405412397";
const BLOG_URL = "https://xogalax.blogspot.com";
const SITEMAP_URL = `${BLOG_URL}/sitemap.xml`;
const FOLLOWERS_KV_KEY = "followers:count";
const FOLLOWERS_CACHE_TTL = 1800;
const VISITS_KEY = "visits";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin");
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return handlePreflight(origin, allowed);
    }

    if (origin && !allowed.includes(origin)) {
      return json({ error: "origin not allowed" }, 403, cors(origin));
    }

    try {
      switch (path) {
        case "/health":
          return json(
            { ok: true, service: "xogalaxy-backend", time: new Date().toISOString() },
            200,
            cors(origin)
          );
        case "/followers":
          return handleFollowers(request, env, origin);
        case "/visits":
          return handleVisits(request, env, origin);
        case "/chat/ws":
          return handleChatWs(request, env, origin);
        case "/chat/history":
          return handleChatHistory(request, env, origin);
        case "/chat/message":
          return handleChatMessage(request, env, origin);
        case "/chat/mod/delete":
          return handleChatModDelete(request, env, origin);
        default:
          return json({ error: "not found" }, 404, cors(origin));
      }
    } catch (err) {
      console.error("handler error:", err);
      return json({ error: "internal error" }, 500, cors(origin));
    }
  },

  async scheduled(controller, env) {
    const urls = [BLOG_URL + "/"];
    try {
      urls.push(...(await urlsFromSitemap(SITEMAP_URL)));
    } catch (err) {
      console.error("sitemap error:", err);
    }
    const deduped = [...new Set(urls)];
    const results = await saveToWayback(deduped);
    console.log("wayback:", JSON.stringify(results));
    return results;
  },
};

async function handleFollowers(request, env, origin) {
  const lang = new URL(request.url).searchParams.get("lang") || "es";
  try {
    const data = await getFollowers({
      blogId: BLOG_ID,
      origin: BLOG_URL,
      lang,
      kv: env.XOGALAXY_KV,
      cacheKey: FOLLOWERS_KV_KEY,
      cacheTtl: FOLLOWERS_CACHE_TTL,
    });
    return json(data, 200, cors(origin));
  } catch (err) {
    console.error("followers error:", err);
    return json({ error: "followers unavailable" }, 502, cors(origin));
  }
}

async function handleVisits(request, env, origin) {
  const url = new URL(request.url);
  const hit = url.searchParams.get("hit") === "1";
  const stub = env.STATS.getByName("global");
  const value = hit ? await stub.hit(VISITS_KEY) : await stub.get(VISITS_KEY);
  return json({ key: VISITS_KEY, value, hit }, 200, cors(origin));
}

async function handleChatWs(request, env, origin) {
  if (!request.headers.get("Upgrade")) {
    return json({ error: "websocket upgrade required" }, 426, cors(origin));
  }
  const room = new URL(request.url).searchParams.get("room") || "general";
  const stub = env.ROOM.getByName(room.slice(0, 64));
  return stub.fetch(request);
}

async function handleChatHistory(request, env, origin) {
  const url = new URL(request.url);
  const room = (url.searchParams.get("room") || "general").slice(0, 64);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const stub = env.ROOM.getByName(room);
  const messages = await stub.history(room, limit);
  return json({ room, messages }, 200, cors(origin));
}

async function handleChatMessage(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const room = String(body.room || "general").slice(0, 64);
  const nickname = String(body.nickname || "").trim().slice(0, 32);
  const text = String(body.body || "").trim().slice(0, 1000);
  if (!nickname || !text) {
    return json({ error: "nickname and body required" }, 400, cors(origin));
  }
  const stub = env.ROOM.getByName(room);
  const message = await stub.sendMessage(room, nickname, text);
  return json({ message }, 200, cors(origin));
}

async function handleChatModDelete(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  const auth = request.headers.get("Authorization");
  if (!env.MOD_KEY || auth !== `Bearer ${env.MOD_KEY}`) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const room = String(body.room || "general").slice(0, 64);
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return json({ error: "id required" }, 400, cors(origin));
  }
  const stub = env.ROOM.getByName(room);
  await stub.modDelete(room, id);
  return json({ ok: true, id }, 200, cors(origin));
}

function parseOrigins(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function cors(origin) {
  if (origin) return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  return { "Access-Control-Allow-Origin": "*" };
}

function handlePreflight(origin, allowed) {
  if (!origin || !allowed.includes(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
