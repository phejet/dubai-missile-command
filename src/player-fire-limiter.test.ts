import { describe, expect, it } from "vitest";

import {
  bufferPlayerFire,
  consumeBufferedPlayerFire,
  createPlayerFireLimiterState,
  isPlayerFireReady,
  markPlayerFireFired,
  resetPlayerFireLimiter,
} from "./player-fire-limiter.js";

describe("player fire limiter", () => {
  it("starts ready", () => {
    const state = createPlayerFireLimiterState();
    expect(isPlayerFireReady(state, 0)).toBe(true);
  });

  it("blocks until the cooldown expires after a shot", () => {
    const state = createPlayerFireLimiterState();
    markPlayerFireFired(state, 12);
    expect(isPlayerFireReady(state, 31)).toBe(false);
    expect(isPlayerFireReady(state, 32)).toBe(true);
  });

  it("keeps only the latest buffered shot", () => {
    const state = createPlayerFireLimiterState();
    markPlayerFireFired(state, 10);
    bufferPlayerFire(state, { x: 100, y: 200 });
    bufferPlayerFire(state, { x: 300, y: 400 });
    expect(consumeBufferedPlayerFire(state, 29)).toBeNull();
    expect(consumeBufferedPlayerFire(state, 30)).toEqual({ x: 300, y: 400 });
  });

  it("clears any buffered shot when a real shot fires", () => {
    const state = createPlayerFireLimiterState();
    bufferPlayerFire(state, { x: 100, y: 200 });
    markPlayerFireFired(state, 4);
    expect(consumeBufferedPlayerFire(state, 10)).toBeNull();
  });

  it("resets cooldown and buffer together", () => {
    const state = createPlayerFireLimiterState();
    markPlayerFireFired(state, 4);
    bufferPlayerFire(state, { x: 100, y: 200 });
    resetPlayerFireLimiter(state);
    expect(isPlayerFireReady(state, 4)).toBe(true);
    expect(consumeBufferedPlayerFire(state, 4)).toBeNull();
  });
});
