/**
 * Spawn analysis for POST-spawn-commander (current) version.
 * Analytically computes per-wave spawn schedules using wave-spawner.js
 * and also runs N simulation games per wave to measure benchmark metrics.
 */

import { getWaveConfig, generateWaveSchedule, createCommander, THREAT_VALUES } from "../wave-spawner.js";
import { setRng } from "../game-logic.js";
import { mulberry32 } from "./rng.js";

const NUM_SAMPLES = 200; // schedules per wave for statistical analysis

function analyzeWave(wave) {
  const missiles = [];
  const drone136s = [];
  const drone238s = [];
  const mirvs = [];
  const budgets = [];
  const totalThreats = [];
  const threatValues = [];
  const caps = [];
  const durations = []; // last spawn tick (rough wave duration in ticks)

  for (let s = 0; s < NUM_SAMPLES; s++) {
    const rng = mulberry32(s * 1000 + wave * 7 + 42);
    setRng(rng);

    const commander = createCommander("balanced");
    // Advance commander history to match the wave number
    for (let w = 1; w < wave; w++) {
      generateWaveSchedule(w, commander);
    }

    const result = generateWaveSchedule(wave, commander);
    const schedule = result.schedule;
    const cap = result.concurrentCap;
    caps.push(cap);

    let m = 0,
      d1 = 0,
      d2 = 0,
      mv = 0;
    let lastTick = 0;
    for (const entry of schedule) {
      if (entry.type === "missile") m++;
      else if (entry.type === "drone136") d1++;
      else if (entry.type === "drone238") d2++;
      else if (entry.type === "mirv") mv++;
      if (entry.tick > lastTick) lastTick = entry.tick;
    }

    missiles.push(m);
    drone136s.push(d1);
    drone238s.push(d2);
    mirvs.push(mv);
    totalThreats.push(m + d1 + d2 + mv);
    threatValues.push(
      m * THREAT_VALUES.missile + d1 * THREAT_VALUES.drone136 + d2 * THREAT_VALUES.drone238 + mv * THREAT_VALUES.mirv,
    );
    budgets.push(getWaveConfig(wave).budget);
    durations.push(lastTick);
  }

  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const pct = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * p)];
  };

  return {
    wave,
    missiles: { avg: avg(missiles).toFixed(1), p10: pct(missiles, 0.1), p90: pct(missiles, 0.9) },
    drone136: { avg: avg(drone136s).toFixed(1), p10: pct(drone136s, 0.1), p90: pct(drone136s, 0.9) },
    drone238: { avg: avg(drone238s).toFixed(1), p10: pct(drone238s, 0.1), p90: pct(drone238s, 0.9) },
    mirv: { avg: avg(mirvs).toFixed(1), p10: pct(mirvs, 0.1), p90: pct(mirvs, 0.9) },
    totalThreats: { avg: avg(totalThreats).toFixed(1), p10: pct(totalThreats, 0.1), p90: pct(totalThreats, 0.9) },
    threatValue: {
      avg: avg(threatValues).toFixed(1),
      p10: pct(threatValues, 0.1).toFixed(1),
      p90: pct(threatValues, 0.9).toFixed(1),
    },
    budget: budgets[0],
    concurrentCap: avg(caps).toFixed(0),
    lastSpawnTick: { avg: avg(durations).toFixed(0), p90: pct(durations, 0.9) },
  };
}

const waves = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const results = waves.map(analyzeWave);

console.log("=== POST-SPAWN-COMMANDER: Per-Wave Spawn Analysis ===\n");
console.log(
  "Wave | Budget | Cap | Missiles  | Drone136  | Drone238  |   MIRV   | TotalThreats | ThreatValue | LastSpawnTick",
);
console.log(
  "-----|--------|-----|-----------|-----------|-----------|----------|--------------|-------------|---------------",
);
for (const r of results) {
  const m = `${r.missiles.avg} [${r.missiles.p10}-${r.missiles.p90}]`;
  const d1 = `${r.drone136.avg} [${r.drone136.p10}-${r.drone136.p90}]`;
  const d2 = `${r.drone238.avg} [${r.drone238.p10}-${r.drone238.p90}]`;
  const mv = `${r.mirv.avg} [${r.mirv.p10}-${r.mirv.p90}]`;
  const tt = `${r.totalThreats.avg} [${r.totalThreats.p10}-${r.totalThreats.p90}]`;
  const tv = `${r.threatValue.avg} [${r.threatValue.p10}-${r.threatValue.p90}]`;
  const lst = `${r.lastSpawnTick.avg} [p90:${r.lastSpawnTick.p90}]`;
  console.log(
    `  ${String(r.wave).padStart(2)} |   ${String(r.budget).padStart(3)}  | ${String(r.concurrentCap).padStart(3)} | ${m.padEnd(9)} | ${d1.padEnd(9)} | ${d2.padEnd(9)} | ${mv.padEnd(8)} | ${tt.padEnd(12)} | ${tv.padEnd(11)} | ${lst}`,
  );
}

// Print summary growth rates
console.log("\n=== Threat value growth wave-over-wave ===");
for (let i = 1; i < results.length; i++) {
  const prev = parseFloat(results[i - 1].threatValue.avg);
  const curr = parseFloat(results[i].threatValue.avg);
  const pct = (((curr - prev) / prev) * 100).toFixed(1);
  console.log(`  Wave ${results[i - 1].wave}→${results[i].wave}: ${prev} → ${curr} (+${pct}%)`);
}

// Also output JSON for capture
const output = { version: "post-spawn-commander", waves: results };
import { writeFileSync } from "fs";
writeFileSync("spawn-analysis-new.json", JSON.stringify(output, null, 2));
console.log("\nJSON saved to spawn-analysis-new.json");
