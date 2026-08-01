// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createEmptyGameStats } from "./game-logic";
import { assembleCapture, CAPTURE_SCHEMA_VERSION, projectCaptureSummary, type AssembleCaptureInput } from "./capture";
import type { ReplayData, RunRecapData } from "./types";

const digest = async () => "a".repeat(64);

function recap(): RunRecapData {
  const totalStats = createEmptyGameStats();
  totalStats.missileKills = 3;
  totalStats.droneKills = 2;
  totalStats.shotsFired = 10;
  totalStats.multiShots = 4;
  totalStats.maxCombo = 8;
  return {
    score: 900,
    wave: 4,
    timePlayedMs: 12345,
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

function input(overrides: Partial<AssembleCaptureInput> = {}): AssembleCaptureInput {
  const replay: ReplayData = {
    version: 11,
    seed: 42,
    actions: [{ type: "emp", tick: 1 }],
    checkpoints: [],
    finalTick: 10,
  };
  return {
    captureId: "boot-c0",
    meta: {
      buildId: "build",
      installId: null,
      displayName: null,
      bootId: "boot",
      runId: "run",
      capturedAt: 1,
      trigger: "manual",
      note: null,
      appScreen: "playing",
      replaySource: "live",
      partial: true,
      capturedThroughTick: 10,
      platform: "web",
      inputClass: "mouse",
      env: { platform: "web", native: false, ua: "test", dpr: 1, screenW: 900, screenH: 1600 },
    },
    summary: projectCaptureSummary(recap(), true),
    replay,
    events: [{ channel: "game", event: "start" }],
    eventsUnparsed: 0,
    eventsTruncated: false,
    ...overrides,
  };
}

describe("capture assembly", () => {
  it("projects every persisted summary field and normalizes partial outcome", () => {
    const summary = projectCaptureSummary(recap(), true);
    expect(summary).toEqual({
      outcome: "in_progress",
      deathCause: null,
      waveReached: 4,
      score: 900,
      timePlayedMs: 12345,
      burjHealth: 0,
      shotsFired: 10,
      totalKills: 5,
      hitRatio: 0.5,
      multiShots: 4,
      maxCombo: 8,
      destroyedByType: createEmptyGameStats().destroyedByType,
      upgrades: [{ tick: 20, wave: 2, bought: ["patriot"] }],
    });
    expect(Object.values(summary).every((value) => value !== undefined)).toBe(true);
  });

  it("assembles the versioned envelope without mutating nested inputs", async () => {
    const source = input();
    const before = structuredClone(source);
    const result = await assembleCapture(source, { digest });

    expect(result).toMatchObject({
      captureSchema: CAPTURE_SCHEMA_VERSION,
      captureId: "boot-c0",
      meta: { replayComplete: false, replaySha256: "a".repeat(64) },
      attachments: [],
    });
    expect(source).toEqual(before);
  });

  it("marks only an explicitly completed replay as archive-joinable", async () => {
    const source = input();
    source.meta.replaySource = "last-completed";
    source.meta.partial = false;
    const result = await assembleCapture(source, { digest });
    expect(result.meta.replayComplete).toBe(true);
    expect(result.meta.replaySha256).toBe("a".repeat(64));
  });

  it("handles a capture with no run or replay", async () => {
    const result = await assembleCapture(input({ replay: null, summary: null }), { digest });
    expect(result).toMatchObject({
      replay: null,
      summary: null,
      replayOmitted: { reason: "unavailable" },
      meta: { replayComplete: false, replaySha256: null },
    });
  });

  it("drops checkpoints before event data and records the rung", async () => {
    const source = input();
    source.replay!.checkpoints = [{ payload: "x".repeat(2500) } as never];
    const before = structuredClone(source);
    const result = await assembleCapture(source, { maxRawBytes: 1800, digest });

    expect(result.replay).not.toBeNull();
    expect(result.replay?.checkpoints).toBeUndefined();
    expect(result.replayOmitted).toEqual({ reason: "size", checkpointsDropped: true });
    expect(result.meta.replayComplete).toBe(false);
    expect(result.events).toEqual(source.events);
    expect(source).toEqual(before);
  });

  it("halves then drops events before omitting replay", async () => {
    const events = Array.from({ length: 8 }, (_, index) => ({ index, payload: "e".repeat(150) }));
    const half = await assembleCapture(input({ events }), { maxRawBytes: 1800, digest });
    expect(half.events).toEqual(events.slice(4));
    expect(half.eventsTruncated).toBe(true);
    expect(half.replay).not.toBeNull();

    const none = await assembleCapture(input({ events }), { maxRawBytes: 1000, digest });
    expect(none.events).toEqual([]);
    expect(none.replay).toBeNull();
    expect(none.replayOmitted?.reason).toBe("size");
    expect(none.meta.replaySha256).toBeNull();
  });

  it("does not record a no-op when halving a single-event tail", async () => {
    const result = await assembleCapture(input({ events: [{ payload: "e".repeat(1200) }] }), {
      maxRawBytes: 1300,
      digest,
    });
    expect(result.events).toEqual([]);
    expect(result.eventsTruncated).toBe(true);
    expect(result.replay).not.toBeNull();
  });
});
