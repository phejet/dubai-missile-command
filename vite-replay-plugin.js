import { execSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

const MAX_REPLAYS = 50;

function getBuildId() {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const diff = execSync("git diff --stat", { encoding: "utf8" }).trim();
    if (!diff) return sha;
    const hash = createHash("md5").update(diff).digest("hex").slice(0, 8);
    return `${sha}+${hash}`;
  } catch {
    return "unknown";
  }
}

function pruneOldReplays(dir) {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const f of files.slice(MAX_REPLAYS)) {
      unlinkSync(join(dir, f.name));
    }
  } catch {}
}

export default function replayPlugin() {
  const buildId = getBuildId();
  const replayDir = join(process.cwd(), "replays");

  return {
    name: "vite-replay-save",
    configureServer(server) {
      server.middlewares.use("/api/save-replay", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("Method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            // Add build metadata
            data._buildId = buildId;
            data._savedAt = new Date().toISOString();

            mkdirSync(replayDir, { recursive: true });
            const ts = new Date().toISOString().replace(/[:.]/g, "-");
            const filename = `${buildId}_w${data.wave || 0}_s${data.score || 0}_${ts}.json`;
            writeFileSync(join(replayDir, filename), JSON.stringify(data, null, 2));
            pruneOldReplays(replayDir);

            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, file: filename }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}
