// Replays a recorded game and audits each fire action: did the interceptor
// hit anything, what was the closest miss, what was the bot looking at when
// it fired. Surfaces leading errors and wasted shots.
//
// Usage: npx tsx src/headless/replay-audit.ts <replay.json> [--limit=200]

import { readFileSync } from "fs";
import { runGame } from "./sim-runner.js";
import { createReplayRunner } from "../replay.js";
import type { ReplayData, ReplayAction } from "../types.js";

const args = process.argv.slice(2);
const replayPath = args.find((a) => !a.startsWith("--"));
if (!replayPath) {
  console.error("Usage: replay-audit.ts <replay.json> [--limit=N] [--preset=NAME]");
  process.exit(1);
}

function getArg(name: string, def: string | null): string | null {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : def;
}

const LIMIT = parseInt(getArg("limit", "120") as string);
const PRESET = getArg("preset", null);

interface ShotOutcome {
  tick: number;
  aimX: number;
  aimY: number;
  killed: number;
  closestMissDist: number;
  closestMissedThreat?: { type: string; x: number; y: number } | null;
  ammoBefore?: number;
}

function audit(replay: ReplayData) {
  const rr = createReplayRunner(replay);
  rr.init();

  const actions = replay.actions;
  const fireActions: ReplayAction[] = actions.filter((a) => a.type === "fire");
  console.log(`Total fire actions: ${fireActions.length}`);

  // Re-run from scratch with the same seed — tracking interceptor outcomes
  const rerun = runGame(null, {
    seed: replay.seed,
    record: true,
    draftMode: replay.draftMode ?? true,
    preset: PRESET,
    maxTicks: 200000,
  });

  console.log(
    `\nRerun: wave=${rerun.wave} score=${rerun.score} kills=${rerun.stats.missileKills + rerun.stats.droneKills} shots=${rerun.stats.shotsFired} eff=${(
      (rerun.stats.missileKills + rerun.stats.droneKills) /
      Math.max(1, rerun.stats.shotsFired)
    ).toFixed(3)} cause=${rerun.deathCause}`,
  );

  // Group fires by wave (using wave_plan markers in the action log)
  const reReplay = rerun.actions ?? [];
  let curWave = 1;
  const fireByWave: Record<string, number> = {};
  for (const a of reReplay) {
    if (a.type === "wave_plan" && typeof (a as ReplayAction & { wave?: number }).wave === "number") {
      curWave = (a as ReplayAction & { wave: number }).wave;
    } else if (a.type === "fire") {
      const waveKey = String(curWave);
      fireByWave[waveKey] = (fireByWave[waveKey] || 0) + 1;
    }
  }
  console.log(`\nFires per wave:`);
  for (const w of Object.keys(fireByWave).sort((a, b) => parseInt(a) - parseInt(b))) {
    console.log(`  wave ${w}: ${fireByWave[w]} shots`);
  }

  // Use the replay runner to step through and snapshot interceptor / threat positions at each fire
  rr.cleanup();
}

const replay = JSON.parse(readFileSync(replayPath, "utf-8")) as ReplayData;
audit(replay);
