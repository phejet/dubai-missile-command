import { describe, it, expect, afterEach } from "vitest";
import {
  dist,
  lerp,
  burjHalfW,
  pickTarget,
  fireInterceptor,
  createExplosion,
  computeShahed238Path,
  setRng,
  CANVAS_W,
  BURJ_X,
  CITY_Y,
  GROUND_Y,
  BURJ_H,
  LAUNCHERS,
  COL,
} from "./game-logic.js";

function makeGameState(overrides = {}) {
  return {
    burjAlive: true,
    defenseSites: [],
    launcherHP: [2, 2, 2],
    ammo: [22, 22, 22],
    missiles: [],
    drones: [],
    interceptors: [],
    explosions: [],
    particles: [],
    upgrades: { launcherKit: 0 },
    stats: { missileKills: 0, droneKills: 0, shotsFired: 0 },
    shakeTimer: 0,
    shakeIntensity: 0,
    ...overrides,
  };
}

// ── dist ──

describe("dist", () => {
  it("returns 0 for same point", () => {
    expect(dist(5, 5, 5, 5)).toBe(0);
  });

  it("returns 5 for 3-4-5 triangle", () => {
    expect(dist(0, 0, 3, 4)).toBe(5);
  });

  it("handles negative coordinates", () => {
    expect(dist(-3, -4, 0, 0)).toBe(5);
  });
});

// ── lerp ──

describe("lerp", () => {
  it("returns a when t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b when t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint when t=0.5", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });
});

// ── burjHalfW ──

describe("burjHalfW", () => {
  it("returns 0 above spire tip", () => {
    expect(burjHalfW(GROUND_Y - BURJ_H - 50)).toBe(0);
  });

  it("returns 1 in spire region", () => {
    expect(burjHalfW(GROUND_Y - BURJ_H - 15)).toBe(1);
  });

  it("returns ~3 at top of tower", () => {
    const w = burjHalfW(GROUND_Y - BURJ_H);
    expect(w).toBeCloseTo(3, 0);
  });

  it("returns interpolated value mid-tower", () => {
    const w = burjHalfW(GROUND_Y - BURJ_H * 0.5);
    expect(w).toBeGreaterThan(3);
    expect(w).toBeLessThan(15);
  });

  it("returns 0 below ground", () => {
    expect(burjHalfW(GROUND_Y + 10)).toBe(0);
  });
});

// ── pickTarget ──

describe("pickTarget", () => {
  afterEach(() => {
    setRng(Math.random);
  });

  it("returns Burj when random < 0.3 and burjAlive", () => {
    setRng(() => 0.1);
    const g = makeGameState();
    const target = pickTarget(g, 100);
    expect(target).toEqual({ x: BURJ_X, y: CITY_Y });
  });

  it("returns defense/launcher target when random >= 0.3", () => {
    setRng(() => 0.5);
    const g = makeGameState();
    const target = pickTarget(g, 100);
    // Should pick a launcher (closest to fromX=100 is launcher 0 at x=60)
    expect(target.x).toBe(LAUNCHERS[0].x);
  });

  it("falls back to Burj when no defenses alive", () => {
    setRng(() => 0.5);
    const g = makeGameState({ launcherHP: [0, 0, 0] });
    const target = pickTarget(g, 100);
    expect(target).toEqual({ x: BURJ_X, y: CITY_Y });
  });

  it("returns null when nothing alive and Burj dead", () => {
    setRng(() => 0.5);
    const g = makeGameState({ burjAlive: false, launcherHP: [0, 0, 0] });
    const target = pickTarget(g, 100);
    expect(target).toBeNull();
  });

  it("sorts targets by proximity to fromX", () => {
    // First call (Burj check) returns >= 0.3, second call (pick) returns >= 0.7 to pick index 1
    let callCount = 0;
    setRng(() => {
      callCount++;
      return callCount === 1 ? 0.5 : 0.8;
    });
    const g = makeGameState();
    // fromX=500: closest launcher is #1 (x=550), second is #2 (x=860)
    const target = pickTarget(g, 500);
    // With random >= 0.7, picks index 1 (second closest)
    expect(target.x).not.toBe(LAUNCHERS[1].x); // not the closest
  });
});

// ── fireInterceptor ──

describe("fireInterceptor", () => {
  it("picks closest launcher with ammo+HP and creates interceptor", () => {
    const g = makeGameState();
    fireInterceptor(g, 500, 300);
    expect(g.interceptors).toHaveLength(1);
    // Closest launcher to (500,300) is #1 at x=550
    expect(g.interceptors[0].x).toBe(LAUNCHERS[1].x);
  });

  it("decrements ammo and increments shotsFired", () => {
    const g = makeGameState();
    fireInterceptor(g, 500, 300);
    expect(g.ammo[1]).toBe(21);
    expect(g.stats.shotsFired).toBe(1);
  });

  it("skips launchers with 0 HP or 0 ammo", () => {
    const g = makeGameState({ launcherHP: [0, 2, 2], ammo: [22, 0, 22] });
    fireInterceptor(g, 500, 300);
    // Launcher 0 has 0 HP, launcher 1 has 0 ammo, so launcher 2 is used
    expect(g.interceptors[0].x).toBe(LAUNCHERS[2].x);
  });

  it("does nothing when no launcher available", () => {
    const g = makeGameState({ launcherHP: [0, 0, 0] });
    fireInterceptor(g, 500, 300);
    expect(g.interceptors).toHaveLength(0);
    expect(g.stats.shotsFired).toBe(0);
  });
});

// ── createExplosion ──

describe("createExplosion", () => {
  it("pushes explosion with correct properties", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, "#ff0000", true);
    expect(g.explosions).toHaveLength(1);
    const ex = g.explosions[0];
    expect(ex.x).toBe(100);
    expect(ex.y).toBe(200);
    expect(ex.radius).toBe(0);
    expect(ex.maxRadius).toBe(30);
    expect(ex.growing).toBe(true);
    expect(ex.alpha).toBe(1);
    expect(ex.color).toBe("#ff0000");
    expect(ex.playerCaused).toBe(true);
  });

  it("creates 19 particles (6 dots + 5 debris + 8 sparks)", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, "#ff0000");
    expect(g.particles).toHaveLength(19);
  });
});

describe("computeShahed238Path", () => {
  afterEach(() => setRng(Math.random));

  it("returns waypoints, diveStartIndex, and bombIndices", () => {
    setRng(() => 0.5);
    const target = { x: 460, y: 570 };
    const path = computeShahed238Path(-20, 150, true, 4, target);
    expect(path.waypoints.length).toBeGreaterThan(10);
    expect(path.diveStartIndex).toBeGreaterThan(0);
    expect(path.diveStartIndex).toBeLessThan(path.waypoints.length);
    expect(path.bombIndices).toHaveLength(2);
    expect(path.bombIndices[0]).toBeLessThan(path.diveStartIndex);
    expect(path.bombIndices[1]).toBeLessThan(path.diveStartIndex);
    expect(path.bombIndices[1]).toBeGreaterThan(path.bombIndices[0]);
  });

  it("path starts at spawn and ends near target", () => {
    setRng(() => 0.5);
    const target = { x: 460, y: 570 };
    const path = computeShahed238Path(-20, 150, true, 4, target);
    const first = path.waypoints[0];
    const last = path.waypoints[path.waypoints.length - 1];
    expect(first.x).toBeCloseTo(-20, 0);
    expect(first.y).toBeCloseTo(150, 0);
    expect(Math.abs(last.x - target.x)).toBeLessThan(2);
    expect(Math.abs(last.y - target.y)).toBeLessThan(2);
  });

  it("works for left-to-right and right-to-left", () => {
    setRng(() => 0.5);
    const target = { x: 460, y: 570 };
    const pathR = computeShahed238Path(-20, 150, true, 4, target);
    const pathL = computeShahed238Path(CANVAS_W + 20, 150, false, 4, target);
    // Both should end near target
    const lastR = pathR.waypoints[pathR.waypoints.length - 1];
    const lastL = pathL.waypoints[pathL.waypoints.length - 1];
    expect(Math.abs(lastR.x - target.x)).toBeLessThan(2);
    expect(Math.abs(lastL.x - target.x)).toBeLessThan(2);
    // Right path should move rightward initially, left path leftward
    expect(pathR.waypoints[5].x).toBeGreaterThan(pathR.waypoints[0].x);
    expect(pathL.waypoints[5].x).toBeLessThan(pathL.waypoints[0].x);
  });

  it("waypoints are spaced approximately by speed", () => {
    setRng(() => 0.5);
    const speed = 4;
    const path = computeShahed238Path(-20, 150, true, speed, { x: 460, y: 570 });
    // Check spacing of first few cruise waypoints (should be ~speed apart)
    for (let i = 1; i < Math.min(10, path.waypoints.length); i++) {
      const dx = path.waypoints[i].x - path.waypoints[i - 1].x;
      const dy = path.waypoints[i].y - path.waypoints[i - 1].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      expect(d).toBeGreaterThan(speed * 0.5);
      expect(d).toBeLessThan(speed * 2);
    }
  });
});
