/**
 * XO Galaxy — perfiles en D1.
 * Perfil editable por identidad: `sub:<sub>` para cuentas de Google y
 * `visitor:<visitor>` para visitantes anónimos. Nombre, bio y foto (URL).
 * El display name se sincroniza con los posts del autor (author_name/pic).
 */

export async function migrate(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      picture TEXT,
      updated_at INTEGER NOT NULL
    )`
  ).run();
}

function profileId(sub, visitor) {
  if (sub) return "s:" + String(sub).slice(0, 128);
  return "v:" + String(visitor || "").slice(0, 128);
}

function rowToProfile(r) {
  return {
    sub: r.id.startsWith("s:") ? r.id.slice(2) : null,
    visitor: r.id.startsWith("v:") ? r.id.slice(2) : null,
    name: r.name,
    bio: r.bio || "",
    picture: r.picture || null,
    updatedAt: r.updated_at,
  };
}

export async function getProfile(db, { sub = null, visitor = null }) {
  const row = await db.prepare(`SELECT * FROM profiles WHERE id = ?`).bind(profileId(sub, visitor)).first();
  return row ? rowToProfile(row) : null;
}

export async function upsertProfile(db, { sub = null, visitor = null, name = "", bio = "", picture = null }) {
  const cleanName = String(name || "").slice(0, 40) || "Anónimo";
  const cleanBio = String(bio || "").slice(0, 300);
  const cleanPic = picture && /^https?:\/\//i.test(picture) ? String(picture).slice(0, 500) : null;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO profiles (id, name, bio, picture, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         bio = excluded.bio,
         picture = excluded.picture,
         updated_at = excluded.updated_at`
    )
    .bind(profileId(sub, visitor), cleanName, cleanBio, cleanPic, now)
    .run();
  return rowToProfile(await db.prepare(`SELECT * FROM profiles WHERE id = ?`).bind(profileId(sub, visitor)).first());
}

export async function exportAll(db) {
  const rows = await db.prepare(`SELECT * FROM profiles ORDER BY id ASC`).all();
  return rows.results.map(rowToProfile);
}

export async function importAll(db, rows) {
  let imported = 0;
  for (const p of Array.isArray(rows) ? rows : []) {
    const id = p.id || (p.sub ? "s:" + p.sub : p.visitor ? "v:" + p.visitor : null);
    if (!id) continue;
    await db
      .prepare(`INSERT OR IGNORE INTO profiles (id, name, bio, picture, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(
        String(id).slice(0, 128),
        String(p.name || "Anónimo").slice(0, 40),
        String(p.bio || "").slice(0, 300),
        p.picture ? String(p.picture).slice(0, 500) : null,
        Number(p.updatedAt) || Date.now()
      )
      .run();
    imported += 1;
  }
  return imported;
}
