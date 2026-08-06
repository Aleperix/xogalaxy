import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { MOD_KEY: "test-mod-key" },
      },
    }),
  ],
  test: {
    maxWorkers: 1,
    minWorkers: 1,
  },
});
