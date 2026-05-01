import { afterEach, describe, expect, it } from "vitest";
import { setRng, getAmmoCapacity } from "./game-logic.js";
import { initGame, buyUpgrade } from "./game-sim.js";
import { DEBUG_START_PRESETS, applyDebugStartPreset, getDebugStartPreset } from "./debug-starts.js";

describe("debug start presets", () => {
  afterEach(() => setRng(Math.random));

  it("defines the requested wave 3-7 starts", () => {
    expect(DEBUG_START_PRESETS.map((preset) => preset.wave)).toEqual([3, 4, 5, 6, 7]);
  });

  it("bootstraps each preset into a clean playing wave", () => {
    for (const preset of DEBUG_START_PRESETS) {
      setRng(() => 0.5);
      const g = initGame();

      applyDebugStartPreset(g, preset);

      expect(g._debugMode).toBe(true);
      expect(g.state).toBe("playing");
      expect(g.wave).toBe(preset.wave);
      expect(g.waveTick).toBe(0);
      expect(g.scheduleIdx).toBe(0);
      expect(g.schedule.length).toBeGreaterThan(0);
      expect(g.ammo).toEqual([
        getAmmoCapacity(preset.wave, g.upgrades.launcherKit),
        getAmmoCapacity(preset.wave, g.upgrades.launcherKit),
        getAmmoCapacity(preset.wave, g.upgrades.launcherKit),
      ]);
      for (const [key, level] of Object.entries(preset.upgrades)) {
        expect(g.upgrades[key as keyof typeof g.upgrades]).toBeGreaterThanOrEqual(level ?? 0);
      }
    }
  });

  it("applies objective-gated upgrades without mutating persistent progression", () => {
    setRng(() => 0.5);
    const g = initGame();
    const preset = getDebugStartPreset("wave-7")!;
    g.score = 100000;

    expect(buyUpgrade(g, "emp")).toBe(true);
    expect(buyUpgrade(g, "emp")).toBe(false);

    applyDebugStartPreset(g, preset);

    expect(g.upgrades.emp).toBe(2);
    expect(g.upgrades.patriot).toBe(2);
    expect(g.empReady).toBe(true);
    expect(g.defenseSites.some((site) => site.key === "patriot" && site.alive)).toBe(true);
  });
});
