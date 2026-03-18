import { readFileSync } from "fs";
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

const DURATION_MS = parseInt(getArg("duration", "10000"));
const FOCUS = getArg("focus", "all"); // all, enemies, upgrades, mechanics, visual

function benchmark(durationMs) {
  const results = [];
  const t0 = performance.now();
  let seed = 0;
  while (performance.now() - t0 < durationMs) {
    const r = runGame(null, { seed });
    results.push(r);
    seed++;
  }

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

  // Wave distribution
  const waveCounts = {};
  waves.forEach((w) => {
    waveCounts[w] = (waveCounts[w] || 0) + 1;
  });

  return {
    games: results.length,
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
      distribution: waveCounts,
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

const FOCUS_PROMPTS = {
  all: `Provide a comprehensive game balance analysis covering:
1. **Difficulty curve** — Is the game too easy/hard at each wave range? Where is the sweet spot?
2. **New enemy types** — What new threats would keep later waves interesting? Use real-world missile defense inspiration.
3. **New upgrades/defenses** — What new defensive systems could be added? Reference real systems.
4. **Balance tweaks** — Specific changes to costs, spawn rates, blast radius, speeds, ammo, etc.
5. **New mechanics** — Ideas that add strategic depth (not just more content).
6. **Visual/UX** — Ideas to make the game more satisfying to play.`,

  enemies: `Focus specifically on enemy design:
1. What new enemy types would create interesting tactical decisions?
2. How should existing enemies scale differently at higher waves?
3. What enemy combinations create emergent difficulty?
4. How can enemies counter specific upgrade strategies to prevent dominant builds?
5. Design 3-5 detailed enemy concepts with stats, behavior, spawn rules, and counter-play.
Use real-world military systems for inspiration (MIRVs, hypersonics, EW jammers, swarms, etc).`,

  upgrades: `Focus specifically on the upgrade/defense system:
1. Analyze the current upgrade cost curve and effectiveness per level
2. Are any upgrades dominant or useless? What would fix that?
3. Design 3-5 new defensive upgrade concepts with costs, levels, and mechanics
4. How should upgrades interact/synergize with each other?
5. Should there be upgrade trade-offs (e.g., mutually exclusive paths)?
Use real-world defense systems for inspiration (Arrow 3, Trophy APS, THAAD, HELIOS, etc).`,

  mechanics: `Focus specifically on game mechanics and strategic depth:
1. What new player decisions could be added beyond "click to fire" and "buy upgrades"?
2. How can the resource system (ammo, score, HP) create more interesting trade-offs?
3. What meta-progression or between-run systems could work?
4. How can the game reward skill expression and creative strategies?
5. What mechanics from other tower defense / missile command games are worth borrowing?
Design concrete mechanics with implementation details, not just vague ideas.`,

  visual: `Focus specifically on visual feedback and UX:
1. What visual cues would help players prioritize threats?
2. How can kill feedback be more satisfying (explosions, chains, combos)?
3. What HUD improvements would help without cluttering the screen?
4. How should the shop/upgrade UI be improved?
5. What environmental/atmospheric effects would add polish?
6. How can the game better communicate danger, urgency, and success?
Reference specific rendering code you see in App.jsx.`,
};

async function analyze(stats) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const gameSim = readFileSync(join(__dirname, "..", "game-sim.js"), "utf-8");
  const gameLogic = readFileSync(join(__dirname, "..", "game-logic.js"), "utf-8");
  const appJsx = readFileSync(join(__dirname, "..", "App.jsx"), "utf-8");
  const botConfig = readFileSync(join(__dirname, "bot-config.json"), "utf-8");

  const focusPrompt = FOCUS_PROMPTS[FOCUS] || FOCUS_PROMPTS.all;

  const prompt = `You are an expert game designer analyzing "Dubai Missile Command", a canvas-based missile defense game.

## Bot Performance Data (${stats.games} games)
${JSON.stringify(stats, null, 2)}

## Current Bot Config
${botConfig}

## Game Simulation Code (game-sim.js)
\`\`\`js
${gameSim}
\`\`\`

## Game Logic & Constants (game-logic.js)
\`\`\`js
${gameLogic}
\`\`\`

## Rendering & UI (App.jsx)
\`\`\`jsx
${appJsx}
\`\`\`

## Key Game Facts
- Canvas: 900x640, ground at y=570, Burj at x=460 (340px tall)
- 3 launchers at x=60, 550, 860 with 2HP each
- Burj has 5 HP total
- Interceptor speed 5, blast radius 49px
- Missiles accelerate via \`accel = 1.003 + wave*0.0006\`
- Wave target: 8 + wave*4, spawn interval: max(20, 120-wave*10)
- Drones: Shahed-136 (bomb+dive, 1HP) and Shahed-238 (jet, fast, multi-HP, wave 4+)
- 6 upgrades with 3 levels each
- F-15 friendlies worth -500 if hit
- Defense sites can be destroyed mid-wave (restored at wave start)

## Your Task
${focusPrompt}

Be creative but grounded in the existing codebase. Reference specific constants, functions, and mechanics.
Focus on what would make the game FUN for human players, not just harder.
For each suggestion, explain the player experience impact and rough implementation complexity.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text;
}

async function main() {
  console.log(`\n=== Dubai Missile Command — Game Balance Analysis ===`);
  console.log(`Focus: ${FOCUS}`);
  console.log(`Benchmark: ${DURATION_MS / 1000}s\n`);

  console.log(`Running benchmark...`);
  const stats = benchmark(DURATION_MS);
  console.log(`  ${stats.games} games`);
  console.log(
    `  Waves: mean=${stats.waves.mean} median=${stats.waves.median} p10=${stats.waves.p10} p90=${stats.waves.p90} max=${stats.waves.max}`,
  );
  console.log(`  Score: mean=${stats.score.mean} median=${stats.score.median} max=${stats.score.max}`);
  console.log(`  Wave distribution: ${JSON.stringify(stats.waves.distribution)}`);

  console.log(`\nSending to Claude for analysis...\n`);
  console.log(`${"─".repeat(60)}\n`);

  const analysis = await analyze(stats);
  console.log(analysis);

  console.log(`\n${"─".repeat(60)}`);
}

main().catch((err) => {
  console.error("Balance analysis failed:", err);
  process.exit(1);
});
