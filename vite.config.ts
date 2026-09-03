import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import type { Plugin, UserConfig, ViteDevServer } from "vite";
import perfPlugin from "./vite-perf-plugin";
import replayPlugin from "./vite-replay-plugin";
import capturePlugin from "./vite-capture-plugin";
import { getBuildId } from "./vite-build-id";
import {
  assertIosFlavorCaptureChannel,
  requireIosAppFlavor,
  type IosAppFlavor,
  type NativeCaptureChannel,
} from "./src/ios-flavors";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isCapacitor = process.env.CAPACITOR === "1";
const iosAppFlavor: IosAppFlavor | null = isCapacitor ? requireIosAppFlavor(process.env.DMC_APP_FLAVOR) : null;
const appBase = isCapacitor ? "./" : "/dubai-missile-command/";
const captureWorkerUrls = JSON.parse(readFileSync(resolve(__dirname, "capture-worker-urls.json"), "utf8")) as Record<
  "staging" | "production",
  string
>;

function captureChannel(command: "build" | "serve"): "off" | "local" | "staging" | "production" {
  if (command === "serve") {
    if (!isCapacitor) return "local";
    if (iosAppFlavor !== "dev") throw new Error("Capacitor live reload requires DMC_APP_FLAVOR=dev");
    const requested = process.env.DMC_CAPTURE_CHANNEL?.trim() || "off";
    if (requested !== "off" && requested !== "staging") {
      throw new Error(`Capacitor Dev live reload cannot use DMC_CAPTURE_CHANNEL=${requested}`);
    }
    assertIosFlavorCaptureChannel(iosAppFlavor, requested);
    return requested;
  }
  const requested = process.env.DMC_CAPTURE_CHANNEL?.trim() || "off";
  if (requested !== "off" && requested !== "staging" && requested !== "production") {
    throw new Error(`Invalid DMC_CAPTURE_CHANNEL: ${requested}`);
  }
  if (requested !== "off" && !isCapacitor) {
    throw new Error(`DMC_CAPTURE_CHANNEL=${requested} requires CAPACITOR=1`);
  }
  if (iosAppFlavor) assertIosFlavorCaptureChannel(iosAppFlavor, requested as NativeCaptureChannel);
  return requested;
}

function captureBaseUrl(channel: "off" | "local" | "staging" | "production"): string {
  if (channel === "off" || channel === "local") return "";
  const configured = captureWorkerUrls[channel]?.trim();
  if (!configured) {
    throw new Error(`capture-worker-urls.json must contain the reviewed ${channel} Worker URL`);
  }
  const parsed = new URL(configured);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${channel} capture Worker URL must be a public HTTPS origin without a path`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function shareBaseUrls(): Record<"staging" | "production", string> {
  return {
    staging: captureBaseUrl("staging"),
    production: captureWorkerUrls.production?.trim() ? captureBaseUrl("production") : "",
  };
}

function devHtmlEntryAliases(base: string): Plugin {
  const entries = new Map([
    [`${base}editor.html`, resolve(__dirname, "editor.html")],
    [`${base}operator.html`, resolve(__dirname, "operator.html")],
    [`${base}privacy.html`, resolve(__dirname, "privacy.html")],
  ]);

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

function nativeBuildManifest(
  flavor: IosAppFlavor | null,
  channel: "off" | "local" | "staging" | "production",
  buildId: string,
): Plugin {
  return {
    name: "native-build-manifest",
    apply: "build",
    generateBundle() {
      if (!flavor) return;
      this.emitFile({
        type: "asset",
        fileName: "dmc-native-build.json",
        source: `${JSON.stringify({ schema: 1, flavor, channel, buildId }, null, 2)}\n`,
      });
    },
  };
}

// https://vite.dev/config/
// React plugin kept for editor.html (dev tool) — the game itself is vanilla TS
export default defineConfig(({ command }): UserConfig => {
  const channel = captureChannel(command);
  const buildId = getBuildId();
  return {
    plugins: [
      react(),
      devHtmlEntryAliases(appBase),
      replayPlugin(),
      capturePlugin(),
      perfPlugin(),
      nativeBuildManifest(iosAppFlavor, channel, buildId),
    ],
    base: appBase,
    define: {
      __DMC_BUILD_ID__: JSON.stringify(buildId),
      __DMC_APP_FLAVOR__: JSON.stringify(iosAppFlavor ?? "web"),
      __DMC_CAPTURE_CHANNEL__: JSON.stringify(channel),
      __DMC_CAPTURE_BASE_URL__: JSON.stringify(captureBaseUrl(channel)),
      __DMC_SHARE_BASE_URLS__: JSON.stringify(shareBaseUrls()),
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
              privacy: resolve(__dirname, "privacy.html"),
            }
          : {
              main: resolve(__dirname, "index.html"),
              editor: resolve(__dirname, "editor.html"),
              operator: resolve(__dirname, "operator.html"),
              privacy: resolve(__dirname, "privacy.html"),
            },
      },
    },
    test: {
      exclude: ["e2e/**", "worker/test/**", "node_modules/**"],
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
  };
});
