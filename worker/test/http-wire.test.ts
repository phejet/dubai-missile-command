import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createGzip, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { sessionFixture } from "../../test-fixtures/capture";

const processes: ChildProcess[] = [];
const tempDirs: string[] = [];

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("could not allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

async function waitForWorker(url: string, process: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`wrangler exited ${process.exitCode}: ${logs()}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The socket is not listening yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`wrangler did not become ready: ${logs()}`);
}

async function rawHttp(url: URL, token: string): Promise<{ body: Buffer; headers: Record<string, string | string[]> }> {
  return new Promise((resolveRequest, reject) => {
    const request = get(url, { headers: { Authorization: `Bearer ${token}` } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const headers: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers[name] = value;
        }
        resolveRequest({ body: Buffer.concat(chunks), headers });
      });
    });
    request.once("error", reject);
  });
}

async function gzipRepeated(megabytes: number): Promise<Buffer> {
  const gzip = createGzip();
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolveGzip, reject) => {
    gzip.once("error", reject);
    gzip.once("end", () => resolveGzip(Buffer.concat(chunks)));
  });
  const chunk = Buffer.alloc(1024 * 1024, 120);
  for (let index = 0; index < megabytes; index += 1) {
    if (!gzip.write(chunk)) await once(gzip, "drain");
  }
  gzip.end();
  return completed;
}

afterEach(async () => {
  for (const process of processes.splice(0)) {
    if (process.exitCode === null) {
      process.kill("SIGTERM");
      await new Promise<void>((resolveExit) => process.once("exit", () => resolveExit()));
    }
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("capture Worker over real HTTP", () => {
  it("returns the stored gzip object byte-for-byte from ?raw=1", async () => {
    const persistence = mkdtempSync(join(tmpdir(), "dmc-worker-http-"));
    tempDirs.push(persistence);
    const wrangler = resolve("node_modules/.bin/wrangler");
    const migration = spawnSync(
      wrangler,
      [
        "d1",
        "migrations",
        "apply",
        "dmc-captures-local",
        "--local",
        "--config",
        "worker/wrangler.jsonc",
        "--persist-to",
        persistence,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 15_000 },
    );
    if (migration.status !== 0) throw new Error(`migration failed: ${migration.stdout}\n${migration.stderr}`);

    const port = await availablePort();
    let logs = "";
    const worker = spawn(
      wrangler,
      [
        "dev",
        "--config",
        "worker/wrangler.jsonc",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--persist-to",
        persistence,
        "--var",
        "CAPTURE_BEARER_TOKEN:http-test-secret",
        "--log-level",
        "error",
        "--show-interactive-dev-session",
        "false",
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );
    processes.push(worker);
    worker.stdout?.on("data", (chunk) => (logs += String(chunk)));
    worker.stderr?.on("data", (chunk) => (logs += String(chunk)));
    const base = `http://127.0.0.1:${port}`;
    await waitForWorker(base, worker, () => logs);

    const capture = sessionFixture();
    const decoded = Buffer.from(JSON.stringify(capture));
    const sha256 = createHash("sha256").update(decoded).digest("hex");
    const uploaded = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dmc-build": capture.meta.buildId,
        "x-dmc-install": capture.meta.installId!,
        "x-dmc-sha256": sha256,
      },
      body: decoded,
    });
    expect(uploaded.status).toBe(200);

    const retrieved = await rawHttp(
      new URL(`/api/replay/${capture.meta.replaySha256}?raw=1`, base),
      "http-test-secret",
    );
    expect(retrieved.headers["content-encoding"]).toBeUndefined();
    expect(retrieved.headers["content-type"]).toBe("application/gzip");
    const replayBytes = Buffer.from(JSON.stringify(capture.replay));
    expect(gunzipSync(retrieved.body)).toEqual(replayBytes);
    expect(createHash("sha256").update(gunzipSync(retrieved.body)).digest("hex")).toBe(capture.meta.replaySha256);

    const bomb = await gzipRepeated(192);
    expect(bomb.byteLength).toBeLessThan(512 * 1024);
    const rejected = await fetch(`${base}/api/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "x-dmc-build": capture.meta.buildId,
        "x-dmc-install": capture.meta.installId!,
        "x-dmc-sha256": sha256,
      },
      body: bomb.buffer.slice(bomb.byteOffset, bomb.byteOffset + bomb.byteLength) as ArrayBuffer,
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ ok: false, stage: "size" });
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });
});
