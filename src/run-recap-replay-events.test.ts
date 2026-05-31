import { describe, expect, it } from "vitest";
import { initGame } from "./game-sim";
import { handleRunRecapReplayEvent } from "./run-recap-replay-events";
import type { ReplayData, SimEventMap } from "./types";

const waveBonusEvent: SimEventMap["waveBonusStart"] = {
  buildings: 5,
  wave: 3,
  missileKills: 0,
  droneKills: 0,
  destroyedByType: {
    ballisticMissile: 0,
    mirv: 0,
    mirvWarhead: 0,
    stackedMissile: 0,
    bomb: 0,
    shahed136: 0,
    shahed238: 0,
    other: 0,
  },
  multiShots: 0,
  maxCombo: 1,
};

describe("run recap replay events", () => {
  it("applies human wave bonus immediately for offscreen death-clip replay", () => {
    const game = initGame();
    game.score = 1200;
    const replay: ReplayData = { seed: 1, actions: [], isHuman: true };

    handleRunRecapReplayEvent(replay, { getState: () => game }, "waveBonusStart", waveBonusEvent);

    expect(game.score).toBe(2700);
    expect(game._bonusScreenDone).toBe(true);
  });

  it("resumes bot replay bonus pauses without applying human UI score", () => {
    const game = initGame();
    game.score = 1200;
    const replay: ReplayData = { seed: 1, actions: [] };

    handleRunRecapReplayEvent(replay, { getState: () => game }, "waveBonusStart", waveBonusEvent);

    expect(game.score).toBe(1200);
    expect(game._bonusScreenDone).toBe(true);
  });
});
