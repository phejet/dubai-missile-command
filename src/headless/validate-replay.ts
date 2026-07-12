import { readFileSync } from "node:fs";
import { createReplayRunner } from "../replay";
import type { ReplayData, ReplayEventMap } from "../types";

export function validateReplay(replay: ReplayData): ReplayEventMap["replay_divergence"][] {
  const divergences: ReplayEventMap["replay_divergence"][] = [];
  const runner = createReplayRunner(replay, null, (type, data) => {
    if (type === "replay_divergence") divergences.push(data as ReplayEventMap["replay_divergence"]);
  });
  runner.init();
  const maxSteps = Math.max(replay.finalTick ?? 0, 200000) + 1000;
  for (let steps = 0; steps < maxSteps && !runner.isFinished(); steps++) {
    if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
    else if (runner.isShopPaused()) runner.resumeFromShop();
    else runner.step();
  }
  runner.cleanup();
  return divergences;
}

export function validateReplayFile(path: string): ReplayEventMap["replay_divergence"][] {
  return validateReplay(JSON.parse(readFileSync(path, "utf8")) as ReplayData);
}

const isMain = process.argv[1]?.endsWith("validate-replay.ts") || process.argv[1]?.endsWith("validate-replay.js");
if (isMain) {
  const fileIndex = process.argv.indexOf("--file");
  const path = fileIndex >= 0 ? process.argv[fileIndex + 1] : undefined;
  if (!path) {
    console.error("Usage: npx tsx src/headless/validate-replay.ts --file <replay.json>");
    process.exitCode = 2;
  } else {
    const divergences = validateReplayFile(path);
    if (divergences.length > 0) {
      console.error(JSON.stringify(divergences[0], null, 2));
      process.exitCode = 1;
    } else {
      console.log(`Replay verified: ${path}`);
    }
  }
}
