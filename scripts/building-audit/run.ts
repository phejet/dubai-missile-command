/* eslint-disable @typescript-eslint/no-explicit-any -- private JSON artifact schemas are validated at runtime by the audit assertions. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createReplayRunner } from "../../src/replay";
import { getRngState, getGameplayBuildingBounds, setRng } from "../../src/game-logic";
import { cloneGameStateForReplayAnchor } from "../../src/replay-anchor";
import { buildRunRecapData } from "../../src/run-recap";
import { compareSummary } from "../../src/operator-inspection";
import { parseDetail } from "../../src/operator-contract";
import { initGame, buildingAuditInternals } from "../../src/game-sim";
import { mulberry32 } from "../../src/headless/rng";
import * as audit from "./observer.mjs";
declare const OBSERVED: boolean;
const out = "operator-results/building-audit-20260919";
function hash(v: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(v, (_k, v) => (v instanceof Set ? { set: [...v] } : v instanceof Map ? { map: [...v] } : v)))
    .digest("hex");
}
if (process.argv.includes("--cases")) {
  const cases = [];
  for (const mode of ["direct", "miss", "dead-target", "swept-only"]) {
    setRng(mulberry32(42));
    const g = initGame();
    g.buildings.forEach((b) => (b.alive = false));
    const b = g.buildings[0];
    b.alive = mode !== "dead-target";
    const box = getGameplayBuildingBounds(b);
    const x = (box.left + box.right) / 2;
    const m = {
      x: mode === "miss" ? box.right + 10 : x,
      y: box.top - 1,
      vx: 0,
      vy: mode === "swept-only" ? box.bottom - box.top + 20 : 3,
      accel: 1,
      trail: [],
      alive: true,
      type: "bomb",
      targetX: x,
      targetY: box.top,
      _hitByExplosions: new Set(),
    };
    g.missiles = [m as never];
    if (OBSERVED) audit.start(g, getGameplayBuildingBounds);
    buildingAuditInternals.updateMissiles(g, 1);
    assert.equal(b.alive, mode === "miss" || mode === "swept-only", mode);
    const result = OBSERVED ? audit.finish(g) : null;
    if (mode === "direct") assert.equal(result?.records[0].hitBuilding, 0);
    if (mode === "swept-only") assert(result?.contacts.some((c) => !c.point && c.eligible));
    cases.push({ mode, buildingAlive: b.alive, missileAlive: m.alive, result });
  }
  writeFileSync(out + "/cases.json", JSON.stringify(cases, null, 2));
  console.log("Four controlled collision cases passed.");
  process.exit(0);
}
if (process.argv.includes("--reproduce")) {
  assert(OBSERVED);
  const runs = JSON.parse(readFileSync(out + "/observed-results.json", "utf8")).filter(
    (r: any) => r.status === "verified" && r.cohort === "human-study",
  );
  const evidence = [];
  for (const r of runs) {
    for (const t of r.audit.records.filter(
      (t: any) => t.type === "bomb" && t.hitBuilding !== null && t.hitBuilding !== t.target && t.end.targetAlive,
    )) {
      setRng(mulberry32(42));
      const g = initGame();
      g.burjAlive = false;
      g.launcherHP = [0, 0];
      g.defenseSites = [];
      g.buildings.forEach((b, i) => (b.alive = i === t.target || i === t.hitBuilding));
      const m = {
        ...t.start,
        alive: true,
        type: "bomb",
        accel: 1,
        trail: [],
        targetX: t.aim.x,
        targetY: t.aim.y,
        _hitByExplosions: new Set(),
      };
      g.missiles = [m as never];
      audit.start(g, getGameplayBuildingBounds);
      let ticks = 0;
      while (m.alive && ticks < 1000) {
        audit.clock(++ticks);
        buildingAuditInternals.updateMissiles(g, 1);
      }
      assert(g.buildings[t.target].alive);
      assert(!g.buildings[t.hitBuilding].alive);
      evidence.push({
        case: "Recorded bomb misses intended live building and destroys neighbor",
        run: r.studyLabel,
        threat: t.id,
        ticks,
        observed: audit.finish(g),
      });
    }
    for (const c of r.audit.contacts.filter((c: any) => c.eligible && !c.point)) {
      setRng(mulberry32(42));
      const g = initGame();
      g.burjAlive = false;
      g.launcherHP = [0, 0];
      g.defenseSites = [];
      g.buildings.forEach((b, i) => (b.alive = i === c.building));
      const m = {
        ...c.previous,
        vx: c.current.x - c.previous.x,
        vy: c.current.y - c.previous.y,
        alive: true,
        type: "mirv_warhead",
        accel: 1,
        trail: [],
        _hitByExplosions: new Set(),
      };
      g.missiles = [m as never];
      audit.start(g, getGameplayBuildingBounds);
      buildingAuditInternals.updateMissiles(g, 1);
      assert(g.buildings[c.building].alive);
      assert(m.alive);
      assert(audit.segment(c.previous, c.current, c.bounds));
      const observed = audit.finish(g);
      assert(observed.contacts.some((x: any) => x.eligible && !x.point));
      evidence.push({
        case: "Recorded segment clips building but endpoint collision misses",
        run: r.studyLabel,
        threat: c.id,
        tick: c.tick,
        observed,
      });
    }
  }
  assert.equal(evidence.length, 2);
  writeFileSync(out + "/reproductions.json", JSON.stringify(evidence, null, 2));
  console.log("Both replay-derived defects reproduced in isolated real missile updates.");
  process.exit(0);
}
const inventory = JSON.parse(readFileSync(out + "/inventory.json", "utf8"));
const results = [];
for (const row of inventory.rows) {
  const replay = row.replay;
  let runner;
  const result: any = {
    label: row.label,
    cohort: row.cohort,
    studyLabel: row.studyLabel,
    build: replay._buildId ?? null,
  };
  if (!Number.isFinite(replay.finalTick)) {
    results.push({ ...result, status: "unverifiable", reason: "No final tick / historical endpoint" });
    continue;
  }
  try {
    runner = createReplayRunner(replay, null, (type, data) => {
      if (type === "replay_divergence") throw Error("Checkpoint divergence at tick " + (data as any).tick);
    });
    const g = runner.init();
    if (OBSERVED) audit.start(g, getGameplayBuildingBounds);
    const samples = [];
    const cp = new Set((replay.checkpoints ?? []).map((c: any) => c.tick));
    const sample = () =>
      samples.push(
        hash({ state: cloneGameStateForReplayAnchor(g), rng: getRngState(), meta: runner!.studyMetadata() }),
      );
    sample();
    let loops = 0;
    while (runner.getTick() < replay.finalTick) {
      assert(!runner.isFinished(), "Finished before recorded endpoint");
      assert(++loops < replay.finalTick * 3 + 100, "Loop bound");
      audit.clock(runner.getTick());
      if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
      else if (runner.isShopPaused()) runner.resumeFromShop();
      else runner.step();
      if (runner.getTick() % 120 === 0 || cp.has(runner.getTick())) sample();
    }
    sample();
    const meta = runner.studyMetadata();
    assert.equal(meta.actionIdx, replay.actions.length, "Action consumption");
    assert.equal(meta.verifiedCheckpointIndexes.length, (replay.checkpoints ?? []).length, "Checkpoint consumption");
    if (replay.score !== undefined) assert.equal(g.score, replay.score, "Stored score");
    if (replay.wave !== undefined) assert.equal(g.wave, replay.wave, "Stored wave");
    if (row.studyLabel) {
      const detail = parseDetail(
        JSON.parse(readFileSync("operator-results/scoring-study-20260915/" + row.studyLabel + "-detail.json", "utf8"))
          .session,
      );
      assert.deepEqual(compareSummary(detail, buildRunRecapData(g, replay)), [], "Stored summary");
    }
    Object.assign(result, {
      status: cp.size ? "verified" : "no-checkpoints",
      finalTick: runner.getTick(),
      score: g.score,
      wave: g.wave,
      stats: g.stats,
      meta,
      samples,
    });
    if (OBSERVED) result.audit = audit.finish(g);
  } catch (e) {
    Object.assign(result, { status: "quarantined", reason: String((e as Error).message).slice(0, 200) });
  } finally {
    runner?.cleanup();
  }
  results.push(result);
  console.log(row.label, result.status);
}
if (OBSERVED) {
  const baseline = JSON.parse(readFileSync(out + "/baseline-results.json", "utf8"));
  assert.deepEqual(
    results.map((r) => {
      const copy = { ...r };
      delete copy.audit;
      return copy;
    }),
    baseline,
    "Observer equivalence for every corpus entry",
  );
  console.log("Observer matches baseline across all entries.");
}
writeFileSync(out + "/" + (OBSERVED ? "observed" : "baseline") + "-results.json", JSON.stringify(results), {
  mode: 0o600,
});
