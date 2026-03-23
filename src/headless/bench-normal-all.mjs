/**
 * Normal-mode benchmark for all 4 presets using same seeds as bench-draft.mjs.
 */
import { setRng, fireInterceptor } from "../game-logic.js";
import { initGame, update, buyUpgrade, closeShop, repairSite, repairLauncher, fireEmp } from "../game-sim.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades, resolveBotConfig } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };
import { writeFileSync } from "fs";

const NUM_GAMES = 300;
const MAX_TICKS = 100_000;
const PRESETS = ["perfect", "good", "average", "novice"];
const SEEDS = Array.from({ length: NUM_GAMES }, (_, i) => i + 99999);

function runGame(seed, preset) {
  const config = resolveBotConfig(defaultConfig, preset);
  const rng = mulberry32(seed);
  setRng(rng);
  const g = initGame();
  let lastFireTick = -Infinity;
  let deathCause = "timeout";

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (g.state === "gameover") { deathCause = "destroyed"; break; }
    if (g.state === "shop") {
      const { repairs, priority } = botDecideUpgrades(g, config);
      for (const r of repairs) {
        if (r.type === "repairLauncher") repairLauncher(g, r.index);
        else if (r.type === "repairSite") repairSite(g, r.key);
      }
      let boughtAny = true;
      while (boughtAny) {
        boughtAny = false;
        for (const key of priority) { if (buyUpgrade(g, key)) boughtAny = true; }
      }
      closeShop(g);
    }
    if (g.empReady) {
      const threats = g.missiles.filter(m => m.alive).length + g.drones.filter(d => d.alive).length;
      if (threats >= (config.emp?.minThreatsToFire || 4)) fireEmp(g, null);
    }
    const action = botDecideAction(g, config, lastFireTick, tick);
    if (action) {
      g.crosshairX = action.x; g.crosshairY = action.y;
      fireInterceptor(g, action.x, action.y);
      lastFireTick = tick;
    }
    update(g, 1, null);
  }
  setRng(Math.random);
  return { score: g.score, wave: g.wave, stats: { ...g.stats }, deathCause };
}

function pct(arr, p) { return [...arr].sort((a,b)=>a-b)[Math.floor(arr.length*p)]; }
function avg(arr) { return arr.reduce((s,v)=>s+v,0)/arr.length; }

console.log(`\n=== NORMAL MODE Baseline: ${NUM_GAMES} games × ${PRESETS.length} presets ===\n`);
const allResults = {};

for (const preset of PRESETS) {
  const t0 = performance.now();
  const results = SEEDS.map(seed => runGame(seed, preset));
  const elapsed = performance.now() - t0;

  const scores = results.map(r => r.score);
  const waves  = results.map(r => r.wave);
  const kills  = results.map(r => r.stats.missileKills + r.stats.droneKills);
  const shots  = results.map(r => r.stats.shotsFired);
  const eff    = results.map(r => r.stats.shotsFired > 0 ? (r.stats.missileKills + r.stats.droneKills) / r.stats.shotsFired : 0);

  const deathCauses = {};
  results.forEach(r => { deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1; });
  const waveDist = {};
  waves.forEach(w => { waveDist[w] = (waveDist[w] || 0) + 1; });

  const summary = {
    preset,
    score: { mean: avg(scores), median: pct(scores,0.5), p10: pct(scores,0.1), p90: pct(scores,0.9) },
    wave: { mean: avg(waves), median: pct(waves,0.5), p10: pct(waves,0.1), p90: pct(waves,0.9) },
    kills: avg(kills), shots: avg(shots), efficiency: avg(eff),
    deathCauses, waveDist,
  };
  allResults[preset] = summary;

  console.log(`── ${preset.toUpperCase()} (${(elapsed/1000).toFixed(1)}s) ──`);
  console.log(`  Score: mean=${avg(scores).toFixed(0)} median=${pct(scores,0.5)} p10=${pct(scores,0.1)} p90=${pct(scores,0.9)}`);
  console.log(`  Waves: mean=${avg(waves).toFixed(1)} median=${pct(waves,0.5)} p10=${pct(waves,0.1)} p90=${pct(waves,0.9)}`);
  console.log(`  Efficiency: ${avg(eff).toFixed(3)} kills/shot`);
  const topWaves = Object.keys(waveDist).sort((a,b)=>waveDist[b]-waveDist[a]).slice(0,5);
  console.log(`  Top waves: ${topWaves.map(w=>`${w}(${waveDist[w]})`).join(", ")}`);
  console.log();
}

writeFileSync("normal-bench-all.json", JSON.stringify(allResults, null, 2));
console.log("JSON saved to normal-bench-all.json");
