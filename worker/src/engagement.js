/**
 * XO Galaxy — engagement (ratings y reacciones) en D1.
 * ratings:   estrellas 1..5 por target y usuario. PK (target, user_sub).
 *            value <= 0 borra el voto. value en [1..5] es upsert.
 * reactions: toggles (emoji o texto) por target/usuario/tipo. PK anti-duplicado:
 *            re-reaccionar desactiva.
 * Las identidades son opacas: sub de Google o un id de visitante (localStorage).
 */
export const RATING_MAX = 5;
const TARGET_MAX = 200;
const USER_MAX = 64;
const TYPE_MAX = 32;

export function sanitizeTarget(s) {
  return String(s || "").trim().slice(0, TARGET_MAX);
}

export function sanitizeUser(s) {
  return String(s || "").trim().slice(0, USER_MAX).replace(/[^A-Za-z0-9_-]/g, "");
}

export function sanitizeType(s) {
  return String(s || "").trim().slice(0, TYPE_MAX);
}

export function migrate(db) {
  return db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ratings (
        target TEXT NOT NULL,
        user_sub TEXT NOT NULL,
        value INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (target, user_sub)
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ratings_target ON ratings(target)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS reactions (
        target TEXT NOT NULL,
        user_sub TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (target, user_sub, type)
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target)`),
  ]);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function rate(db, { target, user, value }) {
  const now = Date.now();
  if (value <= 0) {
    await db.prepare(`DELETE FROM ratings WHERE target = ? AND user_sub = ?`).bind(target, user).run();
    return ratingSummary(db, target, user);
  }
  await db
    .prepare(
      `INSERT INTO ratings (target, user_sub, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (target, user_sub) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(target, user, value, now, now)
    .run();
  return ratingSummary(db, target, user);
}

export async function ratingSummary(db, target, user = null) {
  const agg = await db
    .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(value), 0) AS s FROM ratings WHERE target = ?`)
    .bind(target)
    .first();
  const mine = user
    ? await db.prepare(`SELECT value FROM ratings WHERE target = ? AND user_sub = ?`).bind(target, user).first()
    : null;
  const count = Number(agg ? agg.c : 0);
  const total = Number(agg ? agg.s : 0);
  return {
    target,
    count,
    avg: count ? round2(total / count) : 0,
    value: mine ? Number(mine.value) : 0,
  };
}

export async function ratingSummaries(db, targets) {
  const out = {};
  for (const t of targets) out[t] = await ratingSummary(db, t, null);
  return out;
}

export async function react(db, { target, user, type }) {
  const existing = await db
    .prepare(`SELECT 1 FROM reactions WHERE target = ? AND user_sub = ? AND type = ?`)
    .bind(target, user, type)
    .first();
  if (existing) {
    await db
      .prepare(`DELETE FROM reactions WHERE target = ? AND user_sub = ? AND type = ?`)
      .bind(target, user, type)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO reactions (target, user_sub, type, created_at) VALUES (?, ?, ?, ?)`)
      .bind(target, user, type, Date.now())
      .run();
  }
  return reactionCounts(db, target);
}

export async function reactionCounts(db, target) {
  const rows = await db.prepare(`SELECT type, COUNT(*) AS c FROM reactions WHERE target = ? GROUP BY type`).bind(target).all();
  const counts = {};
  for (const r of rows.results) counts[r.type] = Number(r.c);
  return { target, counts };
}

export async function reactionSummaries(db, targets) {
  const out = {};
  for (const t of targets) out[t] = await reactionCounts(db, t);
  return out;
}

export async function exportAll(db) {
  const ratings = await db.prepare(`SELECT target, user_sub, value, created_at, updated_at FROM ratings`).all();
  const reactions = await db.prepare(`SELECT target, user_sub, type, created_at FROM reactions`).all();
  return { ratings: ratings.results, reactions: reactions.results };
}

export async function importAll(db, data) {
  let imported = 0;
  for (const r of data.ratings || []) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ratings (target, user_sub, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(String(r.target).slice(0, TARGET_MAX), String(r.user_sub).slice(0, USER_MAX), Number(r.value), Number(r.created_at) || Date.now(), Number(r.updated_at) || Number(r.created_at) || Date.now())
      .run();
    imported += 1;
  }
  for (const r of data.reactions || []) {
    await db
      .prepare(`INSERT OR IGNORE INTO reactions (target, user_sub, type, created_at) VALUES (?, ?, ?, ?)`)
      .bind(String(r.target).slice(0, TARGET_MAX), String(r.user_sub).slice(0, USER_MAX), String(r.type).slice(0, TYPE_MAX), Number(r.created_at) || Date.now())
      .run();
    imported += 1;
  }
  return imported;
}
