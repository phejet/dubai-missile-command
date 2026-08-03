import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Plugin, ViteDevServer } from "vite";
import {
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  validateReportBody,
  validateSessionBody,
} from "./src/capture-contract";

export { MAX_COMPRESSED_BYTES, MAX_DECODED_BYTES } from "./src/capture-contract";
const MAX_CAPTURES = 50;
const CAPTURE_SUFFIX_RE = /\.json(?:\.gz|\.raw)?$/;

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function failure(res: ServerResponse, stage: string, error: unknown, status = 400): void {
  sendJson(res, status, {
    ok: false,
    stage,
    message: error instanceof Error ? error.message : String(error),
  });
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readRequest(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > MAX_COMPRESSED_BYTES) {
        req.off("data", onData);
        req.off("end", onEnd);
        req.resume();
        reject(new Error(`compressed body exceeds ${MAX_COMPRESSED_BYTES} bytes`));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => resolve(Buffer.concat(chunks));
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", reject);
  });
}

function boundedNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function pruneCaptureGroups(dir: string): void {
  try {
    const groups = new Map<string, { files: string[]; time: number }>();
    for (const name of readdirSync(dir).filter((file) => CAPTURE_SUFFIX_RE.test(file))) {
      const base = name.replace(CAPTURE_SUFFIX_RE, "");
      const group = groups.get(base) ?? { files: [], time: 0 };
      group.files.push(name);
      group.time = Math.max(group.time, statSync(join(dir, name)).mtimeMs);
      groups.set(base, group);
    }
    const stale = [...groups.values()].sort((a, b) => b.time - a.time).slice(MAX_CAPTURES);
    for (const group of stale) {
      for (const file of group.files) unlinkSync(join(dir, file));
    }
  } catch {
    // Capture persistence must not take down the dev server during pruning.
  }
}

export function createCaptureHandler(
  captureDir = join(process.cwd(), "captures"),
  kind: "session" | "report" = "report",
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, stage: "parse", message: "Method not allowed" });
      return;
    }

    let wire: Buffer;
    try {
      wire = await readRequest(req);
    } catch (error) {
      failure(res, "size", error);
      return;
    }

    const contentEncoding = header(req, "content-encoding").trim().toLowerCase();
    let raw: Buffer;
    try {
      if (contentEncoding === "gzip") raw = gunzipSync(wire, { maxOutputLength: MAX_DECODED_BYTES + 1 });
      else if (contentEncoding === "" || contentEncoding === "identity") raw = wire;
      else throw new Error(`unsupported content encoding: ${contentEncoding}`);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      failure(res, code === "ERR_BUFFER_TOO_LARGE" ? "size" : "compress", error);
      return;
    }
    if (raw.byteLength > MAX_DECODED_BYTES) {
      failure(res, "size", new Error(`decoded body exceeds ${MAX_DECODED_BYTES} bytes`));
      return;
    }

    const expectedSha = header(req, "x-dmc-sha256");
    const actualSha = createHash("sha256").update(raw).digest("hex");
    if (!expectedSha || expectedSha !== actualSha) {
      failure(res, "hash", new Error("x-dmc-sha256 does not match the decoded body"));
      return;
    }

    const validation = await (kind === "session" ? validateSessionBody : validateReportBody)(
      raw,
      {
        build: header(req, "x-dmc-build"),
        install: header(req, "x-dmc-install"),
        sha256: expectedSha,
      },
      actualSha,
    );
    if (!validation.ok) {
      failure(res, validation.stage, new Error(validation.message));
      return;
    }
    const capture = validation.ok ? ("session" in validation ? validation.session : validation.report) : null;
    if (!capture) {
      failure(res, "parse", new Error("validated capture is missing"));
      return;
    }

    try {
      mkdirSync(captureDir, { recursive: true });
      const wave = boundedNumber(capture.summary?.waveReached);
      const score = boundedNumber(capture.summary?.score);
      const id = capture.kind === "session" ? capture.meta.runId : capture.reportId;
      const base = `${capture.meta.buildId}-w${wave}-s${score}-${id}`;
      const encoding = contentEncoding === "gzip" ? "gzip" : "none";
      const wireFile = `${base}.json.${encoding === "gzip" ? "gz" : "raw"}`;
      const prettyFile = `${base}.json`;
      writeFileSync(join(captureDir, wireFile), wire);
      writeFileSync(join(captureDir, prettyFile), `${JSON.stringify(capture, null, 2)}\n`);
      pruneCaptureGroups(captureDir);
      sendJson(res, 200, {
        ok: true,
        id,
        encoding,
        file: prettyFile,
        rawBytes: raw.byteLength,
        wireBytes: wire.byteLength,
      });
    } catch (error) {
      failure(res, "serialize", error);
    }
  };
}

export default function capturePlugin(): Plugin {
  const captureDir = join(process.cwd(), "captures");
  const sessionHandler = createCaptureHandler(captureDir, "session");
  const reportHandler = createCaptureHandler(captureDir, "report");
  return {
    name: "vite-capture-save",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/session", (req, res) => void sessionHandler(req, res));
      server.middlewares.use("/api/report", (req, res) => void reportHandler(req, res));
    },
  };
}
