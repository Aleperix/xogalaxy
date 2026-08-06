import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";

describe("Stats DO", () => {
  beforeEach(async () => {
    await reset();
  });

  it("increments and reads a key", async () => {
    const stub = env.STATS.getByName("global");
    expect(await stub.get("visits")).toBe(0);
    expect(await stub.hit("visits")).toBe(1);
    expect(await stub.hit("visits")).toBe(2);
    expect(await stub.get("visits")).toBe(2);
  });

  it("isolates different keys", async () => {
    const stub = env.STATS.getByName("global");
    await stub.hit("visits");
    expect(await stub.get("visits")).toBe(1);
    expect(await stub.get("other")).toBe(0);
  });

  it("persists values in SQLite storage", async () => {
    const stub = env.STATS.getByName("global");
    await stub.hit("visits");
    await stub.hit("visits");
    await runInDurableObject(stub, (instance, state) => {
      const rows = state.storage.sql
        .exec("SELECT key, value FROM stats ORDER BY key")
        .toArray();
      expect(rows).toEqual([{ key: "visits", value: 2 }]);
    });
  });
});
