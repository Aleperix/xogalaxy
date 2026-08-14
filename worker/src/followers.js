/**
 * XO Galaxy — seguidores en D1.
 * Un seguidor es una sesión de Google (sub verificado). La identidad viene del
 * ID token verificado en /auth/verify, nunca de un scraper de Blogger.
 */

export async function migrate(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS followers (
        sub TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        picture TEXT,
        created_at INTEGER NOT NULL
      )`
    ),
  ]);
}

function rowToFollower(r) {
  return {
    sub: r.sub,
    name: r.name,
    picture: r.picture || null,
    createdAt: r.created_at,
  };
}

export async function follow(db, { sub, name, picture }) {
  await db
    .prepare(
      `INSERT INTO followers (sub, name, picture, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (sub) DO UPDATE SET name = excluded.name, picture = excluded.picture`
    )
    .bind(sub, String(name || "").slice(0, 40), picture || null, Date.now())
    .run();
  return rowToFollower(await db.prepare(`SELECT * FROM followers WHERE sub = ?`).bind(sub).first());
}

export async function unfollow(db, sub) {
  const res = await db.prepare(`DELETE FROM followers WHERE sub = ?`).bind(sub).run();
  return res.meta.changes > 0;
}

export async function countFollowers(db) {
  const row = await db.prepare(`SELECT COUNT(*) AS c FROM followers`).first();
  return Number(row ? row.c : 0);
}

export async function isFollowing(db, sub) {
  const row = await db.prepare(`SELECT 1 FROM followers WHERE sub = ?`).bind(sub).first();
  return Boolean(row);
}

export async function getFollower(db, sub) {
  const row = await db.prepare(`SELECT * FROM followers WHERE sub = ?`).bind(sub).first();
  return row ? rowToFollower(row) : null;
}

export async function syncProfile(db, { sub, name, picture }) {
  if (!sub) return;
  await db
    .prepare(`UPDATE followers SET name = ?, picture = ? WHERE sub = ?`)
    .bind(String(name || "").slice(0, 40), picture || null, sub)
    .run();
}

export async function listFollowers(db, limit = 100) {
  const rows = await db
    .prepare(`SELECT * FROM followers ORDER BY created_at ASC LIMIT ?`)
    .bind(Math.min(Number(limit) || 100, 200))
    .all();
  return rows.results.map(rowToFollower);
}

export async function listFollowersMerged(db, limit = 100) {
  const rows = await db
    .prepare(
      `SELECT f.sub, f.created_at,
              COALESCE(p.name, f.name) AS name,
              COALESCE(p.picture, f.picture) AS picture
       FROM followers f
       LEFT JOIN profiles p ON p.id = 's:' || f.sub
       ORDER BY f.created_at ASC LIMIT ?`
    )
    .bind(Math.min(Number(limit) || 100, 200))
    .all();
  return rows.results.map((r) => ({
    sub: r.sub,
    name: r.name,
    picture: r.picture || null,
    createdAt: r.created_at,
  }));
}

export async function exportAll(db) {
  const rows = await db.prepare(`SELECT * FROM followers ORDER BY sub ASC`).all();
  return rows.results.map(rowToFollower);
}

export async function importAll(db, rows) {
  let imported = 0;
  for (const f of Array.isArray(rows) ? rows : []) {
    if (!f || !f.sub) continue;
    await db
      .prepare(`INSERT OR IGNORE INTO followers (sub, name, picture, created_at) VALUES (?, ?, ?, ?)`)
      .bind(
        String(f.sub).slice(0, 64),
        String(f.name || "Anónimo").slice(0, 40),
        f.picture || null,
        Number(f.createdAt) || Date.now()
      )
      .run();
    imported += 1;
  }
  return imported;
}
