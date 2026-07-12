import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import type { Plugin, ViteDevServer } from "vite";
import perfPlugin from "./vite-perf-plugin";
import replayPlugin from "./vite-replay-plugin";
import { getBuildId } from "./vite-build-id";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isCapacitor = process.env.CAPACITOR === "1";
const appBase = isCapacitor ? "./" : "/dubai-missile-command/";

function devHtmlEntryAliases(base: string): Plugin {
  const entries = new Map([[`${base}editor.html`, resolve(__dirname, "editor.html")]]);

  return {
    name: "dev-html-entry-aliases",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const url = new URL(req.url, "http://localhost");
        const entryPath = entries.get(url.pathname);
        if (!entryPath) {
          next();
          return;
        }

        server
          .transformIndexHtml(req.url, readFileSync(entryPath, "utf-8"))
          .then((html) => {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(html);
          })
          .catch(next);
      });
    },
  };
}

// https://vite.dev/config/
// React plugin kept for editor.html (dev tool) — the game itself is vanilla TS
export default defineConfig({
  plugins: [react(), devHtmlEntryAliases(appBase), replayPlugin(), perfPlugin()],
  base: appBase,
  define: {
    __DMC_BUILD_ID__: JSON.stringify(getBuildId()),
  },
  server: {
    allowedHosts: isCapacitor ? [".local"] : undefined,
    cors: { origin: true },
  },
  build: {
    rollupOptions: {
      input: isCapacitor
        ? {
            main: resolve(__dirname, "index.html"),
          }
        : {
            main: resolve(__dirname, "index.html"),
            editor: resolve(__dirname, "editor.html"),
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
