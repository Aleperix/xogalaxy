/**
 * XO Galaxy — comentarios propios (D1).
 * Autores Google verificados se publican directo; anónimos quedan 'pending'
 * hasta que el owner aprueba (ver /comments/mod/*).
 */

export const COMMENT_STATUS = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected" };

export async function migrate(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        author_sub TEXT,
        author_name TEXT NOT NULL,
        author_pic TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status)`),
  ]);
}

function rowToComment(r) {
  return {
    id: r.id,
    postId: r.post_id,
    author: {
      sub: r.author_sub || null,
      name: r.author_name,
      picture: r.author_pic || null,
    },
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
  };
}

export async function createComment(db, { postId, body, author }) {
  const res = await db
    .prepare(
      `INSERT INTO comments (post_id, author_sub, author_name, author_pic, body, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(
      postId,
      author.sub || null,
      author.name || "Anónimo",
      author.picture || null,
      body,
      author.sub ? COMMENT_STATUS.APPROVED : COMMENT_STATUS.PENDING,
      Date.now()
    )
    .first();
  return rowToComment(res);
}

export async function listComments(db, postId) {
  const rows = await db
    .prepare(
      `SELECT * FROM comments
       WHERE post_id = ? AND deleted = 0 AND status = ?
       ORDER BY id ASC`
    )
    .bind(postId, COMMENT_STATUS.APPROVED)
    .all();
  return rows.results.map(rowToComment);
}

export async function countComments(db, postId) {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM comments
       WHERE post_id = ? AND deleted = 0 AND status = ?`
    )
    .bind(postId, COMMENT_STATUS.APPROVED)
    .first();
  return r ? r.n : 0;
}

export async function totalComments(db) {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM comments
       WHERE deleted = 0 AND status = ?`
    )
    .bind(COMMENT_STATUS.APPROVED)
    .first();
  return r ? r.n : 0;
}

export async function pendingComments(db) {
  const rows = await db
    .prepare(
      `SELECT * FROM comments
       WHERE status = ? AND deleted = 0
       ORDER BY id ASC`
    )
    .bind(COMMENT_STATUS.PENDING)
    .all();
  return rows.results.map(rowToComment);
}

export async function reviewComment(db, id, action) {
  if (![COMMENT_STATUS.APPROVED, COMMENT_STATUS.REJECTED].includes(action)) {
    throw new Error("invalid action");
  }
  const r = await db
    .prepare(`UPDATE comments SET status = ? WHERE id = ? AND status = ? RETURNING *`)
    .bind(action, id, COMMENT_STATUS.PENDING)
    .first();
  return r ? rowToComment(r) : null;
}

export async function deleteComment(db, id, authorSub) {
  if (authorSub) {
    return db
      .prepare(`UPDATE comments SET deleted = 1 WHERE id = ? AND author_sub = ? RETURNING id`)
      .bind(id, authorSub)
      .first();
  }
  return db.prepare(`UPDATE comments SET deleted = 1 WHERE id = ? RETURNING id`).bind(id).first();
}

export async function exportAll(db) {
  const rows = await db.prepare(`SELECT * FROM comments ORDER BY id ASC`).all();
  return rows.results.map(rowToComment);
}

export async function importComments(db, rows) {
  let imported = 0;
  for (const c of Array.isArray(rows) ? rows : []) {
    if (!c || !c.postId || !c.body) continue;
    await db
      .prepare(
        `INSERT INTO comments (id, post_id, author_sub, author_name, author_pic, body, status, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
      )
      .bind(
        c.id,
        String(c.postId),
        (c.author && c.author.sub) || null,
        (c.author && c.author.name) || "Anónimo",
        (c.author && c.author.picture) || null,
        String(c.body),
        c.status || COMMENT_STATUS.PENDING,
        Number(c.createdAt) || Date.now(),
        c.deleted ? 1 : 0
      )
      .run();
    imported += 1;
  }
  return imported;
}
