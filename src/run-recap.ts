import { cloneDestroyedByTypeStats, normalizeGameStats } from "./game-logic.js";
import type {
  GameState,
  OutcomeCause,
  ReplayData,
  RunRecapData,
  ShopAction,
  UpgradeTimelineEntry,
  WaveSummaryRecord,
} from "./types.js";

const TICK_MS = 1000 / 60;

export function deriveOutcomeCause(game: GameState): OutcomeCause {
  if (!game.burjAlive) return "burj_destroyed";
  if (game.state === "gameover") return "survived";
  return "abandoned";
}

function cloneWaveSummary(summary: WaveSummaryRecord): WaveSummaryRecord {
  return {
    ...summary,
    destroyedByType: cloneDestroyedByTypeStats(summary.destroyedByType),
  };
}

function inferWaveForTick(tick: number, waves: WaveSummaryRecord[], fallbackWave: number): number {
  const direct = waves.find((wave) => tick >= wave.startTick && tick <= wave.endTick);
  if (direct) return direct.wave;
  const completedBefore = [...waves].reverse().find((wave) => tick >= wave.endTick);
  return completedBefore?.wave ?? fallbackWave;
}

export function extractUpgradeTimeline(
  actionLog: GameState["_actionLog"] | ReplayData["actions"] | undefined,
  waveSummaries: WaveSummaryRecord[],
  fallbackWave = 1,
): UpgradeTimelineEntry[] {
  if (!actionLog) return [];
  return actionLog
    .filter((action): action is ShopAction => action.type === "shop" && Array.isArray((action as ShopAction).bought))
    .filter((action) => action.bought.length > 0)
    .map((action) => ({
      tick: action.tick,
      wave: typeof action.wave === "number" ? action.wave : inferWaveForTick(action.tick, waveSummaries, fallbackWave),
      bought: [...action.bought],
    }));
}

export function buildRunRecapData(game: GameState, replay: ReplayData | null): RunRecapData {
  const totalStats = normalizeGameStats(game.stats);
  const totalKills = totalStats.missileKills + totalStats.droneKills;
  const tick = replay?.finalTick ?? game._replayTick ?? 0;
  const waves = (game._waveSummaries ?? []).map(cloneWaveSummary);
  return {
    score: game.score,
    wave: game.wave,
    timePlayedMs: Math.max(0, Math.round(tick * TICK_MS)),
    hitRatio: totalStats.shotsFired > 0 ? totalKills / totalStats.shotsFired : 0,
    burjHealth: Math.max(0, game.burjHealth),
    outcome: deriveOutcomeCause(game),
    totalStats,
    waves,
    upgrades: extractUpgradeTimeline(game._actionLog ?? replay?.actions, waves, game.wave),
    hasReplay: replay !== null,
    replayId: replay?.replayId,
  };
}
