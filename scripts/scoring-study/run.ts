import { runQualityCases } from "./quality-cases";
import { runControlledCases } from "./cases";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createReplayRunner } from "../../src/replay";
import { getRngState } from "../../src/game-logic";
import { cloneGameStateForReplayAnchor } from "../../src/replay-anchor";
import { buildRunRecapData } from "../../src/run-recap";
import { compareSummary } from "../../src/operator-inspection";
import { parseDetail } from "../../src/operator-contract";
import * as audit from "./observer.mjs";
import type { ReplayData } from "../../src/types";
declare const STUDY_OBSERVED: boolean;
const root = "operator-results/scoring-study-20260915/";
const quality = process.argv.includes("--quality");
const out = root + (quality ? "quality/" : "attribution/");
mkdirSync(out, { recursive: true, mode: 0o700 });
if (process.argv.includes("--cases")) {
  assert(STUDY_OBSERVED);
  const passed = quality ? runQualityCases() : runControlledCases();
  writeFileSync(out + "controlled-cases.json", JSON.stringify(passed, null, 2), { mode: 0o600 });
  console.log(passed);
  process.exit(0);
}
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
const results = [];
function hash(value: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, v) =>
        v instanceof Set
          ? { set: [...v] }
          : v instanceof Map
            ? { map: [...v] }
            : typeof v === "number" && !Number.isFinite(v)
              ? String(v)
              : v,
      ),
    )
    .digest("hex");
}
for (const { label } of manifest) {
  const replay: ReplayData = JSON.parse(readFileSync(root + label + "-replay.json", "utf8"));
  const detail = parseDetail(JSON.parse(readFileSync(root + label + "-detail.json", "utf8")).session);
  const runner = createReplayRunner(replay, null, (type, data) => {
    if (type === "replay_divergence") throw Error(JSON.stringify(data));
  });
  if (STUDY_OBSERVED) audit.start({ quality });
  const g = runner.init();
  const initialScore = g.score;
  const initialStats = { ...g.stats };
  const samples: { tick: number; phase: string; hash: string }[] = [];
  const waveDeltas: Record<string, { score: number; shots: number; kills: number; multis: number }> = {};
  const checkpointTicks = new Set(replay.checkpoints.map((c) => c.tick));
  const sample = (phase: string) =>
    samples.push({
      tick: runner.getTick(),
      phase,
      hash: hash({ state: cloneGameStateForReplayAnchor(g), rng: getRngState(), metadata: runner.studyMetadata() }),
    });
  sample("init");
  let iterations = 0;
  while (runner.getTick() < replay.finalTick) {
    assert(!runner.isFinished(), label + " finished early");
    assert(++iterations < replay.finalTick * 3 + 100, "loop guard");
    audit.clock(runner.getTick());
    const wave = g.wave,
      score = g.score,
      shots = g.stats.shotsFired,
      kills = g.stats.missileKills + g.stats.droneKills,
      multis = g.stats.multiShots;
    if (STUDY_OBSERVED && quality) audit.qualityBefore(g, runner.getTick());
    const previousState = g.state;
    let phase = "step";
    if (runner.isBonusPaused()) {
      phase = "bonus";
      runner.resumeFromBonusScreen();
    } else if (runner.isShopPaused()) {
      phase = "shop";
      runner.resumeFromShop();
    } else runner.step();
    if (STUDY_OBSERVED && quality) audit.qualityAfter(g, phase);
    const w = (waveDeltas[wave] ??= { score: 0, shots: 0, kills: 0, multis: 0 });
    w.score += g.score - score;
    w.shots += g.stats.shotsFired - shots;
    w.kills += g.stats.missileKills + g.stats.droneKills - kills;
    w.multis += g.stats.multiShots - multis;
    if (
      runner.getTick() % 120 === 0 ||
      checkpointTicks.has(runner.getTick()) ||
      phase !== "step" ||
      g.state !== previousState ||
      runner.isBonusPaused() ||
      runner.isShopPaused()
    )
      sample(phase);
  }
  sample("final");
  const metadata = runner.studyMetadata();
  assert.equal(runner.getTick(), replay.finalTick);
  assert.equal(metadata.actionIdx, replay.actions.length, label + " action consumption");
  assert.equal(metadata.verifiedCheckpointIndexes.length, replay.checkpoints.length, label + " checkpoint consumption");
  const recap = buildRunRecapData(g, replay);
  assert.deepEqual(compareSummary(detail, recap), [], label + " summary");
  if (STUDY_OBSERVED && quality) audit.qualityFinish(g);
  const observed = STUDY_OBSERVED ? audit.stop() : null;
  const result = {
    label,
    finalTick: runner.getTick(),
    metadata,
    samples,
    waveDeltas,
    initialScore,
    initialStats,
    score: g.score,
    stats: g.stats,
    recap,
  };
  if (observed) {
    assert.equal(observed.stack.length, 0, "balanced observer contexts");
    const events = observed.events;
    for (const [key, count] of Object.entries(g.stats.destroyedByType)) {
      assert.equal(
        events.filter((e) => e.type === "destroyed" && e.typeKey === key).length,
        count,
        label + " destroyed type " + key,
      );
    }
    assert.equal(
      events.filter((e) => e.type === "reward").reduce((n: number, e) => n + e.amount, initialScore),
      g.score,
      label + " score",
    );
    for (const [wave, w] of Object.entries(waveDeltas)) {
      const es = events.filter((e) => e.wave === Number(wave));
      assert.equal(
        es.filter((e) => e.type === "reward").reduce((n: number, e) => n + e.amount, 0),
        w.score,
        label + " wave reward " + wave,
      );
      assert.equal(es.filter((e) => e.type === "multiShot").length, w.multis, label + " wave multis " + wave);
      assert.equal(es.filter((e) => e.type === "shot").length, w.shots, label + " wave shots " + wave);
      assert.equal(es.filter((e) => e.type === "destroyed").length, w.kills, label + " wave destroyed " + wave);
    }
    if (quality) writeFileSync(out + label + "-frames.json", JSON.stringify(observed.frames), { mode: 0o600 });
    writeFileSync(out + label + "-events.json", JSON.stringify(events), { mode: 0o600 });
  }
  results.push(result);
  runner.cleanup();
  console.log(label, STUDY_OBSERVED ? "observed" : "baseline", "verified", samples.length, "state samples");
}
writeFileSync(out + (STUDY_OBSERVED ? "observed" : "baseline") + "-results.json", JSON.stringify(results), {
  mode: 0o600,
});
if (STUDY_OBSERVED) {
  const baseline = JSON.parse(readFileSync(root + "attribution/baseline-results.json", "utf8"));
  assert.deepEqual(JSON.parse(JSON.stringify(results)), baseline, "baseline / observer state and recap equivalence");
  console.log("All 26 observed runs exactly match baseline samples, RNG, action/checkpoint consumption and summaries.");
}
