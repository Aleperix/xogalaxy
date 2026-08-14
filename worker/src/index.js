import { Stats } from "./stats.js";
import { Room } from "./room.js";
import * as followers from "./followers.js";
import { urlsFromSitemap, saveToWayback } from "./wayback.js";
import { Auth, isOwner } from "./auth.js";
import * as comments from "./comments.js";
import * as posts from "./posts.js";
import * as profiles from "./profiles.js";
import * as engagement from "./engagement.js";
import { fetchRelease } from "./releases.js";
import * as newsletter from "./newsletter.js";
import { sendEmail } from "./email.js";
import * as emails from "./emails.js";

export { Stats } from "./stats.js";
export { Room } from "./room.js";

const BLOG_ID = "6925527305408412397";
const BLOG_URL = "https://xogalax.blogspot.com";
const SITEMAP_URL = `${BLOG_URL}/sitemap.xml`;
const VISITS_KEY = "visits";
const COMMENT_RATE_LIMIT = 10;
const COMMENT_BODY_MAX = 4000;
const COMMENT_POST_ID_MAX = 200;
const CHAT_ROOMS = ["general"];
const POST_TITLE_MAX = 200;
const POST_BODY_MAX = 20000;
const POST_URL_MAX = 500;
const POST_RATE_LIMIT = 10;
const RELEASES_RATE_LIMIT = 60;
const RELEASES_CACHE = "public, max-age=3600";
const RATING_RATE_LIMIT = 30;
const REACTION_RATE_LIMIT = 30;
const FOLLOW_RATE_LIMIT = 30;
const PROFILE_RATE_LIMIT = 30;
const ENGAGEMENT_TARGETS_MAX = 50;

async function ensureComments(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='comments'`).first();
  if (!row) await comments.migrate(db);
}

async function ensurePosts(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts'`).first();
  if (!row) await posts.migrate(db);
}

async function ensureEngagement(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ratings'`).first();
  if (!row) await engagement.migrate(db);
}

async function ensureFollowers(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='followers'`).first();
  if (!row) await followers.migrate(db);
}

async function ensureProfiles(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'`).first();
  if (!row) await profiles.migrate(db);
}

async function ensureNewsletter(db) {
  const row = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='subscribers'`).first();
  if (!row) await newsletter.migrate(db);
}

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
        case "/followers/follow":
          return handleFollowersFollow(request, env, origin);
        case "/followers/unfollow":
          return handleFollowersUnfollow(request, env, origin);
        case "/followers/me":
          return handleFollowersMe(request, env, origin);
        case "/profiles":
          return handleProfiles(request, env, origin);
        case "/visits":
          return handleVisits(request, env, origin);
        case "/auth/verify":
          return handleAuthVerify(request, env, origin);
        case "/auth/config":
          return handleAuthConfig(env, origin);
        case "/chat/ws":
          return handleChatWs(request, env, origin);
        case "/chat/history":
          return handleChatHistory(request, env, origin);
        case "/chat/message":
          return handleChatMessage(request, env, origin);
        case "/chat/mod/delete":
          return handleChatModDelete(request, env, origin);
        case "/comments":
          return handleComments(request, env, origin);
        case "/comments/counts":
          return handleCommentsCounts(request, env, origin);
        case "/comments/total":
          return handleCommentsTotal(request, env, origin);
        case "/comments/mod/pending":
          return handleCommentsPending(request, env, origin);
        case "/comments/mod/review":
          return handleCommentsReview(request, env, origin);
        case "/comments/delete":
          return handleCommentsDelete(request, env, origin);
        case "/comments/export":
          return handleCommentsExport(request, env, origin);
        case "/comments/import":
          return handleCommentsImport(request, env, origin);
        case "/posts":
          return handlePosts(request, env, origin);
        case "/posts/pending":
          return handlePostsPending(request, env, origin);
        case "/posts/approved":
          return handlePostsApproved(request, env, origin);
        case "/posts/my":
          return handlePostsMy(request, env, origin);
        case "/posts/by-author":
          return handlePostsByAuthor(request, env, origin);
        case "/posts/mod/review":
          return handlePostsReview(request, env, origin);
        case "/posts/delete":
          return handlePostsDelete(request, env, origin);
        case "/posts/url":
          return handlePostsUrl(request, env, origin);
        case "/releases":
          return handleReleases(request, env, origin);
        case "/rating":
          return handleRating(request, env, origin);
        case "/reaction":
          return handleReaction(request, env, origin);
        case "/engagement":
          return handleEngagement(request, env, origin);
        case "/subscribe":
          return handleSubscribe(request, env, origin);
        case "/subscribe/confirm":
          return handleSubscribeConfirm(request, env, origin);
        case "/unsubscribe":
          return handleUnsubscribe(request, env, origin);
        case "/preferences":
          return handlePreferences(request, env, origin);
        default:
          return json({ error: "not found" }, 404, cors(origin));
      }
    } catch (err) {
      console.error("handler error:", err);
      return json({ error: "internal error" }, 500, cors(origin));
    }
  },

  async scheduled(controller, env) {
    if (controller && controller.cron === "45 4 * * 1") {
      try {
        const digest = await sendNewsletterDigest(env);
        console.log("newsletter digest:", JSON.stringify(digest));
      } catch (err) {
        console.error("newsletter digest error:", err);
      }
    }

    const urls = [BLOG_URL + "/"];
    try {
      urls.push(...(await urlsFromSitemap(SITEMAP_URL)));
    } catch (err) {
      console.error("sitemap error:", err);
    }
    const deduped = [...new Set(urls)];
    const wayback = await saveToWayback(deduped);
    console.log("wayback:", JSON.stringify(wayback));

    let backup = null;
    try {
      backup = await buildBackup(env);
      await pushBackupToGitHub(env, backup);
      console.log("backup pushed");
    } catch (err) {
      console.error("backup error:", err);
    }
    return { wayback, backup: backup ? { ok: true, exportedAt: backup.exportedAt } : null };
  },
};

// ---- auth ----

async function handleAuthConfig(env, origin) {
  return json(
    { clientId: env.GOOGLE_CLIENT_ID || "" },
    200,
    Object.assign({}, cors(origin), { "Cache-Control": "public, max-age=3600" })
  );
}

async function handleAuthVerify(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  try {
    await ensureProfiles(env.DB);
    const auth = new Auth(env);
    const profile = await auth.verify(body.token, env.GOOGLE_CLIENT_ID);
    const merged = await profiles.mergeIdentity(env.DB, profile);
    return json(
      {
        sub: merged.sub,
        name: merged.name,
        bio: merged.bio,
        picture: merged.picture,
        isOwner: isOwner(env, merged.sub),
      },
      200,
      cors(origin)
    );
  } catch (err) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
}

// ---- chat ----

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
  const author = body.token ? await verifyProfile(env, body.token) : null;
  const message = await stub.sendMessage(room, nickname, text, author);
  return json({ message }, 200, cors(origin));
}

async function verifyProfile(env, token) {
  try {
    await ensureProfiles(env.DB);
    const auth = new Auth(env);
    const p = await auth.verify(token, env.GOOGLE_CLIENT_ID);
    const merged = await profiles.mergeIdentity(env.DB, p);
    return { sub: merged.sub, name: merged.name || "", picture: merged.picture || null };
  } catch (err) {
    return null;
  }
}

async function handleChatModDelete(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const who = await ownerFromRequest(env, request, body);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
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

// ---- comments ----

async function handleComments(request, env, origin) {
  const url = new URL(request.url);
  await ensureComments(env.DB);
  if (request.method === "GET") {
    const postId = (url.searchParams.get("postId") || "").slice(0, COMMENT_POST_ID_MAX);
    if (!postId) return json({ error: "postId required" }, 400, cors(origin));
    if (url.searchParams.get("count") === "1") {
      const count = await comments.countComments(env.DB, postId);
      return json({ postId, count }, 200, cors(origin));
    }
    const items = await comments.listComments(env.DB, postId);
    return json({ postId, comments: items }, 200, cors(origin));
  }

  if (request.method === "POST") {
    if (await rateLimited(env, request, "comments", COMMENT_RATE_LIMIT)) {
      return json({ error: "rate limited" }, 429, cors(origin));
    }
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ error: "invalid json" }, 400, cors(origin));
    }
    const postId = String(body.postId || "").trim().slice(0, COMMENT_POST_ID_MAX);
    const text = String(body.body || "").trim().slice(0, COMMENT_BODY_MAX);
    if (!postId || !text) {
      return json({ error: "postId and body required" }, 400, cors(origin));
    }
    let author = { sub: null, name: String(body.name || "").trim().slice(0, 40) };
    if (body.token) {
      const profile = await verifyProfile(env, body.token);
      if (!profile) return json({ error: "unauthorized" }, 401, cors(origin));
      author = profile;
    }
    const created = await comments.createComment(env.DB, { postId, body: text, author });
    return json({ comment: created }, 201, cors(origin));
  }

  return json({ error: "method not allowed" }, 405, cors(origin));
}

async function handleCommentsCounts(request, env, origin) {
  await ensureComments(env.DB);
  const ids = (new URL(request.url).searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  const counts = {};
  for (const id of ids) {
    counts[id] = await comments.countComments(env.DB, id);
  }
  return json({ counts }, 200, cors(origin));
}

async function handleCommentsTotal(request, env, origin) {
  await ensureComments(env.DB);
  const total = await comments.totalComments(env.DB);
  return json({ total }, 200, cors(origin));
}

async function handleCommentsPending(request, env, origin) {
  const who = await ownerFromRequest(env, request);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await ensureComments(env.DB);
  const items = await comments.pendingComments(env.DB);
  return json({ comments: items }, 200, cors(origin));
}

async function handleCommentsReview(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const who = await ownerFromRequest(env, request, body);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const id = Number(body.id);
  const action = String(body.action || "");
  if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) {
    return json({ error: "id and action required" }, 400, cors(origin));
  }
  await ensureComments(env.DB);
  const row = await comments.reviewComment(
    env.DB,
    id,
    action === "approve" ? comments.COMMENT_STATUS.APPROVED : comments.COMMENT_STATUS.REJECTED
  );
  return json({ comment: row }, row ? 200 : 404, cors(origin));
}

async function handleCommentsDelete(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return json({ error: "id required" }, 400, cors(origin));
  }
  await ensureComments(env.DB);
  const isMod = authorizedMod(request, env);
  let sub = null;
  if (!isMod && body.token) {
    const profile = await verifyProfile(env, body.token);
    if (profile) sub = isOwner(env, profile.sub) ? null : profile.sub;
  }
  if (!isMod && !sub) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const row = await comments.deleteComment(env.DB, id, sub);
  return json({ ok: Boolean(row) }, row ? 200 : 404, cors(origin));
}

async function handleCommentsExport(request, env, origin) {
  const who = await ownerFromRequest(env, request);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await ensureComments(env.DB);
  const items = await comments.exportAll(env.DB);
  return json({ exportedAt: new Date().toISOString(), comments: items }, 200, cors(origin));
}

async function handleCommentsImport(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const who = await ownerFromRequest(env, request, body);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await ensureComments(env.DB);
  const imported = await comments.importComments(env.DB, body.comments);
  return json({ imported }, 200, cors(origin));
}

// ---- posts (tool de aportes) ----

async function handlePosts(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  await ensurePosts(env.DB);
  if (await rateLimited(env, request, "posts", POST_RATE_LIMIT)) {
    return json({ error: "rate limited" }, 429, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const title = String(body.title || "").trim().slice(0, POST_TITLE_MAX);
  const text = String(body.body || "").trim().slice(0, POST_BODY_MAX);
  if (!title || !text) {
    return json({ error: "title and body required" }, 400, cors(origin));
  }
  let author = { sub: null, visitor: null, name: String(body.name || "").trim().slice(0, 40) };
  if (body.token) {
    const profile = await verifyProfile(env, body.token);
    if (!profile) return json({ error: "unauthorized" }, 401, cors(origin));
    author = profile;
  } else {
    author.visitor = String(body.visitor || "").trim().slice(0, 64);
  }
  const created = await posts.createPost(env.DB, { title, body: text, author });
  return json({ post: created }, 201, cors(origin));
}

async function handlePostsPending(request, env, origin) {
  const who = await ownerFromRequest(env, request);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await ensurePosts(env.DB);
  const items = await posts.pendingPosts(env.DB);
  return json({ posts: items }, 200, cors(origin));
}

async function handlePostsApproved(request, env, origin) {
  const who = await ownerFromRequest(env, request);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await ensurePosts(env.DB);
  const items = await posts.approvedPosts(env.DB);
  return json({ posts: items }, 200, cors(origin));
}

async function handlePostsMy(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  const url = new URL(request.url);
  await ensurePosts(env.DB);
  const token = request.headers.get("X-XOGALAXY-Token") || url.searchParams.get("token") || "";
  const profile = token ? await verifyProfile(env, token) : null;
  if (token && !profile) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const visitor = String(url.searchParams.get("visitor") || "").trim().slice(0, 64);
  if (!profile && !visitor) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const items = await posts.myPosts(env.DB, {
    sub: profile ? profile.sub : null,
    visitor: visitor || null,
  });
  return json({ posts: items }, 200, cors(origin));
}

async function handlePostsByAuthor(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  const url = new URL(request.url);
  await ensurePosts(env.DB);
  const sub = String(url.searchParams.get("sub") || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
  if (!sub) {
    return json({ error: "sub required" }, 400, cors(origin));
  }
  const token = request.headers.get("X-XOGALAXY-Token") || url.searchParams.get("token") || "";
  const profile = token ? await verifyProfile(env, token) : null;
  const includePending = profile && (profile.sub === sub || isOwner(env, profile.sub));
  const items = await posts.authorPosts(env.DB, sub, includePending);
  return json({ author: sub, posts: items }, 200, cors(origin));
}

async function handlePostsReview(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const who = await ownerFromRequest(env, request, body);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const id = Number(body.id);
  const action = String(body.action || "");
  if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) {
    return json({ error: "id and action required" }, 400, cors(origin));
  }
  await ensurePosts(env.DB);
  const row = await posts.reviewPost(
    env.DB,
    id,
    action === "approve" ? posts.POST_STATUS.APPROVED : posts.POST_STATUS.REJECTED
  );
  return json({ post: row }, row ? 200 : 404, cors(origin));
}

async function handlePostsDelete(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return json({ error: "id required" }, 400, cors(origin));
  }
  await ensurePosts(env.DB);
  const who = await ownerFromRequest(env, request, body);
  let authorSub = null;
  if (!who && body.token) {
    const profile = await verifyProfile(env, body.token);
    if (profile) authorSub = isOwner(env, profile.sub) ? null : profile.sub;
  }
  if (!who && !authorSub) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const row = await posts.deletePost(env.DB, id, authorSub);
  return json({ ok: Boolean(row) }, row ? 200 : 404, cors(origin));
}

async function handlePostsUrl(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const who = await ownerFromRequest(env, request, body);
  if (!who) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const id = Number(body.id);
  const url = String(body.url || "").trim().slice(0, POST_URL_MAX);
  if (!Number.isInteger(id) || !url) {
    return json({ error: "id and url required" }, 400, cors(origin));
  }
  await ensurePosts(env.DB);
  const row = await posts.setPostUrl(env.DB, id, url);
  return json({ post: row }, row ? 200 : 404, cors(origin));
}

// ---- releases (proxy GitHub) ----

async function handleReleases(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  const url = new URL(request.url).searchParams.get("url") || "";
  if (!url) {
    return json({ error: "url required" }, 400, cors(origin));
  }
  if (await rateLimited(env, request, "releases", RELEASES_RATE_LIMIT)) {
    return json({ error: "rate limited" }, 429, cors(origin));
  }
  try {
    const data = await fetchRelease(env, url);
    return json(data, 200, Object.assign({}, cors(origin), { "Cache-Control": RELEASES_CACHE }));
  } catch (err) {
    console.error("releases error:", err.message);
    return json({ error: "release unavailable" }, 502, Object.assign({}, cors(origin), { "Cache-Control": RELEASES_CACHE }));
  }
}

// ---- engagement (ratings + reacciones) ----

async function handleRating(request, env, origin) {
  const url = new URL(request.url);
  await ensureEngagement(env.DB);
  if (request.method === "GET") {
    const target = engagement.sanitizeTarget(url.searchParams.get("target"));
    if (!target) return json({ error: "target required" }, 400, cors(origin));
    const user = engagement.sanitizeUser(url.searchParams.get("user"));
    const summary = await engagement.ratingSummary(env.DB, target, user || null);
    return json(summary, 200, cors(origin));
  }
  if (request.method === "POST") {
    if (await rateLimited(env, request, "rating", RATING_RATE_LIMIT)) {
      return json({ error: "rate limited" }, 429, cors(origin));
    }
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ error: "invalid json" }, 400, cors(origin));
    }
    const target = engagement.sanitizeTarget(body.target);
    const value = Number(body.value);
    if (!target || !Number.isInteger(value) || value < 0 || value > engagement.RATING_MAX) {
      return json({ error: "target and value (0..5) required" }, 400, cors(origin));
    }
    let user = engagement.sanitizeUser(body.user);
    if (!user && body.token) {
      const profile = await verifyProfile(env, body.token);
      if (!profile) return json({ error: "unauthorized" }, 401, cors(origin));
      user = engagement.sanitizeUser(profile.sub);
    }
    if (!user) {
      return json({ error: "user required" }, 400, cors(origin));
    }
    const summary = await engagement.rate(env.DB, { target, user, value });
    return json(summary, 200, cors(origin));
  }
  return json({ error: "method not allowed" }, 405, cors(origin));
}

async function handleReaction(request, env, origin) {
  const url = new URL(request.url);
  await ensureEngagement(env.DB);
  if (request.method === "GET") {
    const target = engagement.sanitizeTarget(url.searchParams.get("target"));
    if (!target) return json({ error: "target required" }, 400, cors(origin));
    const counts = await engagement.reactionCounts(env.DB, target);
    return json(counts, 200, cors(origin));
  }
  if (request.method === "POST") {
    if (await rateLimited(env, request, "reaction", REACTION_RATE_LIMIT)) {
      return json({ error: "rate limited" }, 429, cors(origin));
    }
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ error: "invalid json" }, 400, cors(origin));
    }
    const target = engagement.sanitizeTarget(body.target);
    const type = engagement.sanitizeType(body.type);
    if (!target || !type) {
      return json({ error: "target and type required" }, 400, cors(origin));
    }
    let user = engagement.sanitizeUser(body.user);
    if (!user && body.token) {
      const profile = await verifyProfile(env, body.token);
      if (!profile) return json({ error: "unauthorized" }, 401, cors(origin));
      user = engagement.sanitizeUser(profile.sub);
    }
    if (!user) {
      return json({ error: "user required" }, 400, cors(origin));
    }
    const counts = await engagement.react(env.DB, { target, user, type });
    return json(counts, 200, cors(origin));
  }
  return json({ error: "method not allowed" }, 405, cors(origin));
}

async function handleEngagement(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  const url = new URL(request.url);
  await ensureEngagement(env.DB);
  const targets = (url.searchParams.get("targets") || "")
    .split(",")
    .map(engagement.sanitizeTarget)
    .filter(Boolean)
    .slice(0, ENGAGEMENT_TARGETS_MAX);
  if (!targets.length) {
    return json({ error: "targets required" }, 400, cors(origin));
  }
  const user = engagement.sanitizeUser(url.searchParams.get("user"));
  const ratings = {};
  for (const t of targets) ratings[t] = await engagement.ratingSummary(env.DB, t, user || null);
  const reactions = await engagement.reactionSummaries(env.DB, targets);
  return json({ ratings, reactions }, 200, cors(origin));
}

// ---- followers / visits ----

async function handleFollowers(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  await ensureFollowers(env.DB);
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 100;
  const [count, list] = await Promise.all([followers.countFollowers(env.DB), followers.listFollowers(env.DB, limit)]);
  return json({ count, followers: list }, 200, cors(origin));
}

async function handleFollowersFollow(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  await ensureFollowers(env.DB);
  if (await rateLimited(env, request, "follow", FOLLOW_RATE_LIMIT)) {
    return json({ error: "rate limited" }, 429, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const profile = await verifyProfile(env, String(body.token || ""));
  if (!profile) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const follower = await followers.follow(env.DB, profile);
  const count = await followers.countFollowers(env.DB);
  return json({ ok: true, following: true, follower, count }, 200, cors(origin));
}

async function handleFollowersUnfollow(request, env, origin) {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  await ensureFollowers(env.DB);
  if (await rateLimited(env, request, "follow", FOLLOW_RATE_LIMIT)) {
    return json({ error: "rate limited" }, 429, cors(origin));
  }
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const profile = await verifyProfile(env, String(body.token || ""));
  if (!profile) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  await followers.unfollow(env.DB, profile.sub);
  const count = await followers.countFollowers(env.DB);
  return json({ ok: true, following: false, count }, 200, cors(origin));
}

async function handleFollowersMe(request, env, origin) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, cors(origin));
  }
  await ensureFollowers(env.DB);
  const token = request.headers.get("X-XOGALAXY-Token") || new URL(request.url).searchParams.get("token") || "";
  const profile = await verifyProfile(env, token);
  if (!profile) {
    return json({ error: "unauthorized" }, 401, cors(origin));
  }
  const row = await followers.getFollower(env.DB, profile.sub);
  return json({ following: Boolean(row), follower: row }, 200, cors(origin));
}

async function handleVisits(request, env, origin) {
  const url = new URL(request.url);
  const hit = url.searchParams.get("hit") === "1";
  const stub = env.STATS.getByName("global");
  const value = hit ? await stub.hit(VISITS_KEY) : await stub.get(VISITS_KEY);
  return json({ key: VISITS_KEY, value, hit }, 200, cors(origin));
}

// ---- perfiles ----

async function handleProfiles(request, env, origin) {
  await ensureProfiles(env.DB);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const sub = String(url.searchParams.get("sub") || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    const visitor = String(url.searchParams.get("visitor") || "").trim().replace(/[^A-Za-z0-9_-]/g, "");
    if (!sub && !visitor) {
      return json({ error: "sub or visitor required" }, 400, cors(origin));
    }
    const row = await profiles.getProfile(env.DB, { sub: sub || null, visitor: visitor || null });
    if (!row) {
      return json({ profile: null }, 200, cors(origin));
    }
    const token = request.headers.get("X-XOGALAXY-Token") || url.searchParams.get("token") || "";
    const me = token ? await verifyProfile(env, token) : null;
    return json(
      {
        profile: Object.assign({}, row, {
          isOwner: isOwner(env, row.sub),
          isSelf: !!(me && row.sub && me.sub === row.sub),
        }),
      },
      200,
      cors(origin)
    );
  }

  if (request.method === "PUT") {
    if (await rateLimited(env, request, "profile", PROFILE_RATE_LIMIT)) {
      return json({ error: "rate limited" }, 429, cors(origin));
    }
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ error: "invalid json" }, 400, cors(origin));
    }
    const name = String(body.name || "").trim().slice(0, 40);
    const bio = String(body.bio || "").trim().slice(0, 300);
    const picture = String(body.picture || "").trim().slice(0, 500) || null;
    if (picture && !/^https?:\/\//i.test(picture)) {
      return json({ error: "invalid picture" }, 400, cors(origin));
    }
    let sub = null;
    let visitor = null;
    if (body.token) {
      const profile = await verifyProfile(env, String(body.token || ""));
      if (!profile) return json({ error: "unauthorized" }, 401, cors(origin));
      sub = profile.sub;
    } else {
      visitor = String(body.visitor || "").trim().slice(0, 64);
      if (!visitor) return json({ error: "visitor required" }, 400, cors(origin));
    }
    const row = await profiles.upsertProfile(env.DB, { sub, visitor, name, bio, picture });
    await ensurePosts(env.DB);
    await posts.updateAuthor(env.DB, { sub, visitor, name: row.name, picture: row.picture });
    await ensureFollowers(env.DB);
    await followers.syncProfile(env.DB, { sub, name: row.name, picture: row.picture });
    return json({ profile: row }, 200, cors(origin));
  }

  return json({ error: "method not allowed" }, 405, cors(origin));
}

// ---- newsletter ----

const NEWSLETTER_RATE_LIMIT = 5;

function newsletterLinks(subscriber) {
  const t = encodeURIComponent(subscriber.token);
  return {
    base: BLOG_URL,
    confirm: `${BLOG_URL}/subscribe/confirm?t=${t}`,
    unsubscribe: `${BLOG_URL}/unsubscribe?t=${t}`,
    prefs: `${BLOG_URL}/preferences?t=${t}`,
  };
}

async function handleSubscribe(request, env, origin) {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405, cors(origin));
  if (await rateLimited(env, request, "subscribe", NEWSLETTER_RATE_LIMIT)) {
    return json({ error: "too many requests" }, 429, cors(origin));
  }
  await ensureNewsletter(env.DB);
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "invalid json" }, 400, cors(origin));
  }
  const email = String(body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.toLowerCase())) {
    return json({ error: "email inválido" }, 400, cors(origin));
  }
  const res = await newsletter.subscribe(env.DB, { email, name: body.name, prefs: body.prefs });
  if (res.alreadyActive) {
    return json({ ok: true, message: "Ya estás suscripto a las novedades." }, 200, cors(origin));
  }
  const links = newsletterLinks(res.subscriber);
  const mail = emails.confirmEmail(res.subscriber, links);
  try {
    await sendEmail(env, {
      to: res.subscriber.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: { "List-Unsubscribe": `<${links.unsubscribe}>` },
    });
  } catch (err) {
    console.error("confirm email error:", err);
  }
  return json({ ok: true, message: "Revisá tu casilla para confirmar la suscripción." }, 201, cors(origin));
}

async function handleSubscribeConfirm(request, env, origin) {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, cors(origin));
  await ensureNewsletter(env.DB);
  const token = new URL(request.url).searchParams.get("t") || "";
  const s = await newsletter.confirm(env.DB, token);
  if (!s) {
    return html(
      emails.page("Suscripción",
        `<h1>Enlace inválido</h1><p>Este enlace de confirmación es inválido o ya fue usado. Si querés suscribirte, volvé a dejar tu correo en el blog.</p>` +
        `<p><a class="btn" href="${BLOG_URL}">Volver a XO Galaxy</a></p>`),
      400
    );
  }
  return html(
    emails.page("Suscripción confirmada",
      `<h1>Estás adentro! 🎉</h1><p>Confirmamos tu suscripción a las novedades de XO Galaxy. Vas a recibir juegos, actividades, tutoriales y joyas perdidas de la época XO.</p>` +
      `<p><a class="btn" href="${BLOG_URL}">Ir a XO Galaxy</a></p>`),
    200
  );
}

async function handleUnsubscribe(request, env, origin) {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, cors(origin));
  await ensureNewsletter(env.DB);
  const token = new URL(request.url).searchParams.get("t") || "";
  const s = await newsletter.unsubscribe(env.DB, token);
  if (!s) {
    return html(
      emails.page("Baja",
        `<h1>Enlace inválido</h1><p>Este enlace de baja es inválido o ya fue procesado.</p>` +
        `<p><a class="btn" href="${BLOG_URL}">Volver a XO Galaxy</a></p>`),
      400
    );
  }
  return html(
    emails.page("Te diste de baja",
      `<h1>Listo, te diste de baja</h1><p>No vas a recibir más novedades de XO Galaxy en <strong>${s.email}</strong>. Nos vemos en el blog!</p>` +
      `<p><a class="btn" href="${BLOG_URL}">Volver a XO Galaxy</a></p>`),
    200
  );
}

async function handlePreferences(request, env, origin) {
  await ensureNewsletter(env.DB);
  const url = new URL(request.url);
  const token = url.searchParams.get("t") || "";

  if (request.method === "POST") {
    let prefs = {};
    const ctype = request.headers.get("Content-Type") || "";
    if (ctype.includes("application/json")) {
      try {
        const body = await request.json();
        prefs = body.prefs || body;
      } catch (_) {
        return json({ error: "invalid json" }, 400, cors(origin));
      }
    } else {
      const fd = await request.formData();
      const topics = fd.getAll("topics").filter(Boolean);
      prefs = { topics, frequency: String(fd.get("frequency") || "weekly") };
    }
    const s = await newsletter.setPreferences(env.DB, token, prefs);
    if (!s) {
      return json({ error: "token inválido" }, 400, cors(origin));
    }
    return html(
      emails.page("Preferencias guardadas",
        `<h1>Preferencias guardadas</h1><p>Actualizamos tus temas y frecuencia. Cualquier cosa, siempre podés cambiarlas desde los mails que recibís.</p>` +
        `<p><a class="btn" href="${BLOG_URL}">Volver a XO Galaxy</a></p>`),
      200
    );
  }

  if (request.method !== "GET") return json({ error: "method not allowed" }, 405, cors(origin));

  const s = await newsletter.getByToken(env.DB, token);
  if (!s) {
    return html(
      emails.page("Preferencias",
        `<h1>Enlace inválido</h1><p>Este enlace de preferencias es inválido o ya fue procesado.</p>` +
        `<p><a class="btn" href="${BLOG_URL}">Volver a XO Galaxy</a></p>`),
      400
    );
  }
  const checked = s.prefs.topics;
  const topicInputs = emails.TOPICS.map(
    (t) => `<label class="field"><input type="checkbox" name="topics" value="${t}" ${checked.includes(t) ? "checked" : ""} style="margin-right:6px"/>${emails.topicLabel(t)}</label>`
  ).join("");
  const freqOptions = [["weekly", "Semanal"], ["monthly", "Mensual"]].map(
    ([v, l]) => `<option value="${v}" ${s.prefs.frequency === v ? "selected" : ""}>${l}</option>`
  ).join("");
  return html(
    emails.page("Preferencias",
      `<h1>Preferencias</h1>` +
      `<form method="POST" action="/preferences?t=${encodeURIComponent(s.token)}">` +
      `<div class="field"><label>Temas que te interesan</label>${topicInputs}</div>` +
      `<div class="field"><label>Frecuencia</label><select name="frequency">${freqOptions}</select></div>` +
      `<div class="field"><button>Guardar</button></div>` +
      `</form>` +
      `<p style="font-size:12px;color:#8b95a9">Recibís esta edición en <strong>${s.email}</strong>.</p>`),
    200
  );
}

export async function sendNewsletterDigest(env) {
  await ensureNewsletter(env.DB);
  const since = Date.now() - 7 * 86400000;
  const recent = (await posts.approvedPosts(env.DB)).filter((p) => (p.approvedAt || 0) >= since);
  const weekly = await newsletter.activeSubscribers(env.DB, {
    frequency: "weekly",
    dueBefore: Date.now() - 6 * 86400000,
  });
  const monthly = await newsletter.activeSubscribers(env.DB, {
    frequency: "monthly",
    dueBefore: Date.now() - 28 * 86400000,
  });
  const targets = [...weekly, ...monthly];
  let sent = 0;
  let failed = 0;
  for (const s of targets) {
    const links = newsletterLinks(s);
    const mail = emails.digestEmail(s, recent, links);
    try {
      const info = await sendEmail(env, {
        to: s.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: {
          "List-Unsubscribe": `<${links.unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await newsletter.logSend(env.DB, s.id, mail.subject, info.messageId, "sent");
      sent += 1;
    } catch (err) {
      console.error("digest send error:", s.email, err);
      await newsletter.logSend(env.DB, s.id, mail.subject, null, "failed");
      failed += 1;
    }
  }
  return { sent, failed, posts: recent.length, targets: targets.length };
}

// ---- helpers ----

function authorizedMod(request, env) {
  const auth = request.headers.get("Authorization");
  return Boolean(env.MOD_KEY && auth === `Bearer ${env.MOD_KEY}`);
}

async function ownerFromRequest(env, request, body) {
  const auth = request.headers.get("Authorization");
  if (env.MOD_KEY && auth === `Bearer ${env.MOD_KEY}`) return { role: "mod" };
  const token = (request.headers.get("X-XOGALAXY-Token") || (body && body.token) || "").trim();
  if (!token) return null;
  const profile = await verifyProfile(env, token);
  if (!profile || !isOwner(env, profile.sub)) return null;
  return { role: "owner", profile };
}

async function rateLimited(env, request, key, limit, windowSec = 3600) {
  const cf = request.cf || {};
  const ip = request.headers.get("CF-Connecting-IP") || cf.connectingIp || "unknown";
  let digest;
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key + ":" + ip));
    digest = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    return false;
  }
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const k = `rl:${digest}:${bucket}`;
  const n = Number(await env.XOGALAXY_KV.get(k)) || 0;
  if (n >= limit) return true;
  await env.XOGALAXY_KV.put(k, String(n + 1), { expirationTtl: windowSec });
  return false;
}

async function buildBackup(env) {
  await ensureComments(env.DB);
  await ensurePosts(env.DB);
  await ensureEngagement(env.DB);
  await ensureFollowers(env.DB);
  await ensureProfiles(env.DB);
  await ensureNewsletter(env.DB);
  const commentsExport = await comments.exportAll(env.DB);
  const postsExport = await posts.exportAll(env.DB);
  const engagementExport = await engagement.exportAll(env.DB);
  const followersExport = await followers.exportAll(env.DB);
  const profilesExport = await profiles.exportAll(env.DB);
  const newsletterExport = await newsletter.exportAll(env.DB);
  const chat = {};
  for (const room of CHAT_ROOMS) {
    const stub = env.ROOM.getByName(room);
    chat[room] = await stub.export(room);
  }
  return {
    exportedAt: new Date().toISOString(),
    schema: 6,
    comments: commentsExport,
    posts: postsExport,
    engagement: engagementExport,
    followers: followersExport,
    profiles: profilesExport,
    newsletter: newsletterExport,
    chat,
  };
}

async function pushBackupToGitHub(env, backup) {
  const token = env.XOGALAXY_GH_TOKEN;
  const repo = (env.XOGALAXY_GH_REPO || "").trim();
  if (!token || !repo) throw new Error("XOGALAXY_GH_TOKEN/XOGALAXY_GH_REPO not configured");
  const json = JSON.stringify(backup, null, 2);
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const content = btoa(bin);
  const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
  const path = `backups/data-${date}.json`;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "xogalaxy-backend",
    },
    body: JSON.stringify({ message: `backup ${date}`, content }),
  });
  if (!res.ok) throw new Error(`github backup HTTP ${res.status}: ${await res.text()}`);
  return path;
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
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

function html(body, status, headers) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
