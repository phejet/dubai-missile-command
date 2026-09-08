// Score attribution harness.
//
// Answers "where do the points actually come from?" by intercepting every write
// to GameState.score and tagging it with the subsystem that caused it.
//
// Usage:
//   npx tsx src/headless/score-attrib.ts [--preset=perfect] [--games=20] [--seed=1000]
//   npx tsx src/headless/score-attrib.ts --all

import { runGame } from "./sim-runner";
import type { Explosion, GameState } from "../types";

type Tagged = Explosion & { _src?: string };

const args = process.argv.slice(2);
const getArg = (name: string, def: string): string => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : def;
};

// ── source maps, derived from the source files themselves ─────────────────────
// Stack frames give us file:line but no function names (the sim is built from
// arrow callbacks), so we build the file:line -> label maps by reading the sim
// source at startup. That keeps the tool honest when the sim is edited.

import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (f: string) => readFileSync(resolve(SRC, f), "utf8").split("\n");

const WEAPON_BY_COLOR: [RegExp, string][] = [
  [/COL\.hornet/, "hornet"],
  [/COL\.roadrunner/, "roadrunner"],
  [/COL\.patriot/, "patriot"],
  [/COL\.interceptor/, "player-interceptor"],
  [/COL\.flare/, "flare"],
  [/COL\.phalanx/, "phalanx"],
  [/COL\.laser/, "ironbeam"],
  [/COL\.emp/, "emp"],
];

function labelFromWindow(lines: string[], idx: number, span = 12): string | null {
  const chunk = lines.slice(idx, idx + span).join("\n");
  for (const [re, label] of WEAPON_BY_COLOR) if (re.test(chunk)) return label;
  return null;
}

/** file:line of every boom()/createExplosion() call site -> the weapon that owns it. */
const explosionSites = new Map<string, string>();
/** file:line of every score write -> a coarse kind. */
const scoreSites = new Map<string, string>();
/** file:line of every damageTarget() call site -> the weapon that owns it. */
const damageSites = new Map<string, string>();

for (const file of ["game-sim.ts", "game-sim-flare.ts", "game-sim-emp.ts", "game-sim-patriot.ts"]) {
  const lines = readSrc(file);
  lines.forEach((line, i) => {
    const key = `${file}:${i + 1}`;
    if (/\bboom\(/.test(line) && !/function boom/.test(line)) {
      explosionSites.set(key, labelFromWindow(lines, i) ?? (file === "game-sim-flare.ts" ? "flare" : "enemy-impact"));
    }
    if (/\bdamageTarget\(/.test(line) && !/function damageTarget/.test(line)) {
      damageSites.set(key, labelFromWindow(lines, i, 3) ?? "unknown-weapon");
    }
    if (/\.score\s*[+-]=/.test(line)) {
      const win = lines.slice(Math.max(0, i - 8), i + 2).join("\n");
      if (/getBuildingSurvivalBonus/.test(line)) scoreSites.set(key, "bonus:buildings-survived");
      else if (/250 \* g\.wave/.test(line)) scoreSites.set(key, "bonus:wave-clear");
      else if (/\.score\s*-=/.test(line)) scoreSites.set(key, "penalty:f15-friendly-fire");
      else if (/getKillReward/.test(line)) scoreSites.set(key, /updateFlares|destroyThreat/.test(win) ? "kill:flare" : "kill:aoe");
      else if (/[Bb]onus/.test(line)) scoreSites.set(key, "multikill:aoe");
      else scoreSites.set(key, "unclassified");
    }
  });
}
{
  const lines = readSrc("game-logic.ts");
  lines.forEach((line, i) => {
    if (/\.score\s*\+=/.test(line) && /getKillReward/.test(line)) {
      scoreSites.set(`game-logic.ts:${i + 1}`, "kill:damageTarget");
    }
  });
}
// The buildings-survived bonus is applied by the host (bonus screen in the browser,
// the sim-runner sink headlessly), not by the sim.
{
  const lines = readSrc("headless/sim-runner.ts");
  lines.forEach((line, i) => {
    if (/getBuildingSurvivalBonus/.test(line) && /\.score\s*\+=/.test(line)) {
      scoreSites.set(`sim-runner.ts:${i + 1}`, "bonus:buildings-survived");
    }
  });
}

Error.stackTraceLimit = 60;
const FRAME_RE = /([A-Za-z0-9._-]+\.ts):(\d+):\d+/;

function frames(): { key: string; raw: string }[] {
  const err = new Error();
  const out: { key: string; raw: string }[] = [];
  for (const raw of (err.stack ?? "").split("\n").slice(2)) {
    const m = FRAME_RE.exec(raw);
    if (m) out.push({ key: `${m[1]}:${m[2]}`, raw });
  }
  return out;
}

/** Which weapon created this explosion? Walk out until we hit a known boom() site. */
function classifyExplosionSource(fs: { key: string }[]): string {
  for (const f of fs) {
    const hit = explosionSites.get(f.key);
    if (hit) return hit;
  }
  return "other";
}

/** Which subsystem awarded these points? */
function classifyScore(fs: { key: string }[], currentSrc: string | null): string {
  for (const f of fs) {
    const kind = scoreSites.get(f.key);
    if (!kind) continue;
    if (kind === "kill:aoe") return `kill:${currentSrc ?? "?"}`;
    if (kind === "multikill:aoe") return `multikill:${currentSrc ?? "?"}`;
    if (kind === "kill:damageTarget") {
      for (const g of fs) {
        const w = damageSites.get(g.key);
        if (w) return `kill:${w}`;
      }
      return "kill:direct-damage";
    }
    return kind;
  }
  return "unknown";
}

// ── instrumentation ───────────────────────────────────────────────────────────
interface Ledger {
  bySource: Record<string, number>;
  comboAmplification: number; // points that exist only because combo > 1
  baseKillPoints: number; // sum of raw kill rewards, combo stripped
  killsBySource: Record<string, number>;
  comboSamples: number[];
  rawSites: Record<string, number>;
  comboAmpBySource: Record<string, number>;
}

function instrument(g: GameState, led: Ledger): void {
  let currentEx: Tagged | null = null;

  // Tag explosions with their creator, and let chain blasts inherit their root's tag.
  let arr = g.explosions as Tagged[];
  const wrap = (a: Tagged[]): Tagged[] => {
    const push = Array.prototype.push.bind(a);
    const forEach = Array.prototype.forEach.bind(a);
    Object.defineProperty(a, "push", {
      configurable: true,
      value: (...items: Tagged[]) => {
        const fs = frames();
        for (const it of items) {
          // Chain blasts belong to whatever weapon started the chain.
          it._src =
            it.rootExplosionId != null
              ? (a.find((e) => e.id === it.rootExplosionId)?._src ?? "chain")
              : classifyExplosionSource(fs);
        }
        return push(...items);
      },
    });
    Object.defineProperty(a, "forEach", {
      configurable: true,
      value: (cb: (e: Tagged, i: number, all: Tagged[]) => void, thisArg?: unknown) =>
        forEach((e: Tagged, i: number, all: Tagged[]) => {
          const prev = currentEx;
          currentEx = e;
          try {
            cb.call(thisArg, e, i, all);
          } finally {
            currentEx = prev;
          }
        }),
    });
    return a;
  };
  wrap(arr);
  Object.defineProperty(g, "explosions", {
    configurable: true,
    get: () => arr,
    set: (v: Tagged[]) => {
      arr = wrap(v);
    },
  });

  // Intercept every score write.
  let score = g.score;
  Object.defineProperty(g, "score", {
    configurable: true,
    get: () => score,
    set: (v: number) => {
      const delta = v - score;
      score = v;
      if (delta === 0) return;
      const fs = frames();
      const tag = classifyScore(fs, currentEx?._src ?? null);
      led.bySource[tag] = (led.bySource[tag] ?? 0) + delta;
      if (tag === "unknown" || tag === "unclassified") {
        const site = fs.slice(0, 4).map((f) => f.key).join(" <- ");
        led.rawSites[site] = (led.rawSites[site] ?? 0) + delta;
      }
      if (tag.startsWith("kill:")) {
        const combo = Math.max(1, g.combo);
        const base = delta / combo;
        led.baseKillPoints += base;
        led.comboAmplification += delta - base;
        led.comboAmpBySource[tag] = (led.comboAmpBySource[tag] ?? 0) + (delta - base);
        led.killsBySource[tag] = (led.killsBySource[tag] ?? 0) + 1;
        led.comboSamples.push(combo);
      }
    },
  });
}

function reportUnclassified(led: Ledger): void {
  for (const [site, pts] of Object.entries(led.rawSites)) {
    console.log(`  !! unclassified ${pts} pts from ${site}`);
  }
}

function emptyLedger(): Ledger {
  return {
    bySource: {},
    comboAmplification: 0,
    baseKillPoints: 0,
    killsBySource: {},
    comboSamples: [],
    rawSites: {},
    comboAmpBySource: {},
  };
}

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
      instrument(g, led);
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
