import { readFileSync, writeFileSync } from "fs";
import { runGame } from "./sim-runner";
import { CURRENT_REPLAY_VERSION } from "../replay-version";
import type { ReplayData } from "../types";

// Record the best game out of N runs, or a specific seed
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string | null) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
}

const templateFile = getArg("template", null);
const template = templateFile ? (JSON.parse(readFileSync(templateFile, "utf8")) as ReplayData) : null;
const seed = getArg("seed", template ? String(template.seed) : null);
const tryCount = parseInt(getArg("tries", "1000") as string);
const outFile = getArg("out", templateFile ?? "replay.json") as string;
const draftMode = template?.draftMode ?? true;
const passive = !!template && template.actions.every((action) => action.type === "wave_plan");

function recordSeed(seedValue: number) {
  return runGame(null, {
    seed: seedValue,
    record: true,
    draftMode,
    bootstrap: template?.bootstrap,
    stopCondition: template?.stopCondition,
    initialState: template?.initialState,
    isHuman: template?.isHuman,
    passive,
  });
}

function buildReplay(seedValue: number, result: ReturnType<typeof runGame>) {
  const replay: ReplayData = {
    version: CURRENT_REPLAY_VERSION,
    seed: seedValue,
    actions: result.actions!,
    initialState: result.initialState!,
    draftMode,
  };
  if (template?.bootstrap) replay.bootstrap = template.bootstrap;
  if (template?.stopCondition) replay.stopCondition = template.stopCondition;
  if (template?.isHuman) replay.isHuman = true;
  return replay;
}

if (seed !== null) {
  console.log(`Recording draft-mode game with seed ${seed}...`);
  const parsedSeed = parseInt(seed);
  const result = recordSeed(parsedSeed);
  const replay = buildReplay(parsedSeed, result);
  writeFileSync(outFile, `${JSON.stringify(replay, null, 2)}\n`);
  console.log(`Wave ${result.wave}, score ${result.score}, ${result.actions!.length} actions`);
  console.log(`Saved to ${outFile}`);
} else {
  console.log(`Finding best draft-mode game out of ${tryCount}...`);
  let best = { wave: 0, score: 0 };
  let bestSeed = 0;
  for (let s = 0; s < tryCount; s++) {
    const r = runGame(null, { seed: s, draftMode });
    if (r.wave > best.wave || (r.wave === best.wave && r.score > best.score)) {
      best = r;
      bestSeed = s;
    }
  }
  console.log(`Best: seed ${bestSeed}, wave ${best.wave}, score ${best.score}`);
  console.log(`Recording...`);
  const result = recordSeed(bestSeed);
  const replay = buildReplay(bestSeed, result);
  writeFileSync(outFile, `${JSON.stringify(replay, null, 2)}\n`);
  console.log(`${result.actions!.length} actions, saved to ${outFile}`);
}
