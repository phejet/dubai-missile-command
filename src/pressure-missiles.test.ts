import { afterEach, describe, expect, it } from "vitest";
import { createGameSim, spawnMirv, spawnMissile, spawnStackedMissile } from "./game-sim";
import { getRngState, setRng, setRngState } from "./game-logic";
import { mulberry32 } from "./headless/rng";
import { buildReplayCheckpoint } from "./replay-debug";
import { cloneGameStateForReplayAnchor } from "./replay-anchor";
import { advanceSpawnSchedule } from "./wave-spawner";
import type { GameState } from "./types";

afterEach(() => setRng(Math.random));
function setup(wave = 5, seed = 42) {
  setRng(mulberry32(seed));
  const sim = createGameSim(),
    g = sim.initGame();
  g.wave = wave;
  g.schedule = [{ type: "missile", tick: 1e9 }];
  return { sim, g };
}

describe("pressure missile integration", () => {
  it("does not refund a MIRV killed before splitting", () => {
    const { sim, g } = setup();
    expect(spawnMirv(g)).toBe(true);
    const count = g.targetPressure!.units.length;
    g.missiles[0].alive = false;
    g.missiles[0].killedBy = "player";
    sim.update(g, 1);
    expect(g.targetPressure!.units).toHaveLength(count);
    expect(g.targetPressure!.units.every((u) => u.state === "cancelled")).toBe(true);
    expect(spawnMissile(g)).toBe(true);
    expect(g.targetPressure!.units).toHaveLength(count + 1);
  });
  for (const kind of ["mirv", "stack2", "stack3"] as const) {
    it(`transfers ${kind} ownership without duplicate units and inherits carrier visibility`, () => {
      const { sim, g } = setup(10);
      expect(kind === "mirv" ? spawnMirv(g) : spawnStackedMissile(g, kind === "stack2" ? 2 : 3, { side: "left" })).toBe(
        true,
      );
      const parent = g.missiles[0],
        ids = [...parent.pressure!.unitIds],
        planned = parent.pressure!.children.map((c) => c.target);
      for (let i = 0; !parent.splitTriggered && i < 300; i++) sim.update(g, 1);
      expect(parent.splitTriggered).toBe(true);
      expect(g.targetPressure!.units).toHaveLength(ids.length);
      expect(g.targetPressure!.units.every((u) => u.state === "committed")).toBe(true);
      expect(g.missiles.flatMap((m) => m.pressure!.unitIds).sort()).toEqual(ids.sort());
      expect(g.missiles.every((m) => m.pressure!.visibleTicks > 0)).toBe(true);
      for (const target of planned)
        expect(g.missiles.some((m) => m.targetX === target.x && m.targetY === target.y)).toBe(true);
    });
  }
  it("keeps a destroyed destination frozen through the split", () => {
    const { sim, g } = setup();
    expect(spawnMirv(g)).toBe(true);
    const carrier = g.missiles[0];
    const plan = carrier.pressure!.children.find((c) => c.target.id.startsWith("building:"))!;
    expect(plan).toBeDefined();
    g.buildings[Number(plan.target.id.split(":")[1])].alive = false;
    for (let i = 0; !carrier.splitTriggered && i < 300; i++) sim.update(g, 1);
    const child = g.missiles.find((m) => m.pressure!.unitIds.includes(plan.unitId))!;
    expect([child.targetX, child.targetY]).toEqual([plan.target.x, plan.target.y]);
  });
  it("retains sampled parameters, RNG and schedule entry while deferring", () => {
    const { g } = setup();
    g.burjAlive = false;
    g.buildings.forEach((b) => (b.alive = false));
    g.launcherHP.fill(0);
    g.schedule = [{ type: "missile", tick: 0, overrides: { side: "left" } }];
    const spawn = (state: unknown) => spawnMissile(state as GameState, { side: "left" });
    advanceSpawnSchedule(g, 1, spawn);
    expect(g.scheduleIdx).toBe(0);
    expect(g.targetPressure!.units).toEqual([]);
    const pending = structuredClone(g.pendingMissileSpawn),
      rng = getRngState();
    for (let i = 0; i < 10; i++) advanceSpawnSchedule(g, 1, spawn);
    expect(g.pendingMissileSpawn).toEqual(pending);
    expect(getRngState()).toBe(rng);
    expect(g.targetPressure!.deferredAttempts).toBe(1);
    g.buildings[0].alive = true;
    g.waveTick = 30;
    advanceSpawnSchedule(g, 1, spawn);
    expect(g.scheduleIdx).toBe(1);
    expect(g.pendingMissileSpawn).toBeUndefined();
  });
  it("records late-wave warning shortfalls without changing missile speed", () => {
    const { g } = setup(50);
    expect(spawnMissile(g, { side: "top" })).toBe(true);
    const m = g.missiles[0],
      unit = g.targetPressure!.units[0];
    expect(Math.hypot(m.vx, m.vy)).toBeGreaterThanOrEqual(9);
    expect(Math.hypot(m.vx, m.vy)).toBeLessThanOrEqual(10);
    expect(m.accel).toBeCloseTo(1.0495);
    expect(unit.warningShortfall).toBeGreaterThan(0);
    expect(unit.warningTicks! + unit.warningShortfall!).toBe(60);
  });
  it("reproduces split plans after an anchor clone and hashes quota mutations", () => {
    const { sim, g } = setup(10);
    expect(spawnMirv(g)).toBe(true);
    for (let i = 0; i < 20; i++) sim.update(g, 1);
    const anchor = cloneGameStateForReplayAnchor(g),
      rng = getRngState()!;
    for (let i = 0; i < 90; i++) sim.update(g, 1);
    const expected = buildReplayCheckpoint(g, 110);
    setRngState(rng);
    for (let i = 0; i < 90; i++) sim.update(anchor, 1);
    expect(buildReplayCheckpoint(anchor, 110)).toEqual(expected);
    anchor.targetPressure!.units[0].category = "infrastructure";
    expect(buildReplayCheckpoint(anchor, 110).hash).not.toBe(expected.hash);
  });
  it("uses the approved tower fallback only after an empty flank's sky clears", () => {
    const { g } = setup(10);
    g.buildings.forEach((b, i) => (b.alive = i === 6));
    g.launcherHP.fill(0);
    const blocker = { x: 100, y: 100, vx: 0, vy: 0, accel: 1, alive: true, trail: [], type: "missile" as const };
    g.missiles.push(blocker);
    expect(spawnMissile(g, { side: "left" })).toBe(false);
    expect(g.targetPressure!.units).toHaveLength(0);
    blocker.alive = false;
    g.waveTick = 30;
    expect(spawnMissile(g, { side: "left" })).toBe(true);
    expect(g.targetPressure!.units[0].exception).toBe("empty-flank-tower");
    expect(g.missiles[1].x).toBe(-10);
    expect(g.targetPressure!.units[0].category).toBe("tower");
  });
  it("shares one reservation sequence across ordinary missiles and split families", () => {
    const { g } = setup(10);
    expect(spawnMissile(g, { side: "top" })).toBe(true);
    expect(spawnMirv(g)).toBe(true);
    expect(spawnStackedMissile(g, 3, { side: "top" })).toBe(true);
    expect(spawnMissile(g, { side: "top" })).toBe(true);
    expect(g.targetPressure!.units).toHaveLength(10);
    expect(g.targetPressure!.units.filter((u) => u.requested === "tower")).toHaveLength(3);
    expect(g.targetPressure!.units.filter((u) => u.requested === "building")).toHaveLength(5);
    expect(g.targetPressure!.units.filter((u) => u.requested === "infrastructure")).toHaveLength(2);
  });
  for (const corruption of ["missing-plan", "invalid-child", "duplicate-child", "stale-wave"] as const) {
    it(`retires a corrupt carrier without a partial split or a frame-loop throw: ${corruption}`, () => {
      const { sim, g } = setup();
      expect(spawnMirv(g)).toBe(true);
      const carrier = g.missiles[0],
        ledger = g.targetPressure!;
      carrier.splitY = carrier.y + 1;
      if (corruption === "missing-plan") carrier.pressure = undefined;
      else if (corruption === "invalid-child") carrier.pressure!.children[1].unitId = 99999;
      else if (corruption === "duplicate-child")
        carrier.pressure!.children[1].unitId = carrier.pressure!.children[0].unitId;
      else ledger.wave = g.wave - 1;
      expect(() => sim.update(g, 1)).not.toThrow();
      expect(carrier.alive).toBe(false);
      expect(g.missiles).toHaveLength(0);
      expect(ledger.units.every((u) => u.committedTick === undefined)).toBe(true);
      expect(ledger.invariantFailures).toBe(1);
      expect(ledger.lastInvariantFailure).toContain("carrier retired");
    });
  }
});
