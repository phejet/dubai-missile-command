// Score attribution harness.
//
// Answers "where do the points actually come from?" by intercepting every write
// to GameState.score and tagging it with the subsystem that caused it.
// Instrumentation lives in score-probe.ts and is shared with combo-eval.ts.
//
// Usage:
//   npx tsx src/headless/score-attrib.ts [--preset=perfect] [--games=20] [--seed=1000]
//   npx tsx src/headless/score-attrib.ts --all [--fixed-build] [--json=out.json]

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { runGame } from "./sim-runner";
import { SRC, attachScoreProbe, emptyLedger, reportUnclassified, type Ledger } from "./score-probe";
import type { GameState } from "../types";

const args = process.argv.slice(2);
const getArg = (name: string, def: string): string => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : def;
};

interface RunSummary {
  preset: string;
  seed: number;
  score: number;
  wave: number;
  shots: number;
  kills: number;
  maxCombo: number;
  buildingsAlive: number;
  ledger: Ledger;
}

// --fixed-build forces every preset onto the same upgrade priority, so a tier
// comparison measures aim/reaction skill alone rather than build choice.
const FIXED_BUILD = args.includes("--fixed-build");
const baseConfig = JSON.parse(readFileSync(resolve(SRC, "headless/bot-config.json"), "utf8"));
if (FIXED_BUILD) {
  const shared = baseConfig.presets.perfect.upgradePriority;
  for (const p of Object.values(baseConfig.presets) as Record<string, unknown>[]) {
    p.upgradePriority = shared;
    delete p.upgradeStrategy;
  }
}

function runOne(preset: string, seed: number): RunSummary {
  const led = emptyLedger();
  let live: GameState | null = null;
  const res = runGame(FIXED_BUILD ? baseConfig : null, {
    seed,
    preset,
    isHuman: true, // applies the buildings-survived bonus the real bonus screen awards
    maxTicks: 200000,
    onInit: (g) => {
      live = g;
      attachScoreProbe(g, led);
    },
  });
  reportUnclassified(led);
  return {
    preset,
    seed,
    score: res.score,
    wave: res.wave,
    shots: res.stats.shotsFired,
    kills: res.stats.missileKills + res.stats.droneKills,
    maxCombo: res.stats.maxCombo,
    buildingsAlive: (live as GameState | null)?.buildings.filter((b) => b.alive).length ?? 0,
    ledger: led,
  };
}

function mergeLedgers(runs: RunSummary[]): Ledger {
  const out = emptyLedger();
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.ledger.bySource)) out.bySource[k] = (out.bySource[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.ledger.killsBySource))
      out.killsBySource[k] = (out.killsBySource[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.ledger.comboAmpBySource))
      out.comboAmpBySource[k] = (out.comboAmpBySource[k] ?? 0) + v;
    out.comboAmplification += r.ledger.comboAmplification;
    out.baseKillPoints += r.ledger.baseKillPoints;
    out.comboSamples.push(...r.ledger.comboSamples);
  }
  return out;
}

// "player-aimed" = the player's own interceptor blast, including chains it set off
// (chain blasts inherit their root explosion's source tag).
const PLAYER_SOURCES = new Set(["kill:player-interceptor", "multikill:player-interceptor"]);

function report(preset: string, runs: RunSummary[]): void {
  const n = runs.length;
  const led = mergeLedgers(runs);
  const total = Object.values(led.bySource).reduce((a, b) => a + b, 0);
  const avg = (x: number) => Math.round(x / n).toLocaleString();
  const pct = (x: number) => `${((x / total) * 100).toFixed(1)}%`;

  const scores = runs.map((r) => r.score).sort((a, b) => a - b);
  const waves = runs.map((r) => r.wave);
  const median = scores[Math.floor(scores.length / 2)];
  const meanWave = waves.reduce((a, b) => a + b, 0) / n;
  const shots = runs.reduce((a, r) => a + r.shots, 0);
  const kills = runs.reduce((a, r) => a + r.kills, 0);

  console.log(`\n═══ ${preset.toUpperCase()}  (${n} games) ═══`);
  console.log(
    `  median score ${median.toLocaleString()}   mean wave ${meanWave.toFixed(1)}   ` +
      `shots ${shots}   kills ${kills}   kills/shot ${(kills / Math.max(1, shots)).toFixed(2)}`,
  );
  console.log(`  ── points per game by source ──`);
  const rows = Object.entries(led.bySource).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) {
    console.log(`    ${k.padEnd(30)} ${avg(v).padStart(10)}  ${pct(v).padStart(7)}`);
  }

  const killTotal = rows.filter(([k]) => k.startsWith("kill:") || k.startsWith("multikill:")).reduce((a, [, v]) => a + v, 0);
  const playerKill = rows.filter(([k]) => PLAYER_SOURCES.has(k)).reduce((a, [, v]) => a + v, 0);
  const bonusTotal = rows.filter(([k]) => k.startsWith("bonus:")).reduce((a, [, v]) => a + v, 0);

  console.log(`  ── rollup ──`);
  console.log(`    player-aimed kill points      ${avg(playerKill).padStart(10)}  ${pct(playerKill).padStart(7)}`);
  console.log(
    `    automated kill points         ${avg(killTotal - playerKill).padStart(10)}  ${pct(killTotal - playerKill).padStart(7)}`,
  );
  console.log(`    flat bonuses (no skill)       ${avg(bonusTotal).padStart(10)}  ${pct(bonusTotal).padStart(7)}`);
  console.log(
    `    combo amplification           ${avg(led.comboAmplification).padStart(10)}  ${pct(led.comboAmplification).padStart(7)}` +
      `   (base kill value ${avg(led.baseKillPoints)})`,
  );
  const meanCombo = led.comboSamples.reduce((a, b) => a + b, 0) / Math.max(1, led.comboSamples.length);
  console.log(`    mean combo at time of kill    ${meanCombo.toFixed(2)}x`);
}

// ── main ──────────────────────────────────────────────────────────────────────
const games = parseInt(getArg("games", "20"));
const baseSeed = parseInt(getArg("seed", "1000"));
const presets = args.includes("--all") ? ["novice", "average", "good", "perfect"] : [getArg("preset", "good")];

const all: Record<string, RunSummary[]> = {};
for (const preset of presets) {
  const runs: RunSummary[] = [];
  for (let i = 0; i < games; i++) runs.push(runOne(preset, baseSeed + i));
  all[preset] = runs;
  report(preset, runs);
}

const jsonOut = args.find((a) => a.startsWith("--json="));
if (jsonOut) {
  const rows = Object.entries(all).flatMap(([preset, runs]) =>
    runs.map((r) => ({
      preset,
      seed: r.seed,
      score: r.score,
      wave: r.wave,
      shots: r.shots,
      kills: r.kills,
      bySource: r.ledger.bySource,
      killsBySource: r.ledger.killsBySource,
      comboAmpBySource: r.ledger.comboAmpBySource,
      maxCombo: r.maxCombo,
      buildingsAlive: r.buildingsAlive,
      comboAmplification: r.ledger.comboAmplification,
      baseKillPoints: r.ledger.baseKillPoints,
    })),
  );
  writeFileSync(jsonOut.split("=")[1], JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${rows.length} runs to ${jsonOut.split("=")[1]}`);
}

if (presets.length > 1) {
  console.log(`\n═══ SKILL SEPARATION ═══`);
  const med = (p: string) => {
    const s = all[p].map((r) => r.score).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const base = med("novice");
  for (const p of presets) {
    const m = med(p);
    const meanWave = all[p].reduce((a, r) => a + r.wave, 0) / all[p].length;
    const acc = all[p].reduce((a, r) => a + r.kills, 0) / Math.max(1, all[p].reduce((a, r) => a + r.shots, 0));
    console.log(
      `  ${p.padEnd(9)} median ${String(m).padStart(9)}   ${(m / base).toFixed(2)}x novice   ` +
        `mean wave ${meanWave.toFixed(1)}   kills/shot ${acc.toFixed(2)}`,
    );
  }
}
