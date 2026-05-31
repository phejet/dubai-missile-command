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
  LAUNCHER_ARMOR_NODE,
  LAUNCHER_DOUBLE_MAGAZINE_NODE,
  LAUNCHER_HIGH_VELOCITY_NODE,
  LAUNCHER_RAPID_RELOAD_NODE,
  getLauncherBurstChargeCap,
  getLauncherMaxHp,
  createEmptyGameStats,
  recordThreatDestroyed,
  getDestroyedByTypeDelta,
  getLauncherReloadTicks,
  ov,
  OVERRIDE_KEYS,
  hasEditorOverrides,
  assertNoEditorOverridesForDeterministicRun,
} from "./game-logic";
import { createFireChargeState, getFireChargeCount } from "./player-fire-limiter";
import type { EditorOverrideMap } from "./game-logic";
import type { GameState } from "./types";

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    burjAlive: true,
    defenseSites: [],
    launcherHP: [2, 2],
    ammo: [22, 22],
    missiles: [],
    drones: [],
    interceptors: [],
    explosions: [],
    particles: [],
    upgrades: { launcherKit: 0 } as GameState["upgrades"],
    ownedUpgradeNodes: new Set(),
    stats: createEmptyGameStats(),
    shakeTimer: 0,
    shakeIntensity: 0,
    fireChargeState: createFireChargeState(),
    launcherFireTick: [0, 0] as [number, number],
    ...overrides,
  } as GameState;
}

function assertOverrideKeyTypes(): void {
  ov("particle.debrisDrag", 0.96);
  // @ts-expect-error Unknown override keys must not compile.
  ov("particle.debrisDarg", 0.96);
}

void assertOverrideKeyTypes;

describe("editor overrides", () => {
  const globalWithWindow = globalThis as unknown as { window?: { __editorOverrides?: EditorOverrideMap | null } };
  const originalWindow = globalWithWindow.window;

  afterEach(() => {
    if (originalWindow === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = originalWindow;
  });

  it("registers direct and ternary-hidden override keys", () => {
    expect(OVERRIDE_KEYS).toHaveLength(85);
    expect(OVERRIDE_KEYS).toContain("particle.debrisDrag");
    expect(OVERRIDE_KEYS).toContain("flare.salvoCountL1");
    expect(OVERRIDE_KEYS).toContain("flare.salvoSpacingTicksL2");
  });

  it("uses editor override values when present", () => {
    globalWithWindow.window = { __editorOverrides: { "particle.debrisDrag": 0.5 } };

    expect(ov("particle.debrisDrag", 0.96)).toBe(0.5);
    expect(ov("particle.sparkDrag", 0.93)).toBe(0.93);
  });

  it("guards deterministic runs from non-empty editor overrides", () => {
    globalWithWindow.window = { __editorOverrides: {} };
    expect(hasEditorOverrides()).toBe(false);
    expect(() => assertNoEditorOverridesForDeterministicRun("test run")).not.toThrow();

    globalWithWindow.window = { __editorOverrides: { "particle.debrisDrag": 0.5 } };
    expect(hasEditorOverrides()).toBe(true);
    expect(() => assertNoEditorOverridesForDeterministicRun("test run")).toThrow(
      /test run cannot run deterministically/,
    );
  });
});

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

describe("destroyed stats", () => {
  it("records aggregate and per-type destroyed counters", () => {
    const g = makeGameState();
    recordThreatDestroyed(g, {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      accel: 1,
      trail: [],
      alive: false,
      type: "mirv_warhead",
    });
    recordThreatDestroyed(g, {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      trail: [],
      wobble: 0,
      alive: false,
      type: "drone",
      subtype: "shahed238",
      health: 0,
      collisionRadius: 14,
    });

    expect(g.stats.missileKills).toBe(1);
    expect(g.stats.droneKills).toBe(1);
    expect(g.stats.destroyedByType.mirvWarhead).toBe(1);
    expect(g.stats.destroyedByType.shahed238).toBe(1);
  });

  it("builds clamped destroyed-by-type wave deltas", () => {
    const delta = getDestroyedByTypeDelta({ ballisticMissile: 4, shahed136: 3 }, { ballisticMissile: 1, shahed136: 5 });

    expect(delta.ballisticMissile).toBe(3);
    expect(delta.shahed136).toBe(0);
    expect(delta.mirv).toBe(0);
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
    expect(target!.x).toBe(LAUNCHERS[0].x);
  });

  it("falls back to Burj when no defenses alive", () => {
    setRng(() => 0.5);
    const g = makeGameState({ launcherHP: [0, 0] });
    const target = pickTarget(g, 100);
    expect(target).toEqual({ x: BURJ_X, y: CITY_Y });
  });

  it("returns null when nothing alive and Burj dead", () => {
    setRng(() => 0.5);
    const g = makeGameState({ burjAlive: false, launcherHP: [0, 0] });
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
    // fromX=500: closest launcher is the right side, second is the left side.
    const target = pickTarget(g, 500);
    // With random >= 0.7, picks index 1 (second closest)
    expect(target!.x).toBe(LAUNCHERS[0].x);
  });
});

// ── fireInterceptor ──

describe("fireInterceptor", () => {
  it("fires from the left launcher for left-half targets", () => {
    const g = makeGameState();
    fireInterceptor(g, 200, 300);
    expect(g.interceptors).toHaveLength(1);
    expect(g.interceptors[0].x).toBe(LAUNCHERS[0].x);
  });

  it("fires from the right launcher for right-half targets", () => {
    const g = makeGameState();
    fireInterceptor(g, 700, 300);
    expect(g.interceptors).toHaveLength(1);
    expect(g.interceptors[0].x).toBe(LAUNCHERS[1].x);
  });

  it("assigns the center boundary to the right launcher", () => {
    const g = makeGameState();
    fireInterceptor(g, CANVAS_W / 2, 300);
    expect(g.interceptors).toHaveLength(1);
    expect(g.interceptors[0].x).toBe(LAUNCHERS[1].x);
  });

  it("increments shotsFired, drains the shared pool, and does not consume ammo", () => {
    const g = makeGameState();
    fireInterceptor(g, 700, 300, 10);
    expect(g.ammo[1]).toBe(22);
    expect(g.stats.shotsFired).toBe(1);
    expect(getFireChargeCount(g.fireChargeState)).toBe(3);
  });

  it("uses rapid reload for shared pool refill timing", () => {
    const g = makeGameState({ ownedUpgradeNodes: new Set([LAUNCHER_RAPID_RELOAD_NODE]) });
    fireInterceptor(g, 700, 300, 10);
    expect(getLauncherReloadTicks(g)).toBe(15);
    expect(g.fireChargeState.nextRechargeTick).toBe(10 + getLauncherReloadTicks(g));
  });

  it("uses high velocity interceptor stats", () => {
    const g = makeGameState({ ownedUpgradeNodes: new Set([LAUNCHER_HIGH_VELOCITY_NODE]) });
    fireInterceptor(g, 500, 300, 10);
    expect(g.interceptors[0].speed).toBeCloseTo(11.19);
    expect(g.interceptors[0].accel).toBeCloseTo(3.75);
    expect(g.interceptors[0].maxSpeed).toBeCloseTo(37.5);
  });

  it("derives launcher armor and double magazine effects from owned nodes", () => {
    const g = makeGameState({ ownedUpgradeNodes: new Set([LAUNCHER_ARMOR_NODE, LAUNCHER_DOUBLE_MAGAZINE_NODE]) });
    expect(getLauncherMaxHp(g)).toBe(2);
    expect(getLauncherBurstChargeCap(g, 2)).toBe(8);
  });

  it("falls back to the surviving launcher when the selected side is destroyed", () => {
    const g = makeGameState({ launcherHP: [0, 2], ammo: [22, 0] });
    fireInterceptor(g, 200, 300);
    expect(g.interceptors[0].x).toBe(LAUNCHERS[1].x);
  });

  it("does nothing when no launcher available", () => {
    const g = makeGameState({ launcherHP: [0, 0] });
    fireInterceptor(g, 500, 300);
    expect(g.interceptors).toHaveLength(0);
    expect(g.stats.shotsFired).toBe(0);
  });

  it("consecutive taps from the same side drain the shared pool", () => {
    const g = makeGameState();
    expect(fireInterceptor(g, 200, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 220, 320, 11)).toBe(true);
    expect(fireInterceptor(g, 240, 340, 12)).toBe(true);
    expect(fireInterceptor(g, 260, 360, 13)).toBe(true);
    expect(fireInterceptor(g, 280, 380, 14)).toBe(false);
    expect(g.interceptors).toHaveLength(4);
    expect(g.interceptors.every((interceptor) => interceptor.x === LAUNCHERS[0].x)).toBe(true);
    expect(getFireChargeCount(g.fireChargeState)).toBe(0);
  });

  it("tap left then right both fire if shared pool has charges", () => {
    const g = makeGameState();
    expect(fireInterceptor(g, 200, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 700, 300, 11)).toBe(true);
    expect(g.interceptors).toHaveLength(2);
    expect(g.interceptors[0].x).toBe(LAUNCHERS[0].x);
    expect(g.interceptors[1].x).toBe(LAUNCHERS[1].x);
    expect(getFireChargeCount(g.fireChargeState)).toBe(2);
  });

  it("pool refills at reload cadence regardless of which side last fired", () => {
    const g = makeGameState();
    expect(fireInterceptor(g, 200, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 220, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 240, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 260, 300, 10)).toBe(true);
    expect(fireInterceptor(g, 700, 300, 39)).toBe(false);
    expect(fireInterceptor(g, 700, 300, 40)).toBe(true);
    expect(g.interceptors[g.interceptors.length - 1].x).toBe(LAUNCHERS[1].x);
  });

  it("sets burst charge cap to twice the live launcher count", () => {
    const g = makeGameState();
    expect(getLauncherBurstChargeCap(g, 2)).toBe(4);
    expect(getLauncherBurstChargeCap(g, 1)).toBe(2);
    expect(getLauncherBurstChargeCap(g, 0)).toBe(0);
  });

  it("sets double magazine burst charge cap to four times the live launcher count", () => {
    const g = makeGameState({ ownedUpgradeNodes: new Set([LAUNCHER_DOUBLE_MAGAZINE_NODE]) });
    expect(getLauncherBurstChargeCap(g, 2)).toBe(8);
    expect(getLauncherBurstChargeCap(g, 1)).toBe(4);
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

  it("creates 40 particles (10 dots + 16 debris + 14 sparks) for threat explosion", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, "#ff0000");
    expect(g.particles).toHaveLength(40);
  });

  it("uses textured white smoke puffs for interceptor explosions", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, COL.interceptor, true);

    const smoke = g.particles.filter((particle) => particle.type === "smokePuff");

    expect(smoke).toHaveLength(6);
    expect(smoke.every((particle) => particle.textureVariant?.startsWith("whitePuff"))).toBe(true);
    expect(smoke.every((particle) => particle.color === COL.interceptor)).toBe(true);
    expect(g.particles.some((particle) => particle.type === "debris")).toBe(false);
  });

  it("keeps interceptor explosion particle RNG budget aligned with the old dot path", () => {
    const g = makeGameState();
    let calls = 0;
    setRng(() => {
      calls += 1;
      return 0.5;
    });

    try {
      createExplosion(g, 100, 200, 30, COL.interceptor, true);
      expect(calls).toBe(70);
    } finally {
      setRng(Math.random);
    }
  });

  it("uses textured explosion puffs for drone death explosions", () => {
    const g = makeGameState();
    createExplosion(g, 100, 200, 30, "#ff8800", false, 0, { visualType: "drone" });

    const explosionPuffs = g.particles.filter((particle) => particle.type === "explosionPuff");

    expect(explosionPuffs).toHaveLength(10);
    expect(explosionPuffs.every((particle) => particle.textureVariant?.startsWith("explosion"))).toBe(true);
    expect(explosionPuffs.every((particle) => particle.color === "#ff8800")).toBe(true);
    expect(g.particles.filter((particle) => particle.type === "debris")).toHaveLength(16);
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
