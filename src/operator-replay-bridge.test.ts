// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { replayFixture } from "../test-fixtures/capture";
import {
  OPERATOR_REPLAY_LOAD,
  OPERATOR_REPLAY_READY,
  installOperatorReplayReceiver,
  isReplayData,
} from "./operator-replay-bridge";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "opener", { configurable: true, value: null });
});

describe("operator replay bridge", () => {
  it("accepts only replay-shaped payloads", () => {
    expect(isReplayData(replayFixture())).toBe(true);
    expect(isReplayData({ seed: 1, actions: "nope" })).toBe(false);
    expect(isReplayData(null)).toBe(false);
  });

  it("loads one same-origin replay from the window that opened it", async () => {
    window.history.replaceState({}, "", "/?operatorReplay=1");
    const source = { postMessage: vi.fn() };
    Object.defineProperty(window, "opener", { configurable: true, value: source });
    const loadReplay = vi.fn(async () => undefined);
    expect(installOperatorReplayReceiver(loadReplay)).toBe(true);
    expect(source.postMessage).toHaveBeenCalledWith({ type: OPERATOR_REPLAY_READY }, window.location.origin);

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: source as unknown as Window,
        data: { type: OPERATOR_REPLAY_LOAD, replay: replayFixture() },
      }),
    );
    await Promise.resolve();
    expect(loadReplay).toHaveBeenCalledOnce();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: source as unknown as Window,
        data: { type: OPERATOR_REPLAY_LOAD, replay: replayFixture() },
      }),
    );
    expect(loadReplay).toHaveBeenCalledOnce();
  });
});
