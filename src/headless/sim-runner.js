import { setRng, fireInterceptor } from "../game-logic.js";
import { initGame, update, buyUpgrade, closeShop } from "../game-sim.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };

export function runGame(botConfig, options = {}) {
  const config = botConfig || defaultConfig;
  const seed = options.seed ?? Date.now();
  const maxTicks = options.maxTicks ?? 100000;
  const record = options.record ?? false;
  const dt = 1; // fixed timestep per tick

  const rng = mulberry32(seed);
  setRng(rng);

  const g = initGame();
  let lastFireTick = -Infinity;
  let deathCause = "timeout";
  const actions = record ? [] : null;

  for (let tick = 0; tick < maxTicks; tick++) {
    if (g.state === "gameover") {
      deathCause = "destroyed";
      break;
    }

    if (g.state === "shop") {
      const bought = [];
      const keys = botDecideUpgrades(g, config);
      // Round-robin: buy one level of each priority per pass
      let boughtAny = true;
      while (boughtAny) {
        boughtAny = false;
        for (const key of keys) {
          if (buyUpgrade(g, key)) {
            bought.push(key);
            boughtAny = true;
          }
        }
      }
      if (record) actions.push({ tick, type: "shop", bought });
      closeShop(g);
      continue;
    }

    // Bot decides whether to fire
    const action = botDecideAction(g, config, lastFireTick, tick);
    if (action) {
      fireInterceptor(g, action.x, action.y);
      lastFireTick = tick;
      if (record) actions.push({ tick, type: "fire", x: action.x, y: action.y });
    }

    // Advance simulation
    update(g, dt, null);
  }

  // Restore default RNG
  setRng(Math.random);

  const result = {
    score: g.score,
    wave: g.wave,
    stats: { ...g.stats },
    ticks: Math.min(maxTicks, maxTicks),
    deathCause,
    seed,
  };
  if (record) result.actions = actions;
  return result;
}

// Allow running directly: node src/headless/sim-runner.js
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("sim-runner.js") || process.argv[1].endsWith("sim-runner.mjs"));

if (isMain) {
  const seed = parseInt(process.argv[2]) || 42;
  console.log(`Running game with seed ${seed}...`);
  const t0 = performance.now();
  const result = runGame(null, { seed });
  const elapsed = performance.now() - t0;
  console.log(`Done in ${elapsed.toFixed(0)}ms`);
  console.log(`  Score: ${result.score}`);
  console.log(`  Wave:  ${result.wave}`);
  console.log(`  Death: ${result.deathCause}`);
  console.log(`  Stats: ${JSON.stringify(result.stats)}`);

  // Determinism check
  console.log(`\nDeterminism check (same seed)...`);
  const result2 = runGame(null, { seed });
  if (result.score === result2.score && result.wave === result2.wave) {
    console.log(`  PASS — same seed produces same result`);
  } else {
    console.log(`  FAIL — scores differ: ${result.score} vs ${result2.score}`);
  }
}
