import { afterEach, describe, expect, it } from "vitest";
import { setRng, CANVAS_W, GROUND_Y, CITY_Y, BURJ_X, computeShahed238Path } from "./game-logic.js";
import { createGameSim, spawnMirv, spawnDrone } from "./game-sim.js";

describe("MIRV behavior", () => {
  afterEach(() => setRng(Math.random));

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
    expect(mirv.warheadCount).toBe(5);
    mirv.splitY = mirv.y + 1;

    sim.update(g, 2);
    expect(g.missiles.filter((m) => m.alive && m.type === "mirv_warhead")).toHaveLength(5);
    expect(g.explosions.some((ex) => ex.harmless)).toBe(true);
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

function makePropDrone(overrides = {}) {
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
    _hitByExplosions: new Set(),
    empSlowTimer: 0,
    ...overrides,
  };
}

function makeJetDrone(overrides = {}) {
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
    _hitByExplosions: new Set(),
    empSlowTimer: 0,
    waypoints: path.waypoints,
    pathIndex: 0,
    bombIndices: path.bombIndices,
    bombsDropped: 0,
    diveStartIndex: path.diveStartIndex,
    diveTarget: target,
    ...overrides,
  };
}

function makeBallisticMissile(overrides = {}) {
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
  };
}

describe("Shahed-238 (jet) diving", () => {
  afterEach(() => setRng(Math.random));

  it("spawnDrone creates jet with precomputed waypoints", () => {
    setRng(() => 0.5);
    const { g } = makeCleanGame(5);
    spawnDrone(g);
    const jet = g.drones.find((d) => d.subtype === "shahed238");
    expect(jet).toBeTruthy();
    expect(jet.waypoints.length).toBeGreaterThan(10);
    expect(jet.diveStartIndex).toBeGreaterThan(0);
    expect(jet.diveStartIndex).toBeLessThan(jet.waypoints.length);
    expect(jet.bombIndices).toHaveLength(2);
    expect(jet.bombIndices[0]).toBeLessThan(jet.diveStartIndex);
    expect(jet.bombIndices[1]).toBeLessThan(jet.diveStartIndex);
    expect(jet.bombsDropped).toBe(0);
    expect(jet.diveTarget).toBeDefined();
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

    jet.pathIndex = jet.diveStartIndex - 2;
    sim.update(g, 1);
    if (jet.pathIndex >= jet.diveStartIndex) {
      expect(jet.diving).toBe(true);
    }
    jet.pathIndex = jet.diveStartIndex + 1;
    sim.update(g, 1);
    expect(jet.diving).toBe(true);
  });

  it("drops 2 bombs at precomputed path positions", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const jet = makeJetDrone();
    g.drones.push(jet);
    const missileBefore = g.missiles.length;

    jet.pathIndex = jet.bombIndices[0] - 0.5;
    sim.update(g, 1);
    expect(jet.bombsDropped).toBe(1);
    expect(g.missiles.length).toBe(missileBefore + 1);
    expect(g.missiles[g.missiles.length - 1].type).toBe("bomb");

    jet.pathIndex = jet.bombIndices[1] - 0.5;
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
    jet.pathIndex = jet.waypoints.length - 2;
    jet.diving = true;
    sim.update(g, 1);
    sim.update(g, 1);
    expect(jet.alive).toBe(false);
    expect(g.explosions.length).toBeGreaterThan(0);
  });
});

describe("Decoy flares", () => {
  afterEach(() => setRng(Math.random));

  it("only launches when an interceptable missile is in the flare response window", () => {
    const { sim, g } = makeCleanGame(5);
    g.upgrades.flare = 1;
    g.flareTimer = 239;

    sim.updateAutoSystems(g, 1, []);
    expect(g.flares).toHaveLength(0);

    const droneOnly = makePropDrone();
    g.drones.push(droneOnly);
    sim.updateAutoSystems(g, 1, [droneOnly]);
    expect(g.flares).toHaveLength(0);

    const missile = makeBallisticMissile({ x: BURJ_X + 30, y: 260 });
    g.missiles.push(missile);
    sim.updateAutoSystems(g, 1, [missile]);
    expect(g.flares.length).toBeGreaterThan(0);
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

    sim.updateAutoSystems(g, 1, [missile]);
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

  it("dives at 1.8x horizontal speed toward target", () => {
    setRng(() => 0.5);
    const { sim, g } = makeCleanGame(5);
    const prop = makePropDrone();
    g.drones.push(prop);
    const hSpeed = Math.abs(prop.vx);

    prop.diving = true;
    prop.diveTarget = { x: BURJ_X, y: CITY_Y };
    sim.update(g, 1);

    expect(prop.diveSpeed).toBeCloseTo(Math.max(hSpeed, 1.0) * 1.8, 1);
    const actualSpeed = Math.sqrt(prop.vx ** 2 + prop.vy ** 2);
    expect(actualSpeed).toBeCloseTo(prop.diveSpeed, 1);
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
});
