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

if (seed !== null) {
  console.log(`Recording game with seed ${seed}...`);
  const result = runGame(null, { seed: parseInt(seed), record: true });
  const replay = { seed: parseInt(seed), actions: result.actions };
  writeFileSync(outFile, JSON.stringify(replay));
  console.log(`Wave ${result.wave}, score ${result.score}, ${result.actions.length} actions`);
  console.log(`Saved to ${outFile}`);
} else {
  console.log(`Finding best game out of ${tryCount}...`);
  let best = { wave: 0, score: 0 };
  let bestSeed = 0;
  for (let s = 0; s < tryCount; s++) {
    const r = runGame(null, { seed: s });
    if (r.wave > best.wave || (r.wave === best.wave && r.score > best.score)) {
      best = r;
      bestSeed = s;
    }
  }
  console.log(`Best: seed ${bestSeed}, wave ${best.wave}, score ${best.score}`);
  console.log(`Recording...`);
  const result = runGame(null, { seed: bestSeed, record: true });
  const replay = { seed: bestSeed, actions: result.actions };
  writeFileSync(outFile, JSON.stringify(replay));
  console.log(`${result.actions.length} actions, saved to ${outFile}`);
}
