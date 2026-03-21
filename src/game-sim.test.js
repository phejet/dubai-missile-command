import { afterEach, describe, expect, it } from "vitest";
import { setRng } from "./game-logic.js";
import { createGameSim, spawnMirv } from "./game-sim.js";

describe("MIRV behavior", () => {
  afterEach(() => {
    setRng(Math.random);
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
    expect(mirv.warheadCount).toBe(3);
    mirv.splitY = mirv.y + 1;

    sim.update(g, 2);
    expect(g.missiles.filter((m) => m.alive && m.type === "mirv_warhead")).toHaveLength(3);
    expect(g.explosions.some((ex) => ex.harmless)).toBe(true);
  });
});
