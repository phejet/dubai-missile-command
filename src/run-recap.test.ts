import { describe, expect, it } from "vitest";
import { createEmptyGameStats } from "./game-logic";
import { initGame } from "./game-sim";
import { buildRunRecapData, buildRunRecapWaveCards, deriveOutcomeCause, extractUpgradeTimeline } from "./run-recap";
import type { ReplayAction, WaveSummaryRecord } from "./types";

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

    const recap = buildRunRecapData(g, { version: 5, seed: 1, actions: [], finalTick: 180, replayId: "abc" });

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

  it("builds wave cards with terminal start ticks and aggregated purchases", () => {
    const g = initGame();
    g.state = "gameover";
    g.burjAlive = false;
    g.burjHealth = 0;
    g.wave = 3;
    g.score = 3500;
    g.stats.missileKills = 6;
    g.stats.droneKills = 3;
    g.stats.multiShots = 2;
    g.stats.maxCombo = 5;
    g._waveStartTick = 240;
    g._waveSummaries = [
      makeWaveSummary({ wave: 1, scoreEarned: 1200, missileKills: 2, droneKills: 1, startTick: 0, endTick: 100 }),
      makeWaveSummary({ wave: 2, scoreEarned: 800, missileKills: 2, droneKills: 1, startTick: 120, endTick: 220 }),
    ];
    g._actionLog = [
      { type: "wave_plan", tick: 0, wave: 1 },
      { type: "shop", tick: 110, wave: 1, bought: ["wildHornets"] },
      { type: "wave_plan", tick: 120, wave: 2 },
      { type: "shop", tick: 225, wave: 2, bought: ["roadrunner"] },
      { type: "shop", tick: 226, wave: 2, bought: ["patriot"] },
      { type: "wave_plan", tick: 240, wave: 3 },
    ];

    const recap = buildRunRecapData(g, {
      version: 5,
      seed: 1,
      actions: g._actionLog as ReplayAction[],
      finalTick: 300,
    });

    expect(recap.waveCards).toHaveLength(3);
    expect(recap.waveCards[1]).toMatchObject({
      wave: 2,
      bought: ["roadrunner", "patriot"],
      terminal: false,
    });
    expect(recap.waveCards[2]).toMatchObject({
      wave: 3,
      scoreEarned: 1500,
      missileKills: 2,
      droneKills: 1,
      startTick: 240,
      endTick: 300,
      terminal: true,
    });
  });

  it("can build wave cards directly for preview fixtures", () => {
    const waves = [makeWaveSummary({ wave: 1, scoreEarned: 500, startTick: 0, endTick: 80 })];
    const cards = buildRunRecapWaveCards({
      score: 900,
      wave: 2,
      burjHealth: 0,
      totalStats: { ...createEmptyGameStats(), missileKills: 2, maxCombo: 3 },
      waves,
      upgrades: [{ tick: 90, wave: 1, bought: ["emp"] }],
      actionLog: [{ type: "wave_plan", tick: 120, wave: 2 }],
      finalTick: 160,
    });

    expect(cards.map((card) => card.wave)).toEqual([1, 2]);
    expect(cards[0].bought).toEqual(["emp"]);
    expect(cards[1]).toMatchObject({ terminal: true, startTick: 120, scoreEarned: 400 });
  });

  it("uses the first wave start marker when duplicate markers exist", () => {
    const cards = buildRunRecapWaveCards({
      score: 100,
      wave: 2,
      burjHealth: 0,
      totalStats: createEmptyGameStats(),
      waves: [],
      upgrades: [],
      actionLog: [
        { type: "wave_plan", tick: 120, wave: 2 },
        { type: "wave_plan", tick: 180, wave: 2 },
      ],
      finalTick: 220,
    });

    expect(cards[0]).toMatchObject({ wave: 2, startTick: 120, terminal: true });
  });
});
