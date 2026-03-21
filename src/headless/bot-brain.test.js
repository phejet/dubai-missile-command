import { describe, expect, it } from "vitest";
import defaultConfig from "./bot-config.json" with { type: "json" };
import { botDecideAction, resolveBotConfig } from "./bot-brain.js";

function makeGame() {
  return {
    wave: 5,
    ammo: [10, 10, 10],
    launcherHP: [1, 1, 1],
    interceptors: [],
    missiles: [
      {
        alive: true,
        x: 450,
        y: 260,
        vx: 0,
        vy: 1,
        accel: 1,
        type: "missile",
      },
    ],
    drones: [],
    planes: [],
  };
}

describe("resolveBotConfig", () => {
  it("applies humanized preset overrides without mutating the base config", () => {
    const resolved = resolveBotConfig(defaultConfig, "average");
    expect(resolved.activePreset).toBe("average");
    expect(resolved.humanization.enabled).toBe(true);
    expect(defaultConfig).not.toHaveProperty("activePreset");
    expect(defaultConfig).not.toHaveProperty("humanization");
  });
});

describe("botDecideAction humanized presets", () => {
  it("waits for reaction delay before taking a shot", () => {
    const config = resolveBotConfig(defaultConfig, "average");
    config.humanization.startWave = 1;
    config.humanization.focusWidthRatio = 1;
    config.humanization.minThreatCount = 1;
    config.humanization.focusDurationMin = 100;
    config.humanization.focusDurationMax = 100;
    config.humanization.reactionDelayMin = 2;
    config.humanization.reactionDelayMax = 2;
    config.humanization.peripheralNoticeChance = 1;
    config.humanization.urgentReactionMultiplier = 1;
    config.humanization.aimJitter = 0;
    config.humanization.leadBlendMin = 1;
    config.humanization.leadBlendMax = 1;

    const g = makeGame();

    expect(botDecideAction(g, config, -Infinity, 0)).toBeNull();
    const action = botDecideAction(g, config, -Infinity, 1);
    expect(action).not.toBeNull();
    expect(action.x).toBeGreaterThanOrEqual(20);
    expect(action.y).toBeGreaterThanOrEqual(20);
  });
});
