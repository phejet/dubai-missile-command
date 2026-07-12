import { describe, expect, it, vi } from "vitest";
import { createAudioNodeLifecycle } from "./audio-node-lifecycle";

describe("audio node lifecycle", () => {
  it("disconnects and releases transient nodes after the TTL", () => {
    vi.useFakeTimers();
    const lifecycle = createAudioNodeLifecycle(undefined, 3000);
    const node = { disconnect: vi.fn() };

    lifecycle.track(node);
    expect(lifecycle.getTrackedCount()).toBe(1);

    vi.advanceTimersByTime(2999);
    expect(node.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(lifecycle.getTrackedCount()).toBe(0);
    vi.useRealTimers();
  });

  it("clears every retained node immediately", () => {
    const callbacks: Array<() => void> = [];
    const lifecycle = createAudioNodeLifecycle((callback) => callbacks.push(callback));
    const nodes = [{ disconnect: vi.fn() }, { disconnect: vi.fn() }];
    nodes.forEach((node) => lifecycle.track(node));

    lifecycle.clear();

    expect(lifecycle.getTrackedCount()).toBe(0);
    expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
    callbacks.forEach((callback) => callback());
    expect(nodes.every((node) => node.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
