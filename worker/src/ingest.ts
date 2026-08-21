import type { ProblemReport, SessionUpload } from "../../src/capture";
import { serializedBytes } from "../../src/capture";
import {
  MAX_COMPRESSED_BYTES,
  MAX_DECODED_BYTES,
  validateReportBody,
  validateSessionBody,
  type ContractStage,
} from "../../src/capture-contract";
import {
  projectDiagnosticReportRow,
  projectReplayRow,
  projectSessionRow,
  type DiagnosticReportRow,
  type ReplayRow,
  type SessionRow,
} from "./projection";
import type { D1PreparedStatement, D1Result, Env } from "./bindings";
import { authorizeCapture, CaptureAuthorizationError } from "./capture-auth";

class IngestError extends Error {
  constructor(
    readonly stage: ContractStage | "auth" | "rate" | "conflict" | "store",
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
  if (error instanceof CaptureAuthorizationError) {
    console.warn(`[capture-auth] rejected operation=ingest reason=${error.reason}`);
    return jsonResponse(error.status, {
      ok: false,
      stage: "auth",
      message: error.status === 503 ? "Capture authentication unavailable" : "Unauthorized",
    });
  }
  const known = error instanceof IngestError ? error : new IngestError("store", String(error), 500);
  console.warn(
    JSON.stringify({
      message: "capture ingest rejected",
      stage: known.stage,
      status: known.status,
      error: known.message,
    }),
  );
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

async function rateLimitIp(request: Request, env: Env): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") || "__local__";
  if (!(await env.INGEST_IP.limit({ key: ip })).success) {
    throw new IngestError("rate", "capture rate limit exceeded", 429);
  }
}

function validateDeclaredLength(request: Request): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  const declaredLength = Number(header);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPRESSED_BYTES) {
    throw new IngestError("size", `compressed body exceeds ${MAX_COMPRESSED_BYTES} bytes`);
  }
}

async function prepare(
  request: Request,
  env: Env,
): Promise<{
  bytes: Uint8Array;
  encoding: "gzip" | "none";
  actualSha: string;
  headers: { build: string; install: string; sha256: string };
}> {
  if (request.method !== "POST") throw new IngestError("parse", "Method not allowed", 405);
  validateDeclaredLength(request);
  await rateLimitIp(request, env);
  const decoded = await decodedBody(request);
  return {
    ...decoded,
    actualSha: await sha256(decoded.bytes),
    headers: {
      build: request.headers.get("x-dmc-build") ?? "",
      install: request.headers.get("x-dmc-install") ?? "",
      sha256: request.headers.get("x-dmc-sha256") ?? "",
    },
  };
}

interface PreparedReplay {
  row: ReplayRow;
  statement: D1PreparedStatement;
  stored: Uint8Array;
}

async function prepareReplay(
  replay: SessionUpload["replay"],
  replaySha256: string | null,
  receivedAt: number,
  env: Env,
): Promise<PreparedReplay | null> {
  if (!replay || !replaySha256) return null;
  const raw = serializedBytes(replay);
  const stored = await gzip(raw);
  const row = projectReplayRow({
    sha256: replaySha256,
    rawBytes: raw.byteLength,
    storedBytes: stored.byteLength,
    receivedAt,
  });
  const statement = env.DB.prepare(
    `INSERT INTO replays (
      replay_sha256, first_seen_at, last_referenced_at, raw_bytes, stored_bytes, r2_key
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(replay_sha256) DO UPDATE SET
      last_referenced_at=MAX(replays.last_referenced_at, excluded.last_referenced_at),
      raw_bytes=excluded.raw_bytes,
      stored_bytes=excluded.stored_bytes,
      r2_key=excluded.r2_key`,
  ).bind(row.replay_sha256, row.first_seen_at, row.last_referenced_at, row.raw_bytes, row.stored_bytes, row.r2_key);
  return { row, statement, stored };
}

async function writeReplay(replay: PreparedReplay | null, env: Env): Promise<void> {
  if (!replay) return;
  await env.CAPTURES.put(replay.row.r2_key, replay.stored, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    customMetadata: { sha256: replay.row.replay_sha256, kind: "replay" },
  });
}

function sessionInsert(env: Env, row: SessionRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO sessions (
      run_id, install_id, install_ephemeral, display_name, build, platform, input_class,
      created_at, received_at, outcome, death_cause, wave_reached, score, time_played_ms,
      burj_health, shots_fired, total_kills, hit_ratio, multi_shots, max_combo,
      destroyed_by_type_json, upgrades_json, feedback_emoji, feedback_note, replay_sha256,
      replay_omitted_reason, replay_complete_claimed, replay_verified, verified_at, shared, source,
      sha256, submitter_key_id_hash
    ) SELECT ${Array.from({ length: 33 }, () => "?").join(", ")}
      WHERE ? IS NULL OR EXISTS (
        SELECT 1 FROM replays WHERE replay_sha256 = ?
      )
    ON CONFLICT(run_id) DO NOTHING`,
  ).bind(
    row.run_id,
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
    row.replay_omitted_reason,
    row.replay_complete_claimed,
    row.replay_verified,
    row.verified_at,
    row.shared,
    row.source,
    row.sha256,
    row.submitter_key_id_hash,
    row.replay_sha256,
    row.replay_sha256,
  );
}

function reportInsert(env: Env, row: DiagnosticReportRow): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO diagnostic_reports (
      report_id, install_id, install_ephemeral, run_id, boot_id, build, platform, input_class,
      created_at, received_at, app_screen, trigger, note, partial, captured_through_tick,
      replay_sha256, replay_source, replay_omitted_reason, events_count, events_truncated,
      sha256, raw_bytes, stored_bytes, r2_key, submitter_key_id_hash
    ) SELECT ${Array.from({ length: 25 }, () => "?").join(", ")}
      WHERE ? IS NULL OR EXISTS (
        SELECT 1 FROM replays WHERE replay_sha256 = ?
      )
    ON CONFLICT(report_id) DO NOTHING`,
  ).bind(
    row.report_id,
    row.install_id,
    row.install_ephemeral,
    row.run_id,
    row.boot_id,
    row.build,
    row.platform,
    row.input_class,
    row.created_at,
    row.received_at,
    row.app_screen,
    row.trigger,
    row.note,
    row.partial,
    row.captured_through_tick,
    row.replay_sha256,
    row.replay_source,
    row.replay_omitted_reason,
    row.events_count,
    row.events_truncated,
    row.sha256,
    row.raw_bytes,
    row.stored_bytes,
    row.r2_key,
    row.submitter_key_id_hash,
    row.replay_sha256,
    row.replay_sha256,
  );
}

export async function ingestSession(request: Request, env: Env): Promise<Response> {
  try {
    const prepared = await prepare(request, env);
    const validation = await validateSessionBody(prepared.bytes, prepared.headers, prepared.actualSha);
    if (!validation.ok) throw new IngestError(validation.stage, validation.message);
    const session = validation.session;
    const authorization = await authorizeCapture(request, env, {
      purpose: "session",
      build: session.meta.buildId,
      decodedBodySha256: prepared.actualSha,
    });
    const receivedAt = Date.now();
    const replay = await prepareReplay(session.replay, session.meta.replaySha256, receivedAt, env);
    const row = projectSessionRow(session, receivedAt, {
      sha256: prepared.actualSha,
      keyIdHash: authorization.keyIdHash,
    });
    const existing = await env.DB.prepare(
      "SELECT run_id, replay_sha256, sha256, submitter_key_id_hash FROM sessions WHERE run_id = ?",
    )
      .bind(row.run_id)
      .first<ExistingSession>();
    if (existing) {
      if (
        existing.sha256 !== row.sha256 ||
        existing.replay_sha256 !== row.replay_sha256 ||
        existing.submitter_key_id_hash !== row.submitter_key_id_hash
      ) {
        throw new IngestError("conflict", "runId already has different bytes or owner", 409);
      }
      await writeReplay(replay, env);
      if (replay) await replay.statement.run();
      return jsonResponse(200, {
        ok: true,
        id: row.run_id,
        encoding: prepared.encoding,
        replaySha256: row.replay_sha256,
        replayR2Key: row.replay_sha256 ? `replays/${row.replay_sha256}.json.gz` : null,
      });
    }

    await writeReplay(replay, env);
    await env.DB.batch<D1Result>([...(replay ? [replay.statement] : []), sessionInsert(env, row)]);
    const committed = await env.DB.prepare(
      "SELECT run_id, replay_sha256, sha256, submitter_key_id_hash FROM sessions WHERE run_id = ?",
    )
      .bind(row.run_id)
      .first<ExistingSession>();
    if (
      !committed ||
      committed.sha256 !== row.sha256 ||
      committed.replay_sha256 !== row.replay_sha256 ||
      committed.submitter_key_id_hash !== row.submitter_key_id_hash
    ) {
      throw new IngestError("conflict", "runId committed with different bytes or owner", 409);
    }
    return jsonResponse(200, {
      ok: true,
      id: row.run_id,
      encoding: prepared.encoding,
      replaySha256: committed.replay_sha256,
      replayR2Key: committed.replay_sha256 ? `replays/${committed.replay_sha256}.json.gz` : null,
    });
  } catch (error) {
    return failure(error);
  }
}

interface ExistingSession {
  run_id: string;
  replay_sha256: string | null;
  sha256: string | null;
  submitter_key_id_hash: string | null;
}

interface ExistingReport {
  report_id: string;
  replay_sha256: string | null;
  sha256: string;
  raw_bytes: number;
  stored_bytes: number;
  r2_key: string;
  submitter_key_id_hash: string | null;
}

export async function ingestReport(request: Request, env: Env): Promise<Response> {
  try {
    const prepared = await prepare(request, env);
    const validation = await validateReportBody(prepared.bytes, prepared.headers, prepared.actualSha);
    if (!validation.ok) throw new IngestError(validation.stage, validation.message);
    const report = validation.report;
    const authorization = await authorizeCapture(request, env, {
      purpose: "report",
      build: report.meta.buildId,
      decodedBodySha256: prepared.actualSha,
    });
    const { replay: _replay, ...storedReport } = report;
    const reportBytes = serializedBytes(storedReport);
    const reportSha = await sha256(reportBytes);
    const receivedAt = Date.now();
    const reportStored = await gzip(reportBytes);
    const row = projectDiagnosticReportRow(report, {
      sha256: reportSha,
      rawBytes: reportBytes.byteLength,
      storedBytes: reportStored.byteLength,
      receivedAt,
      submitterKeyIdHash: authorization.keyIdHash,
    });

    const existing = await env.DB.prepare(
      `SELECT report_id, replay_sha256, sha256, raw_bytes, stored_bytes, r2_key, submitter_key_id_hash
       FROM diagnostic_reports WHERE report_id = ?`,
    )
      .bind(report.reportId)
      .first<ExistingReport>();
    if (existing) {
      if (
        existing.sha256 !== row.sha256 ||
        existing.replay_sha256 !== row.replay_sha256 ||
        existing.submitter_key_id_hash !== row.submitter_key_id_hash
      ) {
        throw new IngestError("conflict", "reportId already has different bytes or owner", 409);
      }
      const replay = await prepareReplay(report.replay, report.meta.replaySha256, receivedAt, env);
      await writeReplay(replay, env);
      if (replay) await replay.statement.run();
      const object = await env.CAPTURES.head(existing.r2_key);
      if (object && object.customMetadata?.sha256 !== existing.sha256) {
        throw new IngestError("conflict", "reportId object has different bytes", 409);
      }
      if (!object) {
        await env.CAPTURES.put(existing.r2_key, reportStored, {
          httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
          customMetadata: {
            sha256: existing.sha256,
            reportId: existing.report_id,
            kind: "diagnostic-report",
          },
        });
      }
      return jsonResponse(200, {
        ok: true,
        id: existing.report_id,
        encoding: prepared.encoding,
        rawBytes: existing.raw_bytes,
        storedBytes: existing.stored_bytes,
        r2Key: existing.r2_key,
        replaySha256: existing.replay_sha256,
      });
    }

    const replay = await prepareReplay(report.replay, report.meta.replaySha256, receivedAt, env);
    await writeReplay(replay, env);
    const reportPut = await env.CAPTURES.put(row.r2_key, reportStored, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
      customMetadata: { sha256: row.sha256, reportId: row.report_id, kind: "diagnostic-report" },
    });
    const createdReportObject = reportPut !== null;
    if (!createdReportObject) {
      const object = await env.CAPTURES.head(row.r2_key);
      if (object?.customMetadata?.sha256 !== row.sha256) {
        throw new IngestError("conflict", "reportId already has different bytes", 409);
      }
    }

    await env.DB.batch([...(replay ? [replay.statement] : []), reportInsert(env, row)]);
    const committed = await env.DB.prepare(
      `SELECT report_id, replay_sha256, sha256, raw_bytes, stored_bytes, r2_key, submitter_key_id_hash
       FROM diagnostic_reports WHERE report_id = ?`,
    )
      .bind(report.reportId)
      .first<ExistingReport>();
    if (
      !committed ||
      committed.sha256 !== row.sha256 ||
      committed.replay_sha256 !== row.replay_sha256 ||
      committed.submitter_key_id_hash !== row.submitter_key_id_hash
    ) {
      if (createdReportObject) await env.CAPTURES.delete(row.r2_key);
      throw new IngestError("conflict", "reportId committed with different bytes", 409);
    }
    return jsonResponse(200, {
      ok: true,
      id: row.report_id,
      encoding: prepared.encoding,
      rawBytes: row.raw_bytes,
      storedBytes: row.stored_bytes,
      r2Key: row.r2_key,
      replaySha256: row.replay_sha256,
    });
  } catch (error) {
    return failure(error);
  }
}
