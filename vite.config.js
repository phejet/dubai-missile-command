import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import replayPlugin from "./vite-replay-plugin.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), replayPlugin()],
  base: "/dubai-missile-command/",
  test: {
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/main.jsx",
        "src/sound.js",
        "src/headless/learn.js",
        "src/headless/balance.js",
        "src/headless/analyze-with-llm.js",
        "src/headless/record.js",
        "src/headless/train.js",
        "src/headless/game-worker.js",
      ],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
