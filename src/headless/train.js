import { Worker } from "worker_threads";
import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
}

const NUM_GAMES = parseInt(getArg("games", "100"));
const NUM_ITERATIONS = parseInt(getArg("iterations", "10"));
const NUM_WORKERS = parseInt(getArg("workers", String(Math.min(8, (await import("os")).cpus().length))));
const DRY_RUN = args.includes("--dry-run");
const MAX_TICKS = parseInt(getArg("maxTicks", "100000"));

const CONFIG_PATH = join(__dirname, "bot-config.json");
const LOG_PATH = join(__dirname, "training-log.jsonl");

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function runBatch(config, numGames) {
  return new Promise((resolve, reject) => {
    // Split games across workers
    const gamesPerWorker = Math.ceil(numGames / NUM_WORKERS);
    const workers = [];
    const allResults = [];
    let completed = 0;

    for (let w = 0; w < NUM_WORKERS; w++) {
      const startIdx = w * gamesPerWorker;
      const count = Math.min(gamesPerWorker, numGames - startIdx);
      if (count <= 0) continue;

      const games = [];
      for (let i = 0; i < count; i++) {
        games.push({ seed: startIdx + i + Date.now(), maxTicks: MAX_TICKS });
      }

      const worker = new Worker(join(__dirname, "game-worker.js"), {
        workerData: { games, config },
      });

      workers.push(worker);

      worker.on("message", (results) => {
        allResults.push(...results);
        completed++;
        if (completed === workers.length) {
          resolve(allResults);
        }
      });

      worker.on("error", reject);
    }
  });
}

function aggregateStats(results) {
  const scores = results.map((r) => r.score).sort((a, b) => a - b);
  const waves = results.map((r) => r.wave).sort((a, b) => a - b);
  const totalKills = results.map((r) => r.stats.missileKills + r.stats.droneKills);
  const totalShots = results.map((r) => r.stats.shotsFired);
  const efficiency = results.map((r) => {
    const kills = r.stats.missileKills + r.stats.droneKills;
    return r.stats.shotsFired > 0 ? kills / r.stats.shotsFired : 0;
  });

  const deathCauses = {};
  results.forEach((r) => {
    deathCauses[r.deathCause] = (deathCauses[r.deathCause] || 0) + 1;
  });

  function percentile(arr, p) {
    const idx = Math.floor(arr.length * p);
    return arr[Math.min(idx, arr.length - 1)];
  }

  return {
    games: results.length,
    score: {
      mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      median: scores[Math.floor(scores.length / 2)],
      p10: percentile(scores, 0.1),
      p90: percentile(scores, 0.9),
      min: scores[0],
      max: scores[scores.length - 1],
    },
    waves: {
      mean: +(waves.reduce((a, b) => a + b, 0) / waves.length).toFixed(1),
      median: waves[Math.floor(waves.length / 2)],
      p10: percentile(waves, 0.1),
      p90: percentile(waves, 0.9),
    },
    efficiency: {
      mean: +(efficiency.reduce((a, b) => a + b, 0) / efficiency.length).toFixed(3),
      meanKills: +(totalKills.reduce((a, b) => a + b, 0) / totalKills.length).toFixed(1),
      meanShots: +(totalShots.reduce((a, b) => a + b, 0) / totalShots.length).toFixed(1),
    },
    deathCauses,
  };
}

async function callClaude(config, history) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const prompt = `You are tuning a bot that plays a missile defense game. The bot has configurable parameters that control its targeting, firing cadence, lead-shot computation, and upgrade purchase priority.

Current config:
${JSON.stringify(config, null, 2)}

All iteration results (${history.length} batches):
${history.map((h) => JSON.stringify(h)).join("\n")}

Analyze the full training run and suggest parameter changes to improve median score and waves survived. Consider:
- If the bot dies early (low waves), it may need better targeting or faster firing
- If ammo efficiency is low, increase cooldowns or improve lead-shot accuracy
- Upgrade priority affects which defenses get purchased first
- The cluster radius affects multi-kill targeting
- Look at trends across iterations to understand what's working and what isn't

Return ONLY a JSON object with the changed fields (same structure as config, but only include fields you want to change). No explanation, just JSON.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Extract JSON from response (handle markdown code blocks)
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
  console.log(`\n=== Dubai Missile Command Bot Training ===`);
  console.log(`Games per iteration: ${NUM_GAMES}`);
  console.log(`Iterations: ${NUM_ITERATIONS}`);
  console.log(`Workers: ${NUM_WORKERS}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  const config = loadConfig();
  const history = [];

  const totalT0 = performance.now();
  for (let iter = 1; iter <= NUM_ITERATIONS; iter++) {
    console.log(`── Iteration ${iter}/${NUM_ITERATIONS} ──`);

    const t0 = performance.now();
    const results = await runBatch(config, NUM_GAMES);
    const elapsed = performance.now() - t0;

    const stats = aggregateStats(results);
    console.log(`  ${NUM_GAMES} games in ${(elapsed / 1000).toFixed(1)}s`);
    console.log(
      `  Score: mean=${stats.score.mean} median=${stats.score.median} p10=${stats.score.p10} p90=${stats.score.p90}`,
    );
    console.log(
      `  Waves: mean=${stats.waves.mean} median=${stats.waves.median} p10=${stats.waves.p10} p90=${stats.waves.p90}`,
    );
    console.log(
      `  Efficiency: ${stats.efficiency.mean} (${stats.efficiency.meanKills} kills / ${stats.efficiency.meanShots} shots)`,
    );
    console.log(`  Deaths: ${JSON.stringify(stats.deathCauses)}`);

    const logEntry = { iteration: iter, timestamp: new Date().toISOString(), stats, config };
    appendFileSync(LOG_PATH, JSON.stringify(logEntry) + "\n");
    history.push({ iteration: iter, stats });
  }

  const totalElapsed = performance.now() - totalT0;
  console.log(
    `\nAll ${NUM_ITERATIONS} iterations complete (${(totalElapsed / 1000).toFixed(1)}s total, ${NUM_ITERATIONS * NUM_GAMES} games)`,
  );

  if (DRY_RUN) {
    console.log(`[dry-run] Skipping Claude API call`);
  } else {
    try {
      console.log(`\nSending all results to Claude for analysis...`);
      const patch = await callClaude(config, history);
      console.log(`Suggested config patch:\n${JSON.stringify(patch, null, 2)}`);

      const newConfig = deepMerge(config, patch);
      saveConfig(newConfig);
      appendFileSync(LOG_PATH, JSON.stringify({ type: "tuning", timestamp: new Date().toISOString(), patch }) + "\n");
      console.log(`Config updated and saved.`);
    } catch (err) {
      console.log(`Claude API error: ${err.message}`);
      appendFileSync(
        LOG_PATH,
        JSON.stringify({ type: "error", timestamp: new Date().toISOString(), error: err.message }) + "\n",
      );
    }
  }

  console.log(`Log: ${LOG_PATH}`);
}

main().catch((err) => {
  console.error("Training failed:", err);
  process.exit(1);
});
