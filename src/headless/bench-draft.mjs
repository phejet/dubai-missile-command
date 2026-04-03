/**
 * Draft-mode balance sweep: all 4 bot presets.
 *
 * Draft rules:
 *   - Shop shows exactly 3 randomly drawn upgrades (non-maxed, seeded RNG)
 *   - Bot buys exactly ONE item — its highest-priority pick from those 3
 *   - All upgrade costs are forced to 0 (items are free)
 *   - Repairs (launcher / site) remain free and happen before the draft pick,
 *     and do NOT count against the one-item limit
 *
 * Usage:  node src/headless/bench-draft.mjs
 */

import { Worker } from "worker_threads";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";

import { setRng, fireInterceptor } from "../game-logic.js";
import { initGame, update, buyUpgrade, closeShop, repairSite, repairLauncher, fireEmp, UPGRADES } from "../game-sim.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades, resolveBotConfig } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NUM_GAMES = 300;
const MAX_TICKS = 100_000;
const PRESETS = ["perfect", "good", "average", "novice"];
const SEEDS = Array.from({ length: NUM_GAMES }, (_, i) => i + 99999);

const ALL_UPGRADE_KEYS = Object.keys(UPGRADES);

/** Draw 3 unique non-maxed upgrade keys using the seeded RNG. */
function draftPick3(g, rng) {
  const available = ALL_UPGRADE_KEYS.filter((k) => g.upgrades[k] < UPGRADES[k].maxLevel);
  if (available.length <= 3) return [...available];
  // Fisher-Yates partial shuffle to pick 3
  const pool = [...available];
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

/** Force cost=0 for one upgrade key and buy it. */
function buyFree(g, key) {
  const def = UPGRADES[key];
  if (!def || g.upgrades[key] >= def.maxLevel) return false;
  const savedCosts = [...def.costs];
  def.costs = [0, 0, 0];
  const ok = buyUpgrade(g, key);
  def.costs = savedCosts;
  return ok;
}

function runGameDraft(botConfig, seed, preset) {
  const config = resolveBotConfig(botConfig, preset);
  const rng = mulberry32(seed);
  setRng(rng);

  const g = initGame();
  let lastFireTick = -Infinity;
  let deathCause = "timeout";
  const draftLog = []; // per-wave draft picks

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (g.state === "gameover") {
      deathCause = "destroyed";
      break;
    }

    if (g.state === "shop") {
      const waveDraft = { wave: g.wave + 1, offered: [], picked: null };

      // Repairs first (free, not counted as the draft pick)
      const { repairs, priority } = botDecideUpgrades(g, config);
      for (const r of repairs) {
        if (r.type === "repairLauncher") repairLauncher(g, r.index);
        else if (r.type === "repairSite") repairSite(g, r.key);
      }

      // Draft: 3 random items from non-maxed pool
      const offered = draftPick3(g, rng);
      waveDraft.offered = offered;

      // Bot picks its top priority item from offered set
      const pick = priority.find((k) => offered.includes(k));
      if (pick) {
        buyFree(g, pick);
        waveDraft.picked = pick;
      }

      draftLog.push(waveDraft);
      closeShop(g);
    }

    // EMP
    if (g.empReady) {
      const threats = g.missiles.filter((m) => m.alive).length + g.drones.filter((d) => d.alive).length;
      if (threats >= (config.emp?.minThreatsToFire || 4)) fireEmp(g, null);
    }

    // Targeting
    const action = botDecideAction(g, config, lastFireTick, tick);
    if (action) {
      g.crosshairX = action.x;
      g.crosshairY = action.y;
      fireInterceptor(g, action.x, action.y);
      lastFireTick = tick;
    }

    update(g, 1, null);
  }

  setRng(Math.random);
  return {
    score: g.score,
    wave: g.wave,
    stats: { ...g.stats },
    deathCause,
    seed,
    draftLog,
  };
}

// ── Run all presets ──────────────────────────────────────────────────────────

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}
function avg(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

console.log(`\n=== DRAFT MODE Balance Sweep: ${NUM_GAMES} games × ${PRESETS.length} presets ===\n`);

const allResults = {};

for (const preset of PRESETS) {
  const t0 = performance.now();
  const results = SEEDS.map((seed) => runGameDraft(defaultConfig, seed, preset));
  const elapsed = performance.now() - t0;

  const scores = results.map((r) => r.score);
  const waves = results.map((r) => r.wave);
  const kills = results.map((r) => r.stats.missileKills + r.stats.droneKills);
  const shots = results.map((r) => r.stats.shotsFired);
  const eff = results.map((r) =>
    r.stats.shotsFired > 0 ? (r.stats.missileKills + r.stats.droneKills) / r.stats.shotsFired : 0,
  );

  const deathCauses = {};
  results.forEach((r) => {
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
  });

  const waveDist = {};
  waves.forEach((w) => {
    waveDist[w] = (waveDist[w] || 0) + 1;
  });

  // Draft pick frequency (which upgrade was picked most often across all waves)
  const pickFreq = {};
  for (const r of results) {
    for (const d of r.draftLog) {
      if (d.picked) pickFreq[d.picked] = (pickFreq[d.picked] || 0) + 1;
    }
  }
  const totalPicks = Object.values(pickFreq).reduce((s, v) => s + v, 0);

  const summary = {
    preset,
    elapsed: (elapsed / 1000).toFixed(1),
    score: { mean: avg(scores), median: pct(scores, 0.5), p10: pct(scores, 0.1), p90: pct(scores, 0.9) },
    wave: { mean: avg(waves), median: pct(waves, 0.5), p10: pct(waves, 0.1), p90: pct(waves, 0.9) },
    kills: avg(kills),
    shots: avg(shots),
    efficiency: avg(eff),
    deathCauses,
    waveDist,
    pickFreq,
    totalPicks,
  };
  allResults[preset] = summary;

  console.log(`── ${preset.toUpperCase()} (${elapsed.toFixed(0)}ms) ──`);
  console.log(
    `  Score: mean=${avg(scores).toFixed(0)} median=${pct(scores, 0.5)} p10=${pct(scores, 0.1)} p90=${pct(scores, 0.9)}`,
  );
  console.log(
    `  Waves: mean=${avg(waves).toFixed(1)} median=${pct(waves, 0.5)} p10=${pct(waves, 0.1)} p90=${pct(waves, 0.9)}`,
  );
  console.log(`  Efficiency: ${avg(eff).toFixed(3)} kills/shot`);
  console.log(`  Deaths: ${JSON.stringify(deathCauses)}`);

  const topWaves = Object.keys(waveDist)
    .sort((a, b) => waveDist[b] - waveDist[a])
    .slice(0, 5);
  console.log(`  Top waves: ${topWaves.map((w) => `${w}(${waveDist[w]})`).join(", ")}`);

  const topPicks = Object.keys(pickFreq)
    .sort((a, b) => pickFreq[b] - pickFreq[a])
    .slice(0, 5)
    .map((k) => `${k}=${((pickFreq[k] / totalPicks) * 100).toFixed(1)}%`);
  console.log(`  Draft picks: ${topPicks.join(", ")}`);
  console.log();
}

writeFileSync("draft-bench-results.json", JSON.stringify(allResults, null, 2));
console.log("JSON saved to draft-bench-results.json");
