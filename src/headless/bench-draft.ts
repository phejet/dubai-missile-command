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

import { writeFileSync } from "fs";
import { setRng, fireInterceptor } from "../game-logic.js";
import { initGame, update, closeShop, repairSite, repairLauncher, fireEmp } from "../game-sim.js";
import { buyDraftUpgrade, draftPick3 } from "../game-sim-shop.js";
import { getUpgradeNodeDef } from "../game-sim-upgrades.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades, resolveBotConfig } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };

const NUM_GAMES = 300;
const MAX_TICKS = 100_000;
const PRESETS = ["perfect", "good", "average", "novice"];
const SEEDS = Array.from({ length: NUM_GAMES }, (_, i) => i + 99999);

function runGameDraft(botConfig: Record<string, unknown>, seed: number, preset: string) {
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
      const waveDraft: { wave: number; offered: string[]; picked: string | null } = {
        wave: g.wave + 1,
        offered: [],
        picked: null,
      };

      // Repairs first (free, not counted as the draft pick)
      const { repairs, priority } = botDecideUpgrades(g, config);
      for (const r of repairs) {
        if (r.type === "repairLauncher") repairLauncher(g, r.index!);
        else if (r.type === "repairSite") repairSite(g, r.key!);
      }

      // Draft: 3 random items from non-maxed pool
      const offered = draftPick3(g);
      waveDraft.offered = offered;

      // Bot picks its top priority family from the offered node set.
      const pick = priority
        .map((family) => offered.find((nodeId) => getUpgradeNodeDef(nodeId)?.family === family || nodeId === family))
        .find(Boolean);
      if (pick) {
        buyDraftUpgrade(g, pick);
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
      if (fireInterceptor(g, action.x, action.y, tick)) {
        lastFireTick = tick;
      }
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

function pct(arr: number[], p: number) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}
function avg(arr: number[]) {
  return arr.reduce((s: number, v: number) => s + v, 0) / arr.length;
}

console.log(`\n=== DRAFT MODE Balance Sweep: ${NUM_GAMES} games × ${PRESETS.length} presets ===\n`);

const allResults: Record<string, unknown> = {};

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

  const deathCauses: Record<string, number> = {};
  results.forEach((r) => {
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
  });

  const waveDist: Record<number, number> = {};
  waves.forEach((w) => {
    waveDist[w] = (waveDist[w] || 0) + 1;
  });

  // Draft pick frequency (which upgrade was picked most often across all waves)
  const pickFreq: Record<string, number> = {};
  for (const r of results) {
    for (const d of r.draftLog) {
      if (d.picked) pickFreq[d.picked] = (pickFreq[d.picked] || 0) + 1;
    }
  }
  const totalPicks = Object.values(pickFreq).reduce((s: number, v: number) => s + v, 0);

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
    .sort((a, b) => waveDist[+b] - waveDist[+a])
    .slice(0, 5);
  console.log(`  Top waves: ${topWaves.map((w) => `${w}(${waveDist[+w]})`).join(", ")}`);

  const topPicks = Object.keys(pickFreq)
    .sort((a, b) => pickFreq[b] - pickFreq[a])
    .slice(0, 5)
    .map((k) => `${k}=${((pickFreq[k] / totalPicks) * 100).toFixed(1)}%`);
  console.log(`  Draft picks: ${topPicks.join(", ")}`);
  console.log();
}

writeFileSync("draft-bench-results.json", JSON.stringify(allResults, null, 2));
console.log("JSON saved to draft-bench-results.json");
