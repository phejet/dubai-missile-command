import { readFileSync, writeFileSync } from "node:fs";
import { createReplayRunner } from "../../src/replay";
import { seekRunnerToTick } from "../../src/replay-seek";
import { buildReplayCheckpoint } from "../../src/replay-debug";
const root = "operator-results/scoring-study-20260915/";
const out = root + "quality/";
const clips = JSON.parse(readFileSync(out + "clips.json", "utf8"));
const proof = [];
for (const clip of clips) {
  const replay = JSON.parse(readFileSync(root + clip.label + "-replay.json", "utf8"));
  const runner = createReplayRunner(replay, null, (type) => {
    if (type === "replay_divergence") throw Error("divergence");
  });
  runner.init();
  for (const offset of [0, 120, 135, 160, 210, 360, 480]) {
    await seekRunnerToTick(runner, clip.start + offset, { cancelled: false });
    proof.push({
      id: clip.id,
      offset,
      tick: runner.getTick(),
      hash: buildReplayCheckpoint(runner.getState()!, runner.getTick()).hash,
    });
  }
  runner.cleanup();
}
writeFileSync(out + "clip-checkpoints.json", JSON.stringify(proof, null, 2), { mode: 0o600 });
console.log("Prepared 70 headless checkpoint comparisons for browser clips.");
