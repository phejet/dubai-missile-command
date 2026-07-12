import { assertNoEditorOverridesForDeterministicRun, setRng, fireInterceptor } from "../game-logic";
import {
  initGame,
  update,
  buyUpgrade,
  buyDraftUpgrade,
  closeShop,
  fireEmp,
  fireF15Pair,
  fireFlareSalvo,
  completeWaveBonusAndOpenShop,
} from "../game-sim";
import { isBonusUiPauseActive } from "../replay-loop";
import { createDefaultReplayInitialState, CURRENT_REPLAY_VERSION } from "../replay-version";
import { buildReplayCheckpoint } from "../replay-debug";
import { getUpgradeNodeDef } from "../game-sim-upgrades";
import { getBuildingSurvivalBonus } from "../wave-bonus";
import { mulberry32 } from "./rng";
import { botDecideAction, botDecideUpgrades, resolveBotConfig, reserveBotTarget } from "./bot-brain";
import defaultConfig from "./bot-config.json" with { type: "json" };
import {
  applyReplayBootstrap,
  applyReplayInitialState,
  resolveReplayStartWave,
  resolveReplayStopWave,
  shouldStopReplayAtWaveComplete,
} from "../replay-bootstrap";
import type { GameStats, ReplayAction, ReplayCheckpoint, ReplayData, TacticId, CommanderStyle } from "../types";

interface RunGameOptions {
  preset?: string | null;
  seed?: number;
  maxTicks?: number;
  record?: boolean;
  draftMode?: boolean;
  bootstrap?: ReplayData["bootstrap"];
  stopCondition?: ReplayData["stopCondition"];
  checkpoints?: boolean;
  initialState?: ReplayData["initialState"];
  isHuman?: boolean;
}

export function runGame(botConfig: Record<string, unknown> | null, options: RunGameOptions = {}) {
  assertNoEditorOverridesForDeterministicRun("Headless simulation");

  const config = resolveBotConfig(botConfig || defaultConfig, options.preset);
  const seed = options.seed ?? Date.now();
  const maxTicks = options.maxTicks ?? 100000;
  const record = options.record ?? false;
  const draftMode = options.draftMode ?? true;
  const isHuman = options.isHuman ?? false;
  const dt = 1; // fixed timestep per tick
  const startWave = resolveReplayStartWave(options);
  const stopWave = resolveReplayStopWave(options, startWave);

  const rng = mulberry32(seed);
  const botRng = mulberry32(seed ^ 0x5f3759df); // separate RNG for bot decisions
  setRng(rng);

  const g = initGame();
  const initialState = options.initialState ?? createDefaultReplayInitialState();
  applyReplayInitialState(g, initialState);
  if (draftMode) (g as unknown as { _draftMode: boolean })._draftMode = true;
  applyReplayBootstrap(g, options, startWave);
  let lastFireTick = -Infinity;
  let deathCause = "timeout";
  const actions: ReplayAction[] | null = record ? [] : null;
  const checkpoints: ReplayCheckpoint[] | undefined = record && options.checkpoints ? [] : undefined;
  const recordCheckpoint = (checkpointTick: number, reason: string | null = null): void => {
    if (!checkpoints) return;
    checkpoints.push(buildReplayCheckpoint(g, checkpointTick, reason));
  };
  const onSimEvent = isHuman
    ? (((type, data) => {
        if (type === "waveBonusStart") {
          g.score += getBuildingSurvivalBonus(data as import("../types").SimEventMap["waveBonusStart"]);
        }
      }) satisfies import("../types").SimEventSink)
    : null;
  let tick: number;

  // Swap to bot RNG for bot decisions, then restore game RNG
  function withBotRng<T>(fn: () => T): T {
    setRng(botRng);
    const result = fn();
    setRng(rng);
    return result;
  }

  // Record initial wave plan
  if (record) {
    actions!.push({
      tick: 0,
      type: "wave_plan",
      wave: g.wave,
      tactics: g.waveTactics as TacticId[],
      style: g.commander.style,
    });
  }
  recordCheckpoint(0, "start");

  for (tick = 0; tick < maxTicks; tick++) {
    if (g.state === "gameover") {
      deathCause = "destroyed";
      break;
    }

    if (g.state === "shop") {
      recordCheckpoint(tick, "shopOpen");
      const bought = [];
      const { priority } = withBotRng(() => botDecideUpgrades(g, config));
      if (draftMode && g._draftOffers) {
        // Draft mode: pick the highest-priority family represented in the offered node set.
        for (const key of priority) {
          const offerId = g._draftOffers.find((nodeId) => {
            const node = getUpgradeNodeDef(nodeId);
            return node?.family === key || nodeId === key;
          });
          if (offerId) {
            if (buyDraftUpgrade(g, offerId)) bought.push(offerId);
            break;
          }
        }
      } else {
        // Round-robin: buy one level of each priority per pass
        let boughtAny = true;
        while (boughtAny) {
          boughtAny = false;
          for (const key of priority) {
            if (buyUpgrade(g, key as import("../types").UpgradeKey)) {
              bought.push(key);
              boughtAny = true;
            }
          }
        }
      }
      if (record) actions!.push({ tick, type: "shop", bought, draftMode: draftMode || undefined } as ReplayAction);
      closeShop(g);
      recordCheckpoint(tick, `waveStart:${g.wave}`);
      if (record) {
        actions!.push({
          tick,
          type: "wave_plan",
          wave: g.wave,
          tactics: g.waveTactics as TacticId[],
          style: g.commander.style,
        });
      }
      // Fall through to update() below — matches how the replay runner
      // processes the first step() after resumeFromShop()
    }

    if (g.flareReadyThisWave) {
      const flareCfg = config.flare || {};
      const minThreats = g.upgrades.flare >= 2 ? flareCfg.minThreatsL2 || 4 : flareCfg.minThreatsL1 || 6;
      const threats =
        g.missiles.filter((m) => m.alive && m.y <= 800).length + g.drones.filter((d) => d.alive && d.y <= 800).length;
      if (threats >= minThreats) {
        fireFlareSalvo(g, null);
        if (record) actions!.push({ tick, type: "flare" });
      }
    }

    // Bot fires EMP when threats are about to hit Burj
    if (g.empReadyThisWave) {
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
        if (record) actions!.push({ tick, type: "emp" });
      }
    }

    // Bot calls in F-15 patrol when threats are massing on screen
    if (g.f15ReadyThisWave) {
      const f15Cfg = config.f15 || {};
      const impactY = f15Cfg.impactY || 700;
      const impactRadius = f15Cfg.impactRadius || 400;
      const minImminent = f15Cfg.minImminentThreats || 3;
      let imminent = 0;
      for (const m of g.missiles) {
        if (m.alive && m.y >= impactY && Math.abs(m.x - 460) < impactRadius) imminent++;
      }
      for (const d of g.drones) {
        if (d.alive && d.y >= impactY && Math.abs(d.x - 460) < impactRadius) imminent++;
      }
      if (imminent >= minImminent) {
        fireF15Pair(g, null);
        if (record) actions!.push({ tick, type: "f15" });
      }
    }

    // Bot decides whether to fire
    const action = withBotRng(() => botDecideAction(g, config, lastFireTick, tick));
    if (action) {
      g.crosshairX = action.x;
      g.crosshairY = action.y;
      const fired = fireInterceptor(g, action.x, action.y, tick);
      if (fired) {
        reserveBotTarget(g, action.targetRef, action.reservationUntil ?? tick, tick);
        lastFireTick = tick;
        if (record) actions!.push({ tick, type: "fire", x: action.x, y: action.y });
      }
    }
    // Record bot cursor position every 3 ticks for replay crosshair
    if (record && tick % 3 === 0) {
      actions!.push({ tick, type: "cursor", x: Math.round(g.crosshairX || 450), y: Math.round(g.crosshairY || 300) });
    }

    // Advance simulation
    update(g, dt, onSimEvent);
    if (isBonusUiPauseActive(g)) completeWaveBonusAndOpenShop(g, onSimEvent);
    const postTick = tick + 1;
    if ((g.state as string) === "gameover") recordCheckpoint(postTick, "gameover");
    else if (postTick % 60 === 0) recordCheckpoint(postTick);
    if (shouldStopReplayAtWaveComplete(g, stopWave)) {
      deathCause = "completed";
      tick++;
      break;
    }
  }

  // Restore default RNG
  setRng(Math.random);

  const result: {
    score: number;
    wave: number;
    stats: GameStats;
    ticks: number;
    deathCause: string;
    seed: number;
    actions?: ReplayAction[];
    draftMode?: boolean;
    version?: number;
    initialState?: ReplayData["initialState"];
    isHuman?: boolean;
    checkpoints?: ReplayData["checkpoints"];
  } = {
    score: g.score,
    wave: g.wave,
    stats: { ...g.stats },
    ticks: tick!,
    deathCause,
    seed,
  };
  if (record) {
    result.version = CURRENT_REPLAY_VERSION;
    result.initialState = {
      metaProgression: {
        version: initialState.metaProgression.version,
        completedObjectives: [...initialState.metaProgression.completedObjectives],
      },
      forcedUpgradeFamilies: [...initialState.forcedUpgradeFamilies],
      burjHealth: initialState.burjHealth,
    };
    if (isHuman) result.isHuman = true;
    if (checkpoints) result.checkpoints = checkpoints;
    result.actions = actions!;
    if (draftMode) result.draftMode = true;
  }
  return result;
}

// Allow running directly with compiled JS or via tsx in the source tree.
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("sim-runner.js") ||
    process.argv[1].endsWith("sim-runner.mjs") ||
    process.argv[1].endsWith("sim-runner.ts"));

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
