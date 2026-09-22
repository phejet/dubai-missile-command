import { afterEach, describe, expect, it } from "vitest";
import { createGameSim, spawnDroneOfType, spawnMissile } from "./game-sim";
import { setRng, getRngState, setRngState, getGameplayBurjCollisionTop, getGameplayBuildingBounds } from "./game-logic";
import { applyReplayBootstrap } from "./replay-bootstrap";
import { createEmptyUpgradeLevels } from "./game-sim-upgrades";
import { mulberry32 } from "./headless/rng";
import { TARGET_PRESSURE } from "./target-pressure";
import { droneRoutePool } from "./drone-routing";
import { towerRouteEntry } from "./missile-routing";
import { cloneGameStateForReplayAnchor } from "./replay-anchor";
import { buildReplayCheckpoint } from "./replay-debug";
import type { Drone } from "./types";

afterEach(() => setRng(Math.random));
function setup(wave = 5, seed = 42) {
  setRng(mulberry32(seed));
  const sim = createGameSim(),
    g = sim.initGame();
  g.wave = wave;
  g.burjHealth = 10000;
  g.schedule = [{ type: "missile", tick: 1e9 }];
  return { sim, g };
}
const families = ["shahed-136", "shahed-136-dive", "shahed-136-dive-bomber", "shahed-136-bomber", "jet"] as const;
function spawn(g: ReturnType<typeof setup>["g"], family: (typeof families)[number], side: "left" | "right" = "left") {
  spawnDroneOfType(g, family === "jet" ? "shahed238" : "shahed136", { side }, family === "jet" ? undefined : family);
  return g.drones[g.drones.length - 1];
}
function advanceUntil(
  sim: ReturnType<typeof setup>["sim"],
  g: ReturnType<typeof setup>["g"],
  condition: () => boolean,
) {
  let ticks = 0;
  while (!condition() && ticks++ < 1800) sim.update(g, 1);
  expect(ticks).toBeLessThan(1800);
}

describe("Stage C pressure ownership and commitment", () => {
  it.each(families)("%s reserves terminal bodies only, and carrier loss refunds nothing", (family) => {
    const { sim, g } = setup();
    const d = spawn(g, family),
      plan = d.pressure!;
    const count = family === "jet" ? 3 : family === "shahed-136-dive-bomber" ? 2 : 1;
    expect(g.targetPressure!.units).toHaveLength(count);
    expect(plan.unitId === undefined).toBe(family === "shahed-136-bomber");
    expect(g.targetPressure!.units.every((u) => u.state === "reserved" || u.state === "cancelled")).toBe(true);
    d.alive = false;
    d.killedBy = "player";
    sim.update(g, 1);
    expect(g.targetPressure!.units.every((u) => u.state === "cancelled")).toBe(true);
    expect(spawnMissile(g)).toBe(true);
    expect(g.targetPressure!.units[count].requested).toBe(TARGET_PRESSURE.sequence[count]);
  });
  it.each(["shahed-136", "jet"] as const)(
    "%s reveals a living destination, then freezes it through destruction",
    (family) => {
      const { sim, g } = setup();
      const d = spawn(g, family);
      expect(d.diveTarget).toBeUndefined();
      advanceUntil(sim, g, () => d.pressure!.committed);
      expect(d.diveTelegraphing).toBe(true);
      const plan = structuredClone(d.pressure!),
        path = structuredClone(d.waypoints),
        target = { ...d.diveTarget! };
      const unit = g.targetPressure!.units[plan.unitId!];
      expect(unit.committedTick).toBeDefined();
      const b = Number(unit.destination.split(":")[1]);
      expect(unit.category).toBe("building");
      g.buildings[b].alive = false;
      for (let i = 0; i < 20; i++) sim.update(g, 1);
      expect(d.diveTarget).toEqual(target);
      expect(d.waypoints).toEqual(path);
      expect(g.targetPressure!.units[plan.unitId!].destination).toBe(unit.destination);
    },
  );
  it("reselects a feasible living same-category target before the tell", () => {
    const { sim, g } = setup();
    const d = spawn(g, "shahed-136");
    const original = d.pressure!.route!.target.id;
    g.buildings[Number(original.split(":")[1])].alive = false;
    advanceUntil(sim, g, () => d.pressure!.committed || !d.pressure!.route);
    const unit = g.targetPressure!.units[d.pressure!.unitId!];
    expect(unit.state).toBe("committed");
    expect(unit.destination).not.toBe(original);
    expect(unit.category).toBe("building");
  });
  it("cancels an infeasible continuation and flies out without a tower redirect or a jump", () => {
    const { sim, g } = setup();
    const d = spawn(g, "shahed-136");
    g.buildings.forEach((b) => (b.alive = false));
    let maxStep = 0;
    advanceUntil(sim, g, () => {
      if (!d.alive) return true;
      const p = { x: d.x, y: d.y };
      sim.update(g, 1);
      maxStep = Math.max(maxStep, Math.hypot(d.x - p.x, d.y - p.y));
      expect(d.diveTarget).toBeUndefined();
      return !d.alive;
    });
    expect(maxStep).toBeLessThan(d.pressure!.speed * 1.1);
    expect(g.targetPressure!.units[d.pressure!.unitId!]).toMatchObject({ state: "cancelled", outcome: "target-lost" });
    expect(g.burjHealth).toBe(10000);
  });
  it("transfers a dropped bomb exactly once; losing its carrier cannot cancel the bomb", () => {
    const { sim, g } = setup();
    const d = spawn(g, "shahed-136-bomber");
    advanceUntil(sim, g, () => d.bombsDropped === 1);
    const bomb = g.missiles.find((m) => m.type === "bomb")!;
    expect(bomb).toBeDefined();
    const id = bomb.pressure!.unitIds[0];
    expect(d.pressure!.bombs[0].transferred).toBe(true);
    expect(g.targetPressure!.units[id].state).toBe("committed");
    d.alive = false;
    sim.update(g, 1);
    expect(g.targetPressure!.units[id].state).toBe("committed");
    bomb.alive = false;
    bomb.killedBy = "player";
    sim.update(g, 1);
    expect(g.targetPressure!.units[id]).toMatchObject({ state: "ended", outcome: "intercepted" });
  });
  it("cancels a bomb whose category disappears before its drop", () => {
    const { sim, g } = setup();
    const d = spawn(g, "shahed-136-bomber");
    g.buildings.forEach((b) => (b.alive = false));
    advanceUntil(sim, g, () => d.bombsDropped === 1);
    expect(g.missiles).toHaveLength(0);
    expect(g.targetPressure!.units[0]).toMatchObject({ state: "cancelled", outcome: "target-lost" });
  });
  it("keeps a launched bomb's velocity and destination after target loss", () => {
    const { sim, g } = setup();
    const d = spawn(g, "shahed-136-bomber");
    advanceUntil(sim, g, () => d.bombsDropped === 1);
    const bomb = g.missiles.find((m) => m.type === "bomb")!;
    const original = { vx: bomb.vx, vy: bomb.vy, targetX: bomb.targetX, targetY: bomb.targetY };
    const unit = g.targetPressure!.units[bomb.pressure!.unitIds[0]];
    g.buildings[Number(unit.destination.split(":")[1])].alive = false;
    for (let i = 0; i < 10; i++) sim.update(g, 1);
    expect(bomb).toMatchObject(original);
  });
  it("reaches a real installed defense site with the city cleared", () => {
    const { sim, g } = setup();
    applyReplayBootstrap(
      g,
      { bootstrap: { acquiredUpgrades: ["wildHornetsLeft", "roadrunner", "phalanx", "patriot", "ironBeam"] } },
      5,
    );
    g.upgrades = createEmptyUpgradeLevels();
    g.buildings.forEach((b) => (b.alive = false));
    g.launcherHP.fill(0);
    const d = spawn(g, "shahed-136-dive");
    const target = d.pressure!.route!.target;
    expect(target.category).toBe("infrastructure");
    expect(target.id.startsWith("site:")).toBe(true);
    advanceUntil(sim, g, () => !d.alive);
    expect(g.defenseSites.find((s) => `site:${s.key}` === target.id)!.alive).toBe(false);
    expect(g.burjHealth).toBe(10000);
  });
  it("mixes missile/drone/bomb requests in one immutable sequence", () => {
    const { g } = setup();
    for (let i = 0; i < 10; i++) {
      spawn(g, "jet", i % 2 ? "right" : "left");
      spawnMissile(g);
    }
    expect(g.targetPressure!.units).toHaveLength(40);
    g.targetPressure!.units.forEach((u, i) => expect(u.requested).toBe(TARGET_PRESSURE.sequence[i % 10]));
  });
  it("anchors reserved and committed paths, bomb transfers and RNG deterministically", () => {
    const { sim, g } = setup();
    spawn(g, "jet");
    spawn(g, "shahed-136-dive-bomber", "right");
    for (let i = 0; i < 30; i++) sim.update(g, 1);
    const saved = cloneGameStateForReplayAnchor(g),
      rng = getRngState();
    for (let i = 0; i < 240; i++) sim.update(g, 1);
    const expected = buildReplayCheckpoint(g, 270);
    setRngState(rng!);
    for (let i = 0; i < 240; i++) sim.update(saved, 1);
    expect(buildReplayCheckpoint(saved, 270)).toEqual(expected);
  });
});

describe("Stage C real movement", () => {
  it("makes near and far destinations choose different dive points, with a clear far-side cruise", () => {
    const { g } = setup();
    const routes = droneRoutePool(g, { x: -20, y: 150 }, 1, 2, false);
    const near = routes.find((r) => r.target.id === "building:0")!;
    const far = routes.find((r) => r.target.id === "building:6")!;
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    for (const route of routes) {
      const tell = route.waypoints[route.tellIndex];
      expect(tell.x).toBeGreaterThanOrEqual(TARGET_PRESSURE.drone.tellInset);
      expect(tell.x).toBeLessThanOrEqual(900 - TARGET_PRESSURE.drone.tellInset);
    }
    expect(far.waypoints[far.diveStartIndex].x).toBeGreaterThan(500);
    expect(far.diveStartIndex).toBeGreaterThan(near.diveStartIndex);
  });
  for (const family of families)
    for (const side of ["left", "right"] as const)
      for (const wave of [1, 20, 50]) {
        it(`${family}/${side}/wave ${wave}: real flight respects non-tower routes and settles ownership`, () => {
          const { sim, g } = setup(wave);
          const d = spawn(g, family, side);
          const originalBuildings = g.buildings.map((b) => b.alive);
          const target = d.pressure!.route?.target;
          let ticks = 0,
            tells = 0,
            maxStep = 0;
          while ((g.drones.length || g.missiles.length) && ticks++ < 1800) {
            const before = [...g.drones, ...g.missiles].map((e) => ({ e, x: e.x, y: e.y }));
            if (d.diveTelegraphing) tells++;
            sim.update(g, 0.5);
            for (const p of before) {
              if (p.e.type === "drone") {
                const drone = p.e as Drone;
                maxStep = Math.max(maxStep, Math.hypot(drone.x - p.x, drone.y - p.y));
                if (!drone.pressure!.route || drone.pressure!.route.target.category !== "tower")
                  expect(towerRouteEntry(p, drone)).toBeNull();
              } else if (g.targetPressure!.units[p.e.pressure!.unitIds[0]].category !== "tower")
                expect(towerRouteEntry(p, p.e)).toBeNull();
            }
          }
          expect(ticks).toBeLessThan(1800);
          expect(g.targetPressure!.units.every((u) => u.state === "ended" || u.state === "cancelled")).toBe(true);
          expect(maxStep).toBeLessThan(d.pressure!.speed * 3);
          if (target && d.pressure!.committed) {
            expect(tells).toBeGreaterThan(0);
            if (target.category === "building") {
              const i = Number(d.pressure!.route!.target.id.split(":")[1]);
              expect(originalBuildings[i]).toBe(true);
              expect(g.buildings[i].alive).toBe(false);
              const roof = getGameplayBuildingBounds(g.buildings[i]);
              expect(d.y).toBeGreaterThan(roof.top - 20);
            }
          }
          if (family === "shahed-136-bomber") expect(d.y).toBeLessThan(getGameplayBurjCollisionTop());
        });
      }
  it.each(["shahed-136", "jet", "shahed-136-bomber"] as const)("%s labels tower-only endgame explicitly", (family) => {
    const { sim, g } = setup();
    g.buildings.forEach((b) => (b.alive = false));
    g.launcherHP.fill(0);
    const d = spawn(g, family);
    advanceUntil(sim, g, () => !d.alive && !g.missiles.length);
    expect(g.targetPressure!.units.some((u) => u.exception === "tower-only")).toBe(true);
    expect(g.burjHealth).toBeLessThan(10000);
  });
});
