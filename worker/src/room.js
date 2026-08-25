import { DurableObject } from "cloudflare:workers";
import { Auth } from "./auth.js";
import { getProfile } from "./profiles.js";
import { notifyMentions, migrate as ensureMentionTables } from "./mentions.js";

const NICK_MAX = 64;
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
    if (version < 2) {
      sql.exec(`
        ALTER TABLE messages ADD COLUMN author_sub TEXT;
        ALTER TABLE messages ADD COLUMN author_name TEXT;
        ALTER TABLE messages ADD COLUMN author_pic TEXT;
        INSERT INTO _sql_schema_migrations (id) VALUES (2);
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
    if (data?.type === "chat") {
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

      const author = await this.verifiedAuthor(data.token);
      await this.sendMessage(room, nickname, body, author);
      return;
    }
  }

  roomOf(ws) {
    try {
      return this.ctx.getTags(ws)[0] || "general";
    } catch (err) {
      return (ws.deserializeAttachment?.() || {}).room || "general";
    }
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
        `SELECT id, nickname, body, created_at, author_sub, author_name, author_pic FROM messages
         WHERE room = ? AND deleted = 0 ORDER BY id DESC LIMIT ?`,
        room,
        Math.min(limit, 200)
      )
      .toArray()
      .reverse();
    return rows.map(this.rowToMessage);
  }

  rowToMessage(r) {
    return {
      id: r.id,
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
      author: r.author_sub
        ? { sub: r.author_sub, name: r.author_name || r.nickname, picture: r.author_pic || null }
        : null,
    };
  }

  async postMessage(room, nickname, body, author = null) {
    const res = this.ctx.storage.sql
      .exec(
        `INSERT INTO messages (room, nickname, body, created_at, author_sub, author_name, author_pic)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, nickname, body, created_at, author_sub, author_name, author_pic`,
        room,
        nickname,
        body,
        Date.now(),
        author ? author.sub : null,
        author ? author.name : null,
        author ? author.picture : null
      )
      .one();
    return this.rowToMessage(res);
  }

  async sendMessage(room, nickname, body, author = null) {
    const msg = await this.postMessage(room, nickname, body, author);
    this.broadcast(room, { type: "message", message: msg });
    if (author && author.sub) {
      if (!this.notifReady) {
        await ensureMentionTables(this.env.DB);
        this.notifReady = true;
      }
      await notifyMentions(this.env.DB, {
        text: body,
        type: "mention_chat",
        actor: { sub: author.sub, name: (msg.author && msg.author.name) || nickname, picture: author.picture },
        excerpt: body,
        ref: "chat",
      });
    }
    return msg;
  }

  async verifiedAuthor(token) {
    if (!token) return null;
    try {
      if (!this.auth) this.auth = new Auth(this.env);
      const profile = await this.auth.verify(token, this.env.GOOGLE_CLIENT_ID);
      let merged = { sub: profile.sub, name: profile.name || "", picture: profile.picture || null };
      try {
        const row = await getProfile(this.env.DB, { sub: profile.sub });
        if (row) merged = { sub: profile.sub, name: row.name, picture: row.picture };
      } catch (err) {
        console.error("chat profile merge error:", err);
      }
      return merged;
    } catch (err) {
      console.error("chat auth error:", err);
      return null;
    }
  }

  async updateAuthor(sub, name, picture) {
    if (!sub) return { ok: false };
    this.ctx.storage.sql.exec(
      "UPDATE messages SET author_name = ?, author_pic = ? WHERE author_sub = ? AND deleted = 0",
      String(name || "").slice(0, 40),
      picture || null,
      sub
    );
    return { ok: true };
  }

  export(room, limit = 5000) {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT id, nickname, body, created_at, deleted, author_sub, author_name, author_pic FROM messages
         WHERE room = ? ORDER BY id ASC LIMIT ?`,
        room,
        limit
      )
      .toArray();
    return rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
      deleted: r.deleted === 1,
      author: r.author_sub
        ? { sub: r.author_sub, name: r.author_name || r.nickname, picture: r.author_pic || null }
        : null,
    }));
  }

  exportSince(room, sinceId = 0, limit = 5000) {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT id, nickname, body, created_at, deleted, author_sub, author_name, author_pic FROM messages
         WHERE room = ? AND id > ? ORDER BY id ASC LIMIT ?`,
        room,
        Number(sinceId) || 0,
        Math.min(limit, 5000)
      )
      .toArray();
    return rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
      deleted: r.deleted === 1,
      author: r.author_sub
        ? { sub: r.author_sub, name: r.author_name || r.nickname, picture: r.author_pic || null }
        : null,
    }));
  }

  async modDelete(room, id) {
    this.ctx.storage.sql.exec("UPDATE messages SET deleted = 1 WHERE id = ? AND room = ?", id, room);
    this.broadcast(room, { type: "deleted", id });
    return { ok: true, id };
  }

  async clearRoom(room) {
    const before = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS n FROM messages WHERE room = ? AND deleted = 0", room)
      .one();
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE room = ?", room);
    this.broadcast(room, { type: "cleared", room });
    return { ok: true, room, removed: before.n };
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
