import { describe, expect, it } from "vitest";
import {
  extractReplayWaveStarts,
  findNextReplayWaveStart,
  findPreviousReplayWaveStart,
} from "./replay-wave-navigation";
import type { ReplayData } from "./types";

describe("replay wave navigation", () => {
  const replay = {
    version: 6,
    seed: 7,
    actions: [
      { type: "wave_plan", tick: 0, wave: 1 },
      { type: "wave_plan", tick: 120, wave: 2 },
      { type: "wave_plan", tick: 121, wave: 2 },
      { type: "wave_plan", tick: 310, wave: 3 },
    ],
  } as ReplayData;

  it("keeps the first marker for each wave and sorts by tick", () => {
    expect(extractReplayWaveStarts(replay)).toEqual([
      { tick: 0, wave: 1 },
      { tick: 120, wave: 2 },
      { tick: 310, wave: 3 },
    ]);
  });

  it("falls back to wave-start checkpoints when an action marker is absent", () => {
    const withCheckpoint = {
      ...replay,
      checkpoints: [{ tick: 500, wave: 4, reason: "waveStart:4" }],
    } as ReplayData;

    const starts = extractReplayWaveStarts(withCheckpoint);
    expect(starts[starts.length - 1]).toEqual({ tick: 500, wave: 4 });
  });

  it("finds adjacent wave starts strictly before and after the current tick", () => {
    const starts = extractReplayWaveStarts(replay);

    expect(findPreviousReplayWaveStart(starts, 200)).toEqual({ tick: 120, wave: 2 });
    expect(findPreviousReplayWaveStart(starts, 120)).toEqual({ tick: 0, wave: 1 });
    expect(findNextReplayWaveStart(starts, 120)).toEqual({ tick: 310, wave: 3 });
    expect(findNextReplayWaveStart(starts, 310)).toBeNull();
  });
});
