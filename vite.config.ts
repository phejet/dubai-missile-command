import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import replayPlugin from "./vite-replay-plugin";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), replayPlugin()],
  base: "/dubai-missile-command/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
        sprites: resolve(__dirname, "sprites.html"),
      },
    },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/sound.ts",
        "src/headless/learn.ts",
        "src/headless/balance.ts",
        "src/headless/analyze-with-llm.ts",
        "src/headless/record.ts",
        "src/headless/train.ts",
        "src/headless/game-worker.ts",
      ],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
