import { DurableObject } from "cloudflare:workers";

export class Stats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS stats (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        )
      `);
    });
  }

  async get(key) {
    const row = this.ctx.storage.sql
      .exec("SELECT COALESCE(MAX(value), 0) AS value FROM stats WHERE key = ?", key)
      .one();
    return row.value;
  }

  async hit(key) {
    this.ctx.storage.sql.exec(
      "INSERT INTO stats (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1",
      key
    );
    return this.get(key);
  }
}
