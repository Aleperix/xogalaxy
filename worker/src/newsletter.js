/**
 * XO Galaxy — suscriptores del newsletter en D1.
 * Flujo estricto de doble opt-in: POST /subscribe crea 'pending', se envía el
 * mail de confirmación con un token, GET /subscribe/confirm lo pasa a 'active'.
 * La baja es de un clic (token en List-Unsubscribe y en el cuerpo del mail).
 * El fallo de envío deja el suscriptor 'pending' para reintentar: nunca se
 * pierde la intención de suscribirse.
 */
import { parsePrefs } from "./emails.js";

export const SUB_STATUS = { PENDING: "pending", ACTIVE: "active", UNSUBSCRIBED: "unsubscribed" };

export const PREFS_DEFAULTS = { topics: [], frequency: "weekly" };

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function newToken() {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64];
  return s;
}

export async function migrate(db) {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        prefs TEXT NOT NULL DEFAULT '{"topics":[],"frequency":"weekly"}',
        token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        confirmed_at INTEGER,
        last_sent_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS newsletter_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent',
        message_id TEXT,
        sent_at INTEGER NOT NULL
      )`
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(token)`),
  ]);
}

function rowToSubscriber(r) {
  let prefs = PREFS_DEFAULTS;
  try {
    prefs = parsePrefs(JSON.parse(r.prefs || "null"));
  } catch (_) {
    /* prefs corruptas: usar defaults */
  }
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    prefs,
    token: r.token,
    status: r.status,
    confirmedAt: r.confirmed_at || null,
    lastSentAt: r.last_sent_at || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getByEmail(db, email) {
  const row = await db.prepare(`SELECT * FROM subscribers WHERE email = ?`).bind(normalizeEmail(email)).first();
  return row ? rowToSubscriber(row) : null;
}

export async function getByToken(db, token) {
  const row = await db.prepare(`SELECT * FROM subscribers WHERE token = ?`).bind(String(token || "").slice(0, 64)).first();
  return row ? rowToSubscriber(row) : null;
}

/**
 * Upsert de intención de suscripción. Devuelve { subscriber, fresh }:
 *  - nueva suscripción          → 'pending', fresh=true
 *  - 'unsubscribed' anterior    → vuelve a 'pending' (nuevo token), fresh=true
 *  - 'pending' existente        → se mantiene (reintento del mail), fresh=false
 *  - 'active' existente         → se mantiene (ya suscripto), fresh=false
 */
export async function subscribe(db, { email, name = "", prefs = null }) {
  const clean = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) throw new Error("email inválido");
  const cleanName = String(name || "").slice(0, 40);
  const cleanPrefs = JSON.stringify(parsePrefs(prefs));
  const existing = await getByEmail(db, clean);
  if (existing) {
    if (existing.status === SUB_STATUS.ACTIVE) {
      return { subscriber: existing, fresh: false, alreadyActive: true };
    }
    const token = newToken();
    await db
      .prepare(`UPDATE subscribers SET name = ?, prefs = ?, token = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(cleanName, cleanPrefs, token, SUB_STATUS.PENDING, Date.now(), existing.id)
      .run();
    return { subscriber: await getByEmail(db, clean), fresh: true, alreadyActive: false };
  }
  const now = Date.now();
  const res = await db
    .prepare(
      `INSERT INTO subscribers (email, name, prefs, token, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .bind(clean, cleanName, cleanPrefs, newToken(), SUB_STATUS.PENDING, now, now)
    .first();
  return { subscriber: rowToSubscriber(res), fresh: true, alreadyActive: false };
}

export async function confirm(db, token) {
  const s = await getByToken(db, token);
  if (!s) return null;
  if (s.status === SUB_STATUS.UNSUBSCRIBED) return null;
  if (s.status === SUB_STATUS.ACTIVE) return s;
  const now = Date.now();
  const res = await db
    .prepare(
      `UPDATE subscribers SET status = ?, confirmed_at = COALESCE(confirmed_at, ?), updated_at = ? WHERE id = ? AND status = ? RETURNING *`
    )
    .bind(SUB_STATUS.ACTIVE, now, now, s.id, SUB_STATUS.PENDING)
    .first();
  return res ? rowToSubscriber(res) : null;
}

export async function unsubscribe(db, token) {
  const s = await getByToken(db, token);
  if (!s) return null;
  const res = await db
    .prepare(`UPDATE subscribers SET status = ?, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(SUB_STATUS.UNSUBSCRIBED, Date.now(), s.id)
    .first();
  return res ? rowToSubscriber(res) : null;
}

export async function setPreferences(db, token, prefs) {
  const s = await getByToken(db, token);
  if (!s) return null;
  const cleanPrefs = JSON.stringify(parsePrefs(prefs));
  const res = await db
    .prepare(`UPDATE subscribers SET prefs = ?, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(cleanPrefs, Date.now(), s.id)
    .first();
  return res ? rowToSubscriber(res) : null;
}

export async function activeSubscribers(db, { frequency = null, dueBefore = null } = {}) {
  let sql = `SELECT * FROM subscribers WHERE status = ?`;
  const args = [SUB_STATUS.ACTIVE];
  if (frequency) {
    sql += ` AND json_extract(prefs, '$.frequency') = ?`;
    args.push(frequency);
  }
  if (dueBefore) {
    sql += ` AND (last_sent_at IS NULL OR last_sent_at < ?)`;
    args.push(dueBefore);
  }
  const rows = await db.prepare(sql).bind(...args).all();
  return rows.results.map(rowToSubscriber);
}

export async function logSend(db, subscriberId, subject, messageId, status = "sent") {
  await db
    .prepare(`INSERT INTO newsletter_sends (subscriber_id, subject, status, message_id, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(subscriberId, String(subject).slice(0, 300), String(status).slice(0, 20), messageId || null, Date.now())
    .run();
  if (status === "sent") {
    await db.prepare(`UPDATE subscribers SET last_sent_at = ? WHERE id = ?`).bind(Date.now(), subscriberId).run();
  }
}

export async function exportAll(db) {
  const subs = await db.prepare(`SELECT * FROM subscribers ORDER BY id ASC`).all();
  const sends = await db.prepare(`SELECT * FROM newsletter_sends ORDER BY id ASC`).all();
  return {
    subscribers: subs.results.map(rowToSubscriber),
    sends: sends.results,
  };
}

export async function importAll(db, data) {
  let imported = 0;
  const subs = (data && data.subscribers) || [];
  for (const s of Array.isArray(subs) ? subs : []) {
    if (!s || !s.email) continue;
    const email = normalizeEmail(s.email);
    if (!email) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO subscribers (id, email, name, prefs, token, status, confirmed_at, last_sent_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        s.id,
        email,
        String(s.name || "").slice(0, 40),
        JSON.stringify(parsePrefs(s.prefs)),
        String(s.token || newToken()).slice(0, 64),
        s.status === SUB_STATUS.ACTIVE ? SUB_STATUS.ACTIVE : s.status === SUB_STATUS.UNSUBSCRIBED ? SUB_STATUS.UNSUBSCRIBED : SUB_STATUS.PENDING,
        s.confirmedAt ? Number(s.confirmedAt) : null,
        s.lastSentAt ? Number(s.lastSentAt) : null,
        Number(s.createdAt) || Date.now(),
        Number(s.updatedAt) || Date.now()
      )
      .run();
    imported += 1;
  }
  const sends = (data && data.sends) || [];
  for (const s of Array.isArray(sends) ? sends : []) {
    if (!s || !s.subscriber_id) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO newsletter_sends (id, subscriber_id, subject, status, message_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        s.id,
        Number(s.subscriber_id),
        String(s.subject || "").slice(0, 300),
        String(s.status || "sent").slice(0, 20),
        s.message_id ? String(s.message_id).slice(0, 200) : null,
        Number(s.sent_at) || Date.now()
      )
      .run();
  }
  return imported;
}
