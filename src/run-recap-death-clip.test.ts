// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountRunRecapDeathClip } from "./run-recap-death-clip";
import type { ReplayData, ReplayStateAnchor } from "./types";

const mocks = vi.hoisted(() => {
  const state = {
    anchorTicks: [] as number[],
    createRunner(_startTick?: number) {
      void _startTick;
      return {};
    },
    destroyRenderer: vi.fn(),
    maxTick: Infinity,
    pixiOptions: [] as unknown[],
    rafCallbacks: [] as Array<(time: number) => void>,
    renderGameplay: vi.fn(),
    stepTicks: [] as number[],
  };
  state.createRunner = (startTick = 0) => {
    let tick = startTick;
    const gameState = { state: "playing", _replayTick: startTick };
    return {
      cleanup: vi.fn(),
      getState: () => gameState,
      getTick: () => tick,
      init: () => gameState,
      isBonusPaused: () => false,
      isFinished: () => tick >= state.maxTick,
      isShopPaused: () => false,
      resumeFromBonusScreen: vi.fn(),
      resumeFromShop: vi.fn(),
      step: () => {
        if (tick >= state.maxTick) return;
        tick++;
        gameState._replayTick = tick;
        state.stepTicks.push(tick);
      },
    };
  };
  return state;
});

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
  createReplayRunner: vi.fn().mockImplementation(() => mocks.createRunner(0)),
  createReplayRunnerFromAnchor: vi.fn().mockImplementation((_replay: ReplayData, anchor: ReplayStateAnchor) => {
    mocks.anchorTicks.push(anchor.tick);
    return mocks.createRunner(anchor.tick);
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
    mocks.anchorTicks.length = 0;
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
    const replay: ReplayData = { version: 5, seed: 7, actions: [], finalTick: 1200, isHuman: true };

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
    const replay: ReplayData = { version: 5, seed: 7, actions: [], finalTick: 1200, isHuman: true };

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

  it("uses inline Pixi options that avoid expensive buffers and the default title frame", async () => {
    const container = document.createElement("div");
    const replay: ReplayData = { version: 5, seed: 7, actions: [], finalTick: 20, isHuman: true };

    const cleanup = mountRunRecapDeathClip(container, replay);
    await flushTasks();

    expect(mocks.pixiOptions).toContainEqual(
      expect.objectContaining({ preserveDrawingBuffer: false, renderInitialFrame: false }),
    );

    cleanup();
  });

  it("starts seeking from a provided replay anchor", async () => {
    const container = document.createElement("div");
    const replay: ReplayData = { version: 5, seed: 7, actions: [], finalTick: 1200, isHuman: true };
    const anchor = {
      rngState: 123,
      state: { state: "playing", _replayTick: 500 },
      tick: 500,
      wave: 3,
    } as ReplayStateAnchor;

    const cleanup = mountRunRecapDeathClip(container, replay, { anchor });
    await flushTasks();

    runNextRaf();
    await Promise.resolve();

    expect(mocks.anchorTicks).toEqual([500]);
    expect(mocks.stepTicks[0]).toBeGreaterThan(500);
    expect((container.querySelector(".run-recap__death-canvas") as HTMLCanvasElement).dataset.clipSeekTick).toBe(
      String(mocks.stepTicks[mocks.stepTicks.length - 1]),
    );

    cleanup();
  });

  it("holds the completed frame instead of automatically seeking again", async () => {
    const container = document.createElement("div");
    const replay: ReplayData = { version: 5, seed: 7, actions: [], finalTick: 2, isHuman: true };

    const cleanup = mountRunRecapDeathClip(container, replay);
    await flushTasks();

    runNextRaf(16);
    await flushTasks();
    runNextRaf(60);
    await flushTasks();
    runNextRaf(110);
    await flushTasks();
    runNextRaf(160);
    await flushTasks();
    runNextRaf(190);
    await flushTasks();
    runNextRaf(270);
    await flushTasks();

    const canvas = container.querySelector(".run-recap__death-canvas") as HTMLCanvasElement;
    const stepsAfterComplete = mocks.stepTicks.length;

    expect(canvas.dataset.clipStatus).toBe("complete");
    expect(container.querySelector(".run-recap__death-status")).toHaveProperty("hidden", true);
    expect(mocks.rafCallbacks).toHaveLength(0);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(canvas.dataset.clipStatus).toBe("complete");
    expect(container.querySelector(".run-recap__death-status")).toHaveProperty("hidden", true);
    expect(mocks.stepTicks).toHaveLength(stepsAfterComplete);

    cleanup();
  });
});
