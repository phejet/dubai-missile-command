import { afterEach, describe, expect, it } from "vitest";
import { getRngState, setRng } from "./game-logic";
import { completeWaveBonusAndOpenShop, initGame, update } from "./game-sim";
import { mulberry32 } from "./headless/rng";
import { buildReplayCausalSnapshot } from "./replay-causal-snapshot";
import { isBonusUiPauseActive } from "./replay-loop";

afterEach(() => setRng(Math.random));

function crossDamagedBurjBoundary(observeEvents: boolean) {
  setRng(mulberry32(425));
  const game = initGame();
  game._draftMode = true;
  game.burjHealth = 6;
  game.waveComplete = true;
  game.waveClearedTimer = 0;
  const events: string[] = [];
  const sink = observeEvents ? (type: string) => events.push(type) : null;

  update(game, 1, sink);
  expect(isBonusUiPauseActive(game)).toBe(true);
  completeWaveBonusAndOpenShop(game, sink);

  return { snapshot: buildReplayCausalSnapshot(game), events };
}

describe("replay wave boundary contract", () => {
  it("keeps observed and unobserved damaged-Burj boundaries causally identical", () => {
    const unobserved = crossDamagedBurjBoundary(false);
    const observed = crossDamagedBurjBoundary(true);

    expect(observed.snapshot).toEqual(unobserved.snapshot);
    expect(observed.events).toEqual(["waveBonusStart", "shopOpen"]);
  });

  it("opens the shop idempotently without consuming RNG twice", () => {
    setRng(mulberry32(9));
    const game = initGame();
    game._draftMode = true;
    game.waveComplete = true;
    game._bonusScreenStarted = true;
    const events: string[] = [];

    completeWaveBonusAndOpenShop(game, (type) => events.push(type));
    const firstOffers = [...(game._draftOffers ?? [])];
    const firstRngState = getRngState();
    completeWaveBonusAndOpenShop(game, (type) => events.push(type));

    expect(game._bonusScreenDone).toBe(true);
    expect(game._draftOffers).toEqual(firstOffers);
    expect(getRngState()).toBe(firstRngState);
    expect(events).toEqual(["shopOpen"]);
  });

  it.each([0, 240, 1800])("treats a %i-frame bonus dwell as wall-clock time only", (dwellFrames) => {
    setRng(mulberry32(11));
    const game = initGame();
    game.burjHealth = 4;
    game.waveComplete = true;
    game.waveClearedTimer = 0;
    update(game, 1, () => {});
    const before = buildReplayCausalSnapshot(game);

    for (let frame = 0; frame < dwellFrames; frame++) {
      expect(isBonusUiPauseActive(game)).toBe(true);
    }

    expect(buildReplayCausalSnapshot(game)).toEqual(before);
  });

  it("rejects non-positive simulation steps", () => {
    expect(() => update(initGame(), 0)).toThrow(/must be positive/);
    expect(() => update(initGame(), -1)).toThrow(/must be positive/);
  });
});
