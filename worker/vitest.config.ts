import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const workerRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: `${workerRoot}wrangler.jsonc` },
      miniflare: {
        bindings: {
          CAPTURE_BEARER_TOKEN: "test-secret",
          TEST_MIGRATIONS: await readD1Migrations(`${workerRoot}migrations`),
        },
      },
    })),
  ],
  test: {
    include: [`${workerRoot}{src,test}/**/*.test.ts`],
    exclude: [`${workerRoot}test/http-wire.test.ts`],
    setupFiles: [`${workerRoot}test/apply-migrations.ts`],
  },
});
