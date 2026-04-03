import { writeFileSync } from "fs";
import { runGame } from "./sim-runner.js";

// Record the best game out of N runs, or a specific seed
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : defaultVal;
}

const seed = getArg("seed", null);
const tryCount = parseInt(getArg("tries", "1000"));
const outFile = getArg("out", "replay.json");
const draftMode = true;

function buildReplay(seedValue, result) {
  return {
    seed: seedValue,
    actions: result.actions,
    draftMode: true,
  };
}

if (seed !== null) {
  console.log(`Recording draft-mode game with seed ${seed}...`);
  const parsedSeed = parseInt(seed);
  const result = runGame(null, { seed: parsedSeed, record: true, draftMode });
  const replay = buildReplay(parsedSeed, result);
  writeFileSync(outFile, JSON.stringify(replay));
  console.log(`Wave ${result.wave}, score ${result.score}, ${result.actions.length} actions`);
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
  const result = runGame(null, { seed: bestSeed, record: true, draftMode });
  const replay = buildReplay(bestSeed, result);
  writeFileSync(outFile, JSON.stringify(replay));
  console.log(`${result.actions.length} actions, saved to ${outFile}`);
}
