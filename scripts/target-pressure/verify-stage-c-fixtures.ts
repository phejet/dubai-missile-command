import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createReplayRunner } from "../../src/replay";
import type { ReplayData } from "../../src/types";
const baseline = "operator-results/target-pressure-stage-c/baseline-60b1fa4b2f19857146ff6a978e3a18471b5aab0c";
const old = await import(pathToFileURL(resolve(baseline, "simulator.mjs")).href);
const rows = [];
for (const name of ["perf-wave1", "perf-wave4-upgrades", "perf-burj-burning"]) {
  for (const source of ["v15", "v16"] as const) {
    const replay = JSON.parse(
      readFileSync(source === "v15" ? `${baseline}/${name}.json` : `public/replays/${name}.json`, "utf8"),
    ) as ReplayData;
    assert.equal(replay.version, source === "v15" ? 15 : 16);
    const makeRunner: typeof createReplayRunner = source === "v15" ? old.createReplayRunner : createReplayRunner;
    const runner = makeRunner(replay, null, (event) => assert.notEqual(event, "replay_divergence"));
    const g = runner.init();
    let steps = 0;
    while (!runner.isFinished() && steps++ < 200000) {
      if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
      else if (runner.isShopPaused()) runner.resumeFromShop();
      else runner.step();
    }
    assert(runner.isFinished(), `${source}/${name}: not finished`);
    rows.push({ source, name, tick: runner.getTick(), score: g.score, wave: g.wave, reason: g.state });
    runner.cleanup();
  }
}
writeFileSync("scripts/target-pressure/stage-c-fixtures.json", JSON.stringify(rows, null, 2) + "\n");
console.log(JSON.stringify(rows, null, 2));
