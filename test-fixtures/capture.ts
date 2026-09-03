import { serializedBytes, type CaptureSummary, type ProblemReport, type SessionUpload } from "../src/capture";
import { sha256HexFallback } from "../src/sha256";
import type { ReplayData } from "../src/types";

export function replayFixture(): ReplayData {
  return {
    version: 11,
    seed: 42,
    actions: [],
    finalTick: 10,
    initialState: {
      metaProgression: { version: 1, completedObjectives: [] },
      forcedUpgradeFamilies: [],
      burjHealth: 7,
    },
    _buildId: "build+dirty",
    _savedAt: "2026-08-04T00:00:00.000Z",
    _env: { platform: "web", native: false, ua: "recording", dpr: 2, screenW: 390, screenH: 844 },
  };
}

function normalizedReplay(replay: ReplayData | null): ReplayData | null {
  if (!replay) return null;
  const normalized = structuredClone(replay);
  delete normalized._env;
  return normalized;
}

function summaryFixture(): CaptureSummary {
  return {
    outcome: "burj_destroyed",
    deathCause: "burj_destroyed",
    waveReached: 4,
    score: 900,
    timePlayedMs: 12_345,
    burjHealth: 0,
    shotsFired: 10,
    totalKills: 5,
    hitRatio: 0.5,
    multiShots: 4,
    maxCombo: 8,
    destroyedByType: {
      ballisticMissile: 1,
      mirv: 1,
      mirvWarhead: 1,
      stackedMissile: 1,
      bomb: 1,
      shahed136: 0,
      shahed238: 0,
      other: 0,
    },
    upgrades: [{ tick: 20, wave: 2, bought: ["patriot"] }],
  };
}

export function sessionFixture(
  overrides: { installId?: string; runId?: string; replay?: ReplayData | null } = {},
): SessionUpload {
  const replay = normalizedReplay(overrides.replay === undefined ? replayFixture() : overrides.replay);
  return {
    captureSchema: 2,
    kind: "session",
    meta: {
      buildId: "build+dirty",
      installId: overrides.installId ?? "12345678-abcd",
      displayName: "Pilot",
      bootId: "boot",
      runId: overrides.runId ?? "run",
      capturedAt: 1_700_000_000_000,
      trigger: "gameover",
      note: "something exploded beautifully",
      appScreen: "gameover",
      replaySource: replay ? "last-completed" : "none",
      partial: false,
      capturedThroughTick: null,
      replaySha256: replay ? sha256HexFallback(serializedBytes(replay)) : null,
      replayComplete: replay !== null,
      platform: "web",
      inputClass: "mouse",
    },
    summary: summaryFixture(),
    replay,
    ...(replay === null ? { replayOmitted: { reason: "unavailable" as const } } : {}),
  };
}

export function reportFixture(
  overrides: { reportId?: string; installId?: string; runId?: string | null; replay?: ReplayData | null } = {},
): ProblemReport {
  const sourceReplay = overrides.replay === undefined ? replayFixture() : overrides.replay;
  const replayEnv = sourceReplay?._env;
  const replay = normalizedReplay(sourceReplay);
  return {
    captureSchema: 2,
    kind: "report",
    reportId: overrides.reportId ?? "boot-c0",
    meta: {
      buildId: "build+dirty",
      installId: overrides.installId ?? "12345678-abcd",
      displayName: "Pilot",
      bootId: "boot",
      runId: overrides.runId === undefined ? "run" : overrides.runId,
      capturedAt: 1_700_000_000_000,
      trigger: "manual",
      note: "something exploded beautifully",
      appScreen: "gameover",
      replaySource: replay ? "last-completed" : "none",
      partial: false,
      capturedThroughTick: null,
      replaySha256: replay ? sha256HexFallback(serializedBytes(replay)) : null,
      replayComplete: replay !== null,
      platform: "web",
      inputClass: "mouse",
      env: { platform: "web", native: false, ua: "test", dpr: 1, screenW: 900, screenH: 1600 },
      ...(replayEnv ? { replayEnv: structuredClone(replayEnv) } : {}),
    },
    summary: summaryFixture(),
    replay,
    ...(replay === null ? { replayOmitted: { reason: "unavailable" as const } } : {}),
    events: [{ channel: "game", event: "start" }],
    eventsUnparsed: 0,
    eventsTruncated: false,
    attachments: [],
  };
}
