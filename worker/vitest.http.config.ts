import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const workerRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    include: [`${workerRoot}test/http-wire.test.ts`],
    testTimeout: 30_000,
  },
});
