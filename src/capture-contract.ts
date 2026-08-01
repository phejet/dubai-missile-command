import type { CaptureEnvelope, CaptureSummary } from "./capture";

export const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;
export const SAFE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
export const SAFE_INSTALL_ID = /^(eph-)?[a-z0-9-]{8,64}$/;

export type ContractStage = "serialize" | "hash" | "compress" | "size" | "parse";
export type ContractResult =
  | { ok: true; capture: CaptureEnvelope; installId: string; ephemeral: boolean }
  | { ok: false; stage: ContractStage; message: string };

const SHA256 = /^[a-f0-9]{64}$/;
const TRIGGERS = new Set(["gameover", "manual", "agent"]);
const SCREENS = new Set(["title", "playing", "shop", "gameover"]);
const REPLAY_SOURCES = new Set(["live", "last-completed", "playback", "none"]);
const INPUT_CLASSES = new Set(["touch", "mouse", "unknown"]);
const OUTCOMES = new Set(["burj_destroyed", "survived", "abandoned", "in_progress"]);
const DESTROYED_TYPES = [
  "ballisticMissile",
  "mirv",
  "mirvWarhead",
  "stackedMissile",
  "bomb",
  "shahed136",
  "shahed238",
  "other",
] as const;

function fail(message: string): ContractResult {
  return { ok: false, stage: "parse", message };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, name: string, max = 256, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${name} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function number(value: unknown, name: string, options: { integer?: boolean; max?: number } = {}): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  if (options.integer && !Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  if (options.max !== undefined && value > options.max) throw new Error(`${name} exceeds ${options.max}`);
  return value;
}

function nullableNumber(value: unknown, name: string): number | null {
  return value === null ? null : number(value, name, { integer: true });
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function enumeration(value: unknown, name: string, values: Set<string>): string {
  if (typeof value !== "string" || !values.has(value)) throw new Error(`${name} has an unknown value`);
  return value;
}

function serializable(value: unknown, name: string): void {
  try {
    if (JSON.stringify(value) === undefined) throw new Error();
  } catch {
    throw new Error(`${name} must be JSON serializable`);
  }
}

function validateSummary(value: unknown, partial: boolean): asserts value is CaptureSummary | null {
  if (value === null) return;
  if (!record(value)) throw new Error("summary must be an object or null");
  const outcome = enumeration(value.outcome, "summary.outcome", OUTCOMES);
  if (partial ? outcome !== "in_progress" : outcome === "in_progress") {
    throw new Error("summary.outcome does not agree with meta.partial");
  }
  if (value.deathCause !== null && value.deathCause !== "burj_destroyed") {
    throw new Error("summary.deathCause has an unknown value");
  }
  number(value.waveReached, "summary.waveReached", { integer: true });
  number(value.score, "summary.score", { integer: true });
  number(value.timePlayedMs, "summary.timePlayedMs", { integer: true });
  number(value.burjHealth, "summary.burjHealth");
  number(value.shotsFired, "summary.shotsFired", { integer: true });
  number(value.totalKills, "summary.totalKills", { integer: true });
  number(value.hitRatio, "summary.hitRatio", { max: 1 });
  number(value.multiShots, "summary.multiShots", { integer: true });
  number(value.maxCombo, "summary.maxCombo", { integer: true });
  if (!record(value.destroyedByType)) throw new Error("summary.destroyedByType must be an object");
  for (const key of DESTROYED_TYPES) {
    number(value.destroyedByType[key], `summary.destroyedByType.${key}`, { integer: true });
  }
  if (!Array.isArray(value.upgrades)) throw new Error("summary.upgrades must be an array");
  serializable(value.upgrades, "summary.upgrades");
}

function parseCapture(decoded: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
}

/** Validates every field projected into D1. Hashing and body decoding remain adapter concerns. */
export function validateCaptureBody(
  decoded: Uint8Array,
  headers: { build: string; install: string; sha256: string },
  actualSha256: string,
): ContractResult {
  if (!SHA256.test(headers.sha256) || headers.sha256 !== actualSha256) {
    return { ok: false, stage: "hash", message: "x-dmc-sha256 does not match the decoded body" };
  }

  let value: unknown;
  try {
    value = parseCapture(decoded);
  } catch (error) {
    return { ok: false, stage: "parse", message: error instanceof Error ? error.message : String(error) };
  }

  try {
    if (!record(value) || value.captureSchema !== 1) return fail("captureSchema must be 1");
    const captureId = string(value.captureId, "captureId", 64)!;
    if (!SAFE_ID.test(captureId)) return fail("captureId must use safe path characters");
    if (!record(value.meta)) return fail("meta must be an object");
    const meta = value.meta;
    const buildId = string(meta.buildId, "meta.buildId", 64)!;
    if (!SAFE_ID.test(buildId)) return fail("buildId must use safe path characters");
    const installId = string(meta.installId, "meta.installId", 64)!;
    if (!SAFE_INSTALL_ID.test(installId)) return fail("installId has an invalid format");
    string(meta.displayName, "meta.displayName", 64, true);
    string(meta.bootId, "meta.bootId", 128);
    string(meta.runId, "meta.runId", 128, true);
    number(meta.capturedAt, "meta.capturedAt", { integer: true });
    enumeration(meta.trigger, "meta.trigger", TRIGGERS);
    string(meta.note, "meta.note", 2_000, true);
    enumeration(meta.appScreen, "meta.appScreen", SCREENS);
    enumeration(meta.replaySource, "meta.replaySource", REPLAY_SOURCES);
    const partial = boolean(meta.partial, "meta.partial");
    nullableNumber(meta.capturedThroughTick, "meta.capturedThroughTick");
    const replaySha = meta.replaySha256;
    if (replaySha !== null && (typeof replaySha !== "string" || !SHA256.test(replaySha))) {
      throw new Error("meta.replaySha256 must be a lowercase SHA-256 or null");
    }
    boolean(meta.replayComplete, "meta.replayComplete");
    string(meta.platform, "meta.platform", 128);
    enumeration(meta.inputClass, "meta.inputClass", INPUT_CLASSES);

    validateSummary(value.summary, partial);
    if (value.replay !== null) serializable(value.replay, "replay");
    if (!Array.isArray(value.events)) throw new Error("events must be an array");
    number(value.eventsUnparsed, "eventsUnparsed", { integer: true });
    boolean(value.eventsTruncated, "eventsTruncated");
    if (!Array.isArray(value.attachments)) throw new Error("attachments must be an array");
    if (value.replayOmitted !== undefined) {
      if (!record(value.replayOmitted) || !["size", "unavailable"].includes(String(value.replayOmitted.reason))) {
        throw new Error("replayOmitted has an invalid reason");
      }
    }
    if (headers.build !== buildId || headers.install !== installId) {
      throw new Error("capture metadata does not match request headers");
    }

    return {
      ok: true,
      capture: value as unknown as CaptureEnvelope,
      installId,
      ephemeral: installId.startsWith("eph-"),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
