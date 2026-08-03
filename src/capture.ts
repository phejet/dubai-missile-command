import type { ReplayData, ReplayEnvironment, RunRecapData, UpgradeTimelineEntry } from "./types";
import { sha256Hex } from "./sha256";

export const CAPTURE_SCHEMA_VERSION = 2 as const;
export const CAPTURE_MAX_RAW_BYTES = 4 * 1024 * 1024;
export const EVENT_TAIL_MAX_BYTES = 256 * 1024;

export type CaptureTrigger = "gameover" | "manual" | "agent";
export type SessionTrigger = "gameover" | "manual";
export type ReportTrigger = "manual" | "agent";
export type CaptureReplaySource = "live" | "last-completed" | "playback" | "none";
export type CaptureAppScreen = "title" | "playing" | "shop" | "gameover";
export type CaptureInputClass = "touch" | "mouse" | "unknown";
export type CaptureOutcome = "burj_destroyed" | "survived" | "abandoned" | "in_progress";

export interface CaptureSummary {
  outcome: CaptureOutcome;
  deathCause: "burj_destroyed" | null;
  waveReached: number;
  score: number;
  timePlayedMs: number;
  burjHealth: number;
  shotsFired: number;
  totalKills: number;
  hitRatio: number;
  multiShots: number;
  maxCombo: number;
  destroyedByType: RunRecapData["totalStats"]["destroyedByType"];
  upgrades: UpgradeTimelineEntry[];
}

interface CaptureMetaBase {
  buildId: string;
  installId: string | null;
  displayName: string | null;
  bootId: string;
  capturedAt: number;
  note: string | null;
  appScreen: CaptureAppScreen;
  replaySource: CaptureReplaySource;
  capturedThroughTick: number | null;
  replaySha256: string | null;
  replayComplete: boolean;
  platform: string;
  inputClass: CaptureInputClass;
}

export interface SessionMeta extends CaptureMetaBase {
  runId: string;
  trigger: SessionTrigger;
  partial: false;
}

export interface ReportMeta extends CaptureMetaBase {
  runId: string | null;
  trigger: ReportTrigger;
  partial: boolean;
  env: ReplayEnvironment;
  replayEnv?: ReplayEnvironment;
}

export interface ReplayOmitted {
  reason: "size" | "unavailable";
  checkpointsDropped?: boolean;
}

export interface SessionUpload {
  captureSchema: typeof CAPTURE_SCHEMA_VERSION;
  kind: "session";
  meta: SessionMeta;
  summary: CaptureSummary;
  replay: ReplayData | null;
  replayOmitted?: ReplayOmitted;
}

export interface ProblemReport {
  captureSchema: typeof CAPTURE_SCHEMA_VERSION;
  kind: "report";
  reportId: string;
  meta: ReportMeta;
  summary: CaptureSummary | null;
  replay: ReplayData | null;
  replayOmitted?: ReplayOmitted;
  events: Record<string, unknown>[];
  eventsUnparsed: number;
  eventsTruncated: boolean;
  attachments: [];
}

type UnstampedSessionMeta = Omit<SessionMeta, "replaySha256" | "replayComplete">;
type UnstampedReportMeta = Omit<ReportMeta, "replaySha256" | "replayComplete">;

export interface AssembleSessionInput {
  meta: UnstampedSessionMeta;
  summary: CaptureSummary;
  replay: ReplayData | null;
}

export interface AssembleReportInput {
  reportId: string;
  meta: UnstampedReportMeta;
  summary: CaptureSummary | null;
  replay: ReplayData | null;
  events: Record<string, unknown>[];
  eventsUnparsed: number;
  eventsTruncated: boolean;
}

export interface AssembleCaptureOptions {
  maxRawBytes?: number;
  digest?: (bytes: Uint8Array) => Promise<string | null>;
}

const encoder = new TextEncoder();

export function serializedBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function halveEventTail(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const sizes = events.map((event) => serializedBytes(event).byteLength);
  const target = Math.floor(sizes.reduce((sum, size) => sum + size, 0) / 2);
  let start = events.length;
  let bytes = 0;
  while (start > 0) {
    const next = sizes[start - 1];
    if (bytes + next > target) break;
    bytes += next;
    start -= 1;
  }
  return events.slice(start);
}

async function stampReplay(
  envelope: SessionUpload | ProblemReport,
  digest: (bytes: Uint8Array) => Promise<string | null>,
): Promise<void> {
  envelope.meta.replaySha256 = envelope.replay ? await digest(serializedBytes(envelope.replay)) : null;
}

async function fits(
  envelope: SessionUpload | ProblemReport,
  maxRawBytes: number,
  digest: (bytes: Uint8Array) => Promise<string | null>,
): Promise<boolean> {
  await stampReplay(envelope, digest);
  return serializedBytes(envelope).byteLength <= maxRawBytes;
}

function dropCheckpoints(envelope: SessionUpload | ProblemReport): boolean {
  if (!envelope.replay?.checkpoints?.length) return false;
  delete envelope.replay.checkpoints;
  envelope.replayOmitted = { reason: "size", checkpointsDropped: true };
  envelope.meta.replayComplete = false;
  return true;
}

function dropReplay(envelope: SessionUpload | ProblemReport): void {
  if (!envelope.replay) return;
  envelope.replay = null;
  envelope.replayOmitted = {
    reason: "size",
    ...(envelope.replayOmitted?.checkpointsDropped ? { checkpointsDropped: true } : {}),
  };
  envelope.meta.replayComplete = false;
}

export function projectCaptureSummary(recap: RunRecapData, partial: boolean): CaptureSummary {
  const totalKills = recap.totalStats.missileKills + recap.totalStats.droneKills;
  const outcome: CaptureOutcome = partial ? "in_progress" : recap.outcome;
  return {
    outcome,
    deathCause: outcome === "burj_destroyed" ? "burj_destroyed" : null,
    waveReached: recap.wave,
    score: recap.score,
    timePlayedMs: recap.timePlayedMs,
    burjHealth: recap.burjHealth,
    shotsFired: recap.totalStats.shotsFired,
    totalKills,
    hitRatio: recap.hitRatio,
    multiShots: recap.totalStats.multiShots,
    maxCombo: recap.totalStats.maxCombo,
    destroyedByType: structuredClone(recap.totalStats.destroyedByType),
    upgrades: structuredClone(recap.upgrades),
  };
}

/** Pure session assembly apart from CPU-only hashing; diagnostics are unrepresentable here. */
export async function assembleSession(
  input: AssembleSessionInput,
  options: AssembleCaptureOptions = {},
): Promise<SessionUpload> {
  const maxRawBytes = options.maxRawBytes ?? CAPTURE_MAX_RAW_BYTES;
  const digest = options.digest ?? sha256Hex;
  const owned = structuredClone(input);
  const envelope: SessionUpload = {
    captureSchema: CAPTURE_SCHEMA_VERSION,
    kind: "session",
    meta: {
      ...owned.meta,
      replaySha256: null,
      replayComplete: owned.meta.replaySource === "last-completed" && owned.replay !== null,
    },
    summary: owned.summary,
    replay: owned.replay,
    ...(owned.replay === null ? { replayOmitted: { reason: "unavailable" as const } } : {}),
  };
  if (envelope.replay) delete envelope.replay._env;

  if (await fits(envelope, maxRawBytes, digest)) return envelope;
  dropCheckpoints(envelope);
  if (await fits(envelope, maxRawBytes, digest)) return envelope;
  dropReplay(envelope);
  await stampReplay(envelope, digest);
  return envelope;
}

/** Pure report assembly apart from CPU-only hashing; this is the sole diagnostics-bearing artifact. */
export async function assembleReport(
  input: AssembleReportInput,
  options: AssembleCaptureOptions = {},
): Promise<ProblemReport> {
  const maxRawBytes = options.maxRawBytes ?? CAPTURE_MAX_RAW_BYTES;
  const digest = options.digest ?? sha256Hex;
  const owned = structuredClone(input);
  const replayEnv = owned.replay?._env ?? owned.meta.replayEnv;
  if (owned.replay) delete owned.replay._env;
  const envelope: ProblemReport = {
    captureSchema: CAPTURE_SCHEMA_VERSION,
    kind: "report",
    reportId: owned.reportId,
    meta: {
      ...owned.meta,
      ...(replayEnv ? { replayEnv } : {}),
      replaySha256: null,
      replayComplete: owned.meta.replaySource === "last-completed" && owned.replay !== null,
    },
    summary: owned.summary,
    replay: owned.replay,
    ...(owned.replay === null ? { replayOmitted: { reason: "unavailable" as const } } : {}),
    events: owned.events,
    eventsUnparsed: owned.eventsUnparsed,
    eventsTruncated: owned.eventsTruncated,
    attachments: [],
  };

  if (await fits(envelope, maxRawBytes, digest)) return envelope;
  dropCheckpoints(envelope);
  if (await fits(envelope, maxRawBytes, digest)) return envelope;

  if (envelope.events.length > 0) {
    const halved = halveEventTail(envelope.events);
    if (halved.length < envelope.events.length) {
      envelope.events = halved;
      envelope.eventsTruncated = true;
    }
  }
  if (await fits(envelope, maxRawBytes, digest)) return envelope;

  if (envelope.events.length > 0) {
    envelope.events = [];
    envelope.eventsTruncated = true;
  }
  if (await fits(envelope, maxRawBytes, digest)) return envelope;

  dropReplay(envelope);
  await stampReplay(envelope, digest);
  return envelope;
}
