// Sweep across all ordered (first, second) pairs of upgrade families.
// For each pair, prepend [first, second] to the preset's upgradePriority,
// run N games, and report mean score / wave / efficiency.
//
// Usage: npx tsx src/headless/upgrade-sweep.ts [--preset=average] [--games=20]

import { runGame } from "./sim-runner.js";
import baseConfig from "./bot-config.json" with { type: "json" };

const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : def;
}

const PRESET = getArg("preset", "average");
const NUM_GAMES = parseInt(getArg("games", "20"));
const SEED_BASE = parseInt(getArg("seed-base", "30000"));
const MAX_TICKS = parseInt(getArg("maxTicks", "60000"));

// burjRepair is filtered by the bot anyway; sweep only over the active families.
const FAMILIES = [
  "wildHornets",
  "roadrunner",
  "flare",
  "ironBeam",
  "phalanx",
  "patriot",
  "launcherKit",
  "emp",
] as const;

type ResultRow = {
  first: string;
  second: string;
  meanScore: number;
  meanWave: number;
  meanEff: number;
  destroyed: number;
};

function deepCloneConfig<T>(cfg: T): T {
  return JSON.parse(JSON.stringify(cfg));
}

function buildSweepConfig(first: string, second: string): Record<string, unknown> {
  const cfg = deepCloneConfig(baseConfig) as Record<string, unknown> & {
    presets: Record<string, { upgradePriority?: string[] }>;
    upgradePriority?: string[];
  };
  const preset = cfg.presets?.[PRESET];
  if (!preset) throw new Error(`Unknown preset: ${PRESET}`);
  const original = (preset.upgradePriority ?? cfg.upgradePriority ?? []) as string[];
  const rest = original.filter((k) => k !== first && k !== second);
  preset.upgradePriority = [first, second, ...rest];
  return cfg;
}

async function runPair(first: string, second: string): Promise<ResultRow> {
  const config = buildSweepConfig(first, second);
  let totalScore = 0;
  let totalWave = 0;
  let totalEff = 0;
  let destroyed = 0;
  for (let i = 0; i < NUM_GAMES; i++) {
    const r = runGame(config, {
      seed: SEED_BASE + i,
      maxTicks: MAX_TICKS,
      preset: PRESET,
      draftMode: true,
    });
    totalScore += r.score;
    totalWave += r.wave;
    const k = r.stats.missileKills + r.stats.droneKills;
    totalEff += r.stats.shotsFired > 0 ? k / r.stats.shotsFired : 0;
    if (r.deathCause === "destroyed") destroyed++;
  }
  return {
    first,
    second,
    meanScore: totalScore / NUM_GAMES,
    meanWave: totalWave / NUM_GAMES,
    meanEff: totalEff / NUM_GAMES,
    destroyed,
  };
}

async function main() {
  console.log(`\n=== Upgrade pair sweep ===`);
  console.log(
    `Preset: ${PRESET}, games per pair: ${NUM_GAMES}, total pairs: ${FAMILIES.length * (FAMILIES.length - 1)}`,
  );
  console.log(`Seed range: ${SEED_BASE}..${SEED_BASE + NUM_GAMES - 1}\n`);

  const results: ResultRow[] = [];
  const t0 = performance.now();

  let idx = 0;
  const total = FAMILIES.length * (FAMILIES.length - 1);
  for (const first of FAMILIES) {
    for (const second of FAMILIES) {
      if (first === second) continue;
      idx++;
      process.stdout.write(`\r  ${idx}/${total}: ${first.padEnd(14)} → ${second.padEnd(14)}`);
      const row = await runPair(first, second);
      results.push(row);
    }
  }
  process.stdout.write("\n");
  console.log(`\nTotal: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  results.sort((a, b) => b.meanScore - a.meanScore);

  console.log("\n── Ranked by mean score ──");
  console.log(
    `  ${"rank".padEnd(5)} ${"1st".padEnd(13)} ${"2nd".padEnd(13)} ${"score".padEnd(10)} ${"wave".padEnd(7)} ${"eff".padEnd(7)} dead`,
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `  ${String(i + 1).padEnd(5)} ${r.first.padEnd(13)} ${r.second.padEnd(13)} ${r.meanScore.toFixed(0).padEnd(10)} ${r.meanWave.toFixed(2).padEnd(7)} ${r.meanEff.toFixed(3).padEnd(7)} ${r.destroyed}/${NUM_GAMES}`,
    );
  }

  // Pivot: rank starting upgrades by mean score across all "second" choices
  console.log("\n── Best first upgrade (averaged over second) ──");
  const byFirst = new Map<string, number[]>();
  for (const r of results) {
    if (!byFirst.has(r.first)) byFirst.set(r.first, []);
    byFirst.get(r.first)!.push(r.meanScore);
  }
  const firstRanked = [...byFirst.entries()]
    .map(([first, scores]) => ({
      first,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.mean - a.mean);
  for (const { first, mean } of firstRanked) {
    console.log(`  ${first.padEnd(14)} mean=${mean.toFixed(0)}`);
  }

  console.log("\n── Best second upgrade (averaged over first) ──");
  const bySecond = new Map<string, number[]>();
  for (const r of results) {
    if (!bySecond.has(r.second)) bySecond.set(r.second, []);
    bySecond.get(r.second)!.push(r.meanScore);
  }
  const secondRanked = [...bySecond.entries()]
    .map(([second, scores]) => ({
      second,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.mean - a.mean);
  for (const { second, mean } of secondRanked) {
    console.log(`  ${second.padEnd(14)} mean=${mean.toFixed(0)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
