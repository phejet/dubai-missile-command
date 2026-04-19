import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import perfPlugin from "./vite-perf-plugin";
import replayPlugin from "./vite-replay-plugin";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isCapacitor = process.env.CAPACITOR === "1";

// https://vite.dev/config/
// React plugin kept for editor.html (dev tool) — the game itself is vanilla TS
export default defineConfig({
  plugins: [react(), replayPlugin(), perfPlugin()],
  base: isCapacitor ? "./" : "/dubai-missile-command/",
  build: {
    rollupOptions: {
      input: isCapacitor
        ? {
            main: resolve(__dirname, "index.html"),
          }
        : {
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
