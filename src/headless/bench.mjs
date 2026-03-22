/**
 * Benchmark runner matching the pre-spawn bench.mjs seed set for comparison.
 */
import { Worker } from "worker_threads";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NUM_GAMES = 200;
const NUM_WORKERS = Math.min(8, os.cpus().length);
const MAX_TICKS = 100000;
const CONFIG = JSON.parse(readFileSync(join(__dirname, "bot-config.json"), "utf-8"));

function runBatch(numGames) {
  return new Promise((resolve, reject) => {
    const gamesPerWorker = Math.ceil(numGames / NUM_WORKERS);
    const workers = [];
    const allResults = [];
    let completed = 0;

    for (let w = 0; w < NUM_WORKERS; w++) {
      const startIdx = w * gamesPerWorker;
      const count = Math.min(gamesPerWorker, numGames - startIdx);
      if (count <= 0) continue;

      const games = [];
      for (let i = 0; i < count; i++) {
        games.push({ seed: startIdx + i + 12345, maxTicks: MAX_TICKS });
      }

      const worker = new Worker(join(__dirname, "game-worker.js"), {
        workerData: { games, config: CONFIG, preset: null },
      });

      workers.push(worker);
      worker.on("message", (results) => {
        allResults.push(...results);
        completed++;
        if (completed === workers.length) resolve(allResults);
      });
      worker.on("error", reject);
    }
  });
}

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}
function avg(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }

const t0 = performance.now();
const results = await runBatch(NUM_GAMES);
const elapsed = performance.now() - t0;

const scores = results.map(r => r.score);
const waves = results.map(r => r.wave);
const kills = results.map(r => r.stats.missileKills + r.stats.droneKills);
const shots = results.map(r => r.stats.shotsFired);
const eff = results.map(r => r.stats.shotsFired > 0 ? (r.stats.missileKills + r.stats.droneKills) / r.stats.shotsFired : 0);

console.log(`=== POST-SPAWN-COMMANDER Benchmark: ${NUM_GAMES} games in ${(elapsed/1000).toFixed(1)}s ===`);
console.log(`Score:  mean=${avg(scores).toFixed(0)} median=${pct(scores, 0.5)} p10=${pct(scores, 0.1)} p90=${pct(scores, 0.9)}`);
console.log(`Waves:  mean=${avg(waves).toFixed(1)} median=${pct(waves, 0.5)} p10=${pct(waves, 0.1)} p90=${pct(waves, 0.9)}`);
console.log(`Kills:  mean=${avg(kills).toFixed(0)} per game`);
console.log(`Shots:  mean=${avg(shots).toFixed(0)} per game`);
console.log(`Efficiency: ${avg(eff).toFixed(3)} (kills/shot)`);

const deathCauses = {};
results.forEach(r => { deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1; });
console.log(`Deaths: ${JSON.stringify(deathCauses)}`);

const waveDist = {};
waves.forEach(w => { waveDist[w] = (waveDist[w] || 0) + 1; });
console.log(`\nWave distribution:`);
Object.keys(waveDist).sort((a,b) => +a - +b).forEach(w => {
  const bar = "█".repeat(Math.round(waveDist[w] / NUM_GAMES * 40));
  console.log(`  Wave ${String(w).padStart(2)}: ${String(waveDist[w]).padStart(3)} games ${bar}`);
});

import { writeFileSync } from "fs";
const output = {
  version: "post-spawn-commander",
  commit: "HEAD (main)",
  numGames: NUM_GAMES,
  score: { mean: avg(scores), median: pct(scores, 0.5), p10: pct(scores, 0.1), p90: pct(scores, 0.9) },
  wave: { mean: avg(waves), median: pct(waves, 0.5), p10: pct(waves, 0.1), p90: pct(waves, 0.9) },
  kills: avg(kills),
  shots: avg(shots),
  efficiency: avg(eff),
  deathCauses,
  waveDist,
};
writeFileSync("/tmp/bench-new.json", JSON.stringify(output, null, 2));
console.log("\nJSON saved to /tmp/bench-new.json");
