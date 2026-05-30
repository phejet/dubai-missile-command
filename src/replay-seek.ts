import type { GameState } from "./types.js";

export interface SeekSignal {
  cancelled: boolean;
}

export interface SeekResult {
  reached: boolean;
  finalTick: number;
}

export interface SeekableReplayRunner {
  step(): void;
  getState(): GameState | null;
  getTick(): number;
  isFinished(): boolean;
  isShopPaused(): boolean;
  resumeFromShop(): void;
  isBonusPaused(): boolean;
  resumeFromBonusScreen(): void;
}

export const SEEK_MAX_STEPS_PER_FRAME = 240;
export const SEEK_FRAME_BUDGET_MS = 7;

function nextFrame(): Promise<number> {
  if (typeof requestAnimationFrame === "function") {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return new Promise((resolve) => setTimeout(() => resolve(performance.now()), 0));
}

function resumeIfPaused(runner: SeekableReplayRunner): void {
  if (runner.isBonusPaused()) {
    const state = runner.getState();
    if (state) state._bonusScreenDone = true;
    runner.resumeFromBonusScreen();
  }
  if (runner.isShopPaused()) runner.resumeFromShop();
}

export async function seekRunnerToTick(
  runner: SeekableReplayRunner,
  targetTick: number,
  signal: SeekSignal,
  onProgress?: (tick: number) => void,
): Promise<SeekResult> {
  if (targetTick <= 0 || runner.getTick() >= targetTick) {
    return { reached: true, finalTick: runner.getTick() };
  }

  while (!signal.cancelled && !runner.isFinished() && runner.getTick() < targetTick) {
    await nextFrame();
    if (signal.cancelled) break;

    const frameStart = performance.now();
    let frameSteps = 0;
    while (
      !signal.cancelled &&
      !runner.isFinished() &&
      runner.getTick() < targetTick &&
      frameSteps < SEEK_MAX_STEPS_PER_FRAME &&
      performance.now() - frameStart < SEEK_FRAME_BUDGET_MS
    ) {
      resumeIfPaused(runner);
      if (!runner.isShopPaused() && !runner.isBonusPaused()) runner.step();
      frameSteps++;
    }
    onProgress?.(runner.getTick());
  }

  const finalTick = runner.getTick();
  return { reached: !signal.cancelled && finalTick >= targetTick, finalTick };
}
