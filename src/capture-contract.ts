import type { CaptureSummary, ProblemReport, SessionUpload } from "./capture";
import { serializedBytes } from "./capture";
import { sha256Hex } from "./sha256";

export const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_DECODED_BYTES = 8 * 1024 * 1024;
export const SAFE_ID = /^[A-Za-z0-9._+-]{1,64}$/;
export const SAFE_INSTALL_ID = /^(eph-)?[a-z0-9-]{8,64}$/;
export const SHA256 = /^[a-f0-9]{64}$/;

export type ContractStage = "serialize" | "hash" | "compress" | "size" | "parse";
export type SessionContractResult =
  | { ok: true; session: SessionUpload; installId: string; ephemeral: boolean }
  | { ok: false; stage: ContractStage; message: string };
export type ReportContractResult =
  | { ok: true; report: ProblemReport; installId: string; ephemeral: boolean }
  | { ok: false; stage: ContractStage; message: string };

const SESSION_TRIGGERS = new Set(["gameover", "manual"]);
const REPORT_TRIGGERS = new Set(["manual", "agent"]);
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
const FORBIDDEN_SESSION_KEYS = ["events", "eventsUnparsed", "eventsTruncated", "attachments"] as const;

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

function validateSummary(value: unknown, partial: boolean, nullable: boolean): asserts value is CaptureSummary | null {
  if (value === null) {
    if (!nullable) throw new Error("summary must not be null");
    return;
  }
  if (!record(value)) throw new Error("summary must be an object");
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

function parseBody(decoded: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
}

function validateHeaders(
  value: Record<string, unknown>,
  headers: { build: string; install: string; sha256: string },
): { meta: Record<string, unknown>; installId: string } {
  if (value.captureSchema !== 2) throw new Error("captureSchema must be 2");
  if (!record(value.meta)) throw new Error("meta must be an object");
  const meta = value.meta;
  const buildId = string(meta.buildId, "meta.buildId", 64)!;
  if (!SAFE_ID.test(buildId)) throw new Error("buildId must use safe path characters");
  const installId = string(meta.installId, "meta.installId", 64)!;
  if (!SAFE_INSTALL_ID.test(installId)) throw new Error("installId has an invalid format");
  if (headers.build !== buildId || headers.install !== installId) {
    throw new Error("capture metadata does not match request headers");
  }
  return { meta, installId };
}

function validateRequestHash(headers: { sha256: string }, actualSha256: string): void {
  if (!SHA256.test(headers.sha256) || headers.sha256 !== actualSha256) {
    throw Object.assign(new Error("x-dmc-sha256 does not match the decoded body"), { stage: "hash" });
  }
}

function validateCommonMeta(meta: Record<string, unknown>, triggers: Set<string>): boolean {
  string(meta.displayName, "meta.displayName", 64, true);
  string(meta.bootId, "meta.bootId", 128);
  number(meta.capturedAt, "meta.capturedAt", { integer: true });
  enumeration(meta.trigger, "meta.trigger", triggers);
  string(meta.note, "meta.note", 2_000, true);
  enumeration(meta.appScreen, "meta.appScreen", SCREENS);
  enumeration(meta.replaySource, "meta.replaySource", REPLAY_SOURCES);
  const partial = boolean(meta.partial, "meta.partial");
  nullableNumber(meta.capturedThroughTick, "meta.capturedThroughTick");
  boolean(meta.replayComplete, "meta.replayComplete");
  string(meta.platform, "meta.platform", 128);
  enumeration(meta.inputClass, "meta.inputClass", INPUT_CLASSES);
  return partial;
}

function validateEnvironment(value: unknown, name: string): void {
  if (!record(value)) throw new Error(`${name} must be an object`);
  string(value.platform, `${name}.platform`, 128);
  boolean(value.native, `${name}.native`);
  string(value.ua, `${name}.ua`, 2_000);
  number(value.dpr, `${name}.dpr`);
  number(value.screenW, `${name}.screenW`);
  number(value.screenH, `${name}.screenH`);
  if (value.deviceModel !== undefined) string(value.deviceModel, `${name}.deviceModel`, 256);
}

async function validateReplay(value: Record<string, unknown>, meta: Record<string, unknown>): Promise<void> {
  const replay = value.replay;
  const claimed = meta.replaySha256;
  const omitted = value.replayOmitted;
  if (omitted !== undefined) {
    if (!record(omitted) || !["size", "unavailable"].includes(String(omitted.reason))) {
      throw new Error("replayOmitted has an invalid reason");
    }
    if (omitted.checkpointsDropped !== undefined) {
      boolean(omitted.checkpointsDropped, "replayOmitted.checkpointsDropped");
    }
  }
  if (replay === null) {
    if (omitted === undefined) throw new Error("replayOmitted is required without a replay");
    if (claimed !== null)
      throw Object.assign(new Error("meta.replaySha256 must be null without a replay"), { stage: "hash" });
    if (meta.replayComplete !== false) throw new Error("meta.replayComplete must be false without a replay");
    return;
  }
  if (record(omitted) && omitted.reason === "unavailable") {
    throw new Error("replayOmitted.unavailable cannot accompany a replay");
  }
  serializable(replay, "replay");
  if (typeof claimed !== "string" || !SHA256.test(claimed)) {
    throw Object.assign(new Error("meta.replaySha256 must be a lowercase SHA-256"), { stage: "hash" });
  }
  const actual = await sha256Hex(serializedBytes(replay));
  if (actual !== claimed)
    throw Object.assign(new Error("meta.replaySha256 does not match replay bytes"), { stage: "hash" });
}

function resultFailure(error: unknown): { ok: false; stage: ContractStage; message: string } {
  const stage = (error as { stage?: ContractStage } | null)?.stage ?? "parse";
  return { ok: false, stage, message: error instanceof Error ? error.message : String(error) };
}

export async function validateSessionBody(
  decoded: Uint8Array,
  headers: { build: string; install: string; sha256: string },
  actualSha256: string,
): Promise<SessionContractResult> {
  try {
    validateRequestHash(headers, actualSha256);
    const parsed = parseBody(decoded);
    if (!record(parsed)) throw new Error("session body must be an object");
    const { meta, installId } = validateHeaders(parsed, headers);
    if (parsed.kind !== "session") throw new Error("kind must be session");
    for (const key of FORBIDDEN_SESSION_KEYS) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) throw new Error(`${key} is forbidden on a session`);
    }
    if (Object.prototype.hasOwnProperty.call(meta, "env")) throw new Error("meta.env is forbidden on a session");
    const partial = validateCommonMeta(meta, SESSION_TRIGGERS);
    if (partial) throw new Error("session meta.partial must be false");
    const runId = string(meta.runId, "meta.runId", 64)!;
    if (!SAFE_ID.test(runId)) throw new Error("runId must use safe path characters");
    validateSummary(parsed.summary, false, false);
    if (record(parsed.replay)) {
      if (Object.prototype.hasOwnProperty.call(parsed.replay, "_env")) {
        throw new Error("replay._env is forbidden on a session");
      }
      for (const key of FORBIDDEN_SESSION_KEYS) {
        if (Object.prototype.hasOwnProperty.call(parsed.replay, key)) {
          throw new Error(`replay.${key} is forbidden on a session`);
        }
      }
    }
    await validateReplay(parsed, meta);
    return {
      ok: true,
      session: parsed as unknown as SessionUpload,
      installId,
      ephemeral: installId.startsWith("eph-"),
    };
  } catch (error) {
    return resultFailure(error);
  }
}

export async function validateReportBody(
  decoded: Uint8Array,
  headers: { build: string; install: string; sha256: string },
  actualSha256: string,
): Promise<ReportContractResult> {
  try {
    validateRequestHash(headers, actualSha256);
    const parsed = parseBody(decoded);
    if (!record(parsed)) throw new Error("report body must be an object");
    const { meta, installId } = validateHeaders(parsed, headers);
    if (parsed.kind !== "report") throw new Error("kind must be report");
    const reportId = string(parsed.reportId, "reportId", 64)!;
    if (!SAFE_ID.test(reportId)) throw new Error("reportId must use safe path characters");
    const partial = validateCommonMeta(meta, REPORT_TRIGGERS);
    const runId = string(meta.runId, "meta.runId", 64, true);
    if (runId !== null && !SAFE_ID.test(runId)) throw new Error("runId must use safe path characters");
    validateEnvironment(meta.env, "meta.env");
    if (meta.replayEnv !== undefined) validateEnvironment(meta.replayEnv, "meta.replayEnv");
    validateSummary(parsed.summary, partial, true);
    if (record(parsed.replay) && Object.prototype.hasOwnProperty.call(parsed.replay, "_env")) {
      throw new Error("replay._env must be hoisted to meta.replayEnv on a report");
    }
    await validateReplay(parsed, meta);
    if (!Array.isArray(parsed.events)) throw new Error("events must be an array");
    serializable(parsed.events, "events");
    number(parsed.eventsUnparsed, "eventsUnparsed", { integer: true });
    boolean(parsed.eventsTruncated, "eventsTruncated");
    if (!Array.isArray(parsed.attachments) || parsed.attachments.length !== 0) {
      throw new Error("attachments must be an empty array until attachment capture ships");
    }
    return {
      ok: true,
      report: parsed as unknown as ProblemReport,
      installId,
      ephemeral: installId.startsWith("eph-"),
    };
  } catch (error) {
    return resultFailure(error);
  }
}
