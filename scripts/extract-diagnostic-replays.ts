import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { CURRENT_REPLAY_VERSION } from "../src/replay-version";

type JsonRecord = Record<string, unknown>;
type ArchiveStatus = "playable" | "unverified" | "unsupported-version" | "incomplete" | "corrupt" | "invalid";

export interface ExtractedArchiveReport {
  archiveId: string;
  status: ArchiveStatus;
  message?: string;
  outputFile?: string;
  replayVersion?: number;
}

export interface ExtractionReport {
  inputs: string[];
  malformedLines: number;
  duplicateEnvelopeRecords: number;
  playableCount: number;
  archives: ExtractedArchiveReport[];
}

interface ArchiveGroup {
  manifests: JsonRecord[];
  parts: JsonRecord[];
  completions: JsonRecord[];
}

function failure(archiveId: string, status: ArchiveStatus, message: string): ExtractedArchiveReport {
  return { archiveId, status, message };
}

function decodePart(data: unknown): Buffer | null {
  if (typeof data !== "string" || data.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return null;
  const decoded = Buffer.from(data, "base64");
  return decoded.toString("base64") === data ? decoded : null;
}

async function recoverArchive(archiveId: string, group: ArchiveGroup, outDir: string): Promise<ExtractedArchiveReport> {
  if (!/^[a-z0-9-]{1,64}$/.test(archiveId)) return failure(archiveId, "invalid", "archiveId is unsafe");
  if (group.manifests.length !== 1)
    return failure(archiveId, "incomplete", `expected one manifest, found ${group.manifests.length}`);
  if (group.completions.length !== 1)
    return failure(archiveId, "incomplete", `expected one completion, found ${group.completions.length}`);
  const manifest = group.manifests[0];
  const completion = group.completions[0];
  if (manifest.encoding !== "base64") return failure(archiveId, "invalid", "unsupported payload encoding");
  const partCount = manifest.partCount;
  if (!Number.isSafeInteger(partCount) || Number(partCount) < 1 || completion.partCount !== partCount) {
    return failure(archiveId, "invalid", "manifest/completion partCount mismatch");
  }

  const byIndex = new Map<number, JsonRecord>();
  for (const part of group.parts) {
    const index = part.index;
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= Number(partCount)) {
      return failure(archiveId, "invalid", "part index is out of range");
    }
    if (byIndex.has(Number(index))) return failure(archiveId, "incomplete", `duplicate part ${index}`);
    byIndex.set(Number(index), part);
  }
  if (byIndex.size !== partCount)
    return failure(archiveId, "incomplete", `expected ${partCount} parts, found ${byIndex.size}`);

  const decoded: Buffer[] = [];
  for (let index = 0; index < Number(partCount); index += 1) {
    const bytes = decodePart(byIndex.get(index)?.data);
    if (!bytes) return failure(archiveId, "corrupt", `part ${index} is not canonical base64`);
    decoded.push(bytes);
  }
  const compressed = Buffer.concat(decoded);
  if (compressed.byteLength !== manifest.compressedBytes) {
    return failure(archiveId, "corrupt", "compressed byte count does not match manifest");
  }

  let raw: Buffer;
  try {
    if (manifest.compression === "gzip") raw = gunzipSync(compressed);
    else if (manifest.compression === "none") raw = compressed;
    else return failure(archiveId, "invalid", `unsupported compression ${String(manifest.compression)}`);
  } catch (error) {
    return failure(
      archiveId,
      "corrupt",
      `decompression failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (raw.byteLength !== manifest.rawBytes)
    return failure(archiveId, "corrupt", "raw byte count does not match manifest");

  const verified = manifest.integrity === "sha256";
  if (verified) {
    if (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
      return failure(archiveId, "invalid", "manifest sha256 is invalid");
    }
    const actual = createHash("sha256").update(raw).digest("hex");
    if (actual !== manifest.sha256) return failure(archiveId, "corrupt", "sha256 mismatch");
    if (archiveId !== actual.slice(0, 16)) return failure(archiveId, "corrupt", "archiveId does not match sha256");
  } else if (manifest.integrity !== "none" || manifest.sha256 !== null) {
    return failure(archiveId, "invalid", "integrity metadata is invalid");
  }

  let replay: JsonRecord;
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload is not an object");
    replay = parsed as JsonRecord;
  } catch (error) {
    return failure(
      archiveId,
      "invalid",
      `replay JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof replay.version !== "number" || !Number.isFinite(replay.version))
    return failure(archiveId, "invalid", "replay version is invalid");
  if (manifest.replayVersion !== replay.version)
    return failure(archiveId, "corrupt", "manifest replayVersion does not match payload");
  if (typeof replay.seed !== "number" || !Number.isFinite(replay.seed))
    return failure(archiveId, "invalid", "replay seed is invalid");
  if (!Array.isArray(replay.actions)) return failure(archiveId, "invalid", "replay actions are invalid");
  if (replay.version === CURRENT_REPLAY_VERSION && (!replay.initialState || typeof replay.initialState !== "object")) {
    return failure(archiveId, "invalid", "current replay is missing initialState");
  }

  const status: ArchiveStatus =
    replay.version !== CURRENT_REPLAY_VERSION ? "unsupported-version" : verified ? "playable" : "unverified";
  const build = safeFilenameSegment(manifest.build, "unknown-build");
  const wave = typeof replay.wave === "number" && Number.isFinite(replay.wave) ? Math.floor(replay.wave) : "unknown";
  const score =
    typeof replay.score === "number" && Number.isFinite(replay.score) ? Math.floor(replay.score) : "unknown";
  const outputFile = `${build}-w${wave}-s${score}-${archiveId}.json`;
  await writeFile(join(outDir, outputFile), `${JSON.stringify(replay, null, 2)}\n`, "utf8");
  return { archiveId, status, outputFile, replayVersion: replay.version };
}

export async function extractDiagnosticReplays(inputPaths: string[], outDir: string): Promise<ExtractionReport> {
  await mkdir(outDir, { recursive: true });
  const groups = new Map<string, ArchiveGroup>();
  const seenEnvelopes = new Set<string>();
  let malformedLines = 0;
  let duplicateEnvelopeRecords = 0;

  for (const inputPath of inputPaths) {
    const content = await readFile(inputPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let record: JsonRecord;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        record = parsed as JsonRecord;
      } catch {
        malformedLines += 1;
        continue;
      }
      if (typeof record.boot === "string" && Number.isSafeInteger(record.seq)) {
        const key = `${record.boot}:${record.seq}`;
        if (seenEnvelopes.has(key)) {
          duplicateEnvelopeRecords += 1;
          continue;
        }
        seenEnvelopes.add(key);
      }
      if (record.channel !== "replay-archive" || typeof record.archiveId !== "string") continue;
      const group = groups.get(record.archiveId) ?? { manifests: [], parts: [], completions: [] };
      groups.set(record.archiveId, group);
      if (record.event === "manifest") group.manifests.push(record);
      else if (record.event === "part") group.parts.push(record);
      else if (record.event === "complete") group.completions.push(record);
    }
  }

  const archives: ExtractedArchiveReport[] = [];
  for (const [archiveId, group] of groups) archives.push(await recoverArchive(archiveId, group, outDir));
  archives.sort((a, b) => a.archiveId.localeCompare(b.archiveId));
  const report: ExtractionReport = {
    inputs: inputPaths.map((path) => basename(path)),
    malformedLines,
    duplicateEnvelopeRecords,
    playableCount: archives.filter((archive) => archive.status === "playable" || archive.status === "unverified")
      .length,
    archives,
  };
  await writeFile(join(outDir, "extraction-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function safeFilenameSegment(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const safe = value
    .trim()
    .replace(/[^a-zA-Z0-9._+-]+/g, "_")
    .slice(0, 80);
  return safe || fallback;
}

function parseArgs(args: string[]): { inputs: string[]; outDir: string } {
  const inputs: string[] = [];
  let outDir = "recovered-replays";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out") {
      if (!args[index + 1]) throw new Error("--out requires a directory");
      outDir = args[++index];
    } else inputs.push(args[index]);
  }
  if (inputs.length === 0)
    throw new Error("usage: npm run diag:extract -- <diagnostics.jsonl> [more.jsonl] [--out DIR]");
  return { inputs, outDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { inputs, outDir } = parseArgs(process.argv.slice(2));
    const report = await extractDiagnosticReplays(inputs, outDir);
    console.log(`Recovered ${report.playableCount} playable replay(s) into ${outDir}`);
    if (
      report.archives.some((archive) => !["playable", "unverified", "unsupported-version"].includes(archive.status))
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
