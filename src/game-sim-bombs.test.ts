import { afterEach, describe, expect, it } from "vitest";
import { createGameSim, spawnDroneOfType } from "./game-sim";
import { getGameplayBuildingBounds, setRng } from "./game-logic";

// Measured launch of run-016 bomb 112: previously overshot building 2 and hit 3.
const recorded = { x: 97.73728576638374, y: 98.6175812097797, vy: 2.580423241853714 };

function setup(path: "waypoint" | "legacy", x = recorded.x, y = recorded.y) {
  setRng(() => 0.5);
  const sim = createGameSim();
  const g = sim.initGame();
  g.schedule = [];
  g.buildings.forEach((b, i) => (b.alive = i === 1 || i === 2));
  spawnDroneOfType(g, "shahed136", undefined, "shahed-136-bomber");
  const d = g.drones[0];
  Object.assign(d, { x, y, vx: -1, vy: 0, wobble: -0.05, diving: false, bombDropped: false, bombsDropped: 0 });
  if (path === "waypoint") {
    d.waypoints = [
      { x, y },
      { x, y },
    ];
    d.pathIndex = 0;
    d.bombIndices = [1];
  } else {
    d.waypoints = undefined;
    d.x += 1; // The legacy carrier moves before dropping.
  }
  return { sim, g };
}

afterEach(() => setRng(Math.random));

describe("bomb roof targeting", () => {
  it.each(["waypoint", "legacy"] as const)("%s drop destroys the selected building instead of its neighbor", (path) => {
    const { sim, g } = setup(path);
    setRng(() => (recorded.vy - 2.4) / 1.6);
    sim.update(g, 1);
    const bomb = g.missiles.find((m) => m.type === "bomb")!;
    expect(bomb).toBeDefined();
    expect(bomb.targetX).toBe(167);
    expect(bomb.vy).toBeCloseTo(recorded.vy, 12);
    const roof = getGameplayBuildingBounds(g.buildings[1]);
    const ticks = Math.ceil((roof.top - bomb.y) / bomb.vy);
    g.drones = [];
    for (let i = 0; i < ticks; i++) sim.update(g, 1);
    expect(bomb.alive).toBe(false);
    expect(g.buildings[1].alive).toBe(false);
    expect(g.buildings[2].alive).toBe(true);
  });

  it.each([0, 0.5, 0.999999])("keeps vertical speed sampling and reaches the roof from either side (rng=%s)", (rng) => {
    for (const x of [80, 230]) {
      const { sim, g } = setup("waypoint", x, 500);
      g.buildings.forEach((b, i) => (b.alive = i === 1));
      setRng(() => rng);
      sim.update(g, 1);
      const bomb = g.missiles.find((m) => m.type === "bomb")!;
      expect(bomb.vy).toBeCloseTo(2.4 + rng * 1.6);
      const frames = Math.ceil((bomb.targetY! - bomb.y) / bomb.vy);
      g.drones = [];
      for (let i = 0; i < frames; i++) sim.update(g, 1);
      expect(g.buildings[1].alive).toBe(false);
    }
  });

  it.each(["waypoint", "legacy"] as const)("%s drop skips absent or unreachable roofs", (path) => {
    for (const noBuildings of [false, true]) {
      const { sim, g } = setup(path, 100, 1405);
      if (noBuildings) g.buildings.forEach((b) => (b.alive = false));
      sim.update(g, 1);
      expect(g.missiles.filter((m) => m.type === "bomb")).toHaveLength(0);
    }
  });
});
