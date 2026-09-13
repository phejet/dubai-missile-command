import { describe, expect, it } from "vitest";
import { runGame } from "./headless/sim-runner";
import { createReplayRunner } from "./replay";
import { seekRunnerToTick } from "./replay-seek";
import { buildRunRecapData } from "./run-recap";
import {
  compareSummary,
  inspectReplay,
  inspectionTimeline,
  TERMINAL_LEAD_IN_TICKS,
  DURATION_TOLERANCE_MS,
  HIT_RATIO_EPSILON,
} from "./operator-inspection";
import type { OperatorSessionDetail } from "./operator-contract";
import type { ReplayData, RunRecapData } from "./types";

export function storedFromRecap(recap: RunRecapData): OperatorSessionDetail {
  return {
    runId: "fixture-run",
    receivedAt: 1,
    createdAt: 1,
    build: "build",
    score: recap.score,
    wave: recap.wave,
    outcome: recap.outcome,
    feedbackEmoji: null,
    replayStatus: "available",
    appFlavor: "staging",
    appleEnvironment: "production",
    platform: "web",
    inputClass: "mouse",
    source: "gameover",
    deathCause: recap.outcome === "burj_destroyed" ? "burj_destroyed" : null,
    timePlayedMs: recap.timePlayedMs,
    burjHealth: recap.burjHealth,
    shotsFired: recap.totalStats.shotsFired,
    totalKills: recap.totalStats.missileKills + recap.totalStats.droneKills,
    hitRatio: recap.hitRatio,
    multiShots: recap.totalStats.multiShots,
    maxCombo: recap.totalStats.maxCombo,
    destroyedByType: recap.totalStats.destroyedByType,
    upgrades: recap.upgrades,
    replayCompleteClaimed: true,
    canRequestReplay: true,
  };
}
function fixture() {
  const result = runGame(null, {
    seed: 1481412993,
    record: true,
    draftMode: true,
    isHuman: true,
    stopCondition: { type: "waveComplete", wave: 3 },
    checkpoints: true,
  });
  return {
    version: result.version!,
    seed: result.seed,
    actions: result.actions!,
    initialState: result.initialState!,
    draftMode: true,
    isHuman: true,
    stopCondition: { type: "waveComplete", wave: 3 },
    checkpoints: result.checkpoints,
  } as ReplayData;
}
describe("operator replay inspection", () => {
  it("crosses real human bonus/shop boundaries and derives consistent wave evidence", async () => {
    const replay = fixture();
    const runner = createReplayRunner(replay);
    runner.init();
    await seekRunnerToTick(runner, Number.MAX_SAFE_INTEGER, { cancelled: false });
    replay.finalTick = runner.getTick();
    const recap = buildRunRecapData(runner.getState()!, replay);
    runner.cleanup();
    const stored = storedFromRecap(recap);
    const inspection = await inspectReplay(stored, replay, { cancelled: false });
    expect(inspection.status).toBe("matches summary");
    expect(inspection.recap.waveCards.length).toBeGreaterThanOrEqual(3);
    expect(inspection.recap.upgrades.length).toBeGreaterThan(0);
    expect(inspection.timeline.map((item) => item.tick)).toEqual(
      inspection.timeline.map((item) => item.tick).sort((a, b) => a - b),
    );
    expect(TERMINAL_LEAD_IN_TICKS).toBe(600);
    const terminal = inspection.timeline.find((item) => item.label.startsWith("Terminal"))!;
    expect(terminal.seekToTick).toBe(
      Math.max(inspection.recap.waveCards[inspection.recap.waveCards.length - 1].startTick, replay.finalTick - 600),
    );
    expect(compareSummary({ ...stored, score: stored.score + 1 }, recap).map((item) => item.field)).toEqual(["score"]);
    expect(compareSummary({ ...stored, timePlayedMs: stored.timePlayedMs + DURATION_TOLERANCE_MS }, recap)).toEqual([]);
    expect(
      compareSummary({ ...stored, timePlayedMs: stored.timePlayedMs + DURATION_TOLERANCE_MS + 1 }, recap)[0].field,
    ).toBe("timePlayedMs");
    const zeroRatio = { ...recap, hitRatio: 0 };
    const zeroStored = { ...stored, hitRatio: HIT_RATIO_EPSILON };
    expect(compareSummary(zeroStored, zeroRatio)).toEqual([]);
    expect(compareSummary({ ...zeroStored, hitRatio: HIT_RATIO_EPSILON * 2 }, zeroRatio)[0].field).toBe("hitRatio");
    await expect(inspectReplay(stored, replay, { cancelled: true })).rejects.toThrow("cancelled");
    await expect(inspectReplay(stored, { ...replay, version: 1 }, { cancelled: false })).rejects.toThrow(
      "incompatible",
    );
    await expect(inspectReplay(stored, { ...replay, version: 999 }, { cancelled: false })).rejects.toThrow(
      "incompatible",
    );
    const timeline = inspectionTimeline(
      {
        ...replay,
        actions: [
          { type: "emp", tick: 0 },
          { type: "f15", tick: 0 },
          { type: "flare", tick: 0 },
        ],
      },
      recap,
      100,
    );
    expect(timeline.filter((item) => item.label.includes("activated"))).toHaveLength(3);
    expect(timeline.every((item) => item.seekToTick >= 0 && item.seekToTick <= 100)).toBe(true);
  });
});
