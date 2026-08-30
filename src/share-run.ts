import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
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

const SHARE_ID = /^[a-f0-9]{16}$/;
type RemoteChannel = "staging" | "production";

export type CreateRunShareResult =
  | { ok: true; shareId: string; shareUrl: string }
  | { ok: false; reason: string; status?: number; error?: unknown };

export interface CreateRunShareDeps {
  runtime?: CaptureRuntimeKind;
  execution?: CaptureExecutionKind;
  remoteConsent?: "unknown" | "denied" | "granted";
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  fetch?: typeof fetch;
  auth?: CaptureAuthDeps;
  authenticatedUpload?: typeof withAuthenticatedCaptureUpload;
}

function endpointUrl(base: string, path: string): URL {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url;
}

function isExpectedShareUrl(value: string, endpoint: string, shareId: string): boolean {
  try {
    const actual = new URL(value);
    const base = new URL(endpoint);
    return (
      actual.protocol === "https:" &&
      actual.origin === base.origin &&
      actual.pathname === `/r/${shareId}` &&
      !actual.username &&
      !actual.password &&
      !actual.search &&
      !actual.hash
    );
  } catch {
    return false;
  }
}

export async function createRunShareLink(
  input: { endpoint: string; channel: RemoteChannel; buildId: string; runId: string },
  deps: CreateRunShareDeps = {},
): Promise<CreateRunShareResult> {
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
    const bytes = new TextEncoder().encode(JSON.stringify({ runId: input.runId, buildId: input.buildId }));
    const sha256 = await (deps.digest ?? sha256Hex)(bytes);
    if (!sha256) return { ok: false, reason: "hash-unavailable" };
    const send = (authorizationHeaders: Record<string, string>, signal?: AbortSignal) =>
      (deps.fetch ?? fetch)(endpointUrl(input.endpoint, "/api/share"), {
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
        purpose: "share",
        buildId: input.buildId,
        decodedBodySha256: sha256,
      },
      send,
      deps.auth,
    );
    if (!response.ok) {
      return {
        ok: false,
        reason: [401, 403].includes(response.status) ? "auth" : "http",
        status: response.status,
      };
    }
    const result = (await response.json()) as { shareId?: unknown; shareUrl?: unknown };
    if (
      typeof result.shareId !== "string" ||
      !SHARE_ID.test(result.shareId) ||
      typeof result.shareUrl !== "string" ||
      !isExpectedShareUrl(result.shareUrl, input.endpoint, result.shareId)
    ) {
      return { ok: false, reason: "invalid-response" };
    }
    return { ok: true, shareId: result.shareId, shareUrl: result.shareUrl };
  } catch (error) {
    if (error instanceof CaptureAuthTimeoutError) return { ok: false, reason: "timeout", error };
    if (error instanceof CaptureAuthError) {
      return { ok: false, reason: "auth", status: error.status, error };
    }
    return { ok: false, reason: "network", error };
  }
}

export async function presentRunShareSheet(shareUrl: string, summary: { score: number; wave: number }): Promise<void> {
  const text = `Wave ${summary.wave} · Score ${summary.score.toLocaleString()} — can you beat it?`;
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title: "Dubai Missile Command run", text, url: shareUrl, dialogTitle: "Share run" });
    return;
  }
  if (navigator.share) {
    await navigator.share({ title: "Dubai Missile Command run", text, url: shareUrl });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(shareUrl);
    return;
  }
  throw new Error("Sharing is unavailable in this browser");
}
