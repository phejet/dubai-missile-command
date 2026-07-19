import type { ReplayData } from "./types";

export interface ReplayWaveStart {
  tick: number;
  wave: number;
}

export function extractReplayWaveStarts(replay: ReplayData): ReplayWaveStart[] {
  const ticksByWave = new Map<number, number>();

  for (const action of replay.actions ?? []) {
    if (action.type !== "wave_plan" || !Number.isFinite(action.wave) || !Number.isFinite(action.tick)) continue;
    if (!ticksByWave.has(action.wave)) ticksByWave.set(action.wave, Math.max(0, Math.floor(action.tick)));
  }

  for (const checkpoint of replay.checkpoints ?? []) {
    const isWaveStart =
      checkpoint.reason === "start" ||
      checkpoint.reason?.startsWith("debugStart:") === true ||
      checkpoint.reason?.startsWith("waveStart:") === true;
    if (!isWaveStart || ticksByWave.has(checkpoint.wave)) continue;
    ticksByWave.set(checkpoint.wave, Math.max(0, Math.floor(checkpoint.tick)));
  }

  return [...ticksByWave.entries()]
    .map(([wave, tick]) => ({ wave, tick }))
    .sort((a, b) => a.tick - b.tick || a.wave - b.wave);
}

export function findPreviousReplayWaveStart(
  waveStarts: ReplayWaveStart[],
  currentTick: number,
): ReplayWaveStart | null {
  for (let index = waveStarts.length - 1; index >= 0; index--) {
    if (waveStarts[index].tick < currentTick) return waveStarts[index];
  }
  return null;
}

export function findNextReplayWaveStart(waveStarts: ReplayWaveStart[], currentTick: number): ReplayWaveStart | null {
  return waveStarts.find((start) => start.tick > currentTick) ?? null;
}
