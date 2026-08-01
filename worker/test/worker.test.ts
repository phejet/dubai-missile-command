import { createExecutionContext, createScheduledController, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_COMPRESSED_BYTES, MAX_DECODED_BYTES } from "../../src/capture-contract";
import { captureFixture } from "../../test-fixtures/capture";
import worker from "../src/index";
import { readBounded } from "../src/ingest";
import { projectCaptureRow, projectSessionRow, type CaptureRow, type SessionRow } from "../src/projection";

let installSequence = 0;
let testInstallId = "12345678-test0";

beforeEach(async () => {
  installSequence += 1;
  testInstallId = `12345678-test${installSequence}`;
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER IF EXISTS fail_session"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM captures"),
  ]);
});

async function digest(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function postCapture(
  capture: ReturnType<typeof captureFixture>,
  options: { gzip?: boolean; sha?: string; build?: string; install?: string; origin?: string; wire?: Uint8Array } = {},
): Promise<Response> {
  if (capture.meta.installId === "12345678-abcd") capture.meta.installId = testInstallId;
  const raw = new TextEncoder().encode(JSON.stringify(capture));
  const wire = options.wire ?? (options.gzip ? await gzip(raw) : raw);
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-dmc-build": options.build ?? capture.meta.buildId,
    "x-dmc-install": options.install ?? capture.meta.installId ?? "",
    "x-dmc-sha256": options.sha ?? (await digest(raw)),
  });
  if (options.gzip) headers.set("Content-Encoding", "gzip");
  if (options.origin) headers.set("Origin", options.origin);
  return SELF.fetch("https://worker.test/api/save-capture", { method: "POST", headers, body: wire });
}

describe("capture Worker", () => {
  it("reports health", async () => {
    const response = await SELF.fetch("https://worker.test/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, schema: 1, build: "dev" });
  });

  it("stores decoded JSON as gzip and projects every completed session", async () => {
    const capture = captureFixture();
    capture.meta.installId = testInstallId;
    const raw = new TextEncoder().encode(JSON.stringify(capture));
    const response = await postCapture(capture, { gzip: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      captureId: capture.captureId,
      encoding: "gzip",
      r2Key: `captures/${testInstallId}/boot-c0.json.gz`,
      sessionProjected: true,
    });

    const row = (await env.DB.prepare("SELECT * FROM captures WHERE capture_id = ?")
      .bind(capture.captureId)
      .first()) as unknown as CaptureRow;
    const expectedCaptureRow = projectCaptureRow(capture, {
      sha256: await digest(raw),
      rawBytes: raw.byteLength,
      storedBytes: row.stored_bytes,
      receivedAt: row.received_at,
    });
    expect(row).toEqual(expectedCaptureRow);
    const object = await env.CAPTURES.get(`captures/${testInstallId}/boot-c0.json.gz`);
    expect(object).not.toBeNull();
    const stored = new Uint8Array(await new Response(object!.body).arrayBuffer());
    expect(await gunzip(stored)).toEqual(raw);
    expect(await digest(await gunzip(stored))).toBe(row!.sha256);

    const session = (await env.DB.prepare(
      "SELECT * FROM sessions WHERE run_id = 'run'",
    ).first()) as unknown as SessionRow;
    expect(session).toEqual(projectSessionRow(capture, row.received_at));
  });

  it("normalizes both wire encodings to the same immutable object", async () => {
    const capture = captureFixture();
    const first = await postCapture(capture);
    const object = await env.CAPTURES.get(`captures/${testInstallId}/boot-c0.json.gz`);
    const stored = new Uint8Array(await new Response(object!.body).arrayBuffer());
    const second = await postCapture(capture, { gzip: true });
    const retried = await env.CAPTURES.get(`captures/${testInstallId}/boot-c0.json.gz`);
    const retriedBytes = new Uint8Array(await new Response(retried!.body).arrayBuffer());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(retriedBytes).toEqual(stored);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(1);
  });

  it("resolves concurrent retries to one object and one row", async () => {
    const capture = captureFixture();
    const [first, second] = await Promise.all([
      postCapture(structuredClone(capture)),
      postCapture(structuredClone(capture)),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(1);
    expect(await env.CAPTURES.head(`captures/${testInstallId}/boot-c0.json.gz`)).not.toBeNull();
  });

  it("cleans up the loser when concurrent installs collide on one captureId", async () => {
    const first = captureFixture();
    const second = captureFixture({ installId: "eph-87654321" });
    second.meta.note = "different bytes";
    second.summary!.score = 999;
    const [firstResponse, secondResponse] = await Promise.all([postCapture(first), postCapture(second)]);
    expect([firstResponse.status, secondResponse.status].sort()).toEqual([200, 409]);

    const winnerIsFirst = firstResponse.status === 200;
    const winnerKey = winnerIsFirst
      ? `captures/${testInstallId}/boot-c0.json.gz`
      : "captures/eph-87654321/boot-c0.json.gz";
    const loserKey = winnerIsFirst
      ? "captures/eph-87654321/boot-c0.json.gz"
      : `captures/${testInstallId}/boot-c0.json.gz`;
    expect(await env.CAPTURES.head(winnerKey)).not.toBeNull();
    expect(await env.CAPTURES.head(loserKey)).toBeNull();
    expect(await env.DB.prepare("SELECT score FROM sessions WHERE run_id = 'run'").first()).toEqual({
      score: winnerIsFirst ? 900 : 999,
    });
  });

  it("rejects capture collisions without changing the original row or object", async () => {
    const capture = captureFixture();
    expect((await postCapture(capture)).status).toBe(200);
    const before = await env.CAPTURES.get(`captures/${testInstallId}/boot-c0.json.gz`);
    const beforeBytes = new Uint8Array(await new Response(before!.body).arrayBuffer());
    capture.meta.note = "different bytes";
    const collision = await postCapture(capture);

    expect(collision.status).toBe(409);
    expect(await collision.json()).toMatchObject({ ok: false, stage: "conflict" });
    const after = await env.CAPTURES.get(`captures/${testInstallId}/boot-c0.json.gz`);
    expect(new Uint8Array(await new Response(after!.body).arrayBuffer())).toEqual(beforeBytes);
  });

  it("upserts one session per run while excluding partial and runless captures", async () => {
    const first = captureFixture({ captureId: "capture-1" });
    const second = captureFixture({ captureId: "capture-2" });
    second.summary!.score = 1_200;
    const partial = captureFixture({ captureId: "capture-3", runId: "partial-run" });
    partial.meta.partial = true;
    partial.meta.appScreen = "playing";
    partial.meta.replaySource = "live";
    partial.summary!.outcome = "in_progress";
    const runless = captureFixture({ captureId: "capture-4", runId: null });
    runless.summary = null;
    runless.meta.appScreen = "title";
    runless.meta.replaySource = "none";

    for (const capture of [first, second, partial, runless]) expect((await postCapture(capture)).status).toBe(200);
    const sessions = await env.DB.prepare("SELECT run_id, score, replay_verified FROM sessions").all();
    expect(sessions.results).toEqual([{ run_id: "run", score: 1_200, replay_verified: 0 }]);
  });

  it("marks ephemeral installs in both tables", async () => {
    const capture = captureFixture({ installId: "eph-12345678" });
    expect((await postCapture(capture)).status).toBe(200);
    expect(await env.DB.prepare("SELECT install_ephemeral FROM captures").first()).toEqual({ install_ephemeral: 1 });
    expect(await env.DB.prepare("SELECT install_ephemeral FROM sessions").first()).toEqual({ install_ephemeral: 1 });
  });

  it.each([
    ["hash", (capture: ReturnType<typeof captureFixture>) => postCapture(capture, { sha: "0".repeat(64) })],
    ["parse", (capture: ReturnType<typeof captureFixture>) => postCapture(capture, { build: "other" })],
    ["parse", (capture: ReturnType<typeof captureFixture>) => postCapture(capture, { install: "other-install" })],
  ])("rejects invalid input at the %s stage without writes", async (stage, send) => {
    const response = await send(captureFixture());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(0);
  });

  it.each([
    ["wrong schema", (capture: ReturnType<typeof captureFixture>) => ((capture.captureSchema as number) = 2)],
    [
      "missing captureId",
      (capture: ReturnType<typeof captureFixture>) => delete (capture as { captureId?: string }).captureId,
    ],
    ["oversized note", (capture: ReturnType<typeof captureFixture>) => (capture.meta.note = "x".repeat(2_001))],
    ["negative score", (capture: ReturnType<typeof captureFixture>) => (capture.summary!.score = -1)],
    ["NaN score", (capture: ReturnType<typeof captureFixture>) => (capture.summary!.score = Number.NaN)],
    [
      "infinite score",
      (capture: ReturnType<typeof captureFixture>) => (capture.summary!.score = Number.POSITIVE_INFINITY),
    ],
    [
      "unknown app screen",
      (capture: ReturnType<typeof captureFixture>) => ((capture.meta.appScreen as string) = "credits"),
    ],
    [
      "unknown replay source",
      (capture: ReturnType<typeof captureFixture>) => ((capture.meta.replaySource as string) = "cloud"),
    ],
    [
      "unknown outcome",
      (capture: ReturnType<typeof captureFixture>) => ((capture.summary!.outcome as string) = "victory"),
    ],
    ["null install", (capture: ReturnType<typeof captureFixture>) => (capture.meta.installId = null)],
    ["empty install", (capture: ReturnType<typeof captureFixture>) => (capture.meta.installId = "")],
  ])("rejects %s at parse without storing anything", async (_name, mutate) => {
    const capture = captureFixture();
    mutate(capture);
    const response = await postCapture(capture);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage: "parse" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(0);
  });

  it("rejects GET on ingest before touching storage", async () => {
    const response = await SELF.fetch("https://worker.test/api/save-capture");
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ ok: false, stage: "parse" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(0);
  });

  it("rejects invalid gzip at the compress stage", async () => {
    const response = await postCapture(captureFixture(), {
      gzip: true,
      wire: new TextEncoder().encode("not gzip"),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage: "compress" });
  });

  it("rejects a compressed request body beyond the wire cap", async () => {
    const response = await postCapture(captureFixture(), { wire: new Uint8Array(MAX_COMPRESSED_BYTES + 1) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, stage: "size" });
  });

  it("cancels a producer immediately after the bounded reader crosses its cap", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBounded(source, MAX_DECODED_BYTES, "decoded body")).rejects.toThrow("exceeds");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(10);
  });

  it("rate limits before attempting decompression", async () => {
    const capture = captureFixture();
    const garbage = new TextEncoder().encode("not gzip");
    let response!: Response;
    for (let index = 0; index < 6; index += 1) response = await postCapture(capture, { gzip: true, wire: garbage });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ ok: false, stage: "rate" });
  });

  it("keeps the D1 batch atomic when the session write fails", async () => {
    await env.DB.prepare(
      "CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'forced session failure'); END",
    ).run();
    const response = await postCapture(captureFixture());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, stage: "store" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(0);
    expect(await env.CAPTURES.head(`captures/${testInstallId}/boot-c0.json.gz`)).not.toBeNull();
  });

  it("requires bearer auth for retrieval/listing and exposes no CORS there", async () => {
    await postCapture(captureFixture());
    for (const path of ["/api/captures", "/api/capture/boot-c0"]) {
      const denied = await SELF.fetch(`https://worker.test${path}`);
      expect(denied.status).toBe(401);
      const allowed = await SELF.fetch(`https://worker.test${path}`, {
        headers: { Authorization: "Bearer test-secret", Origin: "https://phejet.github.io" },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("access-control-allow-origin")).toBeNull();
    }
    const raw = await SELF.fetch("https://worker.test/api/capture/boot-c0?raw=1", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(raw.headers.get("content-encoding")).toBeNull();
    const rawObject = new Uint8Array(await raw.arrayBuffer());
    expect(await gunzip(rawObject)).toEqual(
      new TextEncoder().encode(JSON.stringify(captureFixture({ installId: testInstallId }))),
    );
  });

  it("allows only game origins on ingest preflight", async () => {
    for (const origin of ["capacitor://localhost", "https://phejet.github.io"]) {
      const response = await SELF.fetch("https://worker.test/api/save-capture", {
        method: "OPTIONS",
        headers: { Origin: origin },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
    const denied = await SELF.fetch("https://worker.test/api/save-capture", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("runs received_at retention through the scheduled handler", async () => {
    const capture = captureFixture();
    capture.meta.capturedAt = 9_000_000_000_000;
    await postCapture(capture);
    await env.DB.batch([
      env.DB.prepare("UPDATE captures SET received_at = 1"),
      env.DB.prepare("UPDATE sessions SET received_at = 1"),
    ]);
    const controller = createScheduledController({ scheduledTime: 9_000_000_000_000 });
    const context = createExecutionContext();
    worker.scheduled(controller as never, env, context);
    await waitOnExecutionContext(context);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM captures").first<{ count: number }>())!.count).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM sessions").first<{ count: number }>())!.count).toBe(0);
  });
});
