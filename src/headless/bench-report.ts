#!/usr/bin/env node
/**
 * Deterministic benchmark — fixed seeds, structured JS output.
 *
 * Usage:
 *   node src/headless/bench-report.mjs [--games=500] [--preset=draft]
 *   node src/headless/bench-report.mjs > bench-report.js
 */

import { Worker } from "worker_threads";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";
import type { runGame } from "./sim-runner.js";

type GameResult = ReturnType<typeof runGame>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);

const NUM_GAMES = parseInt(args.games || "500");
const PRESET = args.preset || null;
const DRAFT_MODE = true;
const NUM_WORKERS = Math.min(8, os.cpus().length);
const MAX_TICKS = 100000;
const CONFIG = JSON.parse(readFileSync(join(__dirname, "bot-config.json"), "utf-8"));

function pct(sorted: number[], p: number) {
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

function runBatch() {
  return new Promise((resolve, reject) => {
    const gamesPerWorker = Math.ceil(NUM_GAMES / NUM_WORKERS);
    const workers = [];
    const allResults: GameResult[] = [];
    let completed = 0;

    for (let w = 0; w < NUM_WORKERS; w++) {
      const startSeed = w * gamesPerWorker;
      const count = Math.min(gamesPerWorker, NUM_GAMES - startSeed);
      if (count <= 0) continue;

      const games = [];
      for (let i = 0; i < count; i++) {
        games.push({ seed: startSeed + i, maxTicks: MAX_TICKS });
      }

      const worker = new Worker(join(__dirname, "game-worker.js"), {
        workerData: { games, config: CONFIG, preset: PRESET, draftMode: DRAFT_MODE },
      });

      workers.push(worker);
      worker.on("message", (results: GameResult[]) => {
        allResults.push(...results);
        completed++;
        if (completed === workers.length) resolve(allResults);
      });
      worker.on("error", reject);
    }
  });
}

const t0 = performance.now();
process.stderr.write(`Running ${NUM_GAMES} games (seeds 0–${NUM_GAMES - 1}, preset=${PRESET || "draft"})...\n`);

const results = (await runBatch()) as GameResult[];
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

const scores = results.map((r) => r.score).sort((a: number, b: number) => a - b);
const waves = results.map((r) => r.wave).sort((a: number, b: number) => a - b);
const kills = results.map((r) => r.stats.missileKills + r.stats.droneKills);
const shots = results.map((r) => r.stats.shotsFired);
const totalKills = kills.reduce((a: number, b: number) => a + b, 0);
const totalShots = shots.reduce((a: number, b: number) => a + b, 0);

const waveDeaths: Record<number, number> = {};
for (const r of results) {
  waveDeaths[r.wave] = (waveDeaths[r.wave] || 0) + 1;
}

const report = {
  timestamp: new Date().toISOString(),
  games: NUM_GAMES,
  preset: PRESET || "draft",
  elapsedS: parseFloat(elapsed),
  score: {
    mean: Math.round(scores.reduce((a, b) => a + b, 0) / NUM_GAMES),
    median: scores[Math.floor(NUM_GAMES / 2)],
    p10: pct(scores, 0.1),
    p90: pct(scores, 0.9),
    max: scores[NUM_GAMES - 1],
  },
  waves: {
    mean: parseFloat((waves.reduce((a, b) => a + b, 0) / NUM_GAMES).toFixed(2)),
    median: waves[Math.floor(NUM_GAMES / 2)],
    p10: pct(waves, 0.1),
    p90: pct(waves, 0.9),
    max: waves[NUM_GAMES - 1],
  },
  efficiency: parseFloat((totalKills / Math.max(1, totalShots)).toFixed(3)),
  waveDeaths: Object.fromEntries(
    Object.entries(waveDeaths)
      .sort((a, b) => +a[0] - +b[0])
      .map(([w, c]) => [w, c]),
  ),
};

process.stderr.write(`Done in ${elapsed}s\n`);

console.log(`// Dubai Missile Command — benchmark report`);
console.log(`// Generated: ${report.timestamp}`);
console.log(`// Seeds: 0–${NUM_GAMES - 1} | Games: ${NUM_GAMES} | Preset: ${report.preset}`);
console.log(`export default ${JSON.stringify(report, null, 2)};`);
