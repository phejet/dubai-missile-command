/** Stage B controlled evidence, not a balance claim or human play corpus. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createGameSim, spawnMirv, spawnMissile, spawnStackedMissile } from "../../src/game-sim";
import { runGame } from "../../src/headless/sim-runner";
import { createReplayRunner } from "../../src/replay";
import { CURRENT_REPLAY_VERSION } from "../../src/replay-version";
import type { PressureLedger, PressureUnit } from "../../src/target-pressure";
import { setRng } from "../../src/game-logic";
import { applyReplayBootstrap } from "../../src/replay-bootstrap";
import { createEmptyUpgradeLevels } from "../../src/game-sim-upgrades";
import { mulberry32 } from "../../src/headless/rng";
import { towerRouteEntry } from "../../src/missile-routing";
import type { Missile } from "../../src/types";

const rows = [];
let crossed = 0;
try {
  for (const layout of [
    "intact",
    "upgraded",
    "upgraded-cleared-city",
    "no-buildings",
    "no-infrastructure",
    "only-tower",
    "one-right-building",
  ])
    for (const wave of [1, 5, 10, 20, 30, 50])
      for (const seed of [7, 42, 114]) {
        for (const kind of ["missile", "mirv", "stack2", "stack3"] as const) {
          if (wave < 5 && kind !== "missile") continue;
          for (const side of (kind === "mirv" ? ["top"] : ["left", "right", "top"]) as Array<
            "left" | "right" | "top"
          >) {
            setRng(mulberry32(seed));
            const sim = createGameSim(),
              g = sim.initGame();
            g.wave = wave;
            g.burjHealth = 10000;
            if (layout.startsWith("upgraded")) {
              applyReplayBootstrap(
                g,
                {
                  bootstrap: { acquiredUpgrades: ["wildHornetsLeft", "roadrunner", "phalanx", "patriot", "ironBeam"] },
                },
                wave,
              );
              // Keep the real installed collision geometry, disable interception for route observation.
              g.upgrades = createEmptyUpgradeLevels();
            }
            g.schedule = [{ type: "missile", tick: 1e9 }];
            if (layout === "no-buildings" || layout === "only-tower" || layout === "upgraded-cleared-city")
              g.buildings.forEach((b) => (b.alive = false));
            if (layout === "no-infrastructure" || layout === "only-tower" || layout === "one-right-building")
              g.launcherHP.fill(0);
            if (layout === "one-right-building") g.buildings.forEach((b, i) => (b.alive = i === 6));
            const start = performance.now();
            const spawned =
              kind === "mirv"
                ? spawnMirv(g)
                : kind === "missile"
                  ? spawnMissile(g, { side })
                  : spawnStackedMissile(g, kind === "stack2" ? 2 : 3, { side });
            const planningMs = performance.now() - start;
            const units = g.targetPressure!.units;
            let ticks = 0;
            while (spawned && g.missiles.length && ticks < 1200) {
              const previous = new Map<Missile, { x: number; y: number }>();
              for (const m of g.missiles) previous.set(m, { x: m.x, y: m.y });
              // Exercise fractional motion and child-origin overshoot, not just dt=1.
              if (seed === 114 && ticks === 20) g.empScrubTicks = 7;
              sim.update(g, 1);
              ticks++;
              for (const [m, p] of previous) {
                if (!m.pressure || m.type === "mirv") continue;
                const unit = units[m.pressure.unitIds[0]];
                if (unit.category !== "tower" && towerRouteEntry(p, m) !== null) crossed++;
              }
            }
            assert(ticks < 1200, `${wave}/${seed}/${kind}/${side}: unfinished flight`);
            rows.push({
              layout,
              wave,
              seed,
              kind,
              side,
              spawned,
              planningMs,
              ticks,
              reserved: units.length,
              committed: units.filter((u) => u.committedTick !== undefined).length,
              categories: {
                tower: units.filter((u) => u.category === "tower").length,
                building: units.filter((u) => u.category === "building").length,
                infrastructure: units.filter((u) => u.category === "infrastructure").length,
              },
              siteDestinations: units.filter((u) => u.destination.startsWith("site:")).length,
              launcherDestinations: units.filter((u) => u.destination.startsWith("launcher:")).length,
              shortfalls: units.filter((u) => (u.warningShortfall ?? 0) > 0).length,
              exceptions: units.filter((u) => u.exception).length,
              emptyFlankFallbacks: units.filter((u) => u.exception === "empty-flank-tower").length,
              towerOnly: units.filter((u) => u.exception === "tower-only").length,
              conflict: g.targetPressure!.lastConflict ?? null,
            });
          }
        }
      }
} finally {
  setRng(Math.random);
}
const times = rows.map((r) => r.planningMs).sort((a, b) => a - b);
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
const report = {
  cases: rows.length,
  failed: rows.filter((r) => !r.spawned),
  nonTowerCrossings: crossed,
  planningMs: {
    median: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    max: times[times.length - 1],
  },
  runs,
  rows,
};
writeFileSync("scripts/target-pressure/stage-b-verification.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
assert.equal(crossed, 0, "Non-tower route crossed tower");
assert.equal(report.failed.length, 0, "Persistent empty pool: investigate before shipping");
