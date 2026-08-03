import type { ProblemReport, SessionUpload } from "./capture";
import { sha256Hex } from "./sha256";

export type UploadCaptureResult =
  | { ok: true; id: string; encoding: "gzip" | "none"; file?: string }
  | { ok: false; reason: string; error?: unknown; status?: number };

export interface UploadCaptureDeps {
  endpoint?: string | null;
  compress?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  fetch?: typeof fetch;
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
  const configured =
    deps.endpoint === undefined
      ? typeof __DMC_CAPTURE_ENDPOINT__ !== "undefined"
        ? __DMC_CAPTURE_ENDPOINT__
        : null
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
    const response = await (deps.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers,
      body: requestBody(payload),
    });
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
