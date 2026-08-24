/**
 * XO Galaxy — archivo nocturno del chat.
 * El cron diario (17 4 * * *) exporta los mensajes nuevos de cada sala desde el
 * DO Room hacia D1 (tabla chat_archive), usando un cursor por sala en KV.
 * Lectura pública por día; borrado moderador/owner marca deleted=1.
 */

const CURSOR_PREFIX = "chat_archive_cursor:";
const PAGE_LIMIT = 50;

async function migrate(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS chat_archive (
        room TEXT NOT NULL,
        msg_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        nickname TEXT NOT NULL,
        body TEXT NOT NULL,
        author_sub TEXT,
        author_name TEXT,
        author_pic TEXT,
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (room, msg_id)
      )
    `),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_archive_room_day ON chat_archive(room, day, msg_id)`),
  ]);
}

function dayOf(createdAt) {
  return new Date(Number(createdAt)).toISOString().slice(0, 10);
}

function rowToMessage(r) {
  return {
    id: r.msg_id,
    nickname: r.nickname,
    body: r.body,
    createdAt: r.created_at,
    day: r.day,
    author: r.author_sub
      ? { sub: r.author_sub, name: r.author_name || r.nickname, picture: r.author_pic || null }
      : null,
  };
}

async function insertMessages(db, room, messages) {
  if (!messages || !messages.length) return 0;
  const stmts = messages.map((m) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO chat_archive (room, msg_id, day, nickname, body, author_sub, author_name, author_pic, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        room,
        m.id,
        dayOf(m.createdAt),
        m.nickname || "Anónimo",
        m.body || "",
        m.author && m.author.sub ? m.author.sub : null,
        m.author && m.author.name ? m.author.name : null,
        m.author && m.author.picture ? m.author.picture : null,
        m.createdAt,
        m.deleted ? 1 : 0
      )
  );
  await db.batch(stmts);
  return messages.length;
}

async function listDays(db, room) {
  const { results } = await db
    .prepare(
      `SELECT day, COUNT(*) AS count FROM chat_archive WHERE room = ? AND deleted = 0 GROUP BY day ORDER BY day DESC`
    )
    .bind(room)
    .all();
  return results || [];
}

async function listByDay(db, room, day, cursor = 0, limit = PAGE_LIMIT) {
  const lim = Math.min(Math.max(Number(limit) || PAGE_LIMIT, 1), 200);
  const from = Number(cursor) || 0;
  const { results } = await db
    .prepare(
      `SELECT room, msg_id, day, nickname, body, author_sub, author_name, author_pic, created_at
       FROM chat_archive
       WHERE room = ? AND day = ? AND deleted = 0 AND msg_id > ?
       ORDER BY msg_id ASC LIMIT ?`
    )
    .bind(room, String(day).slice(0, 10), from, lim + 1)
    .all();
  const rows = results || [];
  const hasMore = rows.length > lim;
  const page = hasMore ? rows.slice(0, lim) : rows;
  return {
    room,
    day: String(day).slice(0, 10),
    messages: page.map(rowToMessage),
    nextCursor: hasMore ? page[page.length - 1].msg_id : null,
  };
}

async function markDeleted(db, room, msgId) {
  await db
    .prepare(`UPDATE chat_archive SET deleted = 1 WHERE room = ? AND msg_id = ?`)
    .bind(room, Number(msgId))
    .run();
  return { ok: true, id: Number(msgId) };
}

/**
 * Exporta los mensajes nuevos de cada sala. Devuelve resumen por sala.
 */
async function exportNightly(env, rooms) {
  const summary = {};
  for (const room of rooms || []) {
    let exported = 0;
    try {
      await migrate(env.DB);
      const key = CURSOR_PREFIX + room;
      const raw = await env.XOGALAXY_KV.get(key);
      let cursor = raw ? Number(raw) : 0;
      if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
      const stub = env.ROOM.getByName(room);
      for (let guard = 0; guard < 100; guard++) {
        const batch = await stub.exportSince(room, cursor, 5000);
        if (!batch.length) break;
        await insertMessages(env.DB, room, batch);
        cursor = batch[batch.length - 1].id;
        exported += batch.length;
        if (batch.length < 5000) break;
      }
      await env.XOGALAXY_KV.put(key, String(cursor));
    } catch (err) {
      console.error("chat archive error:", room, err);
      summary[room] = { ok: false, error: String(err && err.message ? err.message : err) };
      continue;
    }
    summary[room] = { ok: true, exported };
  }
  return summary;
}

async function exportAll(db) {
  const { results } = await db
    .prepare(
      `SELECT room, msg_id, day, nickname, body, author_sub, author_name, author_pic, created_at, deleted
       FROM chat_archive ORDER BY room ASC, msg_id ASC`
    )
    .all();
  return results || [];
}

export { migrate, insertMessages, listDays, listByDay, markDeleted, exportNightly, exportAll, dayOf };
