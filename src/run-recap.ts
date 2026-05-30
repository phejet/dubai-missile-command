import { cloneDestroyedByTypeStats, normalizeGameStats } from "./game-logic.js";
import type {
  GameState,
  GameStats,
  OutcomeCause,
  ReplayData,
  ReplayAction,
  RunRecapData,
  RunRecapWaveCard,
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

function extractWaveStartTicks(
  actionLog: GameState["_actionLog"] | ReplayData["actions"] | undefined,
): Map<number, number> {
  const ticks = new Map<number, number>();
  if (!actionLog) return ticks;
  for (const action of actionLog as ReplayAction[]) {
    if (action.type !== "wave_plan" || typeof action.wave !== "number") continue;
    if (ticks.has(action.wave)) continue;
    ticks.set(action.wave, action.tick);
  }
  return ticks;
}

function aggregateBoughtByWave(upgrades: UpgradeTimelineEntry[]): Map<number, string[]> {
  const byWave = new Map<number, string[]>();
  for (const entry of upgrades) {
    const list = byWave.get(entry.wave) ?? [];
    list.push(...entry.bought);
    byWave.set(entry.wave, list);
  }
  return byWave;
}

function sumWaveStats(waves: WaveSummaryRecord[]) {
  return waves.reduce(
    (sum, wave) => {
      sum.scoreEarned += wave.scoreEarned;
      sum.missileKills += wave.missileKills;
      sum.droneKills += wave.droneKills;
      sum.multiShots += wave.multiShots;
      return sum;
    },
    { scoreEarned: 0, missileKills: 0, droneKills: 0, multiShots: 0 },
  );
}

export function buildRunRecapWaveCards({
  score,
  wave,
  burjHealth,
  totalStats,
  waves,
  upgrades,
  actionLog,
  fallbackStartTick = 0,
  finalTick = 0,
}: {
  score: number;
  wave: number;
  burjHealth: number;
  totalStats: GameStats;
  waves: WaveSummaryRecord[];
  upgrades: UpgradeTimelineEntry[];
  actionLog?: GameState["_actionLog"] | ReplayData["actions"];
  fallbackStartTick?: number;
  finalTick?: number;
}): RunRecapWaveCard[] {
  const boughtByWave = aggregateBoughtByWave(upgrades);
  const completed = sumWaveStats(waves);
  const lastCompletedWave = waves.length > 0 ? waves[waves.length - 1].wave : 0;
  const cards: RunRecapWaveCard[] = waves.map((summary) => ({
    wave: summary.wave,
    scoreEarned: summary.scoreEarned,
    missileKills: summary.missileKills,
    droneKills: summary.droneKills,
    multiShots: summary.multiShots,
    maxCombo: summary.maxCombo,
    buildingsSurviving: summary.buildingsSurviving,
    burjHealth: summary.burjHealth,
    startTick: summary.startTick,
    endTick: summary.endTick,
    terminal: false,
    bought: boughtByWave.get(summary.wave) ?? [],
  }));

  if (wave > lastCompletedWave) {
    const waveStartTicks = extractWaveStartTicks(actionLog);
    cards.push({
      wave,
      scoreEarned: Math.max(0, score - completed.scoreEarned),
      missileKills: Math.max(0, totalStats.missileKills - completed.missileKills),
      droneKills: Math.max(0, totalStats.droneKills - completed.droneKills),
      multiShots: Math.max(0, totalStats.multiShots - completed.multiShots),
      maxCombo: totalStats.maxCombo,
      buildingsSurviving: 0,
      burjHealth: Math.max(0, burjHealth),
      startTick: waveStartTicks.get(wave) ?? fallbackStartTick,
      endTick: finalTick,
      terminal: true,
      bought: boughtByWave.get(wave) ?? [],
    });
  }

  return cards;
}

export function buildRunRecapData(game: GameState, replay: ReplayData | null): RunRecapData {
  const totalStats = normalizeGameStats(game.stats);
  const totalKills = totalStats.missileKills + totalStats.droneKills;
  const tick = replay?.finalTick ?? game._replayTick ?? 0;
  const waves = (game._waveSummaries ?? []).map(cloneWaveSummary);
  const actionLog = game._actionLog ?? replay?.actions;
  const upgrades = extractUpgradeTimeline(actionLog, waves, game.wave);
  return {
    score: game.score,
    wave: game.wave,
    timePlayedMs: Math.max(0, Math.round(tick * TICK_MS)),
    hitRatio: totalStats.shotsFired > 0 ? totalKills / totalStats.shotsFired : 0,
    burjHealth: Math.max(0, game.burjHealth),
    outcome: deriveOutcomeCause(game),
    totalStats,
    waves,
    waveCards: buildRunRecapWaveCards({
      score: game.score,
      wave: game.wave,
      burjHealth: game.burjHealth,
      totalStats,
      waves,
      upgrades,
      actionLog,
      fallbackStartTick: game._waveStartTick ?? 0,
      finalTick: tick,
    }),
    upgrades,
    hasReplay: replay !== null,
    replayId: replay?.replayId,
  };
}
