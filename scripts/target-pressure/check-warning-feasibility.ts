/** Read-only Stage B feasibility probe. Runs the current simulator; changes no runtime files. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { CANVAS_W, CANVAS_H, getRng, setRng } from "../../src/game-logic";
import { createGameSim, spawnMirv, spawnMissile } from "../../src/game-sim";

const previousRng = getRng();
const rows = [];
const ordinaryRows = [];
try {
  for (const wave of [5, 8, 10, 12, 14, 16, 20, 30]) {
    // Minimum RNG samples for parent and preplanned children. This is a
    // controlled speed bound, not a sampled human playthrough.
    setRng(() => 0);
    const sim = createGameSim();
    const g = sim.initGame();
    g.wave = wave;
    g.schedule = [{ type: "missile", tick: 1e9 }];
    g.scheduleIdx = 0;
    g.missiles = [];
    g.drones = [];
    spawnMirv(g);
    const carrier = g.missiles[0];
    assert(carrier?.type === "mirv");
    setRng(() => 0);
    let carrierTicks = 0;
    let visibleCarrierTicks = 0;
    while (!carrier.splitTriggered && carrierTicks < 1000) {
      if (carrier.x >= 0 && carrier.x <= CANVAS_W && carrier.y >= 0 && carrier.y <= CANVAS_H) visibleCarrierTicks++;
      sim.update(g, 1);
      carrierTicks++;
    }
    assert(carrier.splitTriggered);
    const child = g.missiles.find((m) => m.type === "mirv_warhead");
    assert(child);
    const speed = Math.hypot(child.vx, child.vy);
    // Very generous upper bound: entire missile survival rectangle, including
    // off-screen margins. Any straight route must leave this rectangle after
    // traveling more than its diagonal, even if it hits no asset at all.
    const maximumDistance = Math.hypot(CANVAS_W + 100, CANVAS_H + 100);
    let distance = 0;
    let currentSpeed = speed;
    let maximumTicks = 0;
    while (distance <= maximumDistance) {
      currentSpeed *= child.accel;
      distance += currentSpeed;
      maximumTicks++;
    }
    const closedFormTicks =
      Math.floor(Math.log(1 + (maximumDistance * (child.accel - 1)) / (speed * child.accel)) / Math.log(child.accel)) +
      1;
    assert.equal(maximumTicks, closedFormTicks);
    rows.push({
      wave,
      minimumChildSpeed: speed,
      acceleration: child.accel,
      carrierTicks,
      visibleCarrierTicks,
      maximumTicksUntilExit: maximumTicks,
      canPossiblyOffer60ChildTicks: maximumTicks >= 60,
    });
  }
  for (const wave of [1, 10, 20, 30, 40, 50, 60]) {
    setRng(() => 0);
    const g = createGameSim().initGame();
    g.wave = wave;
    spawnMissile(g, { side: "top" });
    const missile = g.missiles[0];
    assert(missile?.type === "missile");
    const speed = Math.hypot(missile.vx, missile.vy);
    const maximumDistance = Math.hypot(CANVAS_W + 100, CANVAS_H + 100);
    let distance = 0,
      v = speed,
      ticks = 0;
    while (distance <= maximumDistance) {
      v *= missile.accel;
      distance += v;
      ticks++;
    }
    const closed =
      Math.floor(
        Math.log(1 + (maximumDistance * (missile.accel - 1)) / (speed * missile.accel)) / Math.log(missile.accel),
      ) + 1;
    assert.equal(ticks, closed);
    ordinaryRows.push({
      wave,
      minimumSpeed: speed,
      acceleration: missile.accel,
      maximumTicksUntilExit: ticks,
      canPossiblyOffer60Ticks: ticks >= 60,
    });
  }
} finally {
  setRng(previousRng);
}
const result = {
  note: "Upper bound, not route feasibility. False proves impossible even without asset collisions. True does not prove a fair route exists.",
  rows,
  ordinaryRows,
};
writeFileSync("scripts/target-pressure/warning-feasibility.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
