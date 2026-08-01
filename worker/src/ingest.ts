import {
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  validateCaptureBody,
  type ContractStage,
} from "../../src/capture-contract";
import { isSessionRow, projectCaptureRow, projectSessionRow, type CaptureRow, type SessionRow } from "./projection";
import type { D1PreparedStatement, Env } from "./bindings";

class IngestError extends Error {
  constructor(
    readonly stage: ContractStage | "rate" | "conflict" | "store",
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function jsonResponse(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function failure(error: unknown): Response {
  const known = error instanceof IngestError ? error : new IngestError("store", String(error), 500);
  return jsonResponse(known.status, { ok: false, stage: known.stage, message: known.message });
}

export async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
  label: string,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > max) {
        await reader.cancel(`${label} exceeds ${max} bytes`);
        throw new IngestError("size", `${label} exceeds ${max} bytes`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function decodedBody(request: Request): Promise<{ bytes: Uint8Array; encoding: "gzip" | "none" }> {
  const wire = await readBounded(request.body, MAX_COMPRESSED_BYTES, "compressed body");
  const encoding = (request.headers.get("content-encoding") ?? "").trim().toLowerCase();
  if (encoding === "" || encoding === "identity") {
    if (wire.byteLength > MAX_DECODED_BYTES) {
      throw new IngestError("size", `decoded body exceeds ${MAX_DECODED_BYTES} bytes`);
    }
    return { bytes: wire, encoding: "none" };
  }
  if (encoding !== "gzip") throw new IngestError("compress", `unsupported content encoding: ${encoding}`);
  try {
    const source = new Blob([wire as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
    return { bytes: await readBounded(source, MAX_DECODED_BYTES, "decoded body"), encoding: "gzip" };
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError("compress", error instanceof Error ? error.message : String(error));
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function captureInsert(env: Env, row: CaptureRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO captures (
      capture_id, run_id, install_id, install_ephemeral, boot_id, build, platform, input_class,
      captured_at, received_at, trigger, app_screen, replay_source, partial, captured_through_tick,
      note, replay_sha256, replay_complete, replay_omitted_reason, events_count, events_truncated,
      sha256, raw_bytes, stored_bytes, r2_key
    ) VALUES (${Array.from({ length: 25 }, () => "?").join(", ")})
    ON CONFLICT(capture_id) DO NOTHING`,
  ).bind(
    row.capture_id,
    row.run_id,
    row.install_id,
    row.install_ephemeral,
    row.boot_id,
    row.build,
    row.platform,
    row.input_class,
    row.captured_at,
    row.received_at,
    row.trigger,
    row.app_screen,
    row.replay_source,
    row.partial,
    row.captured_through_tick,
    row.note,
    row.replay_sha256,
    row.replay_complete,
    row.replay_omitted_reason,
    row.events_count,
    row.events_truncated,
    row.sha256,
    row.raw_bytes,
    row.stored_bytes,
    row.r2_key,
  );
}

function sessionUpsert(env: Env, row: SessionRow, capture: CaptureRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sessions (
      run_id, capture_id, install_id, install_ephemeral, display_name, build, platform, input_class,
      created_at, received_at, outcome, death_cause, wave_reached, score, time_played_ms, burj_health,
      shots_fired, total_kills, hit_ratio, multi_shots, max_combo, destroyed_by_type_json, upgrades_json,
      feedback_emoji, feedback_note, replay_sha256, replay_size, replay_complete_claimed, replay_verified,
      verified_at, shared, source
    ) SELECT ${Array.from({ length: 32 }, () => "?").join(", ")}
      WHERE EXISTS (
        SELECT 1 FROM captures WHERE capture_id = ? AND sha256 = ? AND r2_key = ?
      )
    ON CONFLICT(run_id) DO UPDATE SET
      capture_id=excluded.capture_id, install_id=excluded.install_id,
      install_ephemeral=excluded.install_ephemeral, display_name=excluded.display_name,
      build=excluded.build, platform=excluded.platform, input_class=excluded.input_class,
      created_at=excluded.created_at, received_at=excluded.received_at, outcome=excluded.outcome,
      death_cause=excluded.death_cause, wave_reached=excluded.wave_reached, score=excluded.score,
      time_played_ms=excluded.time_played_ms, burj_health=excluded.burj_health,
      shots_fired=excluded.shots_fired, total_kills=excluded.total_kills, hit_ratio=excluded.hit_ratio,
      multi_shots=excluded.multi_shots, max_combo=excluded.max_combo,
      destroyed_by_type_json=excluded.destroyed_by_type_json, upgrades_json=excluded.upgrades_json,
      feedback_note=excluded.feedback_note, replay_sha256=excluded.replay_sha256,
      replay_size=excluded.replay_size, replay_complete_claimed=excluded.replay_complete_claimed,
      replay_verified=0, verified_at=NULL, shared=0, source=excluded.source`,
  ).bind(
    row.run_id,
    row.capture_id,
    row.install_id,
    row.install_ephemeral,
    row.display_name,
    row.build,
    row.platform,
    row.input_class,
    row.created_at,
    row.received_at,
    row.outcome,
    row.death_cause,
    row.wave_reached,
    row.score,
    row.time_played_ms,
    row.burj_health,
    row.shots_fired,
    row.total_kills,
    row.hit_ratio,
    row.multi_shots,
    row.max_combo,
    row.destroyed_by_type_json,
    row.upgrades_json,
    row.feedback_emoji,
    row.feedback_note,
    row.replay_sha256,
    row.replay_size,
    row.replay_complete_claimed,
    row.replay_verified,
    row.verified_at,
    row.shared,
    row.source,
    capture.capture_id,
    capture.sha256,
    capture.r2_key,
  );
}

interface ExistingCapture {
  capture_id: string;
  sha256: string;
  raw_bytes: number;
  stored_bytes: number;
  r2_key: string;
}

async function rateLimit(request: Request, env: Env): Promise<void> {
  const install = request.headers.get("x-dmc-install") || "__missing__";
  const ip = request.headers.get("cf-connecting-ip") || "__local__";
  const [ipResult, installResult] = await Promise.all([
    env.INGEST_IP.limit({ key: ip }),
    env.INGEST_INSTALL.limit({ key: install }),
  ]);
  if (!ipResult.success || !installResult.success) throw new IngestError("rate", "capture rate limit exceeded", 429);
}

function validateDeclaredLength(request: Request): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const declaredLength = Number(header);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPRESSED_BYTES) {
    throw new IngestError("size", `compressed body exceeds ${MAX_COMPRESSED_BYTES} bytes`);
  }
}

export async function ingestCapture(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== "POST") throw new IngestError("parse", "Method not allowed", 405);
    validateDeclaredLength(request);
    await rateLimit(request, env);
    const decoded = await decodedBody(request);
    const actualSha = await sha256(decoded.bytes);
    const validation = validateCaptureBody(
      decoded.bytes,
      {
        build: request.headers.get("x-dmc-build") ?? "",
        install: request.headers.get("x-dmc-install") ?? "",
        sha256: request.headers.get("x-dmc-sha256") ?? "",
      },
      actualSha,
    );
    if (!validation.ok) throw new IngestError(validation.stage, validation.message);
    const capture = validation.capture;
    const allowedBuilds = env.ALLOWED_BUILDS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (allowedBuilds?.length && !allowedBuilds.includes(capture.meta.buildId)) {
      throw new IngestError("parse", "build is not allowed");
    }

    const existing = await env.DB.prepare(
      "SELECT capture_id, sha256, raw_bytes, stored_bytes, r2_key FROM captures WHERE capture_id = ?",
    )
      .bind(capture.captureId)
      .first<ExistingCapture>();
    if (existing) {
      if (existing.sha256 !== actualSha)
        throw new IngestError("conflict", "captureId already has different bytes", 409);
      return jsonResponse(200, {
        ok: true,
        captureId: capture.captureId,
        encoding: decoded.encoding,
        rawBytes: existing.raw_bytes,
        storedBytes: existing.stored_bytes,
        r2Key: existing.r2_key,
        sessionProjected: isSessionRow(capture),
      });
    }

    const stored = await gzip(decoded.bytes);
    const receivedAt = Date.now();
    const row = projectCaptureRow(capture, {
      sha256: actualSha,
      rawBytes: decoded.bytes.byteLength,
      storedBytes: stored.byteLength,
      receivedAt,
    });
    const put = await env.CAPTURES.put(row.r2_key, stored, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
      customMetadata: { sha256: actualSha, captureId: capture.captureId },
    });
    const createdObject = put !== null;
    if (!createdObject) {
      const object = await env.CAPTURES.head(row.r2_key);
      if (object?.customMetadata?.sha256 !== actualSha) {
        throw new IngestError("conflict", "captureId already has different bytes", 409);
      }
    }

    const statements = [captureInsert(env, row)];
    const session = projectSessionRow(capture, receivedAt);
    if (session) statements.push(sessionUpsert(env, session, row));
    await env.DB.batch(statements);

    const committed = await env.DB.prepare("SELECT sha256 FROM captures WHERE capture_id = ?")
      .bind(capture.captureId)
      .first<{ sha256: string }>();
    if (!committed || committed.sha256 !== actualSha) {
      if (createdObject) await env.CAPTURES.delete(row.r2_key);
      throw new IngestError("conflict", "captureId committed with different bytes", 409);
    }
    return jsonResponse(200, {
      ok: true,
      captureId: capture.captureId,
      encoding: decoded.encoding,
      rawBytes: decoded.bytes.byteLength,
      storedBytes: stored.byteLength,
      r2Key: row.r2_key,
      sessionProjected: session !== null,
    });
  } catch (error) {
    return failure(error);
  }
}
