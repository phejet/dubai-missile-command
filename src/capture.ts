import type { ReplayData, ReplayEnvironment, RunRecapData, UpgradeTimelineEntry } from "./types";
import { sha256Hex } from "./sha256";

export const CAPTURE_SCHEMA_VERSION = 1 as const;
export const CAPTURE_MAX_RAW_BYTES = 4 * 1024 * 1024;
export const EVENT_TAIL_MAX_BYTES = 256 * 1024;

export type CaptureTrigger = "gameover" | "manual" | "agent";
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

export interface CaptureMeta {
  buildId: string;
  installId: string | null;
  displayName: string | null;
  bootId: string;
  runId: string | null;
  capturedAt: number;
  trigger: CaptureTrigger;
  note: string | null;
  appScreen: CaptureAppScreen;
  replaySource: CaptureReplaySource;
  partial: boolean;
  capturedThroughTick: number | null;
  replaySha256: string | null;
  replayComplete: boolean;
  platform: string;
  inputClass: CaptureInputClass;
  env: ReplayEnvironment;
}

export interface CaptureAttachment {
  kind: string;
  [key: string]: unknown;
}

export interface CaptureEnvelope {
  captureSchema: typeof CAPTURE_SCHEMA_VERSION;
  captureId: string;
  meta: CaptureMeta;
  summary: CaptureSummary | null;
  replay: ReplayData | null;
  replayOmitted?: { reason: "size" | "unavailable"; checkpointsDropped?: boolean };
  events: Record<string, unknown>[];
  eventsUnparsed: number;
  eventsTruncated: boolean;
  attachments: CaptureAttachment[];
}

export interface AssembleCaptureInput {
  captureId: string;
  meta: Omit<CaptureMeta, "replaySha256" | "replayComplete">;
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

function serializedBytes(value: unknown): Uint8Array {
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

function cloneEnvelopeInput(input: AssembleCaptureInput): CaptureEnvelope {
  const owned = structuredClone(input);
  return {
    captureSchema: CAPTURE_SCHEMA_VERSION,
    captureId: owned.captureId,
    meta: {
      ...owned.meta,
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
}

async function stampReplayHash(
  envelope: CaptureEnvelope,
  digest: (bytes: Uint8Array) => Promise<string | null>,
): Promise<void> {
  envelope.meta.replaySha256 = envelope.replay ? await digest(serializedBytes(envelope.replay)) : null;
}

async function fits(
  envelope: CaptureEnvelope,
  maxRawBytes: number,
  digest: (bytes: Uint8Array) => Promise<string | null>,
): Promise<boolean> {
  await stampReplayHash(envelope, digest);
  return serializedBytes(envelope).byteLength <= maxRawBytes;
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

/** Pure artifact assembly apart from CPU-only hashing; input objects are never mutated. */
export async function assembleCapture(
  input: AssembleCaptureInput,
  options: AssembleCaptureOptions = {},
): Promise<CaptureEnvelope> {
  const maxRawBytes = options.maxRawBytes ?? CAPTURE_MAX_RAW_BYTES;
  const digest = options.digest ?? sha256Hex;
  const envelope = cloneEnvelopeInput(input);

  if (await fits(envelope, maxRawBytes, digest)) return envelope;

  if (envelope.replay?.checkpoints?.length) {
    delete envelope.replay.checkpoints;
    envelope.replayOmitted = { reason: "size", checkpointsDropped: true };
    envelope.meta.replayComplete = false;
  }
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

  if (envelope.replay) {
    envelope.replay = null;
    envelope.replayOmitted = {
      reason: "size",
      ...(envelope.replayOmitted?.checkpointsDropped ? { checkpointsDropped: true } : {}),
    };
    envelope.meta.replayComplete = false;
  }
  await stampReplayHash(envelope, digest);
  return envelope;
}
