import { RUN_FEEDBACK_EMOJIS, type RunFeedbackEmoji } from "../../src/capture";
import { SAFE_ID } from "../../src/capture-contract";
import type { Env } from "./bindings";
import { authorizeCapture, CaptureAuthorizationError } from "./capture-auth";
import { IngestError, jsonResponse, readBounded } from "./ingest";
import { retentionCutoff, SESSION_RETENTION_MS } from "./retention";

const MAX_FEEDBACK_BODY_BYTES = 4 * 1024;

interface FeedbackBody {
  runId: string;
  buildId: string;
  emoji: RunFeedbackEmoji;
}

function parseFeedback(bytes: Uint8Array): FeedbackBody | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof value.runId !== "string" ||
      !SAFE_ID.test(value.runId) ||
      typeof value.buildId !== "string" ||
      value.buildId.length === 0 ||
      value.buildId.length > 200 ||
      typeof value.emoji !== "string" ||
      !RUN_FEEDBACK_EMOJIS.includes(value.emoji as RunFeedbackEmoji) ||
      Object.keys(value).some((key) => key !== "runId" && key !== "buildId" && key !== "emoji")
    ) {
      return null;
    }
    return value as unknown as FeedbackBody;
  } catch {
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function submitFeedback(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== "POST")
      return jsonResponse(405, { ok: false, stage: "parse", message: "Method not allowed" });
    const bytes = await readBounded(request.body, MAX_FEEDBACK_BODY_BYTES, "feedback body");
    const body = parseFeedback(bytes);
    if (!body) return jsonResponse(400, { ok: false, stage: "parse", message: "Invalid feedback request" });
    const actualSha = await sha256Hex(bytes);
    if (request.headers.get("x-dmc-sha256") !== actualSha || request.headers.get("x-dmc-build") !== body.buildId) {
      return jsonResponse(400, { ok: false, stage: "hash", message: "Feedback request integrity mismatch" });
    }
    const authorization = await authorizeCapture(request, env, {
      purpose: "feedback",
      build: body.buildId,
      decodedBodySha256: actualSha,
    });
    const session = await env.DB.prepare(
      "SELECT build, submitter_key_id_hash FROM sessions WHERE run_id = ? AND received_at >= ?",
    )
      .bind(body.runId, retentionCutoff(Date.now(), SESSION_RETENTION_MS))
      .first<{ build: string; submitter_key_id_hash: string | null }>();
    if (!session) return jsonResponse(404, { ok: false, stage: "store", message: "Session not found" });
    if (session.build !== body.buildId || session.submitter_key_id_hash !== authorization.keyIdHash) {
      return jsonResponse(403, { ok: false, stage: "auth", message: "Session owner mismatch" });
    }
    await env.DB.prepare("UPDATE sessions SET feedback_emoji = ? WHERE run_id = ?").bind(body.emoji, body.runId).run();
    return jsonResponse(200, { ok: true, runId: body.runId, emoji: body.emoji });
  } catch (error) {
    if (error instanceof CaptureAuthorizationError) {
      return jsonResponse(error.status, {
        ok: false,
        stage: "auth",
        message: error.status === 503 ? "Capture authentication unavailable" : "Unauthorized",
      });
    }
    if (error instanceof IngestError) {
      return jsonResponse(error.status, { ok: false, stage: error.stage, message: error.message });
    }
    console.error("[capture-worker] feedback failed", error);
    return jsonResponse(500, { ok: false, stage: "store", message: "Unable to save feedback" });
  }
}
