import { setRng, fireInterceptor } from "../game-logic.js";
import { initGame, update, buyUpgrade, buyDraftUpgrade, closeShop, fireEmp } from "../game-sim.js";
import { mulberry32 } from "./rng.js";
import { botDecideAction, botDecideUpgrades, resolveBotConfig, reserveBotTarget } from "./bot-brain.js";
import defaultConfig from "./bot-config.json" with { type: "json" };

export function runGame(botConfig, options = {}) {
  const config = resolveBotConfig(botConfig || defaultConfig, options.preset);
  const seed = options.seed ?? Date.now();
  const maxTicks = options.maxTicks ?? 100000;
  const record = options.record ?? false;
  const draftMode = options.draftMode ?? true;
  const dt = 1; // fixed timestep per tick

  const rng = mulberry32(seed);
  const botRng = mulberry32(seed ^ 0x5f3759df); // separate RNG for bot decisions
  setRng(rng);

  const g = initGame();
  if (draftMode) g._draftMode = true;
  let lastFireTick = -Infinity;
  let deathCause = "timeout";
  const actions = record ? [] : null;
  let tick;

  // Swap to bot RNG for bot decisions, then restore game RNG
  function withBotRng(fn) {
    setRng(botRng);
    const result = fn();
    setRng(rng);
    return result;
  }

  // Record initial wave plan
  if (record) {
    actions.push({ tick: 0, type: "wave_plan", wave: g.wave, tactics: g.waveTactics, style: g.commander.style });
  }

  for (tick = 0; tick < maxTicks; tick++) {
    if (g.state === "gameover") {
      deathCause = "destroyed";
      break;
    }

    if (g.state === "shop") {
      const bought = [];
      const { priority } = withBotRng(() => botDecideUpgrades(g, config));
      if (draftMode && g._draftOffers) {
        // Draft mode: pick the highest-priority offered upgrade
        for (const key of priority) {
          if (g._draftOffers.includes(key)) {
            if (buyDraftUpgrade(g, key)) bought.push(key);
            break;
          }
        }
      } else {
        // Round-robin: buy one level of each priority per pass
        let boughtAny = true;
        while (boughtAny) {
          boughtAny = false;
          for (const key of priority) {
            if (buyUpgrade(g, key)) {
              bought.push(key);
              boughtAny = true;
            }
          }
        }
      }
      if (record) actions.push({ tick, type: "shop", bought, draftMode: draftMode || undefined });
      closeShop(g);
      if (record) {
        actions.push({ tick, type: "wave_plan", wave: g.wave, tactics: g.waveTactics, style: g.commander.style });
      }
      // Fall through to update() below — matches how the replay runner
      // processes the first step() after resumeFromShop()
    }

    // Bot fires EMP when threats are about to hit Burj
    if (g.empReady) {
      const empCfg = config.emp || {};
      const impactY = empCfg.impactY || 420;
      const impactRadius = empCfg.impactRadius || 200;
      const minImminent = empCfg.minImminentThreats || 2;
      let imminent = 0;
      for (const m of g.missiles) {
        if (m.alive && m.y >= impactY && Math.abs(m.x - 460) < impactRadius) imminent++;
      }
      for (const d of g.drones) {
        if (d.alive && d.y >= impactY && Math.abs(d.x - 460) < impactRadius) imminent++;
      }
      if (imminent >= minImminent) {
        fireEmp(g, null);
        if (record) actions.push({ tick, type: "emp" });
      }
    }

    // Bot decides whether to fire
    const action = withBotRng(() => botDecideAction(g, config, lastFireTick, tick));
    if (action) {
      g.crosshairX = action.x;
      g.crosshairY = action.y;
      const fired = fireInterceptor(g, action.x, action.y);
      if (fired) {
        reserveBotTarget(g, action.targetRef, action.reservationUntil, tick);
        lastFireTick = tick;
        if (record) actions.push({ tick, type: "fire", x: action.x, y: action.y });
      }
    }
    // Record bot cursor position every 3 ticks for replay crosshair
    if (record && tick % 3 === 0) {
      actions.push({ tick, type: "cursor", x: Math.round(g.crosshairX || 450), y: Math.round(g.crosshairY || 300) });
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
    ticks: tick,
    deathCause,
    seed,
  };
  if (record) {
    result.actions = actions;
    if (draftMode) result.draftMode = true;
  }
  return result;
}

// Allow running directly: node src/headless/sim-runner.js
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("sim-runner.js") || process.argv[1].endsWith("sim-runner.mjs"));

if (isMain) {
  const seed = parseInt(process.argv[2]) || 42;
  const presetArg = process.argv.find((arg) => arg.startsWith("--preset="));
  const preset = presetArg ? presetArg.split("=")[1] : null;
  console.log(`Running game with seed ${seed}...`);
  if (preset) console.log(`Preset: ${preset}`);
  const t0 = performance.now();
  const result = runGame(null, { seed, preset });
  const elapsed = performance.now() - t0;
  console.log(`Done in ${elapsed.toFixed(0)}ms`);
  console.log(`  Score: ${result.score}`);
  console.log(`  Wave:  ${result.wave}`);
  console.log(`  Death: ${result.deathCause}`);
  console.log(`  Stats: ${JSON.stringify(result.stats)}`);

  // Determinism check
  console.log(`\nDeterminism check (same seed)...`);
  const result2 = runGame(null, { seed, preset });
  if (result.score === result2.score && result.wave === result2.wave) {
    console.log(`  PASS — same seed produces same result`);
  } else {
    console.log(`  FAIL — scores differ: ${result.score} vs ${result2.score}`);
  }
}
