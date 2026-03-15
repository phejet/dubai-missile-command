import { describe, it, expect, vi } from "vitest";
import {
  dist,
  lerp,
  burjHalfW,
  pickTarget,
  fireInterceptor,
  createExplosion,
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
  it("returns Burj when random < 0.3 and burjAlive", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const g = makeGameState();
    const target = pickTarget(g, 100);
    expect(target).toEqual({ x: BURJ_X, y: CITY_Y });
    vi.restoreAllMocks();
  });

  it("returns defense/launcher target when random >= 0.3", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const g = makeGameState();
    const target = pickTarget(g, 100);
    // Should pick a launcher (closest to fromX=100 is launcher 0 at x=60)
    expect(target.x).toBe(LAUNCHERS[0].x);
    vi.restoreAllMocks();
  });

  it("falls back to Burj when no defenses alive", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const g = makeGameState({ launcherHP: [0, 0, 0] });
    const target = pickTarget(g, 100);
    expect(target).toEqual({ x: BURJ_X, y: CITY_Y });
    vi.restoreAllMocks();
  });

  it("returns null when nothing alive and Burj dead", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const g = makeGameState({ burjAlive: false, launcherHP: [0, 0, 0] });
    const target = pickTarget(g, 100);
    expect(target).toBeNull();
    vi.restoreAllMocks();
  });

  it("sorts targets by proximity to fromX", () => {
    // Mock: first call (Burj check) returns >= 0.3, second call (pick) returns >= 0.7 to pick index 1
    const mockRandom = vi.spyOn(Math, "random");
    mockRandom.mockReturnValueOnce(0.5).mockReturnValueOnce(0.8);
    const g = makeGameState();
    // fromX=500: closest launcher is #1 (x=550), second is #2 (x=860)
    const target = pickTarget(g, 500);
    // With random >= 0.7, picks index 1 (second closest)
    expect(target.x).not.toBe(LAUNCHERS[1].x); // not the closest
    vi.restoreAllMocks();
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

  it("creates 12 particles", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, "#ff0000");
    expect(g.particles).toHaveLength(12);
  });
});
