import type { ReplayData } from "./types";

export interface ArchiveRecord {
  channel: "replay-archive";
  event: "manifest" | "part" | "complete";
  [key: string]: unknown;
}

export interface ArchiveDeps {
  compress?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  digest?: (bytes: Uint8Array) => Promise<string | null>;
  /** Base64 characters per part. Must be a positive multiple of four. */
  partChars?: number;
}

export type BuildArchiveResult =
  | {
      ok: true;
      archiveId: string;
      records: ArchiveRecord[];
      rawBytes: number;
      compressedBytes: number;
    }
  | { ok: false; stage: string; error: unknown };

const DEFAULT_PART_CHARS = 32_768;
const BASE64_INPUT_BLOCK_BYTES = 24_576;

async function compressGzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function digestSha256(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_INPUT_BLOCK_BYTES) {
    const block = bytes.subarray(offset, Math.min(bytes.length, offset + BASE64_INPUT_BLOCK_BYTES));
    let binary = "";
    for (let i = 0; i < block.length; i += 1) binary += String.fromCharCode(block[i]);
    encoded += btoa(binary);
  }
  return encoded;
}

export async function buildReplayArchiveRecords(
  replay: ReplayData,
  meta: { build: string; fallbackArchiveId: string },
  deps: ArchiveDeps = {},
): Promise<BuildArchiveResult> {
  const partChars = deps.partChars ?? DEFAULT_PART_CHARS;
  if (!Number.isSafeInteger(partChars) || partChars <= 0 || partChars % 4 !== 0) {
    return { ok: false, stage: "config", error: new Error("partChars must be a positive multiple of four") };
  }

  let raw: Uint8Array;
  try {
    raw = new TextEncoder().encode(JSON.stringify(replay));
  } catch (error) {
    return { ok: false, stage: "serialize", error };
  }

  let sha256: string | null;
  try {
    sha256 = await (deps.digest ?? digestSha256)(raw);
  } catch (error) {
    return { ok: false, stage: "hash", error };
  }

  let compressed: Uint8Array | null;
  try {
    compressed = await (deps.compress ?? compressGzip)(raw);
  } catch (error) {
    return { ok: false, stage: "compress", error };
  }

  const payload = compressed ?? raw;
  let base64: string;
  try {
    base64 = encodeBase64(payload);
  } catch (error) {
    return { ok: false, stage: "encode", error };
  }

  const archiveId = sha256?.slice(0, 16) ?? meta.fallbackArchiveId;
  const partCount = Math.max(1, Math.ceil(base64.length / partChars));
  const records: ArchiveRecord[] = [
    {
      channel: "replay-archive",
      event: "manifest",
      archiveId,
      build: meta.build,
      replayVersion: replay.version,
      compression: compressed ? "gzip" : "none",
      encoding: "base64",
      integrity: sha256 ? "sha256" : "none",
      rawBytes: raw.byteLength,
      compressedBytes: payload.byteLength,
      partCount,
      sha256,
    },
  ];
  for (let index = 0; index < partCount; index += 1) {
    records.push({
      channel: "replay-archive",
      event: "part",
      archiveId,
      index,
      data: base64.slice(index * partChars, (index + 1) * partChars),
    });
  }
  records.push({ channel: "replay-archive", event: "complete", archiveId, partCount });
  return { ok: true, archiveId, records, rawBytes: raw.byteLength, compressedBytes: payload.byteLength };
}
