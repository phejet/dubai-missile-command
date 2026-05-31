// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountRunRecapDeathClip } from "./run-recap-death-clip";
import type { ReplayData } from "./types";

const mocks = vi.hoisted(() => ({
  rafCallbacks: [] as Array<(time: number) => void>,
  stepTicks: [] as number[],
  pixiOptions: [] as unknown[],
  renderGameplay: vi.fn(),
  destroyRenderer: vi.fn(),
  maxTick: Infinity,
}));

vi.mock("./pixi-render.js", () => ({
  PixiRenderer: class {
    readyPromise = Promise.resolve();

    constructor(_canvas: HTMLCanvasElement, options: unknown) {
      mocks.pixiOptions.push(options);
    }

    renderGameplay(...args: unknown[]) {
      return mocks.renderGameplay(...args);
    }

    destroy() {
      return mocks.destroyRenderer();
    }
  },
}));

vi.mock("./replay.js", () => ({
  createReplayRunner: vi.fn().mockImplementation(() => {
    let tick = 0;
    const state = { state: "playing", _replayTick: 0 };
    return {
      init: () => state,
      step: () => {
        if (tick >= mocks.maxTick) return;
        tick++;
        state._replayTick = tick;
        mocks.stepTicks.push(tick);
      },
      getState: () => state,
      getTick: () => tick,
      isFinished: () => tick >= mocks.maxTick,
      isShopPaused: () => false,
      isBonusPaused: () => false,
      resumeFromShop: vi.fn(),
      resumeFromBonusScreen: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

function flushTasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      void Promise.resolve().then(() => resolve());
    }, 0);
  });
}

function runNextRaf(time = 16): void {
  const callbacks = mocks.rafCallbacks.splice(0);
  callbacks.forEach((callback) => callback(time));
}

describe("run recap death clip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.rafCallbacks.length = 0;
    mocks.stepTicks.length = 0;
    mocks.pixiOptions.length = 0;
    mocks.maxTick = Infinity;
    mocks.renderGameplay.mockClear();
    mocks.destroyRenderer.mockClear();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: (time: number) => void) => {
        mocks.rafCallbacks.push(callback);
        return mocks.rafCallbacks.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("yields before seeking the death clip start tick", async () => {
    const container = document.createElement("div");
    const replay: ReplayData = { seed: 7, actions: [], finalTick: 1200, isHuman: true };

    const cleanup = mountRunRecapDeathClip(container, replay);
    await flushTasks();

    expect(container.querySelector(".run-recap__death-canvas")).not.toBeNull();
    expect(container.querySelector(".run-recap__death-status")?.textContent).toMatch(/preparing/i);
    expect(mocks.stepTicks).toHaveLength(0);

    runNextRaf();
    await Promise.resolve();

    expect(mocks.stepTicks.length).toBeGreaterThan(0);
    expect(mocks.stepTicks.length).toBeLessThan(900);
    expect((container.querySelector(".run-recap__death-canvas") as HTMLCanvasElement).dataset.clipSeekTick).toBe(
      String(mocks.stepTicks[mocks.stepTicks.length - 1]),
    );

    cleanup();
  });

  it("does not stay stuck preparing when the seek target is unreachable", async () => {
    mocks.maxTick = 40;
    const container = document.createElement("div");
    const replay: ReplayData = { seed: 7, actions: [], finalTick: 1200, isHuman: true };

    const cleanup = mountRunRecapDeathClip(container, replay);
    await flushTasks();

    runNextRaf();
    await flushTasks();

    const canvas = container.querySelector(".run-recap__death-canvas") as HTMLCanvasElement;
    expect(canvas.dataset.clipStatus).toBe("playing");
    expect(container.querySelector(".run-recap__death-status")).toHaveProperty("hidden", true);
    expect(mocks.renderGameplay).toHaveBeenCalled();

    cleanup();
  });

  it("does not request a preserved WebGL buffer for the inline clip", async () => {
    const container = document.createElement("div");
    const replay: ReplayData = { seed: 7, actions: [], finalTick: 20, isHuman: true };

    const cleanup = mountRunRecapDeathClip(container, replay);
    await flushTasks();

    expect(mocks.pixiOptions).toContainEqual({ preserveDrawingBuffer: false });

    cleanup();
  });
});
