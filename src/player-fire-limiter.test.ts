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

  it("refills the burst pool with a 30/10/5 catchup curve when the player holds fire", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    expect(spendPlayerBurstCharge(state, 2, 30)).toBe(true);
    expect(spendPlayerBurstCharge(state, 2, 30)).toBe(true);
    expect(spendPlayerBurstCharge(state, 2, 30)).toBe(true);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    // First recharge takes the base 30 ticks (last spend at tick 2, so arrives at tick 32).
    syncPlayerFireLimiter(state, 31, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 32, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    // Second recharge takes only 10 ticks (catchup, streak=1).
    syncPlayerFireLimiter(state, 41, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    syncPlayerFireLimiter(state, 42, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
    // Third recharge takes only 5 ticks (catchup, streak=2). Pool full at tick 47.
    syncPlayerFireLimiter(state, 46, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
    syncPlayerFireLimiter(state, 47, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(3);
  });

  it("refills rapid reload bursts with an 18/6/3 catchup curve", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 18);
    expect(spendPlayerBurstCharge(state, 2, 18)).toBe(true);
    expect(spendPlayerBurstCharge(state, 2, 18)).toBe(true);
    expect(spendPlayerBurstCharge(state, 2, 18)).toBe(true);
    syncPlayerFireLimiter(state, 19, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 20, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    syncPlayerFireLimiter(state, 25, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    syncPlayerFireLimiter(state, 26, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
    syncPlayerFireLimiter(state, 28, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
    syncPlayerFireLimiter(state, 29, 3, 18);
    expect(getPlayerBurstChargeCount(state)).toBe(3);
  });

  it("supports doubled burst capacity from the caller", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 6, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(6);
  });

  it("resets the catchup streak when the player fires mid-refill", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    spendPlayerBurstCharge(state, 0, 30);
    spendPlayerBurstCharge(state, 0, 30);
    spendPlayerBurstCharge(state, 0, 30);
    // First charge returns at tick 30 (catchup armed for 20 ticks later).
    syncPlayerFireLimiter(state, 30, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
    // Player fires before the catchup pays out; next recharge resets to base rate.
    spendPlayerBurstCharge(state, 30, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 59, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(0);
    syncPlayerFireLimiter(state, 60, 3, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(1);
  });

  it("keeps sustained tap-spam at one shot per base recharge tick", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    // Burn the burst.
    spendPlayerBurstCharge(state, 0, 30);
    spendPlayerBurstCharge(state, 0, 30);
    spendPlayerBurstCharge(state, 0, 30);
    // Player taps as fast as charges return — sustained should stay at one per 30 ticks.
    let tick = 30;
    let shotsFired = 0;
    for (let i = 0; i < 5; i++) {
      syncPlayerFireLimiter(state, tick, 3, 30);
      expect(getPlayerBurstChargeCount(state)).toBe(1);
      expect(spendPlayerBurstCharge(state, tick, 30)).toBe(true);
      shotsFired++;
      tick += 30;
    }
    expect(shotsFired).toBe(5);
  });

  it("clamps burst capacity when launchers are lost", () => {
    const state = createPlayerFireLimiterState();
    syncPlayerFireLimiter(state, 0, 3, 30);
    syncPlayerFireLimiter(state, 1, 2, 30);
    expect(getPlayerBurstChargeCount(state)).toBe(2);
  });
});
