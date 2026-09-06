import { describe, expect, it } from "vitest";
import { initGame } from "./game-sim";
import { seekRunnerToTick, type SeekSignal, type SeekableReplayRunner } from "./replay-seek";
import type { GameState } from "./types";
import { runGame } from "./headless/sim-runner";
import { createReplayRunner } from "./replay";
import type { ReplayData, ReplayEventMap } from "./types";

class FakeRunner implements SeekableReplayRunner {
  tick = 0;
  finished = false;
  shopPaused = false;
  bonusPaused = false;
  game: GameState = initGame();

  constructor(
    private readonly maxTick = Infinity,
    private readonly pauseTicks: Partial<Record<number, "shop" | "bonus">> = {},
  ) {}

  step(): void {
    const pause = this.pauseTicks[this.tick];
    if (pause === "shop") {
      this.shopPaused = true;
      return;
    }
    if (pause === "bonus") {
      this.bonusPaused = true;
      this.game._bonusScreenDone = false;
      return;
    }
    this.tick++;
    this.game._replayTick = this.tick;
    if (this.tick >= this.maxTick) this.finished = true;
  }

  getState(): GameState | null {
    return this.game;
  }

  getTick(): number {
    return this.tick;
  }

  isFinished(): boolean {
    return this.finished;
  }

  isShopPaused(): boolean {
    return this.shopPaused;
  }

  resumeFromShop(): void {
    this.shopPaused = false;
    this.tick++;
  }

  isBonusPaused(): boolean {
    return this.bonusPaused;
  }

  resumeFromBonusScreen(): void {
    if (!this.game._bonusScreenDone) return;
    this.bonusPaused = false;
    this.tick++;
  }
}

describe("seekRunnerToTick", () => {
  it("seeks a recorded human run through the bonus and shop without checkpoint divergence", async () => {
    const result = runGame(null, {
      seed: 1481412993,
      record: true,
      draftMode: true,
      isHuman: true,
      stopCondition: { type: "waveComplete", wave: 3 },
      checkpoints: true,
    });
    const replay: ReplayData = {
      version: result.version!,
      seed: result.seed,
      actions: result.actions!,
      initialState: result.initialState!,
      draftMode: true,
      isHuman: true,
      stopCondition: { type: "waveComplete", wave: 3 },
      checkpoints: result.checkpoints,
    };
    const target = replay.actions.find((action) => action.type === "wave_plan" && action.wave === 2)!;
    expect(target).toBeDefined();
    const divergences: ReplayEventMap["replay_divergence"][] = [];
    const runner = createReplayRunner(replay, null, (type, data) => {
      if (type === "replay_divergence") divergences.push(data as ReplayEventMap["replay_divergence"]);
    });
    runner.init();
    try {
      await seekRunnerToTick(runner, target.tick, { cancelled: false });
      expect(runner.getTick()).toBe(target.tick);
      expect(runner.getState()!.wave).toBe(2);
      expect(runner.getState()!.state).toBe("playing");
      await seekRunnerToTick(runner, target.tick + 120, { cancelled: false });
      expect(divergences).toEqual([]);
      expect(runner.getState()!.wave).toBe(2);
    } finally {
      runner.cleanup();
    }
  });

  it("reaches the target across shop and bonus pauses", async () => {
    const runner = new FakeRunner(Infinity, { 2: "bonus", 5: "shop" });

    const result = await seekRunnerToTick(runner, 8, { cancelled: false });

    expect(result).toEqual({ reached: true, finalTick: 8 });
    expect(runner.isBonusPaused()).toBe(false);
    expect(runner.isShopPaused()).toBe(false);
  });

  it("resolves at the current tick when cancelled between batches", async () => {
    const runner = new FakeRunner();
    const signal: SeekSignal = { cancelled: false };

    const result = await seekRunnerToTick(runner, 1000, signal, () => {
      signal.cancelled = true;
    });

    expect(result.reached).toBe(false);
    expect(result.finalTick).toBeGreaterThan(0);
    expect(result.finalTick).toBeLessThan(1000);
  });

  it("reports unreachable targets", async () => {
    const runner = new FakeRunner(5);

    const result = await seekRunnerToTick(runner, 10, { cancelled: false });

    expect(result).toEqual({ reached: false, finalTick: 5 });
  });
});
