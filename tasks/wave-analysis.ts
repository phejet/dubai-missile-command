/**
 * Difficulty progression analysis for waves 1-8.
 *
 * For each wave, measures:
 *   - schedule entries by type
 *   - threat value totals
 *   - wave duration (last spawn tick)
 *   - mean and peak dispatch rate
 *   - threat-value flux (TV/sec) at peak
 *   - concurrentCap utilization (cap vs total budget)
 *   - per-second spawn density histogram
 *
 * 60 ticks/sec is the sim rate (game.ts main loop accumulator).
 *
 * Runs N samples per wave with deterministic seeds and reports mean / p10 / p90.
 */

import { getWaveConfig, generateWaveSchedule, createCommander, THREAT_VALUES } from "../src/wave-spawner.js";
import { setRng } from "../src/game-logic.js";
import { mulberry32 } from "../src/headless/rng.js";
import type { SpawnEntry } from "../src/types.js";

const TICK_HZ = 60;
const NUM_SAMPLES = 400;
const WINDOW_SEC = 4; // sliding window for "peak burst" detection
const WINDOW_TICKS = WINDOW_SEC * TICK_HZ;

const SHAHED_VARIANTS = new Set([
  "shahed-136",
  "shahed-136-bomber",
  "shahed-136-dive",
  "shahed-136-dive-bomber",
]);

// Approximate average residency on screen in ticks (rough heuristic) used to estimate
// "expected concurrent threats" assuming the player intercepts at average pace.
// Numbers come from CANVAS_H=1600, GROUND_Y=1530, BURJ_X=460, and the spawn speeds in
// game-sim.ts (wave-scaled): missile (rand(0.5,1.0)+wave*0.08)*2; drone238 (rand(2.5,3.9)+wave*0.05)*2; etc.
function approxResidencyTicks(type: string, wave: number): number {
  const speedMissile = (0.75 + wave * 0.08) * 2; // mean ballistic speed
  const speedDrone136 = (0.63 + wave * 0.05) * 2; // prop avg
  const speedDrone238 = (3.2 + wave * 0.05) * 2; // jet avg
  const speedMirv = (0.75 + wave * 0.05) * 2;
  const path = 1500; // approx vertical/diagonal path length
  if (type === "missile") return path / speedMissile;
  if (type === "stack2") return path / speedMissile;
  if (type === "stack3") return path / speedMissile;
  if (SHAHED_VARIANTS.has(type)) return 900 / speedDrone136;
  if (type === "drone238") return 900 / speedDrone238;
  if (type === "mirv") return path / speedMirv + 240; // + warhead splits
  return 600;
}

interface WaveSample {
  schedule: SpawnEntry[];
  cap: number;
  budget: number;
  tactics: string[];
}

function sampleWave(wave: number, seed: number): WaveSample {
  const rng = mulberry32(seed);
  setRng(rng);
  const cmdr = createCommander("balanced");
  for (let w = 1; w < wave; w++) generateWaveSchedule(w, cmdr);
  const result = generateWaveSchedule(wave, cmdr);
  return {
    schedule: result.schedule,
    cap: result.concurrentCap,
    budget: getWaveConfig(wave).budget,
    tactics: result.tactics,
  };
}

interface WaveStats {
  wave: number;
  budget: number;
  cap: number;
  schedTotal: number;
  schedTV: number;
  durationTicks: number;
  durationSec: number;
  meanRateSpawnsPerSec: number;
  peakRateSpawnsPerSec: number; // 4-sec sliding window
  meanTVPerSec: number;
  peakTVPerSec: number;
  expectedConcurrent: number;     // mean alive count integrated over wave (heuristic)
  expectedConcurrentTV: number;   // mean alive threat value (heuristic)
  peakConcurrent: number;         // max alive count
  peakConcurrentTV: number;       // max alive TV
  capUtilization: number;         // peak alive TV / cap
  byType: Record<string, number>;
}

function statsForSample(s: WaveSample, wave: number): WaveStats {
  const sched = s.schedule;
  const lastTick = sched.length > 0 ? sched[sched.length - 1].tick : 0;
  const durationTicks = Math.max(1, lastTick + 1);
  const durationSec = durationTicks / TICK_HZ;

  let totalTV = 0;
  const byType: Record<string, number> = {};
  for (const e of sched) {
    totalTV += THREAT_VALUES[e.type];
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  if (!Number.isFinite(durationTicks) || durationTicks < 1) {
    console.log("BAD durationTicks", { wave, lastTick, schedLen: sched.length });
  }

  // Sliding window peak in spawns/sec and TV/sec
  let peakSpawns = 0;
  let peakTV = 0;
  // Pre-sort by tick for window scan (already sorted in generator)
  for (let i = 0; i < sched.length; i++) {
    let count = 0;
    let tv = 0;
    for (let j = i; j < sched.length && sched[j].tick - sched[i].tick <= WINDOW_TICKS; j++) {
      count++;
      tv += THREAT_VALUES[sched[j].type];
    }
    if (count > peakSpawns) peakSpawns = count;
    if (tv > peakTV) peakTV = tv;
  }

  // Tick-by-tick simulated alive count, assuming a threat lives `approxResidencyTicks` after spawn
  // (no concurrentCap deferral modeled — see notes; cap-induced backpressure handled separately).
  const aliveLen = Math.ceil(durationTicks) + 600;
  const aliveAt: number[] = new Array(aliveLen).fill(0);
  const aliveTVAt: number[] = new Array(aliveLen).fill(0);
  let peakConcurrent = 0;
  let peakConcurrentTV = 0;

  for (const e of sched) {
    const lifeT = approxResidencyTicks(e.type, wave);
    const tStart = e.tick;
    const tEnd = Math.min(aliveAt.length - 1, e.tick + Math.round(lifeT));
    for (let t = tStart; t <= tEnd; t++) {
      aliveAt[t]++;
      aliveTVAt[t] += THREAT_VALUES[e.type];
      if (aliveAt[t] > peakConcurrent) peakConcurrent = aliveAt[t];
      if (aliveTVAt[t] > peakConcurrentTV) peakConcurrentTV = aliveTVAt[t];
    }
  }
  // Mean concurrent over the active window
  let aliveSum = 0;
  let aliveTVSum = 0;
  let activeTicks = 0;
  for (let t = 0; t < aliveAt.length; t++) {
    if (aliveAt[t] > 0) {
      aliveSum += aliveAt[t];
      aliveTVSum += aliveTVAt[t];
      activeTicks++;
    }
  }
  const expectedConcurrent = activeTicks > 0 ? aliveSum / activeTicks : 0;
  const expectedConcurrentTV = activeTicks > 0 ? aliveTVSum / activeTicks : 0;

  return {
    wave,
    budget: s.budget,
    cap: s.cap,
    schedTotal: sched.length,
    schedTV: totalTV,
    durationTicks,
    durationSec,
    meanRateSpawnsPerSec: sched.length / durationSec,
    peakRateSpawnsPerSec: peakSpawns / WINDOW_SEC,
    meanTVPerSec: totalTV / durationSec,
    peakTVPerSec: peakTV / WINDOW_SEC,
    expectedConcurrent,
    expectedConcurrentTV,
    peakConcurrent,
    peakConcurrentTV,
    capUtilization: peakConcurrentTV / s.cap,
    byType,
  };
}

function aggregate(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return { mean, p10, p50, p90 };
}

function analyzeWave(wave: number) {
  const samples: WaveStats[] = [];
  for (let s = 0; s < NUM_SAMPLES; s++) {
    const seed = s * 1009 + wave * 31 + 17;
    samples.push(statsForSample(sampleWave(wave, seed), wave));
  }
  const pickField = (k: keyof WaveStats) =>
    aggregate(samples.map((x) => x[k] as number));
  const typeMean: Record<string, number> = {};
  for (const s of samples) {
    for (const k of Object.keys(s.byType)) {
      typeMean[k] = (typeMean[k] ?? 0) + s.byType[k];
    }
  }
  for (const k of Object.keys(typeMean)) typeMean[k] = +(typeMean[k] / NUM_SAMPLES).toFixed(2);

  return {
    wave,
    budget: samples[0].budget,
    cap: samples[0].cap,
    schedTotal: pickField("schedTotal"),
    schedTV: pickField("schedTV"),
    durationSec: pickField("durationSec"),
    meanRateSpawnsPerSec: pickField("meanRateSpawnsPerSec"),
    peakRateSpawnsPerSec: pickField("peakRateSpawnsPerSec"),
    meanTVPerSec: pickField("meanTVPerSec"),
    peakTVPerSec: pickField("peakTVPerSec"),
    expectedConcurrent: pickField("expectedConcurrent"),
    expectedConcurrentTV: pickField("expectedConcurrentTV"),
    peakConcurrent: pickField("peakConcurrent"),
    peakConcurrentTV: pickField("peakConcurrentTV"),
    capUtilization: pickField("capUtilization"),
    byType: typeMean,
  };
}

const waves = [1, 2, 3, 4, 5, 6, 7, 8];
const results = waves.map(analyzeWave);

function fmt(n: number, digits = 1) {
  return n.toFixed(digits);
}

console.log("\n===== Waves 1-8 Difficulty Curve (balanced commander, 400 samples) =====\n");
console.log(
  "Tick rate: 60 Hz. WAVE_DURATION_SCALE in spawner = 1.5 (already baked into schedule ticks)\n",
);
console.log(
  "W |   Bud Cap | Total entries | TV total       | Duration s | Spawn/sec mean→peak(4s) | TV/sec mean→peak(4s) | Mean alive (TV) | Peak alive (TV) | Cap util%",
);
console.log("--+-----------+---------------+----------------+------------+-------------------------+----------------------+-----------------+-----------------+----------");
for (const r of results) {
  const total = `${fmt(r.schedTotal.mean)} [${r.schedTotal.p10}-${r.schedTotal.p90}]`;
  const tv = `${fmt(r.schedTV.mean)} [${fmt(r.schedTV.p10)}-${fmt(r.schedTV.p90)}]`;
  const dur = `${fmt(r.durationSec.mean)}s`;
  const meanRate = `${fmt(r.meanRateSpawnsPerSec.mean, 2)}→${fmt(r.peakRateSpawnsPerSec.mean, 2)}`;
  const tvRate = `${fmt(r.meanTVPerSec.mean, 2)}→${fmt(r.peakTVPerSec.mean, 2)}`;
  const meanAlive = `${fmt(r.expectedConcurrent.mean, 1)} (${fmt(r.expectedConcurrentTV.mean, 1)})`;
  const peakAlive = `${fmt(r.peakConcurrent.mean, 1)} (${fmt(r.peakConcurrentTV.mean, 1)})`;
  const cap = `${fmt(r.capUtilization.mean * 100, 0)}%`;
  console.log(
    `${String(r.wave).padStart(2)}| ${String(r.budget).padStart(5)} ${String(r.cap).padStart(4)}| ${total.padEnd(13)} | ${tv.padEnd(14)} | ${dur.padEnd(10)} | ${meanRate.padEnd(23)} | ${tvRate.padEnd(20)} | ${meanAlive.padEnd(15)} | ${peakAlive.padEnd(15)} | ${cap}`,
  );
}

console.log("\n===== Spawn-type composition (mean count per wave) =====\n");
const allTypes = new Set<string>();
for (const r of results) for (const k of Object.keys(r.byType)) allTypes.add(k);
const typeList = Array.from(allTypes);
console.log("W |", typeList.map((t) => t.padEnd(8)).join(" | "));
for (const r of results) {
  console.log(
    String(r.wave).padStart(2) +
      "| " +
      typeList.map((t) => fmt(r.byType[t] ?? 0).padEnd(8)).join(" | "),
  );
}

console.log("\n===== Wave-over-wave delta =====");
for (let i = 1; i < results.length; i++) {
  const a = results[i - 1];
  const b = results[i];
  const d = (cur: number, prev: number) => `${(((cur - prev) / prev) * 100).toFixed(0).padStart(4)}%`;
  console.log(
    `W${a.wave}→W${b.wave}: TV_total ${d(b.schedTV.mean, a.schedTV.mean)} | TV/sec mean ${d(b.meanTVPerSec.mean, a.meanTVPerSec.mean)} | TV/sec peak ${d(b.peakTVPerSec.mean, a.peakTVPerSec.mean)} | mean_alive ${d(b.expectedConcurrent.mean, a.expectedConcurrent.mean)} | peak_alive ${d(b.peakConcurrent.mean, a.peakConcurrent.mean)} | cap_util ${d(b.capUtilization.mean, a.capUtilization.mean)}`,
  );
}

console.log("\n===== ASCII graph: TV/sec (peak vs mean) and Mean alive (count) =====\n");
function ascii(values: number[], title: string, width = 60) {
  const max = Math.max(...values);
  console.log(`${title}  (max=${max.toFixed(1)})`);
  for (let i = 0; i < values.length; i++) {
    const len = Math.round((values[i] / max) * width);
    console.log(`  W${i + 1} | ${"█".repeat(len)} ${values[i].toFixed(1)}`);
  }
  console.log("");
}
ascii(results.map((r) => r.meanTVPerSec.mean), "MeanTV/sec");
ascii(results.map((r) => r.peakTVPerSec.mean), "PeakTV/sec (4s window)");
ascii(results.map((r) => r.meanRateSpawnsPerSec.mean), "Spawns/sec mean");
ascii(results.map((r) => r.peakRateSpawnsPerSec.mean), "Spawns/sec peak (4s window)");
ascii(results.map((r) => r.expectedConcurrent.mean), "Mean alive entities");
ascii(results.map((r) => r.peakConcurrent.mean), "Peak alive entities");
ascii(results.map((r) => r.capUtilization.mean * 100), "Cap utilization %");
ascii(results.map((r) => r.durationSec.mean), "Wave duration (s)");
