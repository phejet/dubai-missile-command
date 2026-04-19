import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { getBuildId } from "./vite-build-id";

const MAX_REPLAYS = 50;

function pruneOldReplays(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const f of files.slice(MAX_REPLAYS)) {
      unlinkSync(join(dir, f.name));
    }
  } catch {
    return;
  }
}

function deriveReplayId(data: Record<string, unknown>): string | null {
  if (typeof data["replayId"] === "string" && data["replayId"].trim()) {
    return data["replayId"].trim();
  }

  if (typeof data["seed"] !== "number" || !Array.isArray(data["actions"])) {
    return null;
  }

  return createHash("sha256")
    .update(String(data["seed"]))
    .update("||")
    .update(JSON.stringify(data["actions"]))
    .digest("hex");
}

export default function replayPlugin(): Plugin {
  const buildId = getBuildId();
  const replayDir = join(process.cwd(), "replays");

  return {
    name: "vite-replay-save",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/save-replay", (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as Record<string, unknown>;
            data["_buildId"] = buildId;
            data["_savedAt"] = new Date().toISOString();
            const replayId = deriveReplayId(data);
            if (replayId) {
              data["replayId"] = replayId;
            }

            mkdirSync(replayDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const filename = `${buildId}_w${data["wave"] || 0}_s${data["score"] || 0}_${ts}.json`;
            writeFileSync(join(replayDir, filename), JSON.stringify(data, null, 2));
            pruneOldReplays(replayDir);

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, file: filename }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        });
      });
    },
  };
}
