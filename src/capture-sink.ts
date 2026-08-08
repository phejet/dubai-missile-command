import type { ProblemReport, SessionUpload } from "./capture";
import { withAuthenticatedCaptureUpload, type CaptureAuthDeps, type AuthenticatedUploadInput } from "./capture-auth";
import { detectCaptureRuntime, getCaptureExecution } from "./capture-execution";
import {
  decideCapturePolicy,
  type CaptureChannel,
  type CaptureExecutionKind,
  type CaptureRuntimeKind,
  type RemoteCaptureConsent,
} from "./capture-policy";
import { sha256Hex } from "./sha256";

export type UploadCaptureResult =
  | { ok: true; id: string; encoding: "gzip" | "none"; file?: string }
  | { ok: false; reason: string; error?: unknown; status?: number };

export interface UploadCaptureDeps {
  endpoint?: string | null;
  remoteEndpoint?: string | null;
  channel?: CaptureChannel;
  runtime?: CaptureRuntimeKind;
  execution?: CaptureExecutionKind;
  remoteConsent?: RemoteCaptureConsent;
  compress?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  fetch?: typeof fetch;
  auth?: CaptureAuthDeps;
  authenticatedUpload?: typeof withAuthenticatedCaptureUpload;
}

async function compressGzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function requestBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function upload(
  body: SessionUpload | ProblemReport,
  route: "/api/session" | "/api/report",
  id: string,
  deps: UploadCaptureDeps,
): Promise<UploadCaptureResult> {
  const channel =
    deps.channel ?? (typeof __DMC_CAPTURE_CHANNEL__ === "undefined" ? ("off" as const) : __DMC_CAPTURE_CHANNEL__);
  const policy = decideCapturePolicy({
    channel,
    runtime: deps.runtime ?? detectCaptureRuntime(),
    execution: deps.execution ?? getCaptureExecution(),
    remoteConsent: deps.remoteConsent ?? "unknown",
  });
  if (!policy.allowed) return { ok: false, reason: `policy:${policy.reason}` };
  const configured =
    policy.destination === "remote"
      ? deps.remoteEndpoint === undefined
        ? typeof __DMC_CAPTURE_BASE_URL__ === "undefined"
          ? ""
          : __DMC_CAPTURE_BASE_URL__
        : deps.remoteEndpoint
      : deps.endpoint === undefined
        ? "/"
        : deps.endpoint;
  if (!configured) return { ok: false, reason: "no-endpoint" };

  try {
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const sha256 = await (deps.digest ?? sha256Hex)(raw);
    if (!sha256) return { ok: false, reason: "hash-unavailable" };
    const compressed = await (deps.compress ?? compressGzip)(raw);
    const payload = compressed ?? raw;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-dmc-build": body.meta.buildId,
      "x-dmc-install": body.meta.installId ?? "",
      "x-dmc-sha256": sha256,
    };
    if (compressed) headers["Content-Encoding"] = "gzip";

    const endpoint = new URL(configured, globalThis.location?.href ?? "http://localhost");
    const basePath = endpoint.pathname.replace(/\/api\/(?:session|report)\/?$/, "").replace(/\/$/, "");
    endpoint.pathname = `${basePath}${route}`;
    const send = (authorizationHeaders: Record<string, string> = {}) =>
      (deps.fetch ?? fetch)(endpoint, {
        method: "POST",
        headers: { ...headers, ...authorizationHeaders },
        body: requestBody(payload),
      });
    const response =
      policy.destination === "remote"
        ? await (deps.authenticatedUpload ?? withAuthenticatedCaptureUpload)(
            {
              endpoint: configured,
              channel: policy.environment,
              purpose: route === "/api/session" ? "session" : "report",
              buildId: body.meta.buildId,
              decodedBodySha256: sha256,
            } satisfies AuthenticatedUploadInput,
            send,
            deps.auth,
          )
        : await send();
    if (!response.ok) return { ok: false, reason: "http", status: response.status };
    const result = (await response.json()) as { id?: string; encoding?: "gzip" | "none"; file?: string };
    return {
      ok: true,
      id: result.id ?? id,
      encoding: result.encoding ?? (compressed ? "gzip" : "none"),
      ...(result.file ? { file: result.file } : {}),
    };
  } catch (error) {
    return { ok: false, reason: "network", error };
  }
}

export function uploadSession(session: SessionUpload, deps: UploadCaptureDeps = {}): Promise<UploadCaptureResult> {
  return upload(session, "/api/session", session.meta.runId, deps);
}

export function reportProblem(report: ProblemReport, deps: UploadCaptureDeps = {}): Promise<UploadCaptureResult> {
  return upload(report, "/api/report", report.reportId, deps);
}
