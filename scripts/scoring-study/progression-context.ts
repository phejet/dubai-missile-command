import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createReplayRunner } from "../../src/replay";
import { getRngState } from "../../src/game-logic";
import { buildRunRecapData } from "../../src/run-recap";
import { compareSummary } from "../../src/operator-inspection";
import { parseDetail } from "../../src/operator-contract";
import type { GameState } from "../../src/types";
const root = "operator-results/scoring-study-20260915/";
const out = root + "progression/";
mkdirSync(out, { recursive: true, mode: 0o700 });
const prior = JSON.parse(readFileSync(root + "attribution/baseline-results.json", "utf8"));
function context(g: GameState, tick: number) {
  return {
    wave: g.wave,
    tick,
    score: g.score,
    combo: g.combo,
    rng: getRngState(),
    owned: [...g.ownedUpgradeNodes].sort(),
    upgrades: { ...g.upgrades },
    meta: structuredClone(g.metaProgression),
    burj: g.burjHealth,
    launchers: [...g.launcherHP],
    buildings: g.buildings.map((b) => b.alive),
    sites: g.defenseSites.map((s) => ({ key: s.key, alive: s.alive })).sort((a, b) => a.key.localeCompare(b.key)),
    empReady: g.empReadyThisWave,
    f15Ready: g.f15ReadyThisWave,
    commander: structuredClone(g.commander),
    schedule: structuredClone(g.schedule),
    concurrentCap: g.concurrentCap,
    tactics: structuredClone(g.waveTactics),
  };
}
const results = [];
for (const baseline of prior) {
  const { label } = baseline;
  const replay = JSON.parse(readFileSync(root + label + "-replay.json", "utf8"));
  const detail = parseDetail(JSON.parse(readFileSync(root + label + "-detail.json", "utf8")).session);
  const runner = createReplayRunner(replay, null, (type) => {
    if (type === "replay_divergence") throw Error(label + " checkpoint divergence");
  });
  const g = runner.init();
  const starts = [context(g, 0)];
  const ends = [];
  let guard = 0;
  while (runner.getTick() < replay.finalTick) {
    assert(++guard < replay.finalTick * 3 + 100);
    assert(!runner.isFinished());
    if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
    else if (runner.isShopPaused()) {
      ends.push({ wave: g.wave, tick: runner.getTick(), score: g.score });
      runner.resumeFromShop();
      starts.push(context(g, runner.getTick()));
    } else runner.step();
  }
  assert.equal(runner.getTick(), baseline.finalTick);
  assert.deepEqual(runner.studyMetadata(), baseline.metadata);
  const recap = buildRunRecapData(g, replay);
  assert.deepEqual(compareSummary(detail, recap), []);
  assert.deepEqual(JSON.parse(JSON.stringify(recap)), baseline.recap);
  assert.equal(ends.length, recap.waveCards.filter((w) => !w.terminal).length);
  results.push({ label, build: detail.build, draftMode: replay.draftMode, seed: replay.seed, starts, ends });
  runner.cleanup();
  console.log(label, "contexts verified");
}
writeFileSync(out + "contexts.json", JSON.stringify(results), { mode: 0o600 });
