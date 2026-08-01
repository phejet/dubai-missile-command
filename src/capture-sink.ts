import type { CaptureEnvelope } from "./capture";
import { sha256Hex } from "./sha256";

export type UploadCaptureResult =
  | { ok: true; captureId: string; encoding: "gzip" | "none"; file?: string }
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

/** The capture transport is fail-closed and never throws into gameplay. */
export async function uploadCapture(
  envelope: CaptureEnvelope,
  deps: UploadCaptureDeps = {},
): Promise<UploadCaptureResult> {
  const endpoint =
    deps.endpoint === undefined
      ? typeof __DMC_CAPTURE_ENDPOINT__ !== "undefined"
        ? __DMC_CAPTURE_ENDPOINT__
        : null
      : deps.endpoint;
  if (!endpoint) return { ok: false, reason: "no-endpoint" };

  try {
    const raw = new TextEncoder().encode(JSON.stringify(envelope));
    const sha256 = await (deps.digest ?? sha256Hex)(raw);
    if (!sha256) return { ok: false, reason: "hash-unavailable" };
    const compressed = await (deps.compress ?? compressGzip)(raw);
    const payload = compressed ?? raw;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-dmc-build": envelope.meta.buildId,
      "x-dmc-install": envelope.meta.installId ?? "",
      "x-dmc-sha256": sha256,
    };
    if (compressed) headers["Content-Encoding"] = "gzip";

    const response = await (deps.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers,
      body: requestBody(payload),
    });
    if (!response.ok) return { ok: false, reason: "http", status: response.status };
    const result = (await response.json()) as { captureId?: string; encoding?: "gzip" | "none"; file?: string };
    return {
      ok: true,
      captureId: result.captureId ?? envelope.captureId,
      encoding: result.encoding ?? (compressed ? "gzip" : "none"),
      ...(result.file ? { file: result.file } : {}),
    };
  } catch (error) {
    return { ok: false, reason: "network", error };
  }
}
