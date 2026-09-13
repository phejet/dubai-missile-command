import { createReplayRunner } from "./replay";
import { seekRunnerToTick, type SeekSignal } from "./replay-seek";
import { buildRunRecapData } from "./run-recap";
import { CURRENT_REPLAY_VERSION } from "./replay-version";
import { SIMULATION_HZ, SIMULATION_TICK_MS } from "./fixed-step-clock";
import { DESTROYED_TYPES, type OperatorSessionDetail } from "./operator-contract";
import type { ReplayData, RunRecapData } from "./types";

export const DURATION_TOLERANCE_MS = Math.ceil(SIMULATION_TICK_MS);
export const HIT_RATIO_EPSILON = 1e-9;
export const TERMINAL_LEAD_IN_TICKS = 10 * SIMULATION_HZ;
export interface TimelineItem {
  tick: number;
  wave: number;
  seconds: number;
  label: string;
  seekToTick: number;
}
export interface ConsistencyDifference {
  field: string;
  expected: unknown;
  derived: unknown;
}
export interface ReplayInspection {
  recap: RunRecapData;
  finalTick: number;
  timeline: TimelineItem[];
  differences: ConsistencyDifference[];
  status: "matches summary" | "mismatch";
}
export function compareSummary(stored: OperatorSessionDetail, recap: RunRecapData): ConsistencyDifference[] {
  const derived = {
    score: recap.score,
    wave: recap.wave,
    outcome: recap.outcome,
    burjHealth: recap.burjHealth,
    shotsFired: recap.totalStats.shotsFired,
    totalKills: recap.totalStats.missileKills + recap.totalStats.droneKills,
    multiShots: recap.totalStats.multiShots,
    maxCombo: recap.totalStats.maxCombo,
  };
  const differences: ConsistencyDifference[] = [];
  const compare = (field: string, expected: unknown, actual: unknown, equal = expected === actual) => {
    if (!equal) differences.push({ field, expected, derived: actual });
  };
  for (const key of Object.keys(derived) as (keyof typeof derived)[]) compare(key, stored[key], derived[key]);
  compare(
    "timePlayedMs",
    stored.timePlayedMs,
    recap.timePlayedMs,
    Math.abs(stored.timePlayedMs - recap.timePlayedMs) <= DURATION_TOLERANCE_MS,
  );
  const ratio = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : NaN);
  compare(
    "hitRatio",
    stored.hitRatio,
    recap.hitRatio,
    Math.abs(ratio(stored.hitRatio) - ratio(recap.hitRatio)) <= HIT_RATIO_EPSILON,
  );
  for (const key of DESTROYED_TYPES)
    compare(`destroyedByType.${key}`, stored.destroyedByType[key], recap.totalStats.destroyedByType[key]);
  const normalize = (entries: OperatorSessionDetail["upgrades"]) =>
    entries.map(({ tick, wave, bought }) => ({ tick, wave, bought }));
  compare(
    "upgrades",
    normalize(stored.upgrades),
    normalize(recap.upgrades),
    JSON.stringify(normalize(stored.upgrades)) === JSON.stringify(normalize(recap.upgrades)),
  );
  return differences;
}
export function waveAtTick(recap: RunRecapData, tick: number): number {
  return [...recap.waveCards].reverse().find((wave) => tick >= wave.startTick)?.wave ?? 1;
}
export function inspectionTimeline(replay: ReplayData, recap: RunRecapData, finalTick: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  const add = (tick: number, wave: number, label: string, seekToTick = tick) => {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > finalTick) return;
    items.push({
      tick,
      wave,
      label,
      seconds: tick / SIMULATION_HZ,
      seekToTick: Math.max(0, Math.min(finalTick, seekToTick)),
    });
  };
  for (const wave of recap.waveCards) {
    add(wave.startTick, wave.wave, `Wave ${wave.wave} start`);
    if (!wave.terminal) add(wave.endTick, wave.wave, `Wave ${wave.wave} complete`);
  }
  for (const action of replay.actions) {
    if (action.type === "shop" && action.bought.length)
      add(
        action.tick,
        action.wave ??
          recap.upgrades.find((entry) => entry.tick === action.tick)?.wave ??
          waveAtTick(recap, action.tick),
        `Purchase: ${action.bought.join(", ")}`,
      );
    if (["emp", "f15", "flare"].includes(action.type))
      add(action.tick, waveAtTick(recap, action.tick), `${action.type.toUpperCase()} activated`);
  }
  const lastStart = recap.waveCards[recap.waveCards.length - 1]?.startTick ?? 0;
  add(
    finalTick,
    recap.wave,
    "Terminal moment · 10-second lead-in",
    Math.max(lastStart, finalTick - TERMINAL_LEAD_IN_TICKS),
  );
  const priority = (item: TimelineItem) =>
    item.label.includes(" complete")
      ? 0
      : item.label.startsWith("Purchase:")
        ? 1
        : item.label.includes(" start")
          ? 2
          : item.label.startsWith("Terminal")
            ? 4
            : 3;
  return items.sort((a, b) => a.tick - b.tick || priority(a) - priority(b));
}
export async function inspectReplay(
  stored: OperatorSessionDetail,
  replay: ReplayData,
  signal: SeekSignal,
  onProgress?: (tick: number) => void,
): Promise<ReplayInspection> {
  if (replay.version !== CURRENT_REPLAY_VERSION)
    throw new Error(`Replay format v${replay.version} is incompatible with this runtime (v${CURRENT_REPLAY_VERSION})`);
  let diverged = false;
  const runner = createReplayRunner(replay, null, (type) => {
    if (type === "replay_divergence") diverged = true;
  });
  try {
    runner.init();
    // The same advancement primitive owns shop/bonus transitions for playback seeking and inspection.
    await seekRunnerToTick(runner, replay.finalTick ?? 60 * 60 * SIMULATION_HZ, signal, onProgress);
    if (signal.cancelled) throw new Error("Inspection cancelled");
    if (diverged) throw new Error("Replay checkpoint divergence: local inspection unavailable");
    if (replay.finalTick === undefined && !runner.isFinished())
      throw new Error("Replay exceeds the one-hour inspection limit");
    const game = runner.getState();
    if (!game) throw new Error("Replay state unavailable");
    const finalTick = runner.getTick();
    const recap = buildRunRecapData(game, { ...replay, finalTick });
    const differences = compareSummary(stored, recap);
    return {
      recap,
      finalTick,
      differences,
      status: differences.length ? "mismatch" : "matches summary",
      timeline: inspectionTimeline(replay, recap, finalTick),
    };
  } finally {
    runner.cleanup();
  }
}
