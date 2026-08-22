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
          CAPTURE_AUTH_SECRET: "test-capture-auth-secret-32-bytes-minimum",
          ALLOWED_BUILDS: "build+dirty",
          APPLE_TEAM_ID: "TESTTEAM1",
          APPLE_BUNDLE_IDS: "com.phejet.dubaicmd.test,com.phejet.dubaicmd.staging",
          APPLE_BUNDLE_VERSIONS: "1,2",
          APPLE_VALIDATION_CATEGORIES: "1,3",
          APPLE_ATTEST_ENVIRONMENTS: "development",
          ENROLLMENT_ENABLED: "true",
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
