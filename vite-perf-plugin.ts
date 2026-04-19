import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { getBuildId } from "./vite-build-id";

function setPerfResponseHeaders(res: ServerResponse): void {
  res.setHeader("Allow", "POST, OPTIONS, HEAD");
  res.setHeader("Content-Type", "application/json");
}

function sanitizePathSegment(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._+-]+/g, "-");
}

function buildDeviceHash(report: Record<string, unknown>): string {
  const payload = JSON.stringify(report["deviceInfo"] ?? {});
  return createHash("sha1").update(payload).digest("hex").slice(0, 10);
}

interface PerfPayload extends Record<string, unknown> {
  frames: unknown[];
  replayId: string;
  runId: string;
  schemaVersion: 1;
}

function isSchemaV1PerfPayload(data: unknown): data is PerfPayload {
  if (typeof data !== "object" || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record["schemaVersion"] === 1 &&
    typeof record["runId"] === "string" &&
    typeof record["replayId"] === "string" &&
    Array.isArray(record["frames"])
  );
}

export default function perfPlugin(): Plugin {
  const perfRoot = join(process.cwd(), "perf-results");
  const runsDir = join(perfRoot, "runs");
  const latestDir = join(perfRoot, "latest");

  return {
    name: "vite-perf-save",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/save-perf", (req: IncomingMessage, res: ServerResponse) => {
        setPerfResponseHeaders(res);

        if (req.method === "OPTIONS" || req.method === "HEAD") {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as unknown;
            if (!isSchemaV1PerfPayload(parsed)) {
              throw new Error("Perf payload must be a schema-v1 report");
            }

            const buildId = getBuildId();
            const deviceHash = buildDeviceHash(parsed);
            const runId = sanitizePathSegment(parsed.runId, "run");
            const replayId = sanitizePathSegment(parsed.replayId, "replay");
            const stampedReport = {
              ...parsed,
              _buildId: buildId,
              _savedAt: new Date().toISOString(),
              buildId,
            };

            const buildDir = join(runsDir, buildId);
            mkdirSync(buildDir, { recursive: true });
            mkdirSync(latestDir, { recursive: true });

            const runPath = join(buildDir, `${deviceHash}-${runId}.json`);
            const latestPath = join(latestDir, `${replayId}-${deviceHash}.json`);

            writeFileSync(runPath, JSON.stringify(stampedReport, null, 2));
            writeFileSync(latestPath, JSON.stringify(stampedReport, null, 2));

            res.end(
              JSON.stringify({
                buildId,
                deviceHash,
                file: relative(process.cwd(), runPath),
                latestFile: relative(process.cwd(), latestPath),
                ok: true,
              }),
            );
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        });
      });
    },
  };
}
