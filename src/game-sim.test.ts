import { afterEach, describe, expect, it } from "vitest";
import {
  setRng,
  CANVAS_W,
  GROUND_Y,
  CITY_Y,
  GAMEPLAY_SCENIC_BASE_Y,
  GAMEPLAY_WATERLINE_Y,
  BURJ_X,
  BURJ_H,
  getGameplayBurjCollisionTop,
  getShahed136LevelFlightYRange,
  LAUNCHER_ARMOR_NODE,
  LAUNCHER_DOUBLE_MAGAZINE_NODE,
  LAUNCHER_HIGH_VELOCITY_NODE,
  LAUNCHER_RAPID_RELOAD_NODE,
  computeShahed136Path,
  computeShahed238Path,
  createExplosion,
  createEmptyGameStats,
} from "./game-logic.js";
import {
  buyDraftUpgrade,
  buyUpgrade,
  createGameSim,
  draftPick3,
  fireFlareSalvo,
  fireF15Pair,
  fireEmp,
  spawnMirv,
  spawnDrone,
  spawnDroneOfType,
  spawnMissile,
  spawnStackedMissile,
  updateBurjFireParticles,
} from "./game-sim.js";
import { buildShopEntries, normalizeLegacyFlareActiveState } from "./game-sim-shop.js";
import { getBurjDamageFireLayout } from "./art-render.js";
import type { Drone, Interceptor, Missile, PatriotMissile } from "./types.js";

describe("MIRV behavior", () => {
  afterEach(() => setRng(Math.random));

  it("spawns MIRVs with 1 HP until boss-style health UI exists", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame();
    spawnMirv(g);

    const mirv = g.missiles.find((m) => m.alive && m.type === "mirv");
    expect(mirv).toBeTruthy();
    expect(mirv!.health).toBe(1);
    expect(mirv!.maxHealth).toBe(1);
  });

  it("splits into 3 warheads on wave 5", () => {
    setRng(() => 0.5);
    const sim = createGameSim();
    const g = sim.initGame();
    g.wave = 5;
    g.missiles = [];
    g.drones = [];
    g.interceptors = [];
    g.explosions = [];
    spawnMirv(g);

    const mirv = g.missiles.find((m) => m.alive && m.type === "mirv");
    expect(mirv).toBeTruthy();
    expect(mirv!.warheadCount).toBe(5);
    mirv!.splitY = mirv!.y + 1;

    sim.update(g, 2);
    expect(g.missiles.filter((m) => m.alive && m.type === "mirv_warhead")).toHaveLength(5);
    expect(g.explosions.some((ex) => ex.harmless)).toBe(true);
  });
});

describe("Upgrade graph", () => {
  afterEach(() => setRng(Math.random));

  it("buys independent hornet siblings in declaration order; each site spawns a defense pad", () => {
    const { g } = makeCleanGame(5);
    g.score = 10000;

    expect(buyUpgrade(g, "wildHornets")).toBe(true);
    expect(g.ownedUpgradeNodes.has("wildHornetsLeft")).toBe(true);
    expect(g.upgrades.wildHornets).toBe(1);
    expect(g.defenseSites.some((site) => site.key === "wildHornetsLeft")).toBe(true);

    expect(buyUpgrade(g, "wildHornets")).toBe(true);
    expect(g.ownedUpgradeNodes.has("wildHornetsRight")).toBe(true);
    expect(g.upgrades.wildHornets).toBe(1); // still rank 1 — siblings, not a ladder
    expect(g.defenseSites.some((site) => site.key === "wildHornetsRight")).toBe(true);

    expect(buyUpgrade(g, "wildHornets")).toBe(true);
    expect(g.ownedUpgradeNodes.has("skyHunterMesh")).toBe(true);
  });

  it("unlocks skyHunterMesh as soon as either hornet site is owned (anyOf prereq)", () => {
    const { g } = makeCleanGame(5);
    g.score = 10000;

    // Without any hornet site, skyHunterMesh should not be purchasable.
    expect(buyUpgrade(g, "skyHunterMesh")).toBe(false);

    // After buying just the left site, the retarget upgrade is eligible.
    expect(buyUpgrade(g, "wildHornetsLeft")).toBe(true);
    expect(buyUpgrade(g, "skyHunterMesh")).toBe(true);
    expect(g.ownedUpgradeNodes.has("skyHunterMesh")).toBe(true);
  });

  it("requires completed objectives before gated graph nodes can be purchased", () => {
    const { g } = makeCleanGame(5);
    g.score = 20000;

    expect(buyUpgrade(g, "roadrunner")).toBe(true);
    expect(buyUpgrade(g, "roadrunner")).toBe(true);
    expect(buyUpgrade(g, "roadrunner")).toBe(false);

    g.metaProgression.completedObjectives.push("kill_25_drones");
    expect(buyUpgrade(g, "roadrunner")).toBe(true);
    expect(g.ownedUpgradeNodes.has("roadrunnerCommandLink")).toBe(true);
    expect(g.upgrades.roadrunner).toBe(3);
  });

  it("treats launcher rapid reload, armor, and high velocity as independent draft nodes", () => {
    const { g } = makeCleanGame(5);

    expect(buyDraftUpgrade(g, LAUNCHER_RAPID_RELOAD_NODE)).toBe(true);
    expect(buyDraftUpgrade(g, LAUNCHER_ARMOR_NODE)).toBe(true);
    expect(buyDraftUpgrade(g, LAUNCHER_HIGH_VELOCITY_NODE)).toBe(true);

    expect(g.ownedUpgradeNodes.has(LAUNCHER_RAPID_RELOAD_NODE)).toBe(true);
    expect(g.ownedUpgradeNodes.has(LAUNCHER_ARMOR_NODE)).toBe(true);
    expect(g.ownedUpgradeNodes.has(LAUNCHER_HIGH_VELOCITY_NODE)).toBe(true);
  });

  it("gates double magazine behind wave 4 progression and any launcher branch", () => {
    const { g } = makeCleanGame(5);

    expect(buyDraftUpgrade(g, LAUNCHER_DOUBLE_MAGAZINE_NODE)).toBe(false);
    expect(buyDraftUpgrade(g, LAUNCHER_RAPID_RELOAD_NODE)).toBe(true);
    expect(buyDraftUpgrade(g, LAUNCHER_DOUBLE_MAGAZINE_NODE)).toBe(false);

    g.metaProgression.completedObjectives.push("reach_wave_4");
    expect(buyDraftUpgrade(g, LAUNCHER_DOUBLE_MAGAZINE_NODE)).toBe(true);
    expect(g.ownedUpgradeNodes.has(LAUNCHER_DOUBLE_MAGAZINE_NODE)).toBe(true);
  });
});

function makeCleanGame(wave = 5) {
  setRng(() => 0.5);
  const sim = createGameSim();
  const g = sim.initGame();
  g.wave = wave;
  g.missiles = [];
  g.drones = [];
  g.interceptors = [];
  g.explosions = [];
  g.particles = [];
  return { sim, g };
}

function makeMissile(overrides: Partial<Missile> = {}): Missile {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    accel: 1,
    trail: [],
    alive: true,
    type: "missile",
    _hitByExplosions: new Set(),
    ...overrides,
  };
}

function makeDrone(overrides: Partial<Drone> = {}): Drone {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    wobble: 0,
    alive: true,
    type: "drone",
    subtype: "shahed136",
    shahedVariant: "shahed-136",
    health: 1,
    collisionRadius: 30,
    _hitByExplosions: new Set(),
    ...overrides,
  };
}

function makeInterceptor(overrides: Partial<Interceptor> = {}): Interceptor {
  return {
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    targetX: 100,
    targetY: 100,
    trail: [],
    alive: true,
    ...overrides,
  };
}

describe("interceptor proximity fuse", () => {
  afterEach(() => setRng(Math.random));

  it("does not spend a second interceptor on a drone already covered by a same-tick blast", () => {
    const { sim, g } = makeCleanGame(5);
    g.schedule = [];
    g.scheduleIdx = 0;
    g.waveTick = 0;

    g.drones.push(makeDrone({ x: 400, y: 500 }), makeDrone({ x: 400, y: 650 }));
    g.interceptors.push(
      makeInterceptor({ x: 399, y: 500, targetX: 400, targetY: 500 }),
      makeInterceptor({ x: 399, y: 500, targetX: 400, targetY: 650 }),
    );

    sim.update(g, 1);

    const rootExplosions = g.explosions.filter((ex) => ex.playerCaused && ex.rootExplosionId === null);
    expect(rootExplosions).toHaveLength(1);
    expect(rootExplosions[0].x).toBe(400);
    expect(rootExplosions[0].y).toBe(500);
    expect(g.drones).toHaveLength(1);
    expect(g.drones[0].y).toBeCloseTo(650.015);
    expect(g.interceptors).toHaveLength(1);
    expect(g.interceptors[0].targetY).toBe(650);
  });

  it("allows proximity detonation when the blast stays close enough to the aimed point", () => {
    const { sim, g } = makeCleanGame(5);
    g.schedule = [];
    g.scheduleIdx = 0;
    g.waveTick = 0;

    g.drones.push(makeDrone({ x: 440, y: 500 }));
    g.interceptors.push(makeInterceptor({ x: 400, y: 500, targetX: 450, targetY: 500 }));

    sim.update(g, 1);

    const rootExplosions = g.explosions.filter((ex) => ex.playerCaused && ex.rootExplosionId === null);
    expect(rootExplosions).toHaveLength(1);
    expect(rootExplosions[0].x).toBe(400);
    expect(rootExplosions[0].y).toBe(500);
    expect(g.drones).toHaveLength(0);
    expect(g.interceptors).toHaveLength(0);
  });
});

describe("summary stats", () => {
  it("tracks destroyed types and counts one player multi-shot per root explosion", () => {
    const { sim, g } = makeCleanGame();
    g.schedule = [{ type: "missile", tick: 999999 }];
    g.scheduleIdx = 0;
    g.missiles = [makeMissile({ x: 100, y: 100 }), makeMissile({ x: 112, y: 100 })];
    createExplosion(g, 100, 100, 80, "#fff", true, 80, { visualType: "missile" });

    sim.update(g, 1);

    expect(g.stats.missileKills).toBe(2);
    expect(g.stats.destroyedByType.ballisticMissile).toBe(2);
    expect(g.stats.multiShots).toBe(1);
  });

  it("tracks max combo for the run and current wave", () => {
    const { sim, g } = makeCleanGame();
    g.schedule = [{ type: "missile", tick: 999999 }];
    g.scheduleIdx = 0;
    g.missiles = [makeMissile({ x: 600, y: 100 })];
    createExplosion(g, 100, 100, 80, "#fff", true, 80, { visualType: "missile" });
    g.explosions[0].kills = 1;
    g.explosions[0].growing = false;
    g.explosions[0].alpha = 0;

    sim.update(g, 1);

    expect(g.combo).toBe(2);
    expect(g.stats.maxCombo).toBe(2);
    expect(g._waveMaxCombo).toBe(2);
  });

  it("emits wave summary deltas for destroyed types, multi-shots, and max combo", () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const sim = createGameSim({ onEvent: (type, data) => events.push({ type, data }) });
    const g = sim.initGame();
    g.wave = 5;
    g.missiles = [];
    g.drones = [];
    g.interceptors = [];
    g.explosions = [];
    g.particles = [];
    const baselineStats = createEmptyGameStats();
    g.stats.missileKills = 5;
    g.stats.droneKills = 2;
    g.stats.destroyedByType.ballisticMissile = 5;
    g.stats.destroyedByType.shahed238 = 2;
    g.stats.multiShots = 4;
    g.stats.maxCombo = 8;
    baselineStats.destroyedByType.ballisticMissile = 3;
    g._waveStartMissileKills = 3;
    g._waveStartDroneKills = 0;
    g._waveStartDestroyedByType = baselineStats.destroyedByType;
    g._waveStartMultiShots = 1;
    g._waveMaxCombo = 6;
    g.waveComplete = true;
    g.waveClearedTimer = 0;

    sim.update(g, 1);

    const summary = events.find((event) => event.type === "waveBonusStart")!.data as {
      destroyedByType: { ballisticMissile: number; shahed238: number };
      multiShots: number;
      maxCombo: number;
      missileKills: number;
      droneKills: number;
    };
    expect(summary.destroyedByType.ballisticMissile).toBe(2);
    expect(summary.destroyedByType.shahed238).toBe(2);
    expect(summary.multiShots).toBe(3);
    expect(summary.maxCombo).toBe(6);
    expect(summary.missileKills).toBe(2);
    expect(summary.droneKills).toBe(2);
  });

  it("includes combo from the final wave-ending explosion before showing the wave summary", () => {
    const events: Array<{ type: string; data: unknown }> = [];
    const sim = createGameSim({ onEvent: (type, data) => events.push({ type, data }) });
    const g = sim.initGame();
    g.schedule = [];
    g.scheduleIdx = 0;
    g.missiles = [makeMissile({ x: 100, y: 100 })];
    createExplosion(g, 100, 100, 80, "#fff", true, 80, { visualType: "missile" });

    sim.update(g, 1);
    for (let i = 0; i < 121; i++) sim.update(g, 1);

    const summary = events.find((event) => event.type === "waveBonusStart")!.data as { maxCombo: number };
    expect(summary.maxCombo).toBe(2);
    expect(g.stats.maxCombo).toBe(2);
  });
});

describe("terminal Burj impacts", () => {
  it.each([
    { type: "missile" as const, label: "missile" },
    { type: "bomb" as const, label: "bomb" },
    { type: "mirv_warhead" as const, label: "MIRV warhead" },
    { type: "stack_child" as const, label: "stack child" },
  ])("damages the Burj when a $label reaches ground at a Burj target", ({ type }) => {
    const { sim, g } = makeCleanGame();
    const healthBefore = g.burjHealth;
    g.schedule = [{ type: "missile", tick: 999999 }];
    g.scheduleIdx = 0;
    g.missiles = [
      makeMissile({
        type,
        x: BURJ_X,
        y: GAMEPLAY_WATERLINE_Y - 2,
        vx: 0,
        vy: 8,
        targetX: BURJ_X,
        targetY: CITY_Y,
      }),
    ];

    sim.update(g, 1);

    expect(g.missiles).toHaveLength(0);
    expect(g.burjHealth).toBe(healthBefore - 1);
    expect(g.burjDecals[g.burjDecals.length - 1]?.kind).toBe("missile");
  });

  it("does not damage the Burj when a missile ground impact was aimed elsewhere", () => {
    const { sim, g } = makeCleanGame();
    const healthBefore = g.burjHealth;
    g.schedule = [{ type: "missile", tick: 999999 }];
    g.scheduleIdx = 0;
    g.missiles = [
      makeMissile({
        x: BURJ_X,
        y: GAMEPLAY_WATERLINE_Y - 2,
        vx: 0,
        vy: 8,
        targetX: BURJ_X + 120,
        targetY: CITY_Y,
      }),
    ];

    sim.update(g, 1);

    expect(g.burjHealth).toBe(healthBefore);
  });
});

function expectLevelShahedAltitude(drone: Drone) {
  const [minY, maxY] = getShahed136LevelFlightYRange();
  const burjMid = GAMEPLAY_SCENIC_BASE_Y - BURJ_H;
  expect(maxY).toBe(burjMid);
  expect(drone.y).toBeGreaterThanOrEqual(minY);
  expect(drone.y).toBeLessThanOrEqual(burjMid);
}

function expectPlayableMissileAngle(missile: Missile) {
  const dy = Math.max(1, (missile.targetY ?? missile.y) - missile.y);
  expect(Math.abs(missile.vx / missile.vy)).toBeGreaterThanOrEqual(0.42 - 0.001);
  expect(Math.abs((missile.targetX ?? missile.x) - missile.x) / dy).toBeGreaterThanOrEqual(0.42 - 0.001);
}

function makePropDrone(overrides: Partial<Drone> = {}): Drone {
  return {
    x: -20,
    y: 150,
    vx: 1.0,
    vy: 0.1,
    wobble: 0,
    alive: true,
    type: "drone",
    subtype: "shahed136",
    health: 2,
    collisionRadius: 30,
    _hitByExplosions: new Set(),
    ...overrides,
  } as Drone;
}

function makeJetDrone(overrides: Partial<Drone> = {}): Drone {
  setRng(() => 0.5);
  const speed = 4.5;
  const target = { x: BURJ_X, y: CITY_Y };
  const path = computeShahed238Path(-20, 150, true, speed, target);
  return {
    x: -20,
    y: 150,
    vx: speed,
    vy: 0.1,
    wobble: 0,
    alive: true,
    type: "drone",
    subtype: "shahed238",
    health: 1,
    collisionRadius: 10,
    _hitByExplosions: new Set(),
    waypoints: path.waypoints,
    pathIndex: 0,
    bombIndices: path.bombIndices,
    bombsDropped: 0,
    diveStartIndex: path.diveStartIndex,
    diveTarget: target,
    ...overrides,
  } as Drone;
}

function makeBallisticMissile(overrides: Partial<Missile> = {}): Missile {
  return {
    x: BURJ_X,
    y: 210,
    vx: 0,
    vy: 2.1,
    accel: 1.01,
    trail: [],
    alive: true,
    type: "missile",
    _hitByExplosions: new Set(),
    ...overrides,
  } as Missile;
}

describe("Shahed-238 (jet) diving", () => {
  afterEach(() => setRng(Math.random));

  it("spawns prop drones with 1 HP until regular threat health is surfaced", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(9);
    spawnDroneOfType(g, "shahed136");

    expect(g.drones).toHaveLength(1);
    expect(g.drones[0].health).toBe(1);
  });

  it("spawns baseline Shahed-136 as a straight flyer with no bomb or dive", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136");
    const drone = g.drones[0];

    expect(drone.shahedVariant).toBe("shahed-136");
    expect(drone.diveStartIndex).toBeUndefined();
    expect(drone.bombIndices).toEqual([]);
    expect(drone.diveTarget).toBeUndefined();
    expectLevelShahedAltitude(drone);
    expect(drone.waypoints!.every((p) => Math.abs(p.y - drone.y) < 0.001)).toBe(true);
    expect(drone.waypoints!.some((p) => Math.abs(p.x - BURJ_X) < 2)).toBe(true);

    drone.pathIndex = Math.floor((drone.waypoints!.length - 1) * 0.55);
    sim.update(g, 1);
    expect(drone.diving).toBeFalsy();
    expect(g.missiles.some((m) => m.type === "bomb")).toBe(false);
  });

  it("does not spawn non-diving Shahed-136 above the Burj collision band", () => {
    setRng(() => 0);
    const { g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136");
    const [minY, maxY] = getShahed136LevelFlightYRange();

    expect(g.drones[0].y).toBeGreaterThanOrEqual(minY);
    expect(g.drones[0].y).toBeLessThanOrEqual(maxY);
    expect(g.drones[0].y).toBeGreaterThanOrEqual(getGameplayBurjCollisionTop(2));
  });

  it("baseline Shahed-136 level flight intersects the Burj body", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136");
    const drone = g.drones[0];
    const healthBefore = g.burjHealth;

    drone.pathIndex = Math.max(0, drone.waypoints!.findIndex((p) => Math.abs(p.x - BURJ_X) < 2) - 1);
    sim.update(g, 2);

    expect(drone.alive).toBe(false);
    expect(g.burjHealth).toBe(healthBefore - 1);
  });

  it("does not explode baseline Shahed-136 at screen center when level flight misses the Burj body", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const y = getGameplayBurjCollisionTop(2) - 20;
    spawnDroneOfType(g, "shahed136", { side: "left", yRange: [y, y] }, "shahed-136");
    const drone = g.drones[0];

    drone.pathIndex = Math.max(0, drone.waypoints!.findIndex((p) => Math.abs(p.x - BURJ_X) < 2) - 1);
    sim.update(g, 2);

    expect(drone.alive).toBe(true);
    expect(g.explosions).toHaveLength(0);

    drone.pathIndex = drone.waypoints!.length - 2;
    sim.update(g, 2);

    expect(g.drones).toHaveLength(0);
    expect(g.explosions).toHaveLength(0);
  });

  it("spawns bomber Shahed-136 with a single mid-flight bomb and no dive", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-bomber");
    const drone = g.drones[0];

    expect(drone.shahedVariant).toBe("shahed-136-bomber");
    expect(drone.diveStartIndex).toBeUndefined();
    expect(drone.bombIndices).toHaveLength(1);
    expect(drone.diveTarget).toBeUndefined();
    expectLevelShahedAltitude(drone);
    expect(drone.waypoints!.every((p) => Math.abs(p.y - drone.y) < 0.001)).toBe(true);

    drone.pathIndex = drone.bombIndices![0] - 0.25;
    sim.update(g, 1);
    expect(drone.bombsDropped).toBe(1);
    expect(drone.diving).toBeFalsy();
    expect(g.missiles.filter((m) => m.type === "bomb")).toHaveLength(1);
  });

  it("makes baseline and bomber Shahed-136 45% faster than dive variants before overrides", () => {
    const { g } = makeCleanGame(5);

    setRng(() => 0.5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136");
    setRng(() => 0.5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-bomber");
    setRng(() => 0.5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-dive");

    const [basic, bomber, dive] = g.drones;
    expect(Math.abs(basic.vx)).toBeCloseTo(Math.abs(dive.vx) * 1.45);
    expect(Math.abs(bomber.vx)).toBeCloseTo(Math.abs(dive.vx) * 1.45);
  });

  it("telegraphs Shahed-136 dive variants before the terminal dive", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-dive");
    const drone = g.drones[0];

    expect(drone.shahedVariant).toBe("shahed-136-dive");
    expect(drone.bombIndices).toEqual([]);
    expect(drone.diveStartIndex).toBeGreaterThan(0);

    drone.pathIndex = drone.diveStartIndex! - 20;
    sim.update(g, 1);
    expect(drone.diveTelegraphing).toBe(true);
    expect(drone.diving).toBeFalsy();

    drone.pathIndex = drone.diveStartIndex!;
    sim.update(g, 1);
    expect(drone.diving).toBe(true);
    expect(drone.diveTelegraphing).toBe(false);
  });

  it("spawns dive-bomber Shahed-136 with current bomb plus dive behavior", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(5);
    spawnDroneOfType(g, "shahed136", undefined, "shahed-136-dive-bomber");
    const drone = g.drones[0];

    expect(drone.shahedVariant).toBe("shahed-136-dive-bomber");
    expect(drone.bombIndices).toHaveLength(1);
    expect(drone.diveStartIndex).toBeGreaterThan(0);
    expect(drone.bombIndices![0]).toBeLessThan(drone.diveStartIndex!);
  });

  it("spawnDrone creates jet with precomputed waypoints", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(5);
    spawnDrone(g);
    const jet = g.drones.find((d) => d.subtype === "shahed238");
    expect(jet).toBeTruthy();
    expect(jet!.waypoints!.length).toBeGreaterThan(10);
    expect(jet!.diveStartIndex).toBeGreaterThan(0);
    expect(jet!.diveStartIndex).toBeLessThan(jet!.waypoints!.length);
    expect(jet!.bombIndices).toHaveLength(2);
    expect(jet!.bombIndices![0]).toBeLessThan(jet!.diveStartIndex!);
    expect(jet!.bombIndices![1]).toBeLessThan(jet!.diveStartIndex!);
    expect(jet!.bombsDropped).toBe(0);
    expect(jet!.diveTarget).toBeDefined();
  });

  it("follows waypoints and advances pathIndex each tick", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    const startX = jet.x;
    sim.update(g, 1);
    expect(jet.pathIndex).toBeGreaterThan(0);
    expect(jet.x).not.toBe(startX);
  });

  it("sets diving flag when pathIndex reaches diveStartIndex", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    expect(jet.diving).toBeFalsy();

    jet.pathIndex = jet.diveStartIndex! - 2;
    sim.update(g, 1);
    if (jet.pathIndex! >= jet.diveStartIndex!) {
      expect(jet.diving).toBe(true);
    }
    jet.pathIndex = jet.diveStartIndex! + 1;
    sim.update(g, 1);
    expect(jet.diving).toBe(true);
  });

  it("drops 2 bombs at precomputed path positions", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    const missileBefore = g.missiles.length;

    jet.pathIndex = jet.bombIndices![0] - 0.5;
    sim.update(g, 1);
    expect(jet.bombsDropped).toBe(1);
    expect(g.missiles.length).toBe(missileBefore + 1);
    expect(g.missiles[g.missiles.length - 1].type).toBe("bomb");

    jet.pathIndex = jet.bombIndices![1] - 0.5;
    sim.update(g, 1);
    expect(jet.bombsDropped).toBe(2);
    expect(g.missiles.length).toBe(missileBefore + 2);
  });

  it("derives vx/vy from frame movement for smooth rotation", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    sim.update(g, 1);
    expect(Math.abs(jet.vx) + Math.abs(jet.vy)).toBeGreaterThan(0);
  });

  it("impacts when path is exhausted", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    jet.pathIndex = jet.waypoints!.length - 2;
    jet.diving = true;
    sim.update(g, 1);
    sim.update(g, 1);
    expect(jet.alive).toBe(false);
    expect(g.explosions.length).toBeGreaterThan(0);
  });
});

describe("Missile spawn angles", () => {
  afterEach(() => setRng(Math.random));

  it("retargets edge-spawned missiles instead of sending them nearly vertical down the edge", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(5);
    g.burjAlive = false;

    spawnMissile(g, { side: "left" });

    const missile = g.missiles[0];
    expect(missile.targetX).not.toBe(60);
    expectPlayableMissileAngle(missile);
  });

  it("moves top-spawned missiles off-axis when the target is directly below", () => {
    const { g } = makeCleanGame(5);
    const rng = [0.5, 0.5125, 0.1];
    let index = 0;
    setRng(() => rng[Math.min(index++, rng.length - 1)]);

    spawnMissile(g, { side: "top" });

    const missile = g.missiles[0];
    expect(missile.targetX).toBe(BURJ_X);
    expect(Math.abs(missile.x - BURJ_X)).toBeGreaterThan(600);
    expectPlayableMissileAngle(missile);
  });

  it("applies the same angle guard to stacked missiles", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(5);
    g.burjAlive = false;

    spawnStackedMissile(g, 2, { side: "left" });

    expectPlayableMissileAngle(g.missiles[0]);
  });
});

describe("Burj damage presentation", () => {
  afterEach(() => setRng(Math.random));

  it("adds a missile Burj decal and local fire fx on direct Burj hit", () => {
    const { sim, g } = makeCleanGame(5);
    const missile = makeBallisticMissile({ x: BURJ_X, y: 1000, vy: 12 });
    g.missiles.push(missile);

    sim.update(g, 2);

    expect(g.burjHealth).toBe(6);
    expect(g.burjDecals).toHaveLength(1);
    expect(g.burjDecals[0].kind).toBe("missile");
    expect(g.burjDamageFx).toHaveLength(1);
    expect(g.burjDamageFx[0].kind).toBe("missile");
  });

  it("adds a drone Burj decal, keeps fire fx persistent, and repair removes oldest damage marks", () => {
    const { sim, g } = makeCleanGame(5);
    g.score = 10000;
    const drone = makePropDrone({ x: BURJ_X, y: 1120, vx: 0, vy: 18, health: 1 });
    g.drones.push(drone);

    sim.update(g, 2);

    expect(g.burjHealth).toBe(6);
    expect(g.burjDecals).toHaveLength(1);
    expect(g.burjDecals[0].kind).toBe("drone");
    expect(g.burjDamageFx).toHaveLength(1);

    sim.update(g, 400);
    expect(g.burjDamageFx).toHaveLength(1);

    expect(sim.buyUpgrade(g, "burjRepair")).toBe(true);
    expect(g.burjHealth).toBe(7);
    expect(g.burjDecals).toHaveLength(0);
    expect(g.burjDamageFx).toHaveLength(0);
  });
});

describe("Burj fire particle presentation", () => {
  const globalWithWindow = globalThis as unknown as { window?: { __editorOverrides?: Record<string, unknown> } };
  const originalWindow = globalWithWindow.window;

  afterEach(() => {
    setRng(Math.random);
    if (originalWindow === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = originalWindow;
  });

  function spawnFireAtHealth(health: number, dt = 10) {
    const { g } = makeCleanGame(5);
    g.burjHealth = health;
    g._gameSeed = 1234;
    setRng(() => 0.5);
    updateBurjFireParticles(g, dt);
    return g.particles.filter((particle) => particle.type?.startsWith("fire"));
  }

  it("does not spawn fire, smoke, or embers while pristine", () => {
    expect(spawnFireAtHealth(7)).toHaveLength(0);
  });

  it("exposes one fire site per damaged band under sparse flame defaults", () => {
    const particles = spawnFireAtHealth(1, 260);
    const layout = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 1, { gameSeed: 1234 });
    const flames = particles.filter((particle) => particle.type === "fireFlame");
    const smoke = particles.filter((particle) => particle.type === "fireSmoke");

    expect(layout.topBand).not.toBeNull();
    expect(layout.fireSites).toHaveLength(7);
    expect(layout.fireSites.map((site) => site.band.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(flames.length).toBeGreaterThan(0);
    expect(smoke.length).toBeGreaterThan(0);
  });

  it("increases particle pressure across the damage tiers", () => {
    const wounded = spawnFireAtHealth(5, 8).length;
    const burning = spawnFireAtHealth(3, 8).length;
    const critical = spawnFireAtHealth(1, 8).length;

    expect(wounded).toBeGreaterThan(0);
    expect(burning).toBeGreaterThan(wounded);
    expect(critical).toBeGreaterThan(burning);
  });

  it("uses the existing hit-flash timer as a temporary fire and smoke kick", () => {
    const baseline = spawnFireAtHealth(5, 8).length;
    const { g } = makeCleanGame(5);
    g.burjHealth = 5;
    g._gameSeed = 1234;
    g.burjHitFlashMax = 48;
    g.burjHitFlashTimer = 48;
    setRng(() => 0.5);
    updateBurjFireParticles(g, 8);

    expect(g.particles.filter((particle) => particle.type?.startsWith("fire")).length).toBeGreaterThan(baseline);
  });

  it("assigns runtime texture variants to flame, ember, and smoke particles", () => {
    const particles = spawnFireAtHealth(1, 260);
    const flames = particles.filter((particle) => particle.type === "fireFlame");
    const embers = particles.filter((particle) => particle.type === "fireEmber");
    const smoke = particles.filter((particle) => particle.type === "fireSmoke");

    expect(flames.length).toBeGreaterThan(0);
    expect(embers.length).toBeGreaterThan(0);
    expect(smoke.length).toBeGreaterThan(0);
    expect(flames.every((particle) => particle.textureVariant?.startsWith("flame-"))).toBe(true);
    expect(embers.every((particle) => particle.textureVariant?.startsWith("ember-"))).toBe(true);
    expect(smoke.every((particle) => particle.textureVariant?.startsWith("blackSmoke"))).toBe(true);
    expect(smoke.some((particle) => particle.color === "#8f969a" || particle.color === "#9da1a3")).toBe(true);
  });

  it("applies smoke Y offset without moving flame particles", () => {
    globalWithWindow.window = { __editorOverrides: { "burjFire.smokeYOffset": 0 } };
    const baseline = spawnFireAtHealth(1, 260);
    globalWithWindow.window = { __editorOverrides: { "burjFire.smokeYOffset": 36 } };
    const shifted = spawnFireAtHealth(1, 260);

    const baselineFlame = baseline.find((particle) => particle.type === "fireFlame")!;
    const shiftedFlame = shifted.find((particle) => particle.type === "fireFlame")!;
    const baselineSmoke = baseline.find((particle) => particle.type === "fireSmoke")!;
    const shiftedSmoke = shifted.find((particle) => particle.type === "fireSmoke")!;

    expect(shiftedFlame.y).toBe(baselineFlame.y);
    expect(shiftedSmoke.y).toBeCloseTo(baselineSmoke.y + 36, 5);
  });

  it("drifts smoke only to the selected rightward wind direction", () => {
    const particles = spawnFireAtHealth(1, 24);
    const smoke = particles.filter((particle) => particle.type === "fireSmoke");

    expect(smoke.length).toBeGreaterThan(0);
    expect(smoke.every((particle) => particle.vx >= 0)).toBe(true);
  });
});

describe("Building destruction presentation", () => {
  afterEach(() => setRng(Math.random));

  it("spawns and expires building destroy fx when a missile destroys a building", () => {
    const { sim, g } = makeCleanGame(5);
    const targetBuilding = g.buildings.find((b) => b.alive)!;
    const missile = makeBallisticMissile({
      x: targetBuilding.x + targetBuilding.w / 2,
      y: GROUND_Y - targetBuilding.h + 20,
      vy: 0,
    });
    g.missiles.push(missile);

    sim.update(g, 1);

    expect(targetBuilding.alive).toBe(false);
    expect(g.buildingDestroyFx).toHaveLength(1);

    sim.update(g, 80);
    expect(g.buildingDestroyFx).toHaveLength(0);
  });
});

describe("Decoy flares", () => {
  afterEach(() => setRng(Math.random));

  it("only launches from an active cast", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 1;
    g.flareReadyThisWave = false;
    const missile = makeBallisticMissile({ x: BURJ_X + 30, y: GROUND_Y - 200 });
    g.missiles.push(missile);

    expect(fireFlareSalvo(g)).toBe(false);
    expect(g.flares).toHaveLength(0);

    sim.updateAutoSystems(g, 240, [missile]);
    expect(g.flares).toHaveLength(0);

    g.flareReadyThisWave = true;
    expect(fireFlareSalvo(g)).toBe(true);
    expect(g.flareReadyThisWave).toBe(false);
    expect(g.flares).toHaveLength(3);
    expect(g.flareSalvoQueue.length).toBeGreaterThan(0);
  });

  it("lures missiles inside the cast radius and leaves outside threats alone", () => {
    const { g } = makeCleanGame(5);
    g.upgrades.flare = 1;
    g.flareReadyThisWave = true;
    const inside = makeBallisticMissile({ x: BURJ_X - 100, y: 850, vx: 1, vy: 1, accel: 1 });
    const outside = makeBallisticMissile({ x: 30, y: 80, vx: 1, vy: 1, accel: 1 });
    g.missiles.push(inside, outside);

    expect(fireFlareSalvo(g)).toBe(true);

    expect(inside.luredByFlare).toBe(true);
    expect(inside.flareTargetId).toBeDefined();
    expect(outside.luredByFlare).not.toBe(true);
  });

  it("keeps a lured missile tracking its assigned flare", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 1;
    const flare = {
      id: 1,
      x: BURJ_X + 20,
      y: 240,
      vx: 0,
      vy: -0.2,
      anchorX: BURJ_X + 20,
      drag: 0.988,
      life: 120,
      maxLife: 120,
      alive: true,
      luresLeft: 1,
      hotRadius: 18,
      trail: [],
    };
    const missile = makeBallisticMissile({ x: BURJ_X - 55, y: 245, vx: 0.5, vy: 1.6, accel: 1 });
    g.flares.push(flare);
    g.nextFlareId = 2;
    g.missiles.push(missile);
    missile.luredByFlare = true;
    missile.flareTargetId = flare.id;

    expect(missile.luredByFlare).toBe(true);
    expect(missile.flareTargetId).toBe(flare.id);

    flare.x += 45;
    flare.y += 10;
    const beforeDist = Math.hypot(missile.x - flare.x, missile.y - flare.y);
    sim.update(g, 1);
    const afterDist = Math.hypot(missile.x - flare.x, missile.y - flare.y);

    expect(afterDist).toBeLessThan(beforeDist);
    expect(missile.vx).toBeGreaterThan(0);
  });

  it("rank 2 queues staggered drops and refills alive launcher ammo", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 2;
    g.flareReadyThisWave = true;
    g.ammo = [0, 2];
    g.launcherHP = [1, 1];

    expect(fireFlareSalvo(g)).toBe(true);

    expect(g.flares).toHaveLength(6);
    expect(g.flareSalvoQueue).toHaveLength(2);
    expect(g.ammo[0]).toBeGreaterThan(0);
    expect(g.ammo[1]).toBeGreaterThan(2);

    sim.update(g, 60);
    expect(g.flareSalvoQueue).toHaveLength(1);
    expect(g.flares.length).toBeGreaterThanOrEqual(12);
  });

  it("rank 2 redirects lured threats to distinct reserved targets", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 2;
    const flareA = {
      id: 1,
      x: 200,
      y: 300,
      vx: 0,
      vy: 0,
      anchorX: 200,
      drag: 0.988,
      life: 120,
      maxLife: 120,
      alive: true,
      luresLeft: 999,
      hotRadius: 60,
      trail: [],
    };
    const flareB = { ...flareA, id: 2, x: 260, anchorX: 260 };
    const attackerA = makeBallisticMissile({
      x: 200,
      y: 300,
      vx: 1,
      vy: 0,
      accel: 1,
      luredByFlare: true,
      flareTargetId: 1,
    });
    const attackerB = makeBallisticMissile({
      x: 260,
      y: 300,
      vx: 1,
      vy: 0,
      accel: 1,
      luredByFlare: true,
      flareTargetId: 2,
    });
    const targetA = makeBallisticMissile({ x: 650, y: 260, vx: 0, vy: 1, accel: 1 });
    const targetB = makePropDrone({ x: 720, y: 320, vx: -1, vy: 0 });
    g.flares.push(flareA, flareB);
    g.missiles.push(attackerA, attackerB, targetA);
    g.drones.push(targetB);

    sim.update(g, 1);

    expect(attackerA.redirected).toBe(true);
    expect(attackerB.redirected).toBe(true);
    expect(attackerA.redirectTarget).toBeDefined();
    expect(attackerB.redirectTarget).toBeDefined();
    expect(attackerA.redirectTarget).not.toBe(attackerB.redirectTarget);
  });

  it("rank 2 redirected projectile detonates with its target", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 2;
    const flare = {
      id: 1,
      x: 200,
      y: 300,
      vx: 0,
      vy: 0,
      anchorX: 200,
      drag: 0.988,
      life: 120,
      maxLife: 120,
      alive: true,
      luresLeft: 999,
      hotRadius: 60,
      trail: [],
    };
    const attacker = makeBallisticMissile({
      x: 200,
      y: 300,
      vx: 1,
      vy: 0,
      accel: 1,
      luredByFlare: true,
      flareTargetId: 1,
    });
    const target = makeBallisticMissile({ x: 700, y: 300, vx: 0, vy: 1, accel: 1 });
    g.flares.push(flare);
    g.missiles.push(attacker, target);

    sim.update(g, 1);
    expect(attacker.redirected).toBe(true);
    attacker.x = target.x;
    attacker.y = target.y;
    sim.update(g, 1);

    expect(attacker.alive).toBe(false);
    expect(target.alive).toBe(false);
    expect(g.explosions.some((ex) => ex.color === "#ff8833")).toBe(true);
  });

  it("cast with no airborne threats spawns flares that expire without lingering claims", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 1;
    g.flareReadyThisWave = true;

    expect(fireFlareSalvo(g)).toBe(true);
    expect(g.flares.length).toBeGreaterThan(0);
    expect(g.flareSalvoClaims.size).toBe(0);

    for (let i = 0; i < 400; i++) sim.update(g, 1);
    expect(g.flares.every((f) => !f.alive) || g.flares.length === 0).toBe(true);
    expect(g.flareSalvoClaims.size).toBe(0);
  });

  it("rank 2 lone attacker with no other threats consumes itself at the flare", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 2;
    const flare = {
      id: 1,
      x: 200,
      y: 300,
      vx: 0,
      vy: 0,
      anchorX: 200,
      drag: 0.988,
      life: 120,
      maxLife: 120,
      alive: true,
      luresLeft: 999,
      hotRadius: 60,
      trail: [],
    };
    const attacker = makeBallisticMissile({
      x: 200,
      y: 300,
      vx: 1,
      vy: 0,
      accel: 1,
      luredByFlare: true,
      flareTargetId: 1,
    });
    g.flares.push(flare);
    g.missiles.push(attacker);

    sim.update(g, 1);

    expect(attacker.alive).toBe(false);
    expect(attacker.redirected).not.toBe(true);
    expect(flare.alive).toBe(false);
    expect(g.explosions.some((ex) => ex.color === "#ff8833")).toBe(true);
  });
});

describe("Auto-defense targeting spread", () => {
  afterEach(() => setRng(Math.random));

  it("launches hornets from the left site only when wildHornetsLeft is the sole purchase", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.hornetSites = [{ key: "wildHornetsLeft", ammo: 2, reloadTimer: 0, launchCooldown: 0 }];
    const threats = [
      makeBallisticMissile({ x: 140, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 460, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 780, y: 240, vx: 0, vy: 1 }),
    ];

    for (let i = 0; i < 30; i++) sim.updateAutoSystems(g, 1, threats);

    expect(g.hornets.length).toBeGreaterThanOrEqual(1);
    // All launches should originate near x=206 (left pad).
    expect(g.hornets.every((h) => h.x < 350)).toBe(true);
  });

  it("launches hornets from the right site only when wildHornetsRight is the sole purchase", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsRight");
    g.hornetSites = [{ key: "wildHornetsRight", ammo: 2, reloadTimer: 0, launchCooldown: 0 }];
    const threats = [
      makeBallisticMissile({ x: 140, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 460, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 780, y: 240, vx: 0, vy: 1 }),
    ];

    for (let i = 0; i < 30; i++) sim.updateAutoSystems(g, 1, threats);

    expect(g.hornets.length).toBeGreaterThanOrEqual(1);
    // All launches should originate near x=622 (right pad).
    expect(g.hornets.every((h) => h.x > 550)).toBe(true);
  });

  it("dual-site ownership fires from both pads with same-half target bias", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.ownedUpgradeNodes.add("wildHornetsRight");
    g.hornetSites = [
      { key: "wildHornetsLeft", ammo: 2, reloadTimer: 0, launchCooldown: 0 },
      { key: "wildHornetsRight", ammo: 2, reloadTimer: 0, launchCooldown: 0 },
    ];
    const threats = [
      makeBallisticMissile({ x: 160, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 260, y: 250, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 650, y: 240, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 760, y: 250, vx: 0, vy: 1 }),
    ];

    for (let i = 0; i < 30; i++) sim.updateAutoSystems(g, 1, threats);

    const leftSiteHornets = g.hornets.filter((h) => h.x < 350);
    const rightSiteHornets = g.hornets.filter((h) => h.x > 550);
    expect(leftSiteHornets.length).toBeGreaterThanOrEqual(1);
    expect(rightSiteHornets.length).toBeGreaterThanOrEqual(1);
    expect(leftSiteHornets.every((h) => h.targetRef && h.targetRef.x < BURJ_X)).toBe(true);
    expect(rightSiteHornets.every((h) => h.targetRef && h.targetRef.x >= BURJ_X)).toBe(true);
  });

  it("holds hornet fire when the only available target is already reserved", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.hornetSites = [{ key: "wildHornetsLeft", ammo: 2, reloadTimer: 0, launchCooldown: 0 }];
    const loneBomb = makeBallisticMissile({ x: 200, y: 240, vx: 0, vy: 1 });

    // Run past the launch-gap cooldown — only one hornet should launch,
    // the second slot stays in the magazine because the only target is reserved.
    for (let i = 0; i < 40; i++) sim.updateAutoSystems(g, 1, [loneBomb]);

    expect(g.hornets).toHaveLength(1);
    expect(g.hornetSites[0].ammo).toBe(1);
  });

  it("spreads roadrunner launch targets across separate threats", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.roadrunner = 2;
    g.roadrunnerAmmo = 2;
    g.roadrunnerReloadTimer = 0;
    g.roadrunnerLaunchCooldown = 0;
    const threats = [
      makeBallisticMissile({ x: 150, y: 250, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 460, y: 250, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 770, y: 250, vx: 0, vy: 1 }),
    ];

    // Tick enough frames for both magazine slots to fire across the L2 launch-gap cooldown (60 ticks).
    for (let i = 0; i < 65; i++) sim.updateAutoSystems(g, 1, threats);

    expect(g.roadrunners).toHaveLength(2);
    const targets = g.roadrunners.map((r) => r.targetRef);
    expect(new Set(targets).size).toBe(2);
    expect(Math.abs(targets[0]!.x - targets[1]!.x)).toBeGreaterThan(200);
  });

  it("holds roadrunner fire when the only target is already being chased", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.roadrunner = 2;
    g.roadrunnerAmmo = 2;
    g.roadrunnerReloadTimer = 0;
    g.roadrunnerLaunchCooldown = 0;
    const loneTarget = makeBallisticMissile({ x: 460, y: 250, vx: 0, vy: 1 });

    // Tick well past the launch-gap cooldown — only one roadrunner should launch,
    // the second ammo should stay in the magazine because the only target is reserved.
    for (let i = 0; i < 65; i++) sim.updateAutoSystems(g, 1, [loneTarget]);

    expect(g.roadrunners).toHaveLength(1);
    expect(g.roadrunnerAmmo).toBe(1);
  });

  it("spreads patriot launch targets across separate threats", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.patriot = 1;
    g.patriotTimer = 479;
    const threats = [
      makeBallisticMissile({ x: 140, y: 260, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 460, y: 260, vx: 0, vy: 1 }),
      makeBallisticMissile({ x: 780, y: 260, vx: 0, vy: 1 }),
    ];

    sim.updateAutoSystems(g, 1, threats);

    expect(g.patriotMissiles).toHaveLength(2);
    const targets = g.patriotMissiles.map((p) => p.targetRef);
    expect(new Set(targets).size).toBe(2);
    expect(Math.abs(targets[0]!.x - targets[1]!.x)).toBeGreaterThan(200);
  });

  it("hornets without skyHunterMesh crash when their target dies", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.hornetSites = [{ key: "wildHornetsLeft", ammo: 0, reloadTimer: 0, launchCooldown: 0 }];
    const deadTarget = makeBallisticMissile({ x: 200, y: 220, alive: false });
    const fallbackTarget = makeBallisticMissile({ x: 760, y: 230, vx: 0, vy: 1 });
    const dumbHornet = {
      x: 210,
      y: 480,
      targetRef: deadTarget,
      speed: 5,
      trail: [],
      alive: true,
      blastRadius: 30,
      wobble: 0,
      life: 600,
      maxLife: 600,
      retargetsRemaining: 0,
    };
    g.hornets.push(dumbHornet);

    sim.updateAutoSystems(g, 1, [fallbackTarget]);

    expect(dumbHornet.alive).toBe(false);
    expect(g.hornets).not.toContain(dumbHornet);
  });

  it("skyHunterMesh hornets retarget indefinitely until life expires", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.ownedUpgradeNodes.add("skyHunterMesh");
    g.hornetSites = [{ key: "wildHornetsLeft", ammo: 0, reloadTimer: 0, launchCooldown: 0 }];
    const t1 = makeBallisticMissile({ x: 200, y: 220, alive: false });
    const t2 = makeBallisticMissile({ x: 350, y: 240, vx: 0, vy: 1 });
    const t3 = makeBallisticMissile({ x: 500, y: 240, vx: 0, vy: 1 });
    const smartHornet = {
      x: 210,
      y: 480,
      targetRef: t1,
      speed: 5,
      trail: [],
      alive: true,
      blastRadius: 30,
      wobble: 0,
      life: 600,
      maxLife: 600,
      retargetsRemaining: Number.POSITIVE_INFINITY,
    };
    g.hornets.push(smartHornet);

    // First tick: t1 already dead → should retarget to t2 or t3 (whichever the picker scores higher).
    sim.updateAutoSystems(g, 1, [t2, t3]);
    expect(smartHornet.alive).toBe(true);
    expect([t2, t3]).toContain(smartHornet.targetRef);
    expect(smartHornet.retargetsRemaining).toBe(Number.POSITIVE_INFINITY);

    // Kill whichever target was picked → should retarget to the other one.
    const firstPick = smartHornet.targetRef!;
    firstPick.alive = false;
    sim.updateAutoSystems(g, 1, [t2, t3]);
    expect(smartHornet.alive).toBe(true);
    expect(smartHornet.targetRef).not.toBe(firstPick);
    expect(smartHornet.targetRef!.alive).toBe(true);
    expect(smartHornet.retargetsRemaining).toBe(Number.POSITIVE_INFINITY);
  });

  it("does not treat a live below-hornet target as a dead-target crash", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.wildHornets = 1;
    g.ownedUpgradeNodes.add("wildHornetsLeft");
    g.hornetSites = [{ key: "wildHornetsLeft", ammo: 0, reloadTimer: 0, launchCooldown: 0 }];
    const lowTarget = makeBallisticMissile({ x: 210, y: 520, vx: 0, vy: 1 });
    g.hornets.push({
      x: 210,
      y: 360,
      targetRef: lowTarget,
      speed: 5,
      trail: [],
      alive: true,
      blastRadius: 25,
      wobble: 0,
      life: 600,
      maxLife: 600,
      retargetsRemaining: 0,
    });

    sim.updateAutoSystems(g, 1, [lowTarget]);

    expect(g.hornets[0].alive).toBe(true);
    expect(g.hornets[0].targetRef).toBe(lowTarget);
    expect(g.hornets[0].y).toBeLessThan(360);
  });

  it("keeps patriot retargets off another patriot's live target", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.patriot = 1;
    g.patriotTimer = 0;
    const deadTarget = makeBallisticMissile({ x: 280, y: 210, alive: false });
    const reservedTarget = makeBallisticMissile({ x: 460, y: 240, vx: 0, vy: 1 });
    const fallbackTarget = makeBallisticMissile({ x: 760, y: 240, vx: 0, vy: 1 });
    g.patriotMissiles.push({
      x: 334,
      y: 560,
      targetRef: deadTarget,
      speed: 15,
      trail: [],
      alive: true,
      blastRadius: 56,
      wobble: 0,
      life: 200,
    } as PatriotMissile);
    g.patriotMissiles.push({
      x: 350,
      y: 560,
      targetRef: reservedTarget,
      speed: 15,
      trail: [],
      alive: true,
      blastRadius: 56,
      wobble: 0,
      life: 200,
    } as PatriotMissile);

    sim.updateAutoSystems(g, 1, [reservedTarget, fallbackTarget]);

    expect(g.patriotMissiles[0].targetRef).toBe(fallbackTarget);
  });
});

describe("Shahed-136 (prop) diving", () => {
  afterEach(() => setRng(Math.random));

  it("starts diving when reaching mid-screen", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const prop = makePropDrone();
    g.drones.push(prop);
    expect(prop.diving).toBeFalsy();
    expect(prop.waypoints).toBeUndefined();

    prop.x = CANVAS_W * 0.36;
    sim.update(g, 1);
    expect(prop.diving).toBe(true);
    expect(prop.diveTarget).toBeDefined();
  });

  it("ramps pathSpeed from 1x up to 4x during the waypoint dive portion (Shahed-136)", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const path = computeShahed136Path(-20, 150, true, 2.0, { x: BURJ_X, y: CITY_Y });
    const prop = makePropDrone({
      waypoints: path.waypoints,
      pathIndex: path.diveStartIndex,
      bombIndices: path.bombIndices,
      bombsDropped: 0,
      diveStartIndex: path.diveStartIndex,
      diveTarget: { x: BURJ_X, y: CITY_Y },
    });
    g.drones.push(prop);

    sim.update(g, 1);
    // After one tick on the dive segment: pathSpeed ramped from 1.0 by factor 1.06.
    expect(prop.diveSpeed).toBeCloseTo(1.06, 2);

    // After many ticks, pathSpeed multiplier saturates at the 4x cap.
    for (let i = 0; i < 80; i++) sim.update(g, 1);
    expect(prop.diveSpeed).toBeCloseTo(4.0, 2);
  });

  it("drops a bomb when reaching mid-screen on wave 3+", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const prop = makePropDrone();
    g.drones.push(prop);

    const missileBefore = g.missiles.length;
    prop.x = CANVAS_W * 0.36;
    sim.update(g, 1);
    expect(prop.bombDropped).toBe(true);
    expect(g.missiles.filter((m) => m.type === "bomb").length).toBe(missileBefore + 1);
  });

  it("impacts on reaching dive target", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const prop = makePropDrone({
      diving: true,
      diveTarget: { x: 400, y: GROUND_Y },
      diveSpeed: 2,
      x: 400,
      y: GROUND_Y - 3,
    });
    g.drones.push(prop);

    sim.update(g, 1);
    expect(prop.alive).toBe(false);
    expect(g.explosions.length).toBeGreaterThan(0);
  });

  it("damages the Burj when terminal dive reaches a Burj target below the body hitbox", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const healthBefore = g.burjHealth;
    const prop = makePropDrone({
      diving: true,
      diveTarget: { x: BURJ_X, y: CITY_Y },
      diveSpeed: 8,
      x: BURJ_X,
      y: CITY_Y - 6,
    });
    g.drones.push(prop);

    sim.update(g, 1);

    expect(prop.alive).toBe(false);
    expect(g.burjHealth).toBe(healthBefore - 1);
    expect(g.burjDecals[g.burjDecals.length - 1]?.kind).toBe("drone");
  });
});

describe("F-15 active upgrade", () => {
  afterEach(() => setRng(Math.random));

  it("does not spawn planes automatically without the f15 upgrade", () => {
    const { sim, g } = makeCleanGame(5);
    g.state = "playing";
    expect(g.planes.length).toBe(0);
    for (let i = 0; i < 1500; i++) sim.update(g, 1);
    expect(g.planes.length).toBe(0);
  });

  it("buying f15 marks it ready for the wave", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 5000;
    expect(buyUpgrade(g, "f15")).toBe(true);
    expect(g.upgrades.f15).toBe(1);
    expect(g.f15ReadyThisWave).toBe(true);
  });

  it("fireF15Pair spawns a formation and consumes the cast", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 5000;
    buyUpgrade(g, "f15");
    expect(fireF15Pair(g, null)).toBe(true);
    expect(g.planes.length).toBe(2);
    expect(Math.sign(g.planes[0].vx)).toBe(Math.sign(g.planes[1].vx));
    expect(g.planes[0].x).not.toBe(g.planes[1].x);
    expect(g.planes[0].y).not.toBe(g.planes[1].y);
    expect(g.f15ReadyThisWave).toBe(false);
  });

  it("rank 2 schedules a return pass from the opposite side", () => {
    const { sim, g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.metaProgression.completedObjectives.push("reach_wave_4");
    g.score = 20000;
    buyUpgrade(g, "f15");
    buyUpgrade(g, "f15TopGun");
    g.state = "playing";
    g.schedule = [];
    g.scheduleIdx = 0;
    fireF15Pair(g, null);
    expect(g.planes.length).toBe(2);
    const firstDir = Math.sign(g.planes[0].vx);
    expect(g.f15ReturnTimer).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) sim.update(g, 1);
    const newPlanes = g.planes.filter((p) => Math.sign(p.vx) === -firstDir);
    expect(newPlanes.length).toBe(2);
    expect(g.f15ReturnTimer).toBe(0);
  });

  it("rank 1 does not schedule a return pass", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 5000;
    buyUpgrade(g, "f15");
    fireF15Pair(g, null);
    expect(g.f15ReturnTimer).toBe(0);
  });

  it("fireF15Pair fails when used or not owned", () => {
    const { g } = makeCleanGame(5);
    expect(fireF15Pair(g, null)).toBe(false);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 5000;
    buyUpgrade(g, "f15");
    g.f15ReadyThisWave = false;
    expect(fireF15Pair(g, null)).toBe(false);
  });

  it("rank 2 lowers plane fireInterval", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.metaProgression.completedObjectives.push("reach_wave_4");
    g.score = 20000;
    buyUpgrade(g, "f15");
    buyUpgrade(g, "f15TopGun");
    expect(g.upgrades.f15).toBe(2);
    fireF15Pair(g, null);
    for (const p of g.planes) {
      expect(p.fireInterval).toBeLessThan(25);
    }
  });

  it("a single cast cannot fire twice in the same wave", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 5000;
    buyUpgrade(g, "f15");
    expect(fireF15Pair(g, null)).toBe(true);
    expect(fireF15Pair(g, null)).toBe(false);
  });
});

describe("active upgrade mutual exclusivity", () => {
  afterEach(() => setRng(Math.random));

  it("buying emp locks the f15 family in the shop", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 20000;
    buyUpgrade(g, "emp");
    const entries = buildShopEntries(g);
    const f15Entry = entries.find((entry) => entry.id === "f15");
    const flareEntry = entries.find((entry) => entry.id === "flare");
    expect(f15Entry).toBeDefined();
    expect(f15Entry!.locked).toBe(true);
    expect(f15Entry!.statusText).toMatch(/EMP/i);
    expect(flareEntry).toBeDefined();
    expect(flareEntry!.locked).toBe(true);
    expect(flareEntry!.statusText).toMatch(/EMP/i);
  });

  it("buying f15 locks the emp family in the shop", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 20000;
    buyUpgrade(g, "f15");
    const entries = buildShopEntries(g);
    const empEntry = entries.find((entry) => entry.id === "emp");
    const flareEntry = entries.find((entry) => entry.id === "flare");
    expect(empEntry).toBeDefined();
    expect(empEntry!.locked).toBe(true);
    expect(empEntry!.statusText).toMatch(/F-15/i);
    expect(flareEntry).toBeDefined();
    expect(flareEntry!.locked).toBe(true);
    expect(flareEntry!.statusText).toMatch(/F-15/i);
  });

  it("buyUpgrade refuses to purchase the locked family", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 50000;
    expect(buyUpgrade(g, "emp")).toBe(true);
    expect(buyUpgrade(g, "f15")).toBe(false);
    expect(buyUpgrade(g, "flare")).toBe(false);
    expect(g.upgrades.f15).toBe(0);
    expect(g.upgrades.flare).toBe(0);
  });

  it("excludes active upgrades from draft offers before wave 3 is complete", () => {
    setRng(() => 0);
    const { g } = makeCleanGame(1);
    g.metaProgression.completedObjectives.push("reach_wave_3");

    for (const wave of [1, 2]) {
      g.wave = wave;
      const offers = draftPick3(g);
      expect(offers).toHaveLength(3);
      expect(offers).not.toContain("emp");
      expect(offers).not.toContain("f15");
      expect(offers).not.toContain("flare");
    }
  });

  it("forces exactly one active upgrade into the wave 3 draft offer", () => {
    setRng(() => 0);
    const { g } = makeCleanGame(3);

    const offers = draftPick3(g);
    const activeOffers = offers.filter((offer) => offer === "emp" || offer === "f15" || offer === "flare");

    expect(offers).toHaveLength(3);
    expect(activeOffers).toHaveLength(1);
    expect(offers.filter((offer) => offer !== "emp" && offer !== "f15" && offer !== "flare")).toHaveLength(2);
  });

  it("prevents direct active-upgrade draft purchases before wave 3", () => {
    const { g } = makeCleanGame(1);
    g.metaProgression.completedObjectives.push("reach_wave_3");

    expect(buyDraftUpgrade(g, "emp")).toBe(false);
    expect(buyDraftUpgrade(g, "f15")).toBe(false);
    expect(buyDraftUpgrade(g, "flare")).toBe(false);
    expect(g.upgrades.emp).toBe(0);
    expect(g.upgrades.f15).toBe(0);
    expect(g.upgrades.flare).toBe(0);

    g.wave = 3;
    expect(buyDraftUpgrade(g, "f15")).toBe(true);
    expect(g.upgrades.f15).toBe(1);
  });

  it("ensures at least one active upgrade is available at wave 3", () => {
    const states = [
      // Fresh first run: no completed objectives yet.
      () => {
        const { g } = makeCleanGame(3);
        return g;
      },
      // Returning player who has reached wave 3 before but not bought anything.
      () => {
        const { g } = makeCleanGame(3);
        g.metaProgression.completedObjectives.push("reach_wave_3");
        return g;
      },
      // EMP path already chosen: F-15 locked, but EMP rank stays buyable/owned.
      () => {
        const { g } = makeCleanGame(3);
        g.metaProgression.completedObjectives.push("reach_wave_3");
        g.score = 20000;
        buyUpgrade(g, "emp");
        return g;
      },
      // F-15 path already chosen: EMP locked, but F-15 rank stays buyable/owned.
      () => {
        const { g } = makeCleanGame(3);
        g.metaProgression.completedObjectives.push("reach_wave_3");
        g.score = 20000;
        buyUpgrade(g, "f15");
        return g;
      },
    ];
    for (const make of states) {
      const g = make();
      const entries = buildShopEntries(g);
      const visibleActive = entries.filter((entry) => entry.active && (entry.owned || !entry.locked));
      expect(visibleActive.length).toBeGreaterThan(0);
    }
  });

  it("normalizes legacy flare conflicts and stale flare defense sites", () => {
    const { g } = makeCleanGame(5);
    g.ownedUpgradeNodes.add("flare");
    g.ownedUpgradeNodes.add("flareCluster");
    g.ownedUpgradeNodes.add("flareCarpet");
    g.ownedUpgradeNodes.add("emp");
    g.defenseSites.push({ key: "flare", x: BURJ_X, y: 837, alive: true });

    normalizeLegacyFlareActiveState(g);

    expect(g.ownedUpgradeNodes.has("flare")).toBe(false);
    expect(g.ownedUpgradeNodes.has("flareCluster")).toBe(true);
    expect(g.ownedUpgradeNodes.has("flareCarpet")).toBe(true);
    expect(g.defenseSites.some((site) => site.key === "flare")).toBe(false);
  });
});

describe("EMP active upgrade", () => {
  afterEach(() => setRng(Math.random));

  it("buying F-15 does not arm EMP (regression)", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_3");
    g.score = 20000;
    buyUpgrade(g, "f15");
    expect(g.empReadyThisWave).toBe(false);
    expect(fireEmp(g, null)).toBe(false);
  });

  it("rank 1 spawns a three-layer Burj ring and consumes the cast", () => {
    const { g } = makeCleanGame(5);
    g.score = 5000;
    buyUpgrade(g, "emp");
    expect(g.empReadyThisWave).toBe(true);
    expect(fireEmp(g, null)).toBe(true);
    expect(g.empRings.length).toBe(3);
    expect(g.empRings.every((ring) => ring.kind === "burj")).toBe(true);
    expect(g.empRings.filter((ring) => (ring.damage ?? 0) > 0)).toHaveLength(1);
    expect(g.empReadyThisWave).toBe(false);
    expect(fireEmp(g, null)).toBe(false);
  });

  it("rank 2 spawns Burj ring + one extra ring per alive launcher", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_6");
    g.score = 20000;
    buyUpgrade(g, "emp");
    buyUpgrade(g, "empCapacitors");
    expect(g.upgrades.emp).toBe(2);
    g.launcherHP = [1, 1];
    fireEmp(g, null);
    expect(g.empRings.length).toBe(9);
    expect(g.empLauncherFlares.length).toBe(2);
  });

  it("rank 2 skips dead-launcher anchors", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_6");
    g.score = 20000;
    buyUpgrade(g, "emp");
    buyUpgrade(g, "empCapacitors");
    g.launcherHP = [1, 0];
    fireEmp(g, null);
    expect(g.empRings.length).toBe(6);
    expect(g.empLauncherFlares.length).toBe(1);
  });

  it("rank 2 launcher rings are smaller than the Burj ring", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_6");
    g.score = 20000;
    buyUpgrade(g, "emp");
    buyUpgrade(g, "empCapacitors");
    g.launcherHP = [1, 1];
    fireEmp(g, null);
    const burjRing = g.empRings[0];
    const launcherRings = g.empRings.filter((ring) => ring.kind === "launcher");
    for (const ring of launcherRings) {
      expect(ring.maxRadius).toBeLessThan(burjRing.maxRadius);
    }
  });

  it("rank 2 refills ammo on alive launchers and skips dead ones", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_6");
    g.score = 20000;
    buyUpgrade(g, "emp");
    buyUpgrade(g, "empCapacitors");
    g.launcherHP = [1, 0];
    g.ammo = [0, 0];
    fireEmp(g, null);
    expect(g.ammo[0]).toBeGreaterThan(0);
    expect(g.ammo[1]).toBe(0);
  });

  it("EMP arms punch-frame feedback state", () => {
    const { g } = makeCleanGame(5);
    g.score = 5000;
    buyUpgrade(g, "emp");
    fireEmp(g, null);
    expect(g.shakeTimer).toBeGreaterThan(6);
    expect(g.shakeIntensity).toBeGreaterThan(3);
    expect(g.empScrubTicks).toBeGreaterThan(0);
    expect(g.empGlitchTimer).toBeGreaterThan(0);
    expect(g.empZoomTimer).toBeGreaterThan(0);
  });

  it("EMP scrub freezes gameplay while the impact hold counts down", () => {
    const { sim, g } = makeCleanGame(5);
    g.score = 5000;
    buyUpgrade(g, "emp");
    g.missiles.push(makeMissile({ x: 100, y: 100, vx: 4, vy: 0 }));
    fireEmp(g, null);
    const coreRing = g.empRings[0];
    const initialShakeTimer = g.shakeTimer;

    sim.update(g, 1);

    expect(g.missiles[0].x).toBe(100);
    expect(coreRing.radius).toBe(0);
    expect(g.empScrubTicks).toBe(6);
    expect(g.shakeTimer).toBe(initialShakeTimer);
  });

  it("EMP scrub releases into quarter-speed before returning to normal", () => {
    const { sim, g } = makeCleanGame(5);
    g.empScrubTicks = 4;
    g.shakeTimer = 10;
    g.missiles.push(makeMissile({ x: 100, y: 100, vx: 4, vy: 0 }));

    sim.update(g, 1);

    expect(g.missiles[0].x).toBe(101);
    expect(g.empScrubTicks).toBe(3);
    expect(g.shakeTimer).toBeCloseTo(9.75);
  });

  it("EMP rings use the front-loaded shockwave expansion curve", () => {
    const { sim, g } = makeCleanGame(5);
    g.score = 5000;
    buyUpgrade(g, "emp");
    fireEmp(g, null);
    g.empScrubTicks = 0;
    const coreRing = g.empRings[0];

    sim.update(g, 1);
    expect(coreRing.radius).toBe(40);
    sim.update(g, 1);
    expect(coreRing.radius).toBe(80);
    sim.update(g, 1);
    expect(coreRing.radius).toBe(120);
    sim.update(g, 1);
    expect(coreRing.radius).toBe(145);
  });

  it("rank 2 rings expand faster than rank 1", () => {
    const { g } = makeCleanGame(5);
    g.metaProgression.completedObjectives.push("reach_wave_6");
    g.score = 20000;
    buyUpgrade(g, "emp");
    buyUpgrade(g, "empCapacitors");
    fireEmp(g, null);
    for (const ring of g.empRings) {
      expect(ring.expandRate).toBeGreaterThan(1);
    }
  });

  it("EMP cannot fire twice in the same wave", () => {
    const { g } = makeCleanGame(5);
    g.score = 5000;
    buyUpgrade(g, "emp");
    expect(fireEmp(g, null)).toBe(true);
    expect(fireEmp(g, null)).toBe(false);
  });
});
