import { afterEach, describe, expect, it } from "vitest";
import { applyReplayBootstrap } from "./replay-bootstrap";
import { createEmptyUpgradeLevels } from "./game-sim-upgrades";
import { createGameSim } from "./game-sim";
import {
  BURJ_X,
  CANVAS_W,
  GAMEPLAY_WATERLINE_Y,
  getGameplayBurjCollisionTop,
  hitsBurjBody,
  setRng,
} from "./game-logic";
import {
  entryRoutePool,
  evaluateMissileRoute,
  missileAssets,
  towerRouteEntry,
  type EntrySide,
} from "./missile-routing";
import type { Missile } from "./types";

afterEach(() => setRng(Math.random));
function setup(wave: number) {
  setRng(() => 0.5);
  const sim = createGameSim();
  const g = sim.initGame();
  g.wave = wave;
  g.schedule = [{ type: "missile", tick: 1e9 }];
  return { sim, g };
}

describe("missile route proof", () => {
  for (const wave of [1, 10, 20])
    for (const side of ["left", "right", "top"] as EntrySide[]) {
      it(`matches real first impacts, wave ${wave}, ${side}`, () => {
        const { g } = setup(wave);
        const preferred = {
          x: side === "left" ? -10 : side === "right" ? CANVAS_W + 10 : 450,
          y: side === "top" ? -10 : 371,
        };
        const routes = entryRoutePool(g, side, preferred, {
          speed: (0.75 + wave * 0.08) * 2,
          accel: 1.0045 + wave * 0.0009,
        });
        expect(routes.length).toBeGreaterThan(0);
        expect(routes.some((r) => r.target.category === "building")).toBe(true);
        for (const r of routes) {
          const { sim, g: actual } = setup(wave);
          const m: Missile = {
            ...r.start,
            vx: r.vx,
            vy: r.vy,
            accel: r.accel,
            type: "missile",
            alive: true,
            trail: [],
          };
          actual.missiles.push(m);
          let ticks = 0;
          while (m.alive && ticks < 1200) {
            sim.update(actual, 1);
            ticks++;
          }
          expect(ticks, r.target.id).toBe(r.impactTicks);
          expect(r.visibleTicks).toBeGreaterThanOrEqual(60);
          if (r.target.category === "tower") expect(actual.burjHealth).toBeLessThan(g.burjHealth);
          if (r.target.id.startsWith("building:"))
            expect(actual.buildings[Number(r.target.id.split(":")[1])].alive).toBe(false);
          if (r.target.id.startsWith("launcher:")) expect(actual.launcherHP[Number(r.target.id.split(":")[1])]).toBe(0);
          if (side === "top") expect(r.start.y).toBe(-10);
          else {
            expect(r.start.x).toBe(preferred.x);
            expect(r.start.y).toBeGreaterThanOrEqual(20);
            expect(r.start.y).toBeLessThanOrEqual(722);
          }
        }
      });
    }
  it("rejects tower crossings even when both sampled endpoints miss", () => {
    const { g } = setup(1);
    const a = { x: BURJ_X - 100, y: 1050 },
      b = { x: BURJ_X + 100, y: 1070 };
    expect(hitsBurjBody(g, a.x, a.y)).toBe(false);
    expect(hitsBurjBody(g, b.x, b.y)).toBe(false);
    expect(towerRouteEntry(a, b)).not.toBeNull();
    expect(towerRouteEntry({ x: 0, y: 0 }, { x: 0, y: GAMEPLAY_WATERLINE_Y })).toBeNull();
    expect(
      towerRouteEntry(
        { x: BURJ_X, y: getGameplayBurjCollisionTop() - 10 },
        { x: BURJ_X, y: getGameplayBurjCollisionTop() + 10 },
      ),
    ).not.toBeNull();
  });
  it("inherits visible carrier warning once without changing child movement", () => {
    const { g } = setup(20),
      assets = missileAssets(g);
    const target = assets.find((a) => a.id === "building:0")!;
    const start = { x: target.x, y: 240 };
    const motion = { speed: 2, accel: 1.09 };
    expect(evaluateMissileRoute(g, assets, start, target, motion)).toBeNull();
    const route = evaluateMissileRoute(g, assets, start, target, { ...motion, inheritedWarning: 44 });
    expect(route).not.toBeNull();
    expect(route!.visibleTicks).toBe(route!.impactTicks + 44);
    expect(Math.hypot(route!.vx, route!.vy)).toBeCloseTo(2);
  });
  it("reports empty pools rather than moving an impossible flank to the top", () => {
    const { g } = setup(50);
    expect(entryRoutePool(g, "left", { x: -10, y: 371 }, { speed: 9, accel: 1.0495 })).toEqual([]);
  });
  it("reaches exposed defense sites with the same live collision geometry", () => {
    function exposedSites() {
      const { sim, g } = setup(10);
      applyReplayBootstrap(
        g,
        { bootstrap: { acquiredUpgrades: ["wildHornetsLeft", "roadrunner", "phalanx", "patriot", "ironBeam"] } },
        10,
      );
      g.buildings.forEach((b) => (b.alive = false));
      g.upgrades = createEmptyUpgradeLevels();
      return { sim, g };
    }
    const { g } = exposedSites();
    const routes = entryRoutePool(g, "top", { x: 450, y: -10 }, { speed: 3, accel: 1.0135 }).filter((r) =>
      r.target.id.startsWith("site:"),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const { sim, g: actual } = exposedSites();
      const m: Missile = {
        ...route.start,
        vx: route.vx,
        vy: route.vy,
        accel: route.accel,
        type: "missile",
        alive: true,
        trail: [],
      };
      actual.missiles.push(m);
      let tick = 0;
      while (m.alive && tick++ < 1200) sim.update(actual, 1);
      expect(actual.defenseSites.find((s) => `site:${s.key}` === route.target.id)!.alive).toBe(false);
      expect(actual.burjHealth).toBe(g.burjHealth);
    }
  });
});
