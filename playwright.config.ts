import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  // Pixi gameplay and the graphics editor are both GPU/CPU-heavy. GitHub's
  // two-core hosted runners chronically starve concurrent browser contexts,
  // producing unrelated animation and mount timeouts across different specs.
  workers: process.env.CI ? 1 : undefined,
  // A failed test can leave Chromium's software renderer degraded even after
  // Playwright closes its context. CI retries replace the entire worker/browser,
  // giving renderer-dependent checks a clean process without weakening timeouts.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Sandboxed environments provide a pinned Chromium here; without the
    // override Playwright insists on its own version-matched download.
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
