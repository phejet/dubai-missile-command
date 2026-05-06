/**
 * Tactical spawn quality analysis for the spawn commander.
 *
 * This intentionally measures the scheduled plan, not actual runtime survival.
 * It does not simulate actual runtime survival; use headless bot runs for that.
 * Cell metrics measure schedule intent, while overlap metrics measure scheduled
 * proximity before concurrent-cap deferrals.
 */

import { createCommander, generateWaveSchedule } from "../src/wave-spawner.js";
import { setRng } from "../src/game-logic.js";
import { mulberry32 } from "../src/headless/rng.js";
import type { SpawnEntry, SpawnType } from "../src/types.js";

const NUM_SAMPLES = 400;
const WINDOW_TICKS = 60;
const WAVES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const SHAHED_136_TYPES = new Set<SpawnType>([
  "shahed-136",
  "shahed-136-bomber",
  "shahed-136-dive",
  "shahed-136-dive-bomber",
]);

type Axis = "left" | "right" | "top" | "natural";
type Speed = "normal" | "fast";

interface SampleMetrics {
  entries: number;
  cellCoverage: number;
  mixedCellShare: number;
  explicitAxisShare: number;
  sideEntropy: number;
  sameLaneStreak: number;
  sameTypeStreak: number;
  mixedAxisWindows: number;
  speedContrastWindows: number;
  repetitionScore: number;
}

function axisFor(entry: SpawnEntry): Axis {
  return entry.overrides?.side ?? "natural";
}

function speedFor(entry: SpawnEntry): Speed {
  return entry.overrides?.variant === "fast" ? "fast" : "normal";
}

function familyFor(type: SpawnType): string {
  if (SHAHED_136_TYPES.has(type)) return "shahed-136";
  if (type === "stack2" || type === "stack3") return "stacked-missile";
  return type;
}

function entropy(entries: SpawnEntry[]): number {
  if (entries.length === 0) return 0;
  const counts = new Map<Axis, number>();
  for (const entry of entries) counts.set(axisFor(entry), (counts.get(axisFor(entry)) ?? 0) + 1);
  let h = 0;
  for (const count of counts.values()) {
    const p = count / entries.length;
    h -= p * Math.log2(p);
  }
  return h / Math.log2(4);
}

function explicitAxisShare(entries: SpawnEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.filter((entry) => axisFor(entry) !== "natural").length / entries.length;
}

function cellCoverage(entries: SpawnEntry[]): number {
  if (entries.length === 0) return 0;
  return entries.filter((entry) => entry.cellId).length / entries.length;
}

function mixedCellShare(entries: SpawnEntry[]): number {
  const cells = new Map<string, SpawnEntry[]>();
  for (const entry of entries) {
    if (!entry.cellId) continue;
    cells.set(entry.cellId, [...(cells.get(entry.cellId) ?? []), entry]);
  }
  if (cells.size === 0) return 0;

  let mixed = 0;
  for (const cell of cells.values()) {
    const axes = new Set(cell.map((entry) => axisFor(entry)));
    const families = new Set(cell.map((entry) => familyFor(entry.type)));
    if (axes.size >= 2 || families.size >= 2) mixed++;
  }
  return mixed / cells.size;
}

function longestStreak<T>(items: T[], keyFn: (item: T) => string): number {
  let longest = 0;
  let current = 0;
  let previous: string | null = null;
  for (const item of items) {
    const key = keyFn(item);
    current = key === previous ? current + 1 : 1;
    previous = key;
    longest = Math.max(longest, current);
  }
  return longest;
}

function countMixedAxisWindows(schedule: SpawnEntry[]): number {
  let count = 0;
  for (let i = 0; i < schedule.length; i++) {
    const axes = new Set<Axis>();
    for (let j = i; j < schedule.length && schedule[j].tick - schedule[i].tick <= WINDOW_TICKS; j++) {
      axes.add(axisFor(schedule[j]));
    }
    if (axes.size >= 2) count++;
  }
  return count;
}

function countSpeedContrastWindows(schedule: SpawnEntry[]): number {
  let count = 0;
  for (let i = 0; i < schedule.length; i++) {
    const speeds = new Set<Speed>();
    for (let j = i; j < schedule.length && schedule[j].tick - schedule[i].tick <= WINDOW_TICKS; j++) {
      speeds.add(speedFor(schedule[j]));
    }
    if (speeds.size >= 2) count++;
  }
  return count;
}

function repetitionScore(schedule: SpawnEntry[]): number {
  let score = 0;
  for (let i = 1; i < schedule.length; i++) {
    const prev = schedule[i - 1];
    const cur = schedule[i];
    const sameAxis = axisFor(prev) === axisFor(cur);
    const sameFamily = familyFor(prev.type) === familyFor(cur.type);
    const sameSpeed = speedFor(prev) === speedFor(cur);
    if (sameAxis) score += 1;
    if (sameFamily) score += 1;
    if (sameAxis && sameFamily) score += 2;
    if (sameAxis && sameFamily && sameSpeed) score += 1;
  }
  return schedule.length > 1 ? score / (schedule.length - 1) : 0;
}

function metricsForSchedule(schedule: SpawnEntry[]): SampleMetrics {
  return {
    entries: schedule.length,
    cellCoverage: cellCoverage(schedule),
    mixedCellShare: mixedCellShare(schedule),
    explicitAxisShare: explicitAxisShare(schedule),
    sideEntropy: entropy(schedule),
    sameLaneStreak: longestStreak(schedule, (entry) => axisFor(entry)),
    sameTypeStreak: longestStreak(schedule, (entry) => familyFor(entry.type)),
    mixedAxisWindows: countMixedAxisWindows(schedule),
    speedContrastWindows: countSpeedContrastWindows(schedule),
    repetitionScore: repetitionScore(schedule),
  };
}

function sampleWave(wave: number, seed: number): SampleMetrics {
  setRng(mulberry32(seed));
  const commander = createCommander("balanced");
  for (let w = 1; w < wave; w++) generateWaveSchedule(w, commander);
  return metricsForSchedule(generateWaveSchedule(wave, commander).schedule);
}

function aggregate(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean,
    p10: sorted[Math.floor(values.length * 0.1)],
    p50: sorted[Math.floor(values.length * 0.5)],
    p90: sorted[Math.floor(values.length * 0.9)],
  };
}

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits);
}

console.log(`\n===== Spawn Tactics Analysis (${NUM_SAMPLES} samples, ${WINDOW_TICKS}-tick windows) =====\n`);
console.log(
  "W | Entries | Cell cov | Mixed cells | Explicit axis | Axis entropy | Same lane max | Same type max | Mixed windows | Speed windows | Repetition",
);
console.log(
  "--+---------+----------+-------------+---------------+--------------+---------------+---------------+---------------+---------------+-----------",
);

for (const wave of WAVES) {
  const samples: SampleMetrics[] = [];
  for (let sample = 0; sample < NUM_SAMPLES; sample++) {
    samples.push(sampleWave(wave, sample * 1009 + wave * 31 + 17));
  }
  const entries = aggregate(samples.map((sample) => sample.entries));
  const cellCoverage = aggregate(samples.map((sample) => sample.cellCoverage));
  const mixedCells = aggregate(samples.map((sample) => sample.mixedCellShare));
  const explicitAxis = aggregate(samples.map((sample) => sample.explicitAxisShare));
  const sideEntropy = aggregate(samples.map((sample) => sample.sideEntropy));
  const sameLane = aggregate(samples.map((sample) => sample.sameLaneStreak));
  const sameType = aggregate(samples.map((sample) => sample.sameTypeStreak));
  const mixedAxis = aggregate(samples.map((sample) => sample.mixedAxisWindows));
  const speedContrast = aggregate(samples.map((sample) => sample.speedContrastWindows));
  const repetition = aggregate(samples.map((sample) => sample.repetitionScore));

  console.log(
    `${String(wave).padStart(2)}| ${fmt(entries.mean, 1).padStart(7)} | ${fmt(cellCoverage.mean * 100, 0).padStart(
      7,
    )}% | ${fmt(mixedCells.mean * 100, 0).padStart(10)}% | ${fmt(explicitAxis.mean * 100, 0).padStart(
      12,
    )}% | ${fmt(sideEntropy.mean).padStart(12)} | ${fmt(sameLane.mean, 1).padStart(
      13,
    )} | ${fmt(sameType.mean, 1).padStart(13)} | ${fmt(mixedAxis.mean, 1).padStart(13)} | ${fmt(
      speedContrast.mean,
      1,
    ).padStart(13)} | ${fmt(repetition.mean).padStart(9)}`,
  );
}

setRng(Math.random);
