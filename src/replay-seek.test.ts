import { describe, expect, it } from "vitest";
import { initGame } from "./game-sim.js";
import { seekRunnerToTick, type SeekSignal, type SeekableReplayRunner } from "./replay-seek.js";
import type { GameState } from "./types.js";

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
