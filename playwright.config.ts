import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: isCI ? 90000 : 30000,
  expect: { timeout: isCI ? 15000 : 5000 },
  // Pixi gameplay and the graphics editor are both GPU/CPU-heavy. GitHub's
  // two-core hosted runners chronically starve concurrent browser contexts,
  // producing unrelated animation and mount timeouts across different specs.
  workers: isCI ? 1 : undefined,
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Sandboxed environments provide a pinned Chromium here; without the
    // override Playwright insists on its own version-matched download.
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: !isCI,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
