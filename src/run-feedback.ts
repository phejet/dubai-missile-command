import { RUN_FEEDBACK_EMOJIS, type RunFeedbackEmoji } from "./capture";
import {
  CaptureAuthError,
  CaptureAuthTimeoutError,
  withAuthenticatedCaptureUpload,
  type CaptureAuthDeps,
} from "./capture-auth";
import { getRemoteCaptureConsent } from "./capture-consent";
import { detectCaptureExecution, detectCaptureRuntime } from "./capture-execution";
import { decideCapturePolicy, type CaptureExecutionKind, type CaptureRuntimeKind } from "./capture-policy";
import { sha256Hex } from "./sha256";

type RemoteChannel = "staging" | "production";

export type SubmitRunFeedbackResult =
  | { ok: true; emoji: RunFeedbackEmoji }
  | { ok: false; reason: string; status?: number; error?: unknown };

export interface SubmitRunFeedbackDeps {
  runtime?: CaptureRuntimeKind;
  execution?: CaptureExecutionKind;
  remoteConsent?: "unknown" | "denied" | "granted";
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  fetch?: typeof fetch;
  auth?: CaptureAuthDeps;
  authenticatedUpload?: typeof withAuthenticatedCaptureUpload;
}

function endpointUrl(base: string): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/feedback`;
  url.search = "";
  url.hash = "";
  return url;
}

export async function submitRunFeedback(
  input: { endpoint: string; channel: RemoteChannel; buildId: string; runId: string; emoji: RunFeedbackEmoji },
  deps: SubmitRunFeedbackDeps = {},
): Promise<SubmitRunFeedbackResult> {
  if (!RUN_FEEDBACK_EMOJIS.includes(input.emoji)) return { ok: false, reason: "invalid-emoji" };
  const policy = decideCapturePolicy({
    channel: input.channel,
    runtime: deps.runtime ?? detectCaptureRuntime(),
    execution: deps.execution ?? detectCaptureExecution("last-completed"),
    remoteConsent: deps.remoteConsent ?? getRemoteCaptureConsent(input.channel),
  });
  if (!policy.allowed || policy.destination !== "remote") {
    return { ok: false, reason: `policy:${policy.allowed ? "not-remote" : policy.reason}` };
  }
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ runId: input.runId, buildId: input.buildId, emoji: input.emoji }),
    );
    const sha256 = await (deps.digest ?? sha256Hex)(bytes);
    if (!sha256) return { ok: false, reason: "hash-unavailable" };
    const send = (authorizationHeaders: Record<string, string>, signal?: AbortSignal) =>
      (deps.fetch ?? fetch)(endpointUrl(input.endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dmc-build": input.buildId,
          "x-dmc-sha256": sha256,
          ...authorizationHeaders,
        },
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        signal,
      });
    const response = await (deps.authenticatedUpload ?? withAuthenticatedCaptureUpload)(
      {
        endpoint: input.endpoint,
        channel: input.channel,
        purpose: "feedback",
        buildId: input.buildId,
        decodedBodySha256: sha256,
      },
      send,
      deps.auth,
    );
    if (!response.ok) {
      return { ok: false, reason: [401, 403].includes(response.status) ? "auth" : "http", status: response.status };
    }
    return { ok: true, emoji: input.emoji };
  } catch (error) {
    if (error instanceof CaptureAuthTimeoutError) return { ok: false, reason: "timeout", error };
    if (error instanceof CaptureAuthError) return { ok: false, reason: "auth", status: error.status, error };
    return { ok: false, reason: "network", error };
  }
}
