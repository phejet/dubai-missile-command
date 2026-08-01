import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCaptureHandler,
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  pruneCaptureGroups,
} from "./vite-capture-plugin";

interface TestResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

const tempDirs: string[] = [];

function capture(overrides: Record<string, unknown> = {}) {
  return {
    captureSchema: 1,
    captureId: "boot-c0",
    meta: { buildId: "build+dirty", installId: null },
    summary: { waveReached: 4, score: 900 },
    replay: null,
    events: [],
    ...overrides,
  };
}

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dmc-capture-test-"));
  tempDirs.push(dir);
  return dir;
}

async function request(
  dir: string,
  raw: Buffer,
  options: { method?: string; gzip?: boolean; wire?: Buffer; sha?: string; build?: string; install?: string } = {},
): Promise<TestResponse> {
  const wire = options.wire ?? (options.gzip ? gzipSync(raw) : raw);
  const req = Readable.from([wire]) as unknown as IncomingMessage;
  req.method = options.method ?? "POST";
  req.headers = {
    ...(options.gzip ? { "content-encoding": "gzip" } : {}),
    "x-dmc-sha256": options.sha ?? createHash("sha256").update(raw).digest("hex"),
    "x-dmc-build": options.build ?? "build+dirty",
    "x-dmc-install": options.install ?? "",
  };
  const response: TestResponse = { statusCode: 200, body: "", headers: {} };
  const res = {
    get statusCode() {
      return response.statusCode;
    },
    set statusCode(value: number) {
      response.statusCode = value;
    },
    setHeader(name: string, value: string) {
      response.headers[name.toLowerCase()] = value;
    },
    end(body?: string | Buffer) {
      response.body = body?.toString() ?? "";
    },
  } as unknown as ServerResponse;
  await createCaptureHandler(dir)(req, res);
  return response;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Vite capture endpoint", () => {
  it("writes byte-identical gzip wire bytes and a pretty JSON copy", async () => {
    const dir = makeDir();
    const raw = Buffer.from(JSON.stringify(capture()));
    const wire = gzipSync(raw);
    const response = await request(dir, raw, { gzip: true });
    const result = JSON.parse(response.body) as { file: string; encoding: string };

    expect(response.statusCode).toBe(200);
    expect(result.encoding).toBe("gzip");
    expect(readFileSync(join(dir, result.file))).toEqual(Buffer.from(`${JSON.stringify(capture(), null, 2)}\n`));
    const wireFile = readdirSync(dir).find((file) => file.endsWith(".json.gz"))!;
    expect(readFileSync(join(dir, wireFile))).toEqual(wire);
  });

  it("writes an uncompressed fallback with a truthful .json.raw extension", async () => {
    const dir = makeDir();
    const raw = Buffer.from(JSON.stringify(capture()));
    const response = await request(dir, raw);

    expect(JSON.parse(response.body)).toMatchObject({ ok: true, encoding: "none" });
    const wireFile = readdirSync(dir).find((file) => file.endsWith(".json.raw"))!;
    expect(readFileSync(join(dir, wireFile))).toEqual(raw);
  });

  it("accepts an uncompressed capture above the old 2 MB wire ceiling", async () => {
    const dir = makeDir();
    const raw = Buffer.from(JSON.stringify(capture({ events: [{ payload: "x".repeat(3 * 1024 * 1024) }] })));
    const response = await request(dir, raw);

    expect(raw.byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, encoding: "none", rawBytes: raw.byteLength });
  });

  it.each([
    ["bad hash", capture(), { sha: "0".repeat(64) }, "hash"],
    ["build mismatch", capture(), { build: "other" }, "parse"],
    ["install mismatch", capture(), { install: "other" }, "parse"],
    ["traversal id", capture({ captureId: "../../etc/x" }), {}, "parse"],
    ["wrong schema", capture({ captureSchema: 2 }), {}, "parse"],
  ] as const)("rejects %s", async (_name, body, options, stage) => {
    const response = await request(makeDir(), Buffer.from(JSON.stringify(body)), options);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ ok: false, stage });
  });

  it("rejects methods, invalid gzip, and both body size limits", async () => {
    const get = await request(makeDir(), Buffer.from(""), { method: "GET" });
    expect(get.statusCode).toBe(405);

    const garbage = Buffer.from("not gzip");
    const invalid = await request(makeDir(), garbage, { gzip: true, wire: garbage });
    expect(JSON.parse(invalid.body)).toMatchObject({ ok: false, stage: "compress" });

    const compressed = await request(makeDir(), Buffer.alloc(MAX_COMPRESSED_BYTES + 1));
    expect(JSON.parse(compressed.body)).toMatchObject({ ok: false, stage: "size" });

    const bombRaw = Buffer.alloc(MAX_DECODED_BYTES + 1, 120);
    const decoded = await request(makeDir(), bombRaw, { gzip: true });
    expect(JSON.parse(decoded.body)).toMatchObject({ ok: false, stage: "size" });
  });

  it("prunes complete capture groups and leaves no orphan wire files", () => {
    const dir = makeDir();
    for (let index = 0; index < 51; index += 1) {
      const base = `build-w1-s1-c${index}`;
      for (const suffix of [".json", ".json.gz", ".json.raw"]) {
        const path = join(dir, `${base}${suffix}`);
        writeFileSync(path, "x");
        const time = new Date(1_000 + index * 1_000);
        utimesSync(path, time, time);
      }
    }

    pruneCaptureGroups(dir);
    const files = readdirSync(dir);
    expect(files).toHaveLength(50 * 3);
    expect(files.some((file) => file.startsWith("build-w1-s1-c0."))).toBe(false);
  });
});
