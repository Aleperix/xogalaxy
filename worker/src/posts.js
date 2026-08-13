/**
 * XO Galaxy — aportes (tool de posts, D1).
 * Los aportes se escriben en Markdown y SIEMPRE quedan 'pending': el owner
 * los revisa en su bandeja (ver /posts/mod/*), los aprueba y los publica
 * manualmente en Blogger (el tool permite copiar el HTML/Markdown resultante).
 * La lista aprobada NO es pública: solo la ve el owner.
 */

export const POST_STATUS = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };

export async function migrate(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author_sub TEXT,
        author_name TEXT NOT NULL,
        author_pic TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        post_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        approved_at INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at)`),
  ]);
  const cols = await db.prepare(`PRAGMA table_info(posts)`).all();
  if (!cols.results.some((c) => c.name === "author_visitor")) {
    await db.prepare(`ALTER TABLE posts ADD COLUMN author_visitor TEXT`).run();
  }
}

function rowToPost(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    author: {
      sub: r.author_sub || null,
      visitor: r.author_visitor || null,
      name: r.author_name,
      picture: r.author_pic || null,
    },
    status: r.status,
    postUrl: r.post_url || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at || null,
    approvedAt: r.approved_at || null,
  };
}

export async function createPost(db, { title, body, author }) {
  const res = await db
    .prepare(
      `INSERT INTO posts (title, body, author_sub, author_visitor, author_name, author_pic, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      title,
      body,
      author.sub || null,
      author.visitor || null,
      author.name || "Anónimo",
      author.picture || null,
      POST_STATUS.PENDING,
      Date.now()
    )
    .first();
  return rowToPost(res);
}

export async function pendingPosts(db) {
  const rows = await db
    .prepare(
      `SELECT * FROM posts
       WHERE status = ? AND deleted = 0
       ORDER BY id ASC`
    )
    .bind(POST_STATUS.PENDING)
    .all();
  return rows.results.map(rowToPost);
}

export async function approvedPosts(db) {
  const rows = await db
    .prepare(
      `SELECT * FROM posts
       WHERE status = ? AND deleted = 0
       ORDER BY approved_at DESC, id DESC`
    )
    .bind(POST_STATUS.APPROVED)
    .all();
  return rows.results.map(rowToPost);
}

export async function myPosts(db, { sub = null, visitor = null }) {
  const rows = await db
    .prepare(
      `SELECT * FROM posts
       WHERE deleted = 0 AND (
         (author_sub IS NOT NULL AND author_sub = ?1)
         OR (author_sub IS NULL AND author_visitor = ?2)
       )
       ORDER BY created_at DESC`
    )
    .bind(sub, visitor)
    .all();
  return rows.results.map(rowToPost);
}

export async function authorPosts(db, sub, includePending) {
  const rows = await db
    .prepare(
      `SELECT * FROM posts
       WHERE deleted = 0 AND author_sub = ?1 AND (?2 = 1 OR status = ?3)
       ORDER BY approved_at DESC, created_at DESC`
    )
    .bind(sub, includePending ? 1 : 0, POST_STATUS.APPROVED)
    .all();
  return rows.results.map(rowToPost);
}

export async function reviewPost(db, id, action) {
  if (![POST_STATUS.APPROVED, POST_STATUS.REJECTED].includes(action)) {
    throw new Error("invalid action");
  }
  const now = Date.now();
  const r = await db
    .prepare(
      `UPDATE posts SET status = ?, updated_at = ?, approved_at = CASE WHEN ? = ? THEN ? ELSE approved_at END
       WHERE id = ? AND status = ? RETURNING *`
    )
    .bind(action, now, action, POST_STATUS.APPROVED, now, id, POST_STATUS.PENDING)
    .first();
  return r ? rowToPost(r) : null;
}

export async function setPostUrl(db, id, url) {
  const r = await db
    .prepare(`UPDATE posts SET post_url = ?, updated_at = ? WHERE id = ? AND status = ? RETURNING *`)
    .bind(url, Date.now(), id, POST_STATUS.APPROVED)
    .first();
  return r ? rowToPost(r) : null;
}

export async function deletePost(db, id, authorSub) {
  if (authorSub) {
    return db
      .prepare(`UPDATE posts SET deleted = 1 WHERE id = ? AND author_sub = ? AND status = ? RETURNING id`)
      .bind(id, authorSub, POST_STATUS.PENDING)
      .first();
  }
  return db.prepare(`UPDATE posts SET deleted = 1 WHERE id = ? RETURNING id`).bind(id).first();
}

export async function exportAll(db) {
  const rows = await db.prepare(`SELECT * FROM posts ORDER BY id ASC`).all();
  return rows.results.map(rowToPost);
}

export async function importPosts(db, rows) {
  let imported = 0;
  for (const p of Array.isArray(rows) ? rows : []) {
    if (!p || !p.title || !p.body) continue;
    await db
      .prepare(
        `INSERT INTO posts (id, title, body, author_sub, author_visitor, author_name, author_pic, status, post_url, created_at, updated_at, approved_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
      )
      .bind(
        p.id,
        String(p.title),
        String(p.body),
        (p.author && p.author.sub) || null,
        (p.author && p.author.visitor) || null,
        (p.author && p.author.name) || "Anónimo",
        (p.author && p.author.picture) || null,
        p.status || POST_STATUS.PENDING,
        p.postUrl || null,
        Number(p.createdAt) || Date.now(),
        p.updatedAt ? Number(p.updatedAt) : null,
        p.approvedAt ? Number(p.approvedAt) : null,
        p.deleted ? 1 : 0
      )
      .run();
    imported += 1;
  }
  return imported;
}
