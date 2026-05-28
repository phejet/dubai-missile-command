import { describe, expect, it } from "vitest";
import { initGame } from "./game-sim.js";
import { handleRunRecapReplayEvent } from "./run-recap-replay-events.js";
import type { ReplayData } from "./types.js";

describe("run recap replay events", () => {
  it("applies human wave bonus immediately for offscreen death-clip replay", () => {
    const game = initGame();
    game.score = 1200;
    const replay: ReplayData = { seed: 1, actions: [], isHuman: true };

    handleRunRecapReplayEvent(replay, { getState: () => game }, "waveBonusStart", { buildings: 5, wave: 3 });

    expect(game.score).toBe(2700);
    expect(game._bonusScreenDone).toBe(true);
  });

  it("resumes bot replay bonus pauses without applying human UI score", () => {
    const game = initGame();
    game.score = 1200;
    const replay: ReplayData = { seed: 1, actions: [] };

    handleRunRecapReplayEvent(replay, { getState: () => game }, "waveBonusStart", { buildings: 5, wave: 3 });

    expect(game.score).toBe(1200);
    expect(game._bonusScreenDone).toBe(true);
  });
});
