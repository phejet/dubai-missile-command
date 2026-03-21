import { Worker } from "worker_threads";
import { readFileSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { resolveBotConfig } from "./bot-brain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
}

const NUM_GAMES = parseInt(getArg("games", "100"));
const NUM_ITERATIONS = parseInt(getArg("iterations", "10"));
const NUM_WORKERS = parseInt(getArg("workers", String(Math.min(8, (await import("os")).cpus().length))));
const MAX_TICKS = parseInt(getArg("maxTicks", "100000"));
const PRESET = getArg("preset", null);

const CONFIG_PATH = join(__dirname, "bot-config.json");
const LOG_PATH = join(__dirname, "training-log.jsonl");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function runBatch(config, numGames) {
  return new Promise((resolve, reject) => {
    // Split games across workers
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
        games.push({ seed: startIdx + i + Date.now(), maxTicks: MAX_TICKS });
      }

      const worker = new Worker(join(__dirname, "game-worker.js"), {
        workerData: { games, config, preset: PRESET },
      });

      workers.push(worker);

      worker.on("message", (results) => {
        allResults.push(...results);
        completed++;
        if (completed === workers.length) {
          resolve(allResults);
        }
      });

      worker.on("error", reject);
    }
  });
}

function aggregateStats(results) {
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const waves = results.map((r) => r.wave).sort((a, b) => a - b);
  const totalKills = results.map((r) => r.stats.missileKills + r.stats.droneKills);
  const totalShots = results.map((r) => r.stats.shotsFired);
  const efficiency = results.map((r) => {
    const kills = r.stats.missileKills + r.stats.droneKills;
    return r.stats.shotsFired > 0 ? kills / r.stats.shotsFired : 0;
  });

  const deathCauses = {};
  results.forEach((r) => {
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
  });

  function percentile(arr, p) {
    const idx = Math.floor(arr.length * p);
    return arr[Math.min(idx, arr.length - 1)];
  }

  return {
    games: results.length,
    score: {
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      median: scores[Math.floor(scores.length / 2)],
      p10: percentile(scores, 0.1),
      p90: percentile(scores, 0.9),
      min: scores[0],
      max: scores[scores.length - 1],
    },
    waves: {
      mean: +(waves.reduce((a, b) => a + b, 0) / waves.length).toFixed(1),
      median: waves[Math.floor(waves.length / 2)],
      p10: percentile(waves, 0.1),
      p90: percentile(waves, 0.9),
    },
    efficiency: {
      mean: +(efficiency.reduce((a, b) => a + b, 0) / efficiency.length).toFixed(3),
      meanKills: +(totalKills.reduce((a, b) => a + b, 0) / totalKills.length).toFixed(1),
      meanShots: +(totalShots.reduce((a, b) => a + b, 0) / totalShots.length).toFixed(1),
    },
    deathCauses,
  };
}

async function main() {
  console.log(`\n=== Dubai Missile Command Bot Training ===`);
  console.log(`Games per iteration: ${NUM_GAMES}`);
  console.log(`Iterations: ${NUM_ITERATIONS}`);
  console.log(`Workers: ${NUM_WORKERS}`);
  console.log(`Preset: ${PRESET || "perfect"}`);
  console.log();

  const config = resolveBotConfig(loadConfig(), PRESET);
  const history = [];

  const totalT0 = performance.now();
  for (let iter = 1; iter <= NUM_ITERATIONS; iter++) {
    console.log(`── Iteration ${iter}/${NUM_ITERATIONS} ──`);

    const t0 = performance.now();
    const results = await runBatch(config, NUM_GAMES);
    const elapsed = performance.now() - t0;

    const stats = aggregateStats(results);
    console.log(`  ${NUM_GAMES} games in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(
      `  Score: mean=${stats.score.mean} median=${stats.score.median} p10=${stats.score.p10} p90=${stats.score.p90}`,
    );
    console.log(
      `  Waves: mean=${stats.waves.mean} median=${stats.waves.median} p10=${stats.waves.p10} p90=${stats.waves.p90}`,
    );
    console.log(
      `  Efficiency: ${stats.efficiency.mean} (${stats.efficiency.meanKills} kills / ${stats.efficiency.meanShots} shots)`,
    );
    console.log(`  Deaths: ${JSON.stringify(stats.deathCauses)}`);

    const logEntry = { iteration: iter, timestamp: new Date().toISOString(), stats, config };
    appendFileSync(LOG_PATH, JSON.stringify(logEntry) + "\n");
    history.push({ iteration: iter, stats });
  }

  const totalElapsed = performance.now() - totalT0;
  console.log(
    `\nAll ${NUM_ITERATIONS} iterations complete (${(totalElapsed / 1000).toFixed(1)}s total, ${NUM_ITERATIONS * NUM_GAMES} games)`,
  );

  console.log(`\nLog: ${LOG_PATH}`);
}

main().catch((err) => {
  console.error("Training failed:", err);
  process.exit(1);
});
