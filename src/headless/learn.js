import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runGame } from "./sim-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
}

const ROUNDS = parseInt(getArg("rounds", "3"));
const DURATION_MS = parseInt(getArg("duration", "10000"));
const DRY_RUN = args.includes("--dry-run");
const CONFIG_PATH = join(__dirname, "bot-config.json");
const BRAIN_PATH = join(__dirname, "bot-brain.js");
const SIM_PATH = join(__dirname, "..", "game-sim.js");
const LOG_PATH = join(__dirname, "learning-log.jsonl");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function benchmark(durationMs) {
  const config = loadConfig();
  const results = [];
  const t0 = performance.now();
  let seed = 0;
  while (performance.now() - t0 < durationMs) {
    const r = runGame(config, { seed });
    results.push(r);
    seed++;
  }
  const elapsed = performance.now() - t0;

  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const waves = results.map((r) => r.wave).sort((a, b) => a - b);
  const efficiency = results.map((r) => {
    const kills = r.stats.missileKills + r.stats.droneKills;
    return r.stats.shotsFired > 0 ? kills / r.stats.shotsFired : 0;
  });
  const deathCauses = {};
  results.forEach((r) => {
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
  });
  function pct(arr, p) {
    return arr[Math.min(Math.floor(arr.length * p), arr.length - 1)];
  }

  return {
    games: results.length,
    elapsed: +(elapsed / 1000).toFixed(1),
    score: {
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      median: scores[Math.floor(scores.length / 2)],
      p10: pct(scores, 0.1),
      p90: pct(scores, 0.9),
      min: scores[0],
      max: scores[scores.length - 1],
    },
    waves: {
      mean: +(waves.reduce((a, b) => a + b, 0) / waves.length).toFixed(2),
      median: waves[Math.floor(waves.length / 2)],
      p10: pct(waves, 0.1),
      p90: pct(waves, 0.9),
      max: waves[waves.length - 1],
    },
    efficiency: {
      mean: +(efficiency.reduce((a, b) => a + b, 0) / efficiency.length).toFixed(3),
      meanKills: +(results.reduce((a, r) => a + r.stats.missileKills + r.stats.droneKills, 0) / results.length).toFixed(
        1,
      ),
      meanShots: +(results.reduce((a, r) => a + r.stats.shotsFired, 0) / results.length).toFixed(1),
    },
    deathCauses,
  };
}

async function analyzeAndPatch(config, stats, history, round) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const botBrain = readFileSync(BRAIN_PATH, "utf-8");
  const gameSim = readFileSync(SIM_PATH, "utf-8");

  const prompt = `You are an expert game AI tuner analyzing a missile defense game bot ("Dubai Missile Command").

## Current Bot Config
\`\`\`json
${JSON.stringify(config, null, 2)}
\`\`\`

## Current Bot Brain Code (bot-brain.js)
\`\`\`js
${botBrain}
\`\`\`

## Game Simulation Code (game-sim.js)
\`\`\`js
${gameSim}
\`\`\`

## Performance History
${history.map((h) => `Round ${h.round}: ${JSON.stringify(h.stats)}`).join("\n")}

## Current Round ${round} Results
${JSON.stringify(stats, null, 2)}

## Game Mechanics Summary
- 3 ground launchers (x: 60, 550, 860) fire interceptors with 49px blast radius
- Enemies: ballistic missiles (accelerating), Shahed-136 drones (drop bombs + dive), Shahed-238 jet drones (fast, multi-HP, dive only)
- Ammo: ${20} + wave*2 per launcher, refilled at wave start
- Wave scaling: target = 8 + wave*4, spawnInterval = max(20, 120-wave*10), droneInterval = max(40, 160-wave*20)
- Jet drones wave 4+ with (wave-3)*15% chance, HP = 2 + floor(wave/4)
- Upgrades bought round-robin (one level per pass through priority list)
- Defense sites destroyed mid-wave reset upgrade to 0; restored before shop opens

## Your Task
Analyze performance and suggest improvements. You may suggest:
1. **Config changes** — parameter tuning in bot-config.json
2. **Code changes** — modifications to bot-brain.js (targeting, firing logic, upgrade strategy)
3. **Bug fixes** — issues in game-sim.js that affect gameplay

Return a JSON object with this exact structure:
\`\`\`json
{
  "analysis": "Brief analysis of what's limiting performance (2-3 sentences)",
  "configPatch": { /* only changed fields, same structure as config */ },
  "brainPatch": "Full replacement content for bot-brain.js if code changes needed, or null if only config changes",
  "simFixes": "Description of any game-sim.js bugs found, or null"
}
\`\`\`

Focus on the highest-impact changes. Don't change things that are already working well.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  return JSON.parse(jsonMatch[1].trim());
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

async function main() {
  console.log(`\n=== Dubai Missile Command Bot Learning ===`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log(`Benchmark duration: ${DURATION_MS / 1000}s per round`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  const history = [];

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  ROUND ${round}/${ROUNDS}`);
    console.log(`${"═".repeat(50)}`);

    // Benchmark
    console.log(`\nRunning benchmark (${DURATION_MS / 1000}s)...`);
    const stats = benchmark(DURATION_MS);
    console.log(`  Games: ${stats.games}`);
    console.log(
      `  Score:  mean=${stats.score.mean} median=${stats.score.median} p10=${stats.score.p10} p90=${stats.score.p90} max=${stats.score.max}`,
    );
    console.log(
      `  Waves:  mean=${stats.waves.mean} median=${stats.waves.median} p10=${stats.waves.p10} p90=${stats.waves.p90} max=${stats.waves.max}`,
    );
    console.log(
      `  Efficiency: ${stats.efficiency.mean} (${stats.efficiency.meanKills} kills / ${stats.efficiency.meanShots} shots)`,
    );
    console.log(`  Deaths: ${JSON.stringify(stats.deathCauses)}`);

    history.push({ round, stats });

    const logEntry = {
      type: "benchmark",
      round,
      timestamp: new Date().toISOString(),
      stats,
      config: loadConfig(),
    };
    appendFileSync(LOG_PATH, JSON.stringify(logEntry) + "\n");

    if (round === ROUNDS && ROUNDS > 1) {
      console.log(`\nFinal round — skipping analysis.`);
      break;
    }

    if (DRY_RUN) {
      console.log(`\n[dry-run] Skipping Claude analysis`);
      continue;
    }

    // Analyze
    console.log(`\nSending to Claude for analysis...`);
    try {
      const config = loadConfig();
      const result = await analyzeAndPatch(config, stats, history, round);

      console.log(`\nAnalysis: ${result.analysis}`);

      // Apply config patch
      if (result.configPatch && Object.keys(result.configPatch).length > 0) {
        const newConfig = deepMerge(config, result.configPatch);
        writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2) + "\n");
        console.log(`Config updated: ${JSON.stringify(result.configPatch)}`);
      } else {
        console.log(`No config changes suggested.`);
      }

      // Apply brain patch
      if (result.brainPatch) {
        writeFileSync(BRAIN_PATH, result.brainPatch);
        console.log(`Bot brain code updated.`);
      }

      // Report sim fixes
      if (result.simFixes) {
        console.log(`\n⚠ Game sim issues found (manual review needed):`);
        console.log(`  ${result.simFixes}`);
      }

      appendFileSync(
        LOG_PATH,
        JSON.stringify({
          type: "analysis",
          round,
          timestamp: new Date().toISOString(),
          analysis: result.analysis,
          configPatch: result.configPatch,
          hasBrainPatch: !!result.brainPatch,
          simFixes: result.simFixes,
        }) + "\n",
      );
    } catch (err) {
      console.error(`Claude API error: ${err.message}`);
      appendFileSync(
        LOG_PATH,
        JSON.stringify({ type: "error", round, timestamp: new Date().toISOString(), error: err.message }) + "\n",
      );
    }
  }

  // Final summary
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  LEARNING SUMMARY`);
  console.log(`${"═".repeat(50)}`);
  console.log(`\nRound | Median Wave | Median Score | Max Wave | Efficiency`);
  console.log(`------+-------------+--------------+----------+-----------`);
  for (const h of history) {
    const s = h.stats;
    console.log(
      `  ${String(h.round).padStart(3)}  |     ${String(s.waves.median).padStart(6)}  |    ${String(s.score.median).padStart(8)} |    ${String(s.waves.max).padStart(4)}  |    ${s.efficiency.mean}`,
    );
  }
  console.log(`\nLog: ${LOG_PATH}`);
}

main().catch((err) => {
  console.error("Learning failed:", err);
  process.exit(1);
});
