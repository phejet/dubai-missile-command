import { SAFE_ID } from "../../src/capture-contract";
import { authorized } from "./auth";
import type { Env } from "./bindings";
import { ingestCapture, jsonResponse } from "./ingest";

const CAPTURE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const SESSION_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
const DEFAULT_ORIGINS = new Set(["capacitor://localhost", "https://phejet.github.io"]);

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
    "Access-Control-Allow-Headers": "Content-Type, Content-Encoding, x-dmc-build, x-dmc-install, x-dmc-sha256",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function ingestWithCors(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins(env).has(origin)) {
    return jsonResponse(403, { ok: false, stage: "parse", message: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") {
    if (!origin) return jsonResponse(400, { ok: false, stage: "parse", message: "Origin required" });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  const response = await ingestCapture(request, env);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, String(value));
  return new Response(response.body, { status: response.status, headers });
}

async function retrieveCapture(request: Request, env: Env, captureId: string): Promise<Response> {
  if (!authorized(request, env.CAPTURE_BEARER_TOKEN)) {
    return jsonResponse(401, { ok: false, stage: "auth", message: "Unauthorized" });
  }
  if (!SAFE_ID.test(captureId)) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid captureId" });
  const row = await env.DB.prepare("SELECT r2_key, sha256 FROM captures WHERE capture_id = ?")
    .bind(captureId)
    .first<{ r2_key: string; sha256: string }>();
  if (!row) return jsonResponse(404, { ok: false, stage: "store", message: "Capture not found" });
  const object = await env.CAPTURES.get(row.r2_key);
  if (!object) return jsonResponse(404, { ok: false, stage: "store", message: "Capture object not found" });
  const url = new URL(request.url);
  if (url.searchParams.get("raw") === "1") {
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store, no-transform",
        "x-dmc-sha256": row.sha256,
      },
    });
  }
  return new Response(
    object.body.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>),
    {
      headers: { "Content-Type": "application/json", "x-dmc-sha256": row.sha256 },
    },
  );
}

async function listCaptures(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.CAPTURE_BEARER_TOKEN)) {
    return jsonResponse(401, { ok: false, stage: "auth", message: "Unauthorized" });
  }
  const url = new URL(request.url);
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [parameter, column] of [
    ["install", "install_id"],
    ["build", "build"],
    ["run", "run_id"],
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
  const query = `SELECT * FROM captures${where} ORDER BY received_at DESC LIMIT ?`;
  const result = await env.DB.prepare(query)
    .bind(...values)
    .all();
  return jsonResponse(200, { ok: true, captures: result.results ?? [] });
}

export async function runRetention(env: Env, now = Date.now()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM captures WHERE received_at < ?").bind(now - CAPTURE_RETENTION_MS),
    env.DB.prepare("DELETE FROM sessions WHERE received_at < ?").bind(now - SESSION_RETENTION_MS),
  ]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return jsonResponse(200, { ok: true, schema: 1, build: env.WORKER_BUILD ?? "dev" });
    }
    if (url.pathname === "/api/save-capture") return ingestWithCors(request, env);
    if (url.pathname === "/api/captures" && request.method === "GET") return listCaptures(request, env);
    const match = /^\/api\/capture\/([^/]+)$/.exec(url.pathname);
    if (match && request.method === "GET") {
      try {
        return retrieveCapture(request, env, decodeURIComponent(match[1]));
      } catch {
        return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid captureId encoding" });
      }
    }
    return jsonResponse(404, { ok: false, stage: "parse", message: "Not found" });
  },

  scheduled(controller: ScheduledControllerLike, env: Env, context: ExecutionContextLike): void {
    context.waitUntil(runRetention(env, controller.scheduledTime || Date.now()));
  },
};
