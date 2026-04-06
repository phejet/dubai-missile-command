#!/usr/bin/env node
/**
 * Local LLM bot optimization loop — uses LM Studio (OpenAI-compatible API)
 *
 * Usage:
 *   node src/headless/learn-local.mjs [options]
 *
 * Options:
 *   --api=http://localhost:1234/v1   LM Studio base URL
 *   --model=<name>                   Model name (auto-detected if omitted)
 *   --rounds=5                       Optimization iterations
 *   --games=50                       Games per benchmark
 *   --min-improvement=0.02           Min fractional score gain to keep a change
 *   --preset=perfect                 Bot preset to optimize
 */

import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runGame } from "./sim-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── CLI args ──
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);

const API_URL = args.api || process.env.LLM_API_URL || "http://localhost:1234/v1";
const MODEL_OVERRIDE = args.model || process.env.LLM_MODEL || null;
const ROUNDS = parseInt(args.rounds || "5");
const NUM_GAMES = parseInt(args.games || "50");
const MIN_IMPROVEMENT = parseFloat(args["min-improvement"] || "0.02");
const PRESET = args.preset || "perfect";

const CONFIG_PATH = join(__dirname, "bot-config.json");
const BRAIN_PATH = join(__dirname, "bot-brain.js");
const LOG_PATH = join(__dirname, "learn-local-log.jsonl");

// ── Helpers ──

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function pct(arr: number[], p: number) {
  return arr[Math.min(Math.floor(arr.length * p), arr.length - 1)];
}

function benchmark(numGames: number, config: Record<string, unknown>) {
  const results = [];
  for (let seed = 0; seed < numGames; seed++) {
    results.push(runGame(config, { seed, preset: PRESET }));
  }
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const waves = results.map((r) => r.wave).sort((a, b) => a - b);
  const kills = results.map((r) => r.stats.missileKills + r.stats.droneKills);
  const shots = results.map((r) => r.stats.shotsFired);
  const meanKills = kills.reduce((a, b) => a + b, 0) / numGames;
  const meanShots = shots.reduce((a, b) => a + b, 0) / numGames;
  return {
    games: numGames,
    score: {
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / numGames),
      median: scores[Math.floor(numGames / 2)],
      p10: pct(scores, 0.1),
      p90: pct(scores, 0.9),
      max: scores[numGames - 1],
    },
    waves: {
      mean: +(waves.reduce((a, b) => a + b, 0) / numGames).toFixed(2),
      median: waves[Math.floor(numGames / 2)],
      p10: pct(waves, 0.1),
      p90: pct(waves, 0.9),
      max: waves[numGames - 1],
    },
    efficiency: +(meanKills / Math.max(1, meanShots)).toFixed(3),
  };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge((target[key] || {}) as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function appendLog(entry: Record<string, unknown>) {
  appendFileSync(LOG_PATH, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n");
}

function fmtStats(s: ReturnType<typeof benchmark>) {
  return `score mean=${s.score.mean} median=${s.score.median} p10=${s.score.p10} p90=${s.score.p90} | waves mean=${s.waves.mean} median=${s.waves.median} max=${s.waves.max} | eff=${s.efficiency}`;
}

// ── LM Studio query ──

async function detectModel() {
  if (MODEL_OVERRIDE) return MODEL_OVERRIDE;
  try {
    const res = await fetch(`${API_URL}/models`);
    const data = await res.json();
    return data.data?.[0]?.id || "default";
  } catch {
    return "default";
  }
}

type HistoryEntry = { round: number; kept: boolean; patch: { analysis?: string }; stats: ReturnType<typeof benchmark> };

async function queryQwen(
  model: string,
  config: Record<string, unknown>,
  stats: ReturnType<typeof benchmark>,
  history: HistoryEntry[],
  round: number,
) {
  const botBrain = readFileSync(BRAIN_PATH, "utf-8");
  const configStr = JSON.stringify(config, null, 2);

  const historyStr =
    history.length > 0
      ? history
          .map(
            (h) =>
              `Round ${h.round}: ${h.kept ? "✓ kept" : "✗ reverted"} — ${h.patch.analysis || "no analysis"}\n  Score: ${fmtStats(h.stats)}`,
          )
          .join("\n")
      : "None yet.";

  const prompt = `You are an expert game AI tuner for "Dubai Missile Command", a missile defense game.

## Game summary
- 3 launchers fire interceptors; enemies: ballistic missiles, Shahed-136 drones, Shahed-238 jet drones, MIRVs (wave 5+)
- Auto-defense upgrades bought in priority order each wave: patriot, wildHornets, launcherKit, ironBeam, roadrunner, phalanx, flare, emp
- Bot preset being optimized: "${PRESET}"

## Current bot-config.json
\`\`\`json
${configStr}
\`\`\`

## Current bot-brain.js
\`\`\`js
${botBrain}
\`\`\`

## Optimization history
${historyStr}

## Round ${round} benchmark (${NUM_GAMES} games, preset="${PRESET}")
${fmtStats(stats)}

## Task
Analyze performance and propose ONE focused improvement. You may change:
1. bot-config.json parameters (configPatch — only changed fields)
2. bot-brain.js logic (brainPatch — full file replacement, or null)

Respond with ONLY a JSON object, no other text:
\`\`\`json
{
  "analysis": "2-3 sentences identifying the main bottleneck",
  "reasoning": "why your proposed change will help",
  "configPatch": { /* only changed fields, or null */ },
  "brainPatch": null
}
\`\`\`

Rules:
- Make ONE change at a time (config OR brain, not both unless tightly coupled)
- Prefer config changes over brain rewrites
- If suggesting brainPatch, return the complete bot-brain.js content
- Do not change things already performing well`;

  const res = await fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 8192,
      stream: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";

  // Strip markdown fences and parse JSON
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const raw = jsonMatch[1].trim();
  const parsed = JSON.parse(raw);

  // Validate shape
  if (typeof parsed !== "object" || parsed === null) throw new Error("Response is not an object");
  return {
    analysis: parsed.analysis || "",
    reasoning: parsed.reasoning || "",
    configPatch: parsed.configPatch || null,
    brainPatch: parsed.brainPatch || null,
  };
}

// ── Patch apply / revert ──

function applyPatch(patch: { configPatch?: Record<string, unknown>; brainPatch?: string }, origConfig: string) {
  if (patch.configPatch) {
    const config = JSON.parse(origConfig) as Record<string, unknown>;
    const updated = deepMerge(config, patch.configPatch);
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2) + "\n");
  }
  if (patch.brainPatch) {
    writeFileSync(BRAIN_PATH, patch.brainPatch);
  }
}

function revertPatch(origConfig: string, origBrain: string) {
  writeFileSync(CONFIG_PATH, origConfig);
  writeFileSync(BRAIN_PATH, origBrain);
}

function autoCommit(baseline: ReturnType<typeof benchmark>, best: ReturnType<typeof benchmark>, rounds: number) {
  try {
    execSync("git add src/headless/bot-config.json src/headless/bot-brain.js", { cwd: join(__dirname, "../..") });
    const msg = `Bot opt (local LLM): ${rounds} rounds, score ${baseline.score.median}→${best.score.median}, waves ${baseline.waves.median}→${best.waves.median}`;
    execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd: join(__dirname, "../..") });
    console.log(`\nCommitted: ${msg}`);
  } catch (e) {
    console.log(`\nNothing to commit (no improvements kept) — ${(e as Error).message.slice(0, 80)}`);
  }
}

// ── Main ──

async function main() {
  console.log("\n=== Dubai Missile Command — Local LLM Bot Optimizer ===");
  console.log(`API: ${API_URL}`);
  console.log(
    `Rounds: ${ROUNDS} | Games/benchmark: ${NUM_GAMES} | Min improvement: ${(MIN_IMPROVEMENT * 100).toFixed(0)}% | Preset: ${PRESET}`,
  );
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Brain:  ${BRAIN_PATH}\n`);

  const model = await detectModel();
  console.log(`Model: ${model}\n`);

  // Baseline
  console.log("── Baseline benchmark ──");
  const baselineConfig = loadConfig();
  const baseline = benchmark(NUM_GAMES, baselineConfig);
  console.log(`  ${fmtStats(baseline)}`);
  appendLog({ type: "baseline", stats: baseline, config: baselineConfig });

  let best = baseline;
  const history: HistoryEntry[] = [];
  let keptCount = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${"─".repeat(54)}`);
    console.log(`  Round ${round}/${ROUNDS}`);
    console.log("─".repeat(54));

    // Save originals before any patch
    const origConfig = readFileSync(CONFIG_PATH, "utf-8");
    const origBrain = readFileSync(BRAIN_PATH, "utf-8");

    // Query Qwen
    console.log("  Querying LLM...");
    let patch;
    try {
      patch = await queryQwen(model, JSON.parse(origConfig) as Record<string, unknown>, best, history, round);
    } catch (err) {
      const e = err as Error;
      console.log(`  ✗ LLM error: ${e.message} — skipping round`);
      appendLog({ type: "error", round, error: e.message });
      continue;
    }

    console.log(`  Analysis: ${patch.analysis}`);
    console.log(`  Reasoning: ${patch.reasoning}`);
    if (patch.configPatch) console.log(`  Config patch: ${JSON.stringify(patch.configPatch)}`);
    if (patch.brainPatch) console.log(`  Brain patch: full replacement (${patch.brainPatch.length} chars)`);

    if (!patch.configPatch && !patch.brainPatch) {
      console.log("  No changes proposed — skipping round");
      history.push({ round, kept: false, patch, stats: best });
      continue;
    }

    // Apply and benchmark
    applyPatch(patch, origConfig);
    console.log("  Benchmarking after patch...");
    const after = benchmark(NUM_GAMES, loadConfig());
    console.log(`  Before: ${fmtStats(best)}`);
    console.log(`  After:  ${fmtStats(after)}`);

    const improved = after.score.mean > best.score.mean * (1 + MIN_IMPROVEMENT);
    if (improved) {
      console.log(
        `  ✓ Kept — score ${best.score.mean} → ${after.score.mean} (+${((after.score.mean / best.score.mean - 1) * 100).toFixed(1)}%)`,
      );
      best = after;
      keptCount++;
      history.push({ round, kept: true, patch, stats: after });
      appendLog({
        type: "result",
        round,
        kept: true,
        patch: { analysis: patch.analysis, configPatch: patch.configPatch, hasBrainPatch: !!patch.brainPatch },
        before: best,
        after,
      });
    } else {
      console.log(`  ✗ Reverted — insufficient improvement (${best.score.mean} → ${after.score.mean})`);
      revertPatch(origConfig, origBrain);
      history.push({ round, kept: false, patch, stats: after });
      appendLog({
        type: "result",
        round,
        kept: false,
        patch: { analysis: patch.analysis, configPatch: patch.configPatch, hasBrainPatch: !!patch.brainPatch },
        before: best,
        after,
      });
    }
  }

  // Summary
  console.log(`\n${"═".repeat(54)}`);
  console.log("  SUMMARY");
  console.log("═".repeat(54));
  console.log(`  Rounds: ${ROUNDS} | Kept: ${keptCount} | Reverted: ${ROUNDS - keptCount}`);
  console.log(`  Score:  ${baseline.score.median} → ${best.score.median} (median)`);
  console.log(`  Waves:  ${baseline.waves.median} → ${best.waves.median} (median)`);

  autoCommit(baseline, best, ROUNDS);

  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: join(__dirname, "../..") })
    .toString()
    .trim();
  console.log(`\nBranch: ${branch}`);
  console.log(`Review: git diff main..${branch} -- src/headless/bot-config.json src/headless/bot-brain.js`);
  console.log(`Log:    ${LOG_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
