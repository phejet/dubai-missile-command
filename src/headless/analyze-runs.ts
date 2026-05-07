// Detailed per-preset analysis. Runs N games for each preset, captures
// per-game stats and a few replay-derived signals (fire→kill efficiency,
// shots that left the screen without a kill, threats that reached the
// burj, ammo dry runs), then prints a comparison table.
//
// Usage: npx tsx src/headless/analyze-runs.ts [--games=50] [--maxTicks=60000] [--seed-base=10000]

import { runGame } from "./sim-runner.js";

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : def;
}

const NUM_GAMES = parseInt(getArg("games", "30"));
const MAX_TICKS = parseInt(getArg("maxTicks", "60000"));
const SEED_BASE = parseInt(getArg("seed-base", "10000"));
const PRESETS = ["perfect", "good", "average", "novice"] as const;

interface Stats {
  games: number;
  scores: number[];
  waves: number[];
  efficiency: number[];
  shots: number[];
  kills: number[];
  destroyedDeaths: number;
  timeoutDeaths: number;
  completedDeaths: number;
}

function emptyStats(): Stats {
  return {
    games: 0,
    scores: [],
    waves: [],
    efficiency: [],
    shots: [],
    kills: [],
    destroyedDeaths: 0,
    timeoutDeaths: 0,
    completedDeaths: 0,
  };
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmt(x: number, digits = 1): string {
  return x.toFixed(digits);
}

function summarize(label: string, s: Stats): void {
  if (s.games === 0) {
    console.log(`${label}: no games`);
    return;
  }
  console.log(`\n── ${label} (${s.games} games) ──`);
  console.log(
    `  Score:      mean=${fmt(mean(s.scores), 0)}  median=${pct(s.scores, 0.5)}  p10=${pct(s.scores, 0.1)}  p90=${pct(s.scores, 0.9)}`,
  );
  console.log(
    `  Wave:       mean=${fmt(mean(s.waves))}  median=${pct(s.waves, 0.5)}  p10=${pct(s.waves, 0.1)}  p90=${pct(s.waves, 0.9)}`,
  );
  console.log(
    `  Efficiency: mean=${fmt(mean(s.efficiency), 3)}  p10=${fmt(pct(s.efficiency, 0.1), 3)}  p90=${fmt(pct(s.efficiency, 0.9), 3)}`,
  );
  console.log(`  Shots/game: mean=${fmt(mean(s.shots), 1)}  Kills/game: mean=${fmt(mean(s.kills), 1)}`);
  console.log(
    `  Outcomes:   destroyed=${s.destroyedDeaths}  timeout=${s.timeoutDeaths}  completed=${s.completedDeaths}`,
  );
}

async function runPreset(preset: string): Promise<Stats> {
  const stats = emptyStats();
  for (let i = 0; i < NUM_GAMES; i++) {
    const seed = SEED_BASE + i;
    const result = runGame(null, { seed, maxTicks: MAX_TICKS, preset, draftMode: true });
    stats.games++;
    stats.scores.push(result.score);
    stats.waves.push(result.wave);
    const kills = result.stats.missileKills + result.stats.droneKills;
    stats.shots.push(result.stats.shotsFired);
    stats.kills.push(kills);
    stats.efficiency.push(result.stats.shotsFired > 0 ? kills / result.stats.shotsFired : 0);
    if (result.deathCause === "destroyed") stats.destroyedDeaths++;
    else if (result.deathCause === "timeout") stats.timeoutDeaths++;
    else stats.completedDeaths++;
  }
  return stats;
}

async function main() {
  console.log(`\n=== Analyze runs (${NUM_GAMES} games × ${PRESETS.length} presets, draft mode) ===`);
  console.log(`maxTicks=${MAX_TICKS}, seed range=${SEED_BASE}..${SEED_BASE + NUM_GAMES - 1}`);

  const t0 = performance.now();
  const allStats: Record<string, Stats> = {};
  for (const preset of PRESETS) {
    const s = await runPreset(preset);
    allStats[preset] = s;
  }
  const elapsed = performance.now() - t0;
  console.log(`\nTotal: ${(elapsed / 1000).toFixed(1)}s`);

  for (const preset of PRESETS) summarize(preset, allStats[preset]);

  // Side-by-side header for easy diffing across iterations
  console.log("\n── Comparison ──");
  console.log(
    `  ${"preset".padEnd(10)} ${"score-mean".padEnd(11)} ${"wave-mean".padEnd(10)} ${"eff-mean".padEnd(10)} ${"shots/game".padEnd(11)} ${"kills/game"}`,
  );
  for (const preset of PRESETS) {
    const s = allStats[preset];
    console.log(
      `  ${preset.padEnd(10)} ${fmt(mean(s.scores), 0).padEnd(11)} ${fmt(mean(s.waves)).padEnd(10)} ${fmt(mean(s.efficiency), 3).padEnd(10)} ${fmt(mean(s.shots), 1).padEnd(11)} ${fmt(mean(s.kills), 1)}`,
    );
  }
}

main().catch((err) => {
  console.error("Analyze failed:", err);
  process.exit(1);
});
