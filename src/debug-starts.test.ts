import { afterEach, describe, expect, it } from "vitest";
import { setRng, getAmmoCapacity } from "./game-logic";
import { initGame, buyUpgrade } from "./game-sim";
import { DEBUG_START_PRESETS, applyDebugStartPreset, getDebugStartPreset } from "./debug-starts";
import { getUpgradeNodeDef } from "./game-sim-upgrades";

describe("debug start presets", () => {
  afterEach(() => setRng(Math.random));

  it("defines the requested wave 3-7 starts (EMP, F-15, and flare variants)", () => {
    expect(DEBUG_START_PRESETS.map((preset) => preset.wave)).toEqual([3, 4, 5, 6, 7, 3, 4, 5, 6, 7, 3, 4, 5, 6, 7]);
    expect(DEBUG_START_PRESETS.filter((preset) => preset.variant === "f15").map((preset) => preset.wave)).toEqual([
      3, 4, 5, 6, 7,
    ]);
    expect(DEBUG_START_PRESETS.filter((preset) => preset.variant === "flare").map((preset) => preset.wave)).toEqual([
      3, 4, 5, 6, 7,
    ]);
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
      ]);
      for (const [key, level] of Object.entries(preset.upgrades)) {
        // The wildHornets family is now three rank-1 siblings (left/right/skyHunterMesh),
        // so g.upgrades.wildHornets stays at 1 regardless of how many nodes you own.
        // Treat the preset value as "this many family nodes should be owned."
        if (key === "wildHornets") {
          const ownedInFamily = Array.from(g.ownedUpgradeNodes).filter(
            (id) => getUpgradeNodeDef(id)?.family === "wildHornets",
          ).length;
          expect(ownedInFamily).toBeGreaterThanOrEqual(level ?? 0);
        } else {
          expect(g.upgrades[key as keyof typeof g.upgrades]).toBeGreaterThanOrEqual(level ?? 0);
        }
      }
    }
  });

  it("applies objective-gated upgrades without mutating persistent progression", () => {
    setRng(() => 0.5);
    const g = initGame();
    const preset = getDebugStartPreset("wave-7")!;
    g.wave = 3;
    g.score = 100000;

    expect(buyUpgrade(g, "emp")).toBe(true);
    expect(buyUpgrade(g, "emp")).toBe(false);

    applyDebugStartPreset(g, preset);

    expect(g.upgrades.emp).toBe(2);
    expect(g.upgrades.patriot).toBe(2);
    expect(g.empReadyThisWave).toBe(true);
    expect(g.defenseSites.some((site) => site.key === "patriot" && site.alive)).toBe(true);
  });
});
