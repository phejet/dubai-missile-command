// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { replayFixture, reportFixture, sessionFixture } from "../test-fixtures/capture";
import {
  assembleReport,
  assembleSession,
  CAPTURE_SCHEMA_VERSION,
  projectCaptureSummary,
  type AssembleReportInput,
  type AssembleSessionInput,
} from "./capture";
import { createEmptyGameStats } from "./game-logic";
import { sha256HexFallback } from "./sha256";
import type { RunRecapData } from "./types";

const digest = async () => "a".repeat(64);

function recap(): RunRecapData {
  const totalStats = createEmptyGameStats();
  Object.assign(totalStats, { missileKills: 3, droneKills: 2, shotsFired: 10, multiShots: 4, maxCombo: 8 });
  return {
    score: 900,
    wave: 4,
    timePlayedMs: 12_345,
    hitRatio: 0.5,
    burjHealth: 0,
    outcome: "burj_destroyed",
    totalStats,
    waves: [],
    waveCards: [],
    upgrades: [{ tick: 20, wave: 2, bought: ["patriot"] }],
    hasReplay: true,
  };
}

function sessionInput(): AssembleSessionInput {
  const source = sessionFixture();
  const { replaySha256: _sha, replayComplete: _complete, ...meta } = source.meta;
  return { meta, summary: source.summary, replay: source.replay };
}

function reportInput(): AssembleReportInput {
  const source = reportFixture();
  const { replaySha256: _sha, replayComplete: _complete, ...meta } = source.meta;
  return {
    reportId: source.reportId,
    meta,
    summary: source.summary,
    replay: source.replay,
    events: source.events,
    eventsUnparsed: source.eventsUnparsed,
    eventsTruncated: source.eventsTruncated,
  };
}

describe("capture assembly", () => {
  it("projects every persisted summary field", () => {
    expect(projectCaptureSummary(recap(), false)).toMatchObject({
      outcome: "burj_destroyed",
      score: 900,
      totalKills: 5,
      shotsFired: 10,
    });
    expect(projectCaptureSummary(recap(), true)).toMatchObject({ outcome: "in_progress", deathCause: null });
  });

  it("assembles a diagnostics-free session without mutating input", async () => {
    const input = sessionInput();
    input.replay!._env = { platform: "web", native: false, ua: "private", dpr: 2, screenW: 390, screenH: 844 };
    const before = structuredClone(input);
    const result = await assembleSession(input, { digest });
    expect(result).toMatchObject({
      captureSchema: CAPTURE_SCHEMA_VERSION,
      kind: "session",
      meta: { runId: "run", replayComplete: true, replaySha256: "a".repeat(64) },
    });
    expect(Object.keys(result)).not.toContain("events");
    expect(Object.keys(result.meta)).not.toContain("env");
    expect(result.replay).not.toHaveProperty("_env");
    expect(input).toEqual(before);
  });

  it("deduplicates production-shaped replay provenance without losing report context", async () => {
    const rawReplay = replayFixture();
    const sessionSource = sessionInput();
    const reportSource = reportInput();
    sessionSource.replay = structuredClone(rawReplay);
    reportSource.replay = structuredClone(rawReplay);
    const realDigest = async (bytes: Uint8Array) => sha256HexFallback(bytes);
    const [session, report] = await Promise.all([
      assembleSession(sessionSource, { digest: realDigest }),
      assembleReport(reportSource, { digest: realDigest }),
    ]);
    expect(session.replay).toEqual(report.replay);
    expect(session.meta.replaySha256).toBe(report.meta.replaySha256);
    expect(session.replay).toMatchObject({ _buildId: "build+dirty", _savedAt: "2026-08-04T00:00:00.000Z" });
    expect(session.replay).not.toHaveProperty("_env");
    expect(report.meta.replayEnv).toEqual(rawReplay._env);
  });

  it("uses the short session degradation ladder", async () => {
    const input = sessionInput();
    input.replay!.checkpoints = [{ payload: "x".repeat(4_000) } as never];
    const withoutCheckpoints = await assembleSession(input, { maxRawBytes: 1_200, digest });
    expect(withoutCheckpoints.replay?.checkpoints).toBeUndefined();
    expect(withoutCheckpoints.replayOmitted).toEqual({ reason: "size", checkpointsDropped: true });

    const withoutReplay = await assembleSession(input, { maxRawBytes: 500, digest });
    expect(withoutReplay.replay).toBeNull();
    expect(withoutReplay.meta.replaySha256).toBeNull();
    expect(withoutReplay.replayOmitted?.reason).toBe("size");
  });

  it("assembles reports with diagnostics and degrades events before replay", async () => {
    const input = reportInput();
    const replayEnv = { platform: "ios", native: true, ua: "recorder", dpr: 3, screenW: 390, screenH: 844 };
    input.replay!._env = replayEnv;
    input.events = Array.from({ length: 8 }, (_, index) => ({ index, payload: "e".repeat(150) }));
    const result = await assembleReport(input, { maxRawBytes: 2_100, digest });
    expect(result.kind).toBe("report");
    expect(result.events.length).toBeLessThan(input.events.length);
    expect(result.eventsTruncated).toBe(true);
    expect(result.replay).not.toBeNull();
    expect(result.replay).not.toHaveProperty("_env");
    expect(result.meta.replayEnv).toEqual(replayEnv);
    expect(result.attachments).toEqual([]);
  });

  it("supports replay-less title reports", async () => {
    const input = reportInput();
    input.meta.runId = null;
    input.meta.replaySource = "none";
    input.summary = null;
    input.replay = null;
    const result = await assembleReport(input, { digest });
    expect(result).toMatchObject({ replay: null, summary: null, replayOmitted: { reason: "unavailable" } });
    expect(result.meta.replaySha256).toBeNull();
  });
});
