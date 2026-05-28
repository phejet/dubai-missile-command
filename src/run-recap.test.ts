import { describe, expect, it } from "vitest";
import { createEmptyGameStats } from "./game-logic.js";
import { initGame } from "./game-sim.js";
import { buildRunRecapData, deriveOutcomeCause, extractUpgradeTimeline } from "./run-recap.js";
import type { ReplayAction, WaveSummaryRecord } from "./types.js";

function makeWaveSummary(overrides: Partial<WaveSummaryRecord> = {}): WaveSummaryRecord {
  return {
    wave: 1,
    scoreEarned: 1000,
    missileKills: 1,
    droneKills: 0,
    destroyedByType: createEmptyGameStats().destroyedByType,
    multiShots: 0,
    maxCombo: 1,
    buildingsSurviving: 8,
    burjHealth: 7,
    startTick: 0,
    endTick: 120,
    ...overrides,
  };
}

describe("run recap data", () => {
  it("derives Burj-destroyed outcome from terminal state", () => {
    const g = initGame();
    g.state = "gameover";
    g.burjAlive = false;

    expect(deriveOutcomeCause(g)).toBe("burj_destroyed");
  });

  it("does not invent launcher-loss game over", () => {
    const g = initGame();
    g.state = "playing";
    g.launcherHP = [0, 0];

    expect(deriveOutcomeCause(g)).toBe("abandoned");
  });

  it("builds hit ratio and time from final replay tick", () => {
    const g = initGame();
    g.state = "gameover";
    g.score = 5000;
    g.wave = 4;
    g.stats.missileKills = 3;
    g.stats.droneKills = 2;
    g.stats.shotsFired = 10;
    g.burjHealth = 3;
    g._waveSummaries = [makeWaveSummary({ wave: 1 })];

    const recap = buildRunRecapData(g, { seed: 1, actions: [], finalTick: 180, replayId: "abc" });

    expect(recap.score).toBe(5000);
    expect(recap.wave).toBe(4);
    expect(recap.hitRatio).toBe(0.5);
    expect(recap.timePlayedMs).toBe(3000);
    expect(recap.burjHealth).toBe(3);
    expect(recap.hasReplay).toBe(true);
    expect(recap.replayId).toBe("abc");
  });

  it("handles zero-shot hit ratio", () => {
    const g = initGame();
    g.stats.shotsFired = 0;

    expect(buildRunRecapData(g, null).hitRatio).toBe(0);
  });

  it("extracts upgrade purchases and assigns waves", () => {
    const waves = [
      makeWaveSummary({ wave: 1, startTick: 0, endTick: 100 }),
      makeWaveSummary({ wave: 2, startTick: 200, endTick: 300 }),
    ];
    const actions: ReplayAction[] = [
      { type: "shop", tick: 120, wave: 1, bought: ["wildHornets"] },
      { type: "shop", tick: 320, bought: ["patriot", "emp"] },
      { type: "shop", tick: 400, wave: 3, bought: [] },
      { type: "fire", tick: 410, x: 1, y: 2 },
    ];

    expect(extractUpgradeTimeline(actions, waves, 3)).toEqual([
      { tick: 120, wave: 1, bought: ["wildHornets"] },
      { tick: 320, wave: 2, bought: ["patriot", "emp"] },
    ]);
  });
});
