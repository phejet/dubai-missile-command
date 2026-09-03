import { SAFE_ID, SHA256 } from "../../src/capture-contract";
import type { Env, R2ObjectBody } from "./bindings";
import { authorizeCapture, CaptureAuthorizationError } from "./capture-auth";
import { IngestError, jsonResponse, readBounded } from "./ingest";
import { REPLAY_RETENTION_MS, retentionCutoff } from "./retention";

const MAX_SHARE_BODY_BYTES = 4 * 1024;
export const SHARE_ID = /^[a-f0-9]{16}$/;

interface ShareBody {
  runId: string;
  buildId: string;
}

interface ShareableSessionRow {
  run_id: string;
  build: string;
  replay_sha256: string | null;
  submitter_key_id_hash: string | null;
  score: number;
  wave_reached: number;
  outcome: string;
}

interface SharedRunRow extends ShareableSessionRow {
  share_id: string;
}

function failure(error: unknown): Response {
  if (error instanceof CaptureAuthorizationError) {
    console.warn(`[capture-auth] rejected operation=share reason=${error.reason}`);
    return jsonResponse(error.status, {
      ok: false,
      stage: "auth",
      message: error.status === 503 ? "Capture authentication unavailable" : "Unauthorized",
    });
  }
  if (error instanceof IngestError) {
    return jsonResponse(error.status, { ok: false, stage: error.stage, message: error.message });
  }
  console.error("[capture-worker] share failed", error);
  return jsonResponse(500, { ok: false, stage: "store", message: "Unable to share run" });
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(bytes));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function deterministicShareId(runId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`DMC-SHARE-v1\0${runId}`));
  return [...new Uint8Array(signature).slice(0, 8)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function parseShareBody(bytes: Uint8Array): ShareBody | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ShareBody>;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof value.runId !== "string" ||
      !SAFE_ID.test(value.runId) ||
      typeof value.buildId !== "string" ||
      value.buildId.length === 0 ||
      value.buildId.length > 200 ||
      Object.keys(value).some((key) => key !== "runId" && key !== "buildId")
    ) {
      return null;
    }
    return { runId: value.runId, buildId: value.buildId };
  } catch {
    return null;
  }
}

function shareUrl(request: Request, shareId: string): string {
  return new URL(`/r/${shareId}`, request.url).toString();
}

export async function shareSession(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, stage: "parse", message: "Method not allowed" });
    }
    const bytes = await readBounded(request.body, MAX_SHARE_BODY_BYTES, "share body");
    const body = parseShareBody(bytes);
    if (!body) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid share request" });
    const actualSha = await sha256Hex(bytes);
    if (request.headers.get("x-dmc-sha256") !== actualSha || request.headers.get("x-dmc-build") !== body.buildId) {
      return jsonResponse(400, { ok: false, stage: "hash", message: "Share request integrity mismatch" });
    }
    const authorization = await authorizeCapture(request, env, {
      purpose: "share",
      build: body.buildId,
      decodedBodySha256: actualSha,
    });
    const session = await env.DB.prepare(
      `SELECT run_id, build, replay_sha256, submitter_key_id_hash, score, wave_reached, outcome
       FROM sessions WHERE run_id = ? AND received_at >= ?`,
    )
      .bind(body.runId, retentionCutoff(Date.now(), REPLAY_RETENTION_MS))
      .first<ShareableSessionRow>();
    if (!session) return jsonResponse(404, { ok: false, stage: "store", message: "Session not found" });
    if (session.submitter_key_id_hash !== authorization.keyIdHash || session.build !== body.buildId) {
      return jsonResponse(403, { ok: false, stage: "auth", message: "Session owner mismatch" });
    }
    if (!session.replay_sha256 || !SHA256.test(session.replay_sha256)) {
      return jsonResponse(409, { ok: false, stage: "store", message: "Session has no shareable replay" });
    }
    const replay = await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
      .bind(session.replay_sha256)
      .first<{ r2_key: string }>();
    if (!replay || !(await env.CAPTURES.head(replay.r2_key))) {
      return jsonResponse(409, { ok: false, stage: "store", message: "Session replay is unavailable" });
    }

    const existing = await env.DB.prepare("SELECT share_id FROM shared_runs WHERE run_id = ?")
      .bind(body.runId)
      .first<{ share_id: string }>();
    const shareId = existing?.share_id ?? (await deterministicShareId(body.runId, env.CAPTURE_AUTH_SECRET!));
    if (!existing) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO shared_runs (share_id, run_id, created_at) VALUES (?, ?, ?)").bind(
          shareId,
          body.runId,
          Date.now(),
        ),
        env.DB.prepare("UPDATE sessions SET shared = 1 WHERE run_id = ?").bind(body.runId),
      ]);
    } else {
      await env.DB.prepare("UPDATE sessions SET shared = 1 WHERE run_id = ?").bind(body.runId).run();
    }
    return jsonResponse(200, { ok: true, shareId, shareUrl: shareUrl(request, shareId) });
  } catch (error) {
    return failure(error);
  }
}

function publicGameUrl(env: Env): URL | null {
  if (!env.PUBLIC_GAME_URL) return null;
  try {
    const url = new URL(env.PUBLIC_GAME_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

async function sharedRow(env: Env, shareId: string, now = Date.now()): Promise<SharedRunRow | null> {
  if (!SHARE_ID.test(shareId)) return null;
  return env.DB.prepare(
    `SELECT sh.share_id, s.run_id, s.build, s.replay_sha256, s.submitter_key_id_hash,
            s.score, s.wave_reached, s.outcome
     FROM shared_runs sh
     JOIN sessions s ON s.run_id = sh.run_id
     WHERE sh.share_id = ? AND s.shared = 1 AND s.received_at >= ?`,
  )
    .bind(shareId, retentionCutoff(now, REPLAY_RETENTION_MS))
    .first<SharedRunRow>();
}

async function objectJson(object: R2ObjectBody): Promise<unknown> {
  const stream = object.body.pipeThrough(
    new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
  return new Response(stream).json();
}

function publicHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=60",
    Vary: "Origin",
  };
}

export async function retrieveSharedRun(env: Env, shareId: string): Promise<Response> {
  const row = await sharedRow(env, shareId);
  if (!row?.replay_sha256) {
    return jsonResponse(404, { ok: false, stage: "store", message: "Shared run not found" }, publicHeaders());
  }
  const replayRow = await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
    .bind(row.replay_sha256)
    .first<{ r2_key: string }>();
  const object = replayRow ? await env.CAPTURES.get(replayRow.r2_key) : null;
  if (!object) {
    return jsonResponse(410, { ok: false, stage: "store", message: "Shared replay expired" }, publicHeaders());
  }
  return jsonResponse(
    200,
    {
      ok: true,
      shareId: row.share_id,
      summary: {
        score: row.score,
        wave: row.wave_reached,
        outcome: row.outcome,
        build: row.build,
      },
      replay: await objectJson(object),
    },
    publicHeaders(),
  );
}

export async function redirectSharedRun(env: Env, shareId: string): Promise<Response> {
  const row = await sharedRow(env, shareId);
  if (!row?.replay_sha256) {
    return jsonResponse(404, { ok: false, stage: "store", message: "Shared run not found" });
  }
  const replay = await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
    .bind(row.replay_sha256)
    .first<{ r2_key: string }>();
  if (!replay || !(await env.CAPTURES.head(replay.r2_key))) {
    return jsonResponse(410, { ok: false, stage: "store", message: "Shared replay unavailable" }, publicHeaders());
  }
  const destination = publicGameUrl(env);
  if (!destination || (env.WORKER_BUILD !== "staging" && env.WORKER_BUILD !== "production")) {
    return jsonResponse(503, { ok: false, stage: "store", message: "Public replay routing unavailable" });
  }
  destination.searchParams.set("r", shareId);
  destination.searchParams.set("share", env.WORKER_BUILD);
  return Response.redirect(destination, 302);
}
