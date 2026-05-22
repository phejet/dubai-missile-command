import { describe, expect, it } from "vitest";

import {
  createFireChargeState,
  getFireChargeCount,
  resetFireChargeState,
  spendFireCharge,
  syncFireChargeState,
} from "./player-fire-limiter.js";

describe("fire charge state", () => {
  it("starts with no charges", () => {
    const state = createFireChargeState();
    expect(getFireChargeCount(state)).toBe(0);
  });

  it("resets charge state", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    resetFireChargeState(state);
    expect(getFireChargeCount(state)).toBe(0);
  });

  it("starts each sync cycle with a full burst equal to the active launcher count", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    expect(getFireChargeCount(state)).toBe(3);
  });

  it("refills the burst pool with a 30/10/5 catchup curve when the player holds fire", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    expect(spendFireCharge(state, 2, 30)).toBe(true);
    expect(spendFireCharge(state, 2, 30)).toBe(true);
    expect(spendFireCharge(state, 2, 30)).toBe(true);
    expect(getFireChargeCount(state)).toBe(0);
    // First recharge takes the base 30 ticks (last spend at tick 2, so arrives at tick 32).
    syncFireChargeState(state, 31, 3, 30);
    expect(getFireChargeCount(state)).toBe(0);
    syncFireChargeState(state, 32, 3, 30);
    expect(getFireChargeCount(state)).toBe(1);
    // Second recharge takes only 10 ticks (catchup, streak=1).
    syncFireChargeState(state, 41, 3, 30);
    expect(getFireChargeCount(state)).toBe(1);
    syncFireChargeState(state, 42, 3, 30);
    expect(getFireChargeCount(state)).toBe(2);
    // Third recharge takes only 5 ticks (catchup, streak=2). Pool full at tick 47.
    syncFireChargeState(state, 46, 3, 30);
    expect(getFireChargeCount(state)).toBe(2);
    syncFireChargeState(state, 47, 3, 30);
    expect(getFireChargeCount(state)).toBe(3);
  });

  it("refills rapid reload bursts with an 18/6/3 catchup curve", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 18);
    expect(spendFireCharge(state, 2, 18)).toBe(true);
    expect(spendFireCharge(state, 2, 18)).toBe(true);
    expect(spendFireCharge(state, 2, 18)).toBe(true);
    syncFireChargeState(state, 19, 3, 18);
    expect(getFireChargeCount(state)).toBe(0);
    syncFireChargeState(state, 20, 3, 18);
    expect(getFireChargeCount(state)).toBe(1);
    syncFireChargeState(state, 25, 3, 18);
    expect(getFireChargeCount(state)).toBe(1);
    syncFireChargeState(state, 26, 3, 18);
    expect(getFireChargeCount(state)).toBe(2);
    syncFireChargeState(state, 28, 3, 18);
    expect(getFireChargeCount(state)).toBe(2);
    syncFireChargeState(state, 29, 3, 18);
    expect(getFireChargeCount(state)).toBe(3);
  });

  it("supports doubled burst capacity from the caller", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 6, 30);
    expect(getFireChargeCount(state)).toBe(6);
  });

  it("resets the catchup streak when the player fires mid-refill", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    spendFireCharge(state, 0, 30);
    spendFireCharge(state, 0, 30);
    spendFireCharge(state, 0, 30);
    // First charge returns at tick 30 (catchup armed for 20 ticks later).
    syncFireChargeState(state, 30, 3, 30);
    expect(getFireChargeCount(state)).toBe(1);
    // Player fires before the catchup pays out; next recharge resets to base rate.
    spendFireCharge(state, 30, 30);
    expect(getFireChargeCount(state)).toBe(0);
    syncFireChargeState(state, 59, 3, 30);
    expect(getFireChargeCount(state)).toBe(0);
    syncFireChargeState(state, 60, 3, 30);
    expect(getFireChargeCount(state)).toBe(1);
  });

  it("keeps sustained tap-spam at one shot per base recharge tick", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    // Burn the burst.
    spendFireCharge(state, 0, 30);
    spendFireCharge(state, 0, 30);
    spendFireCharge(state, 0, 30);
    // Player taps as fast as charges return — sustained should stay at one per 30 ticks.
    let tick = 30;
    let shotsFired = 0;
    for (let i = 0; i < 5; i++) {
      syncFireChargeState(state, tick, 3, 30);
      expect(getFireChargeCount(state)).toBe(1);
      expect(spendFireCharge(state, tick, 30)).toBe(true);
      shotsFired++;
      tick += 30;
    }
    expect(shotsFired).toBe(5);
  });

  it("clamps burst capacity when launchers are lost", () => {
    const state = createFireChargeState();
    syncFireChargeState(state, 0, 3, 30);
    syncFireChargeState(state, 1, 2, 30);
    expect(getFireChargeCount(state)).toBe(2);
  });
});
