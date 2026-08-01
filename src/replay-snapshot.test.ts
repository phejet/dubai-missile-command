// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { initGame } from "./game-sim";
import { createEmptyGameStats } from "./game-logic";
import { buildReplaySnapshot } from "./replay-snapshot";
import { CURRENT_REPLAY_VERSION } from "./replay-version";
import type { ReplayInitialState } from "./types";
import { runGame } from "./headless/sim-runner";
import { validateReplay } from "./headless/validate-replay";

const initialState: ReplayInitialState = {
  metaProgression: { version: 1, completedObjectives: [] },
  forcedUpgradeFamilies: [],
  burjHealth: 7,
};

describe("replay snapshot", () => {
  it("preserves the previous game-over replay shape", () => {
    vi.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));
    const game = initGame();
    game._gameSeed = 42;
    game._replayTick = 99;
    game._actionLog = [{ type: "emp", tick: 4 }];
    game._replayCheckpoints = [];
    game._draftMode = true;
    game.score = 123;
    game.wave = 3;
    game.stats = createEmptyGameStats();

    expect(buildReplaySnapshot(game, initialState, { buildId: "test", finalTick: 100 })).toEqual({
      version: CURRENT_REPLAY_VERSION,
      seed: 42,
      actions: [{ type: "emp", tick: 4 }],
      initialState,
      checkpoints: [],
      finalTick: 100,
      isHuman: true,
      draftMode: true,
      score: 123,
      wave: 3,
      _buildId: "test",
      _savedAt: "2026-08-01T00:00:00.000Z",
      _env: expect.objectContaining({ platform: expect.any(String), native: expect.any(Boolean) }),
    });
    vi.useRealTimers();
  });

  it("owns actions, checkpoints, and initial state synchronously", () => {
    const game = initGame();
    game._actionLog = [{ type: "emp", tick: 4 }];
    game._replayCheckpoints = [
      {
        tick: 4,
        state: "playing",
        wave: 1,
        score: 0,
        burjAlive: true,
        burjHealth: 7,
        ammo: [1, 1, 1],
        launcherHP: [1, 1, 1],
        fireChargeState: { burstCharges: 3, burstChargeCap: 3, nextRechargeTick: null, regenStreak: 0 },
        upgrades: structuredClone(game.upgrades),
        stats: createEmptyGameStats(),
        counts: {},
        hash: "hash",
        diagnostics: {},
      },
    ];
    const snapshot = buildReplaySnapshot(game, initialState, { buildId: "test" });

    game._actionLog.push({ type: "f15", tick: 5 });
    game._replayCheckpoints[0].diagnostics.changed = true;
    initialState.metaProgression.completedObjectives.push("reach_wave_4");

    expect(snapshot.actions).toEqual([{ type: "emp", tick: 4 }]);
    expect(snapshot.checkpoints?.[0].diagnostics).toEqual({});
    expect(snapshot.initialState?.metaProgression.completedObjectives).toEqual([]);
  });

  it("produces a coherent partial replay that passes checkpoint verification", () => {
    const recorded = runGame(null, { seed: 12345, maxTicks: 600, record: true, checkpoints: true });
    const game = initGame();
    game._gameSeed = recorded.seed;
    game._actionLog = recorded.actions;
    game._replayCheckpoints = recorded.checkpoints;
    game._replayTick = recorded.ticks;
    game.score = recorded.score;
    game.wave = recorded.wave;

    const snapshot = buildReplaySnapshot(game, recorded.initialState!, {
      buildId: "test",
      finalTick: recorded.ticks,
      isHuman: false,
    });
    expect(validateReplay(snapshot)).toEqual([]);
  });
});
