/**
 * XO Galaxy — menciones @nombre y notificaciones.
 * Extrae menciones del texto, las resuelve contra los perfiles verificados de
 * D1 (cuentas Google; los anónimos no tienen identidad que notificar) y crea
 * filas en la tabla notifications. También alimenta /users/suggest.
 */

const NAME_RE = /@([\p{L}\p{N}][\p{L}\p{N}_.-]{1,31})/gu;
const MAX_MENTIONS = 20;

async function migrate(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_sub TEXT NOT NULL,
        type TEXT NOT NULL,
        actor_sub TEXT,
        actor_name TEXT NOT NULL,
        actor_pic TEXT,
        excerpt TEXT NOT NULL DEFAULT '',
        ref TEXT,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_sub, id)`),
  ]);
}

function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (c) => "\\" + c);
}

/** Nombres @mencionados únicos, en orden de aparición (máx MAX_MENTIONS). */
function extractMentionNames(text) {
  const out = [];
  const seen = new Set();
  const s = String(text || "");
  NAME_RE.lastIndex = 0;
  let m;
  while ((m = NAME_RE.exec(s)) !== null) {
    const name = m[1];
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
      if (out.length >= MAX_MENTIONS) break;
    }
  }
  return out;
}

/**
 * Resuelve nombres mencionados a perfiles verificados.
 * Match exacto (case-insensitive); si no hay, el primer perfil cuyo nombre empiece con el nombre mencionado.
 */
async function resolveMentions(db, text) {
  const names = extractMentionNames(text);
  if (!names.length) return [];
  const resolved = [];
  const seenSubs = new Set();
  for (const name of names) {
    const row =
      (
        await db
          .prepare(`SELECT id, name, picture FROM profiles WHERE id LIKE 's:%' AND LOWER(name) = LOWER(?) LIMIT 1`)
          .bind(name)
          .first()
      ) ||
      (await db
        .prepare(`SELECT id, name, picture FROM profiles WHERE id LIKE 's:%' AND LOWER(name) LIKE LOWER(?) || '%' ORDER BY LENGTH(name) ASC LIMIT 1`)
        .bind(name)
        .first());
    if (!row) continue;
    const sub = row.id.slice(2);
    if (seenSubs.has(sub)) continue;
    seenSubs.add(sub);
    resolved.push({ sub, name: row.name, picture: row.picture || null });
  }
  return resolved;
}

/**
 * Crea notificaciones para los usuarios mencionados en text (excepto el actor).
 * Devuelve cuántas notificaciones creó. Nunca lanza: las menciones son best-effort.
 */
async function notifyMentions(db, { text, type, actor = null, excerpt = "", ref = null }) {
  try {
    const people = await resolveMentions(db, text);
    const targets = actor && actor.sub ? people.filter((p) => p.sub !== actor.sub) : people;
    if (!targets.length) return 0;
    const cut = String(excerpt || "").replace(/\s+/g, " ").trim().slice(0, 140);
    await db.batch(
      targets.map((p) =>
        db
          .prepare(
            `INSERT INTO notifications (user_sub, type, actor_sub, actor_name, actor_pic, excerpt, ref, created_at, read)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
          )
          .bind(
            p.sub,
            type,
            actor && actor.sub ? actor.sub : null,
            (actor && actor.name) || "Alguien",
            actor && actor.picture ? actor.picture : null,
            cut,
            ref,
            Date.now()
          )
      )
    );
    return targets.length;
  } catch (err) {
    console.error("mentions error:", err);
    return 0;
  }
}

/** Sugerencias de usuarios para autocomplete (solo cuentas Google). */
async function suggestUsers(db, q, limit = 8) {
  const query = likeEscape(String(q || "").trim()).slice(0, 32);
  if (query.length < 2) return [];
  const lim = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const { results } = await db
    .prepare(
      `SELECT id, name, picture FROM profiles
       WHERE id LIKE 's:%' AND name LIKE ? ESCAPE '\\'
       ORDER BY CASE WHEN LOWER(name) LIKE LOWER(?) ESCAPE '\\' THEN 0 ELSE 1 END, name ASC
       LIMIT ?`
    )
    .bind("%" + query + "%", query, lim)
    .all();
  return (results || []).map((r) => ({
    sub: r.id.slice(2),
    name: r.name,
    picture: r.picture || null,
  }));
}

async function listNotifications(db, userSub, limit = 20) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const { results } = await db
    .prepare(
      `SELECT id, type, actor_sub, actor_name, actor_pic, excerpt, ref, created_at, read
       FROM notifications WHERE user_sub = ? ORDER BY id DESC LIMIT ?`
    )
    .bind(userSub, lim)
    .all();
  const items = (results || []).map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor_sub ? { sub: r.actor_sub, name: r.actor_name, picture: r.actor_pic || null } : { name: r.actor_name, picture: r.actor_pic || null },
    excerpt: r.excerpt,
    ref: r.ref || null,
    createdAt: r.created_at,
    read: r.read === 1,
  }));
  const unreadRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_sub = ? AND read = 0`)
    .bind(userSub)
    .first();
  return { items, unread: unreadRow ? unreadRow.n : 0 };
}

async function markAllRead(db, userSub) {
  await db.prepare(`UPDATE notifications SET read = 1 WHERE user_sub = ? AND read = 0`).bind(userSub).run();
  return { ok: true };
}

async function exportAll(db) {
  const { results } = await db.prepare(`SELECT * FROM notifications ORDER BY id ASC`).all();
  return results || [];
}

export { migrate, extractMentionNames, resolveMentions, notifyMentions, suggestUsers, listNotifications, markAllRead, exportAll };
