import { describe, expect, it } from "vitest";

import {
  bufferPlayerFire,
  consumeBufferedPlayerFire,
  createPlayerFireLimiterState,
  getBufferedPlayerFire,
  getPlayerBurstChargeCount,
  resetPlayerFireLimiter,
  spendPlayerBurstCharge,
  syncPlayerFireLimiter,
} from "./player-fire-limiter.js";

describe("player fire limiter", () => {
  it("starts with no buffered shot", () => {
    const state = createPlayerFireLimiterState();
    expect(getBufferedPlayerFire(state)).toBeNull();
    expect(getPlayerBurstChargeCount(state)).toBe(0);
  });

  it("keeps only the latest buffered shot", () => {
    const state = createPlayerFireLimiterState();
    bufferPlayerFire(state, { x: 100, y: 200 });
    bufferPlayerFire(state, { x: 300, y: 400 });
    expect(consumeBufferedPlayerFire(state)).toEqual({ x: 300, y: 400 });
  });

  it("returns null when there is no buffered shot to consume", () => {
    const state = createPlayerFireLimiterState();
    expect(consumeBufferedPlayerFire(state)).toBeNull();
  });

  it("resets buffered shot state", () => {
    const state = createPlayerFireLimiterState();
    bufferPlayerFire(state, { x: 100, y: 200 });
    syncPlayerFireLimiter(state, 0, 3, 30);
    resetPlayerFireLimiter(state);
    expect(getBufferedPlayerFire(state)).toBeNull();
    expect(getPlayerBurstChargeCount(state)).toBe(0);
  });

  it("clears buffered shot after consume", () => {
    const state = createPlayerFireLimiterState();
    bufferPlayerFire(state, { x: 100, y: 200 });
    expect(consumeBufferedPlayerFire(state)).toEqual({ x: 100, y: 200 });
    expect(getBufferedPlayerFire(state)).toBeNull();
  });

  it("starts each sync cycle with a full burst equal to the active launcher count", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(3);
  });

  it("refills one burst charge at a time", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    expect(spendPlayerBurstCharge(state, 0, 30)).toBe(true);
    expect(spendPlayerBurstCharge(state, 1, 30)).toBe(true);
    expect(spendPlayerBurstCharge(state, 2, 30)).toBe(true);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 29, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 30, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    syncPlayerFireLimiter(state, 60, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
  });

  it("clamps burst capacity when launchers are lost", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    syncPlayerFireLimiter(state, 1, 2, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
  });
});
