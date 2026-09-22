/** Stage C controlled simulation and combined replay evidence; not device timing. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createGameSim, spawnDroneOfType } from "../../src/game-sim";
import { runGame } from "../../src/headless/sim-runner";
import { createReplayRunner } from "../../src/replay";
import { CURRENT_REPLAY_VERSION } from "../../src/replay-version";
import type { PressureLedger, PressureUnit } from "../../src/target-pressure";
import { setRng } from "../../src/game-logic";
import { applyReplayBootstrap } from "../../src/replay-bootstrap";
import { createEmptyUpgradeLevels } from "../../src/game-sim-upgrades";
import { mulberry32 } from "../../src/headless/rng";
import { towerRouteEntry } from "../../src/missile-routing";
import type { Drone, Missile, Shahed136Variant } from "../../src/types";

const rows = [];
let crossed = 0;
for (const layout of [
  "intact",
  "upgraded",
  "upgraded-cleared-city",
  "no-buildings",
  "only-tower",
  "one-right-building",
  "no-assets",
])
  for (const wave of [1, 5, 20, 50])
    for (const seed of [7, 42, 114])
      for (const family of ["shahed-136", "shahed-136-dive", "shahed-136-bomber", "shahed-136-dive-bomber", "jet"])
        for (const side of ["left", "right"] as const) {
          setRng(mulberry32(seed));
          const sim = createGameSim(),
            g = sim.initGame();
          g.wave = wave;
          g.burjHealth = 10000;
          g.schedule = [{ type: "missile", tick: 1e9 }];
          if (layout.startsWith("upgraded")) {
            applyReplayBootstrap(
              g,
              { bootstrap: { acquiredUpgrades: ["wildHornetsLeft", "roadrunner", "phalanx", "patriot", "ironBeam"] } },
              wave,
            );
            g.upgrades = createEmptyUpgradeLevels();
            assert(
              g.defenseSites.some((site) => site.alive),
              "Upgraded layout must contain real sites",
            );
          }
          if (
            layout === "no-buildings" ||
            layout === "only-tower" ||
            layout === "no-assets" ||
            layout === "upgraded-cleared-city"
          )
            g.buildings.forEach((b) => (b.alive = false));
          if (["only-tower", "one-right-building", "no-assets"].includes(layout)) g.launcherHP.fill(0);
          if (layout === "one-right-building") g.buildings.forEach((b, i) => (b.alive = i === 6));
          if (layout === "no-assets") g.burjAlive = false;
          const before = performance.now();
          spawnDroneOfType(
            g,
            family === "jet" ? "shahed238" : "shahed136",
            { side },
            family === "jet" ? undefined : (family as Shahed136Variant),
          );
          const planningMs = performance.now() - before;
          const d = g.drones[0];
          let ticks = 0,
            commitMs = 0;
          while (layout !== "no-assets" && (g.drones.length || g.missiles.length) && ticks++ < 1800) {
            const previous = ([...g.drones, ...g.missiles] as (Drone | Missile)[]).map((e) => ({ e, x: e.x, y: e.y }));
            const commitsNow =
              d.alive &&
              !d.pressure!.committed &&
              !!d.pressure!.route &&
              (d.pathIndex ?? 0) >= d.pressure!.route.tellIndex;
            const start = performance.now();
            sim.update(g, 1);
            if (commitsNow) commitMs = performance.now() - start;
            for (const p of previous) {
              const category =
                p.e.type === "drone"
                  ? p.e.pressure?.route?.target.category
                  : g.targetPressure!.units[p.e.pressure!.unitIds[0]].category;
              if (category !== "tower" && towerRouteEntry(p, p.e) !== null) crossed++;
            }
          }
          assert(ticks < 1800, `${layout}/${wave}/${family}/${side}: stalled flight`);
          assert(g.targetPressure!.units.every((u) => u.state === "ended" || u.state === "cancelled"));
          rows.push({
            layout,
            wave,
            seed,
            family,
            side,
            planningMs,
            commitUpdateMs: commitMs,
            ticks,
            units: g.targetPressure!.units,
            towerDamage: 10000 - g.burjHealth,
          });
        }
setRng(Math.random);
const countCategories = (units: PressureUnit[]) =>
  Object.fromEntries(
    ["tower", "building", "infrastructure"].map((category) => [
      category,
      units.filter((u) => u.category === category).length,
    ]),
  );
const runs = [];
for (const seed of [7, 42, 114]) {
  const recorded = runGame(null, { seed, maxTicks: 5000, record: true, checkpoints: true, draftMode: true });
  const runner = createReplayRunner(
    {
      version: CURRENT_REPLAY_VERSION,
      seed,
      actions: recorded.actions!,
      initialState: recorded.initialState!,
      draftMode: true,
      checkpoints: recorded.checkpoints,
    },
    null,
    (event) => {
      assert.notEqual(event, "replay_divergence", `seed ${seed}: checkpoint mismatch`);
    },
  );
  const g = runner.init(),
    ledgers: PressureLedger[] = [];
  let steps = 0;
  while (runner.getTick() < recorded.ticks) {
    assert(++steps < 20000, "replay progress guard");
    if (g.targetPressure && !ledgers.includes(g.targetPressure)) ledgers.push(g.targetPressure);
    if (runner.isBonusPaused()) runner.resumeFromBonusScreen();
    else if (runner.isShopPaused()) runner.resumeFromShop();
    else runner.step();
  }
  assert.equal(g.score, recorded.score);
  runs.push({
    seed,
    ticks: recorded.ticks,
    score: g.score,
    wave: g.wave,
    waves: ledgers.map((ledger) => {
      const committed = ledger.units
        .filter((u) => u.committedTick !== undefined)
        .sort((a, b) => a.committedTick! - b.committedTick! || a.id - b.id);
      const windows = [];
      for (let i = 0; i + 10 <= committed.length; i++)
        windows.push(committed.slice(i, i + 10).filter((u) => u.category === "tower").length);
      return {
        wave: ledger.wave,
        reserved: countCategories(ledger.units),
        committed: countCategories(committed),
        families: Object.fromEntries(
          ["prop-dive", "jet-dive", "bomb"].map((family) => [
            family,
            {
              reserved: ledger.units.filter((u) => u.family === family).length,
              committed: committed.filter((u) => u.family === family).length,
            },
          ]),
        ),
        cancelled: ledger.units.filter((u) => u.state === "cancelled").length,
        shortfalls: committed.filter((u) => (u.warningShortfall ?? 0) > 0).length,
        exceptions: ledger.units.filter((u) => u.exception).length,
        deferredAttempts: ledger.deferredAttempts,
        tenCommitmentTowerRange: windows.length ? [Math.min(...windows), Math.max(...windows)] : null,
      };
    }),
  });
  runner.cleanup();
}
const timing = (values: number[]) => {
  values.sort((a, b) => a - b);
  return {
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.floor(values.length * 0.95)],
    max: values[values.length - 1],
  };
};
const report = {
  cases: rows.length,
  nonTowerCrossings: crossed,
  timingByFamily: Object.fromEntries(
    ["shahed-136", "shahed-136-dive", "shahed-136-bomber", "shahed-136-dive-bomber", "jet"].map((family) => [
      family,
      Object.fromEntries(
        [1, 5, 20, 50].map((wave) => {
          const group = rows.filter((r) => r.family === family && r.wave === wave);
          return [
            wave,
            {
              spawnMs: timing(group.map((r) => r.planningMs)),
              commitmentUpdateMs: timing(group.map((r) => r.commitUpdateMs).filter((v) => v > 0)),
            },
          ];
        }),
      ),
    ]),
  ),
  runs,
  rows,
};
writeFileSync("scripts/target-pressure/stage-c-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
assert.equal(crossed, 0, "Non-tower route crossed the tower");
