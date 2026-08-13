import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          MOD_KEY: "test-mod-key",
          GOOGLE_CLIENT_ID: "test-client-id",
          OWNER_SUBS: "google-user-1",
          EMAIL_PROVIDER: "mock",
        },
        d1Databases: { DB: "test-db" },
      },
    }),
  ],
  test: {
    maxWorkers: 1,
    minWorkers: 1,
  },
});
