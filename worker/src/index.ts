import { SAFE_ID, SHA256 } from "../../src/capture-contract";
import { authorized } from "./auth";
import type { Env, R2ObjectBody } from "./bindings";
import { challenge, enroll, revokeCredential } from "./capture-auth";
import { handleDeletion, handleDeletionJobs, handleReservationRecovery } from "./deletion";
import { submitFeedback } from "./feedback";
import { ingestReport, ingestSession, jsonResponse } from "./ingest";
import {
  isRetained,
  REPORT_RETENTION_MS,
  REPLAY_RETENTION_MS,
  retentionCutoff,
  runRetention,
  SESSION_RETENTION_MS,
} from "./retention";
import { redirectSharedRun, retrieveSharedRun, shareSession } from "./share";

const DEFAULT_ORIGINS = new Set(["capacitor://localhost"]);

export { runRetention } from "./retention";

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledControllerLike {
  scheduledTime: number;
}

function allowedOrigins(env: Env): Set<string> {
  const configured =
    env.ALLOWED_ORIGINS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return new Set([...DEFAULT_ORIGINS, ...configured]);
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Content-Encoding, x-dmc-build, x-dmc-install, x-dmc-sha256, x-dmc-challenge-token, x-dmc-assertion",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function operatorOrigins(env: Env): Set<string> {
  const origins = allowedOrigins(env);
  if (env.PUBLIC_GAME_URL) {
    try {
      origins.add(new URL(env.PUBLIC_GAME_URL).origin);
    } catch {
      // Deployment validation owns PUBLIC_GAME_URL; a malformed value grants no CORS access.
    }
  }
  return origins;
}

function operatorCorsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function withOperatorCors(request: Request, env: Env, handler: () => Promise<Response>): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !operatorOrigins(env).has(origin)) {
    return jsonResponse(403, { ok: false, stage: "auth", message: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") {
    if (!origin) return jsonResponse(400, { ok: false, stage: "parse", message: "Origin required" });
    return new Response(null, { status: 204, headers: operatorCorsHeaders(origin) });
  }
  const response = await handler();
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(operatorCorsHeaders(origin))) headers.set(name, String(value));
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}

async function ingestWithCors(
  request: Request,
  env: Env,
  ingest: (request: Request, env: Env) => Promise<Response>,
): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) {
    return jsonResponse(403, { ok: false, stage: "parse", message: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") {
    if (!origin) return jsonResponse(400, { ok: false, stage: "parse", message: "Origin required" });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  const response = await ingest(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, String(value));
  return new Response(response.body, { status: response.status, headers });
}

function requireAuth(request: Request, env: Env): Response | null {
  return authorized(request, env.CAPTURE_BEARER_TOKEN)
    ? null
    : jsonResponse(401, { ok: false, stage: "auth", message: "Unauthorized" });
}

async function objectJson(object: R2ObjectBody): Promise<Record<string, unknown>> {
  const stream = object.body.pipeThrough(
    new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
  );
  return (await new Response(stream).json()) as Record<string, unknown>;
}

type ReplayLookup =
  | { replay: null; replayStatus: "omitted" | "expired" | "missing" }
  | { replay: unknown; replayStatus: "available" };

function submissionProvenance(row: Record<string, unknown>): Record<string, unknown> {
  return {
    appFlavor: row.app_flavor ?? "unknown",
    bundleId: row.apple_bundle_id ?? null,
    appleEnvironment: row.apple_environment ?? null,
  };
}

async function replayValue(env: Env, sha: string | null): Promise<ReplayLookup> {
  if (sha === null) return { replay: null, replayStatus: "omitted" };
  const row = await env.DB.prepare("SELECT r2_key FROM replays WHERE replay_sha256 = ?")
    .bind(sha)
    .first<{ r2_key: string }>();
  if (!row) {
    console.error(`[capture-worker] replay index missing sha=${sha}`);
    return { replay: null, replayStatus: "missing" };
  }
  const object = await env.CAPTURES.get(row.r2_key);
  if (!object) {
    console.error(`[capture-worker] replay object missing sha=${sha} key=${row.r2_key}`);
    return { replay: null, replayStatus: "missing" };
  }
  return { replay: await objectJson(object), replayStatus: "available" };
}

async function retrieveSession(request: Request, env: Env, runId: string): Promise<Response> {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  if (!SAFE_ID.test(runId)) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid runId" });
  const row = await env.DB.prepare("SELECT * FROM sessions WHERE run_id = ?")
    .bind(runId)
    .first<Record<string, unknown>>();
  if (!row) return jsonResponse(404, { ok: false, stage: "store", message: "Session not found" });
  const now = Date.now();
  if (!isRetained(Number(row.received_at), now, SESSION_RETENTION_MS)) {
    return jsonResponse(404, { ok: false, stage: "store", message: "Session not found" });
  }
  if (!isRetained(Number(row.received_at), now, REPORT_RETENTION_MS)) {
    row.display_name = null;
    row.feedback_note = null;
  }
  const replay = isRetained(Number(row.received_at), now, REPLAY_RETENTION_MS)
    ? await replayValue(env, (row.replay_sha256 as string | null) ?? null)
    : { replay: null, replayStatus: "expired" as const };
  return jsonResponse(200, {
    ok: true,
    session: row,
    provenance: submissionProvenance(row),
    replay: replay.replay,
    ...(replay.replayStatus === "expired" || replay.replayStatus === "missing"
      ? { replayStatus: replay.replayStatus }
      : {}),
  });
}

async function retrieveReport(request: Request, env: Env, reportId: string): Promise<Response> {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  if (!SAFE_ID.test(reportId)) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid reportId" });
  const row = await env.DB.prepare(
    `SELECT r2_key, replay_sha256, app_flavor, apple_bundle_id, apple_environment
     FROM diagnostic_reports WHERE report_id = ? AND received_at >= ?`,
  )
    .bind(reportId, retentionCutoff(Date.now(), REPORT_RETENTION_MS))
    .first<{
      r2_key: string;
      replay_sha256: string | null;
      app_flavor: string;
      apple_bundle_id: string | null;
      apple_environment: string | null;
    }>();
  if (!row) return jsonResponse(404, { ok: false, stage: "store", message: "Report not found" });
  const reportObject = await env.CAPTURES.get(row.r2_key);
  if (!reportObject) return jsonResponse(404, { ok: false, stage: "store", message: "Report object not found" });
  const replay = await replayValue(env, row.replay_sha256);
  const stored = await objectJson(reportObject);
  return jsonResponse(200, {
    ...stored,
    provenance: submissionProvenance(row),
    replay: replay.replay,
    ...(replay.replayStatus === "expired" || replay.replayStatus === "missing"
      ? { replayStatus: replay.replayStatus }
      : {}),
  });
}

async function retrieveReplay(request: Request, env: Env, sha: string): Promise<Response> {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  if (!SHA256.test(sha)) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid replay SHA" });
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT r.r2_key, r.raw_bytes, r.stored_bytes
     FROM replays r
     WHERE r.replay_sha256 = ?
       AND (
         EXISTS (SELECT 1 FROM sessions s WHERE s.replay_sha256 = r.replay_sha256 AND s.received_at >= ?)
         OR EXISTS (
           SELECT 1 FROM diagnostic_reports d
           WHERE d.replay_sha256 = r.replay_sha256 AND d.received_at >= ?
         )
       )`,
  )
    .bind(sha, retentionCutoff(now, REPLAY_RETENTION_MS), retentionCutoff(now, REPORT_RETENTION_MS))
    .first<{ r2_key: string; raw_bytes: number; stored_bytes: number }>();
  if (!row) return jsonResponse(404, { ok: false, stage: "store", message: "Replay not found" });
  const object = await env.CAPTURES.get(row.r2_key);
  if (!object) return jsonResponse(404, { ok: false, stage: "store", message: "Replay object not found" });
  const url = new URL(request.url);
  if (url.searchParams.get("raw") === "1") {
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store, no-transform",
        "x-dmc-sha256": sha,
      },
    });
  }
  return new Response(
    object.body.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>),
    { headers: { "Content-Type": "application/json", "x-dmc-sha256": sha } },
  );
}

async function listRows(request: Request, env: Env, table: "sessions" | "diagnostic_reports"): Promise<Response> {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  const clauses: string[] = [];
  const values: unknown[] = [];
  clauses.push("received_at >= ?");
  values.push(retentionCutoff(Date.now(), table === "sessions" ? SESSION_RETENTION_MS : REPORT_RETENTION_MS));
  for (const [parameter, column] of [
    ["install", "install_id"],
    ["build", "build"],
    ["run", "run_id"],
    ["flavor", "app_flavor"],
  ] as const) {
    const value = url.searchParams.get(parameter);
    if (value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }
  const since = url.searchParams.get("since");
  if (since !== null) {
    const parsed = Number(since);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return jsonResponse(400, { ok: false, stage: "parse", message: "since must be a non-negative epoch ms" });
    }
    clauses.push("received_at >= ?");
    values.push(Math.trunc(parsed));
  }
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;
  values.push(limit);
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(`SELECT * FROM ${table}${where} ORDER BY received_at DESC LIMIT ?`)
    .bind(...values)
    .all();
  const rows = (result.results ?? []).map((row) => {
    if (
      table === "sessions" &&
      !isRetained(Number((row as Record<string, unknown>).received_at), Date.now(), REPORT_RETENTION_MS)
    ) {
      return { ...(row as Record<string, unknown>), display_name: null, feedback_note: null };
    }
    return row;
  });
  return jsonResponse(200, { ok: true, [table === "sessions" ? "sessions" : "reports"]: rows });
}

async function listOperatorSessions(request: Request, env: Env): Promise<Response> {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;
  const result = await env.DB.prepare(
    `SELECT s.run_id, s.received_at, s.build, s.score, s.wave_reached, s.outcome,
            s.replay_sha256, r.r2_key
     FROM sessions s
     LEFT JOIN replays r ON r.replay_sha256 = s.replay_sha256
     WHERE s.received_at >= ?
     ORDER BY s.received_at DESC
     LIMIT ?`,
  )
    .bind(retentionCutoff(Date.now(), SESSION_RETENTION_MS), limit)
    .all<{
      run_id: string;
      received_at: number;
      build: string;
      score: number;
      wave_reached: number;
      outcome: string;
      replay_sha256: string | null;
      r2_key: string | null;
    }>();
  const sessions = await Promise.all(
    (result.results ?? []).map(async (row) => {
      const replayStatus = !row.replay_sha256
        ? "omitted"
        : !isRetained(row.received_at, Date.now(), REPLAY_RETENTION_MS)
          ? "expired"
          : !row.r2_key
            ? "missing"
            : (await env.CAPTURES.head(row.r2_key))
              ? "available"
              : "missing";
      return {
        runId: row.run_id,
        receivedAt: row.received_at,
        build: row.build,
        score: row.score,
        wave: row.wave_reached,
        outcome: row.outcome,
        replayStatus,
      };
    }),
  );
  return jsonResponse(200, { ok: true, sessions });
}

function decodedPathId(pathname: string, pattern: RegExp): string | null {
  const match = pattern.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResponse(200, { ok: true, schema: 2, build: env.WORKER_BUILD ?? "dev" });
    }
    if (url.pathname === "/api/auth/challenge") return ingestWithCors(request, env, challenge);
    if (url.pathname === "/api/auth/ios/enroll") return ingestWithCors(request, env, enroll);
    if (url.pathname === "/api/auth/ios/revoke" && request.method === "POST") {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid JSON" });
      }
      const keyIdHash = (body as { keyIdHash?: unknown })?.keyIdHash;
      if (typeof keyIdHash !== "string") {
        return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid keyIdHash" });
      }
      return (await revokeCredential(keyIdHash, env))
        ? jsonResponse(200, { ok: true })
        : jsonResponse(404, { ok: false, stage: "auth", message: "Credential not found" });
    }
    if (url.pathname === "/api/session") return ingestWithCors(request, env, ingestSession);
    if (url.pathname === "/api/report") return ingestWithCors(request, env, ingestReport);
    if (url.pathname === "/api/share") return ingestWithCors(request, env, shareSession);
    if (url.pathname === "/api/feedback") return ingestWithCors(request, env, submitFeedback);
    if (
      url.pathname === "/api/operator/deletion/preview" ||
      url.pathname === "/api/operator/deletion/execute" ||
      url.pathname === "/api/operator/deletion/resume"
    ) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      return handleDeletion(
        request,
        env,
        url.pathname.endsWith("/preview") ? "preview" : url.pathname.endsWith("/execute") ? "execute" : "resume",
      );
    }
    if (
      url.pathname === "/api/operator/deletion/reservation/inspect" ||
      url.pathname === "/api/operator/deletion/reservation/recover"
    ) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      return handleReservationRecovery(request, env, url.pathname.endsWith("/inspect") ? "inspect" : "recover");
    }
    if (
      url.pathname === "/api/operator/deletion/jobs/list" ||
      url.pathname === "/api/operator/deletion/jobs/inspect" ||
      url.pathname === "/api/operator/deletion/jobs/recover"
    ) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      return handleDeletionJobs(
        request,
        env,
        url.pathname.endsWith("/list") ? "list" : url.pathname.endsWith("/inspect") ? "inspect" : "recover",
      );
    }
    if (url.pathname === "/api/operator/sessions") {
      return withOperatorCors(request, env, () => listOperatorSessions(request, env));
    }
    if (url.pathname === "/api/sessions" && request.method === "GET") return listRows(request, env, "sessions");
    if (url.pathname === "/api/reports" && request.method === "GET") {
      return listRows(request, env, "diagnostic_reports");
    }
    if (request.method === "GET" || request.method === "OPTIONS") {
      const runId = decodedPathId(url.pathname, /^\/api\/session\/([^/]+)$/);
      if (runId !== null) return withOperatorCors(request, env, () => retrieveSession(request, env, runId));
    }
    if (request.method === "GET") {
      const reportId = decodedPathId(url.pathname, /^\/api\/report\/([^/]+)$/);
      if (reportId !== null) return retrieveReport(request, env, reportId);
      const sha = decodedPathId(url.pathname, /^\/api\/replay\/([^/]+)$/);
      if (sha !== null) return retrieveReplay(request, env, sha);
      const sharedId = decodedPathId(url.pathname, /^\/api\/shared\/([^/]+)$/);
      if (sharedId !== null) return retrieveSharedRun(env, sharedId);
      const redirectId = decodedPathId(url.pathname, /^\/r\/([^/]+)$/);
      if (redirectId !== null) return redirectSharedRun(env, redirectId);
    }
    return jsonResponse(404, { ok: false, stage: "parse", message: "Not found" });
  },

  scheduled(controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
    context.waitUntil(runRetention(env, controller.scheduledTime || Date.now()));
  },
};
