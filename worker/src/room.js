import { DurableObject } from "cloudflare:workers";

const NICK_MAX = 32;
const BODY_MAX = 1000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const { version } = sql
      .exec("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations")
      .one();
    if (version < 1) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room TEXT NOT NULL,
          nickname TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, id);
        INSERT INTO _sql_schema_migrations (id) VALUES (1);
      `);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = (url.searchParams.get("room") || "general").slice(0, 64);
    const nickname = (url.searchParams.get("nick") || "Anónimo").slice(0, NICK_MAX);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server, [room]);
    server.serializeAttachment({ nickname, room });
    server.send(JSON.stringify({ type: "history", messages: this.history(room, 50) }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    let data;
    try {
      data = JSON.parse(message);
    } catch (err) {
      return;
    }
    if (data?.type !== "chat") return;

    const attachment = ws.deserializeAttachment?.() || {};
    let room;
    try {
      room = this.ctx.getTags(ws)[0];
    } catch (err) {
      room = null;
    }
    room = (room || attachment.room || "general").slice(0, 64);
    const nickname = String(attachment.nickname || "Anónimo").slice(0, NICK_MAX);
    const body = String(data.body || "").trim().slice(0, BODY_MAX);
    if (!body) return;

    await this.sendMessage(room, nickname, body);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    let room = "general";
    try {
      room = this.ctx.getTags(ws)[0] || "general";
    } catch (err) {
      room = "general";
    }
    console.log(`ws close room=${room} code=${code}`);
  }

  history(room, limit = 50) {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT id, nickname, body, created_at FROM messages
         WHERE room = ? AND deleted = 0 ORDER BY id DESC LIMIT ?`,
        room,
        Math.min(limit, 200)
      )
      .toArray()
      .reverse();
    return rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
    }));
  }

  async postMessage(room, nickname, body) {
    const res = this.ctx.storage.sql
      .exec(
        `INSERT INTO messages (room, nickname, body, created_at)
         VALUES (?, ?, ?, ?) RETURNING id, nickname, body, created_at`,
        room,
        nickname,
        body,
        Date.now()
      )
      .one();
    return {
      id: res.id,
      nickname: res.nickname,
      body: res.body,
      createdAt: res.created_at,
    };
  }

  async sendMessage(room, nickname, body) {
    const msg = await this.postMessage(room, nickname, body);
    this.broadcast(room, { type: "message", message: msg });
    return msg;
  }

  async modDelete(room, id) {
    this.ctx.storage.sql.exec("UPDATE messages SET deleted = 1 WHERE id = ? AND room = ?", id, room);
    this.broadcast(room, { type: "deleted", id });
    return { ok: true, id };
  }

  broadcast(room, obj) {
    const payload = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets(room)) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error("ws send error:", err);
      }
    }
  }
}
