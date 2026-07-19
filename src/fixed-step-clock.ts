export const SIMULATION_HZ = 60;
export const SIMULATION_TICK_MS = 1000 / SIMULATION_HZ;
export const MAX_FRAME_TICKS = 3;

export function accumulateFixedTicks(currentTicks: number, elapsedMs: number): number {
  const safeCurrent = Number.isFinite(currentTicks) && currentTicks > 0 ? currentTicks : 0;
  const safeElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return safeCurrent + Math.min(safeElapsed / SIMULATION_TICK_MS, MAX_FRAME_TICKS);
}
