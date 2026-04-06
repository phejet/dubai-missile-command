import { describe, expect, it } from "vitest";
import defaultConfig from "./bot-config.json" with { type: "json" };
import { botDecideAction, reserveBotTarget, resolveBotConfig } from "./bot-brain.js";
import type { GameState } from "../types";

function makeGame(): GameState {
  return {
    wave: 5,
    ammo: [10, 10, 10] as [number, number, number],
    launcherHP: [1, 1, 1] as [number, number, number],
    interceptors: [],
    missiles: [
      {
        alive: true,
        x: 450,
        y: 260,
        vx: 0,
        vy: 1,
        accel: 1,
        trail: [],
        type: "missile",
      },
    ],
    drones: [],
    planes: [],
  } as unknown as GameState;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeHumanInstant(human: any) {
  human.focusWidthRatio = 1;
  human.minThreatCount = 1;
  human.focusDurationMin = 100;
  human.focusDurationMax = 100;
  human.reactionDelayMin = 0;
  human.reactionDelayMax = 0;
  human.peripheralNoticeChance = 1;
  human.urgentNoticeChance = 1;
  human.urgentReactionMultiplier = 0;
  human.aimJitter = 0;
  human.leadBlendMin = 1;
  human.leadBlendMax = 1;
  human.minClickInterval = 0;
  human.maxBurstShots = 99;
  human.burstWindowTicks = 100;
  human.burstRecoveryMin = 0;
  human.burstRecoveryMax = 0;
  human.cursorSpeedPxPerTick = 1_000_000;
  human.cursorTrackSpeedPxPerTick = 1_000_000;
  human.movementFireThrottleMultiplier = 0;
  human.attentionShiftMin = 0;
  human.attentionShiftMax = 0;
  human.laneSwitchPenalty = 0;
  human.settleTicksMin = 0;
  human.settleTicksMax = 0;
  human.sameTargetAttentionMultiplier = 0;
  human.sameLaneAttentionMultiplier = 0;
  human.sameTargetMoveMultiplier = 0;
  human.retargetAimThreshold = 999;
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
  it("keeps firing under reaction delay instead of going silent", () => {
    const config = resolveBotConfig(defaultConfig, "average");
    config.humanization.startWave = 1;
    makeHumanInstant(config.humanization);
    config.humanization.reactionDelayMin = 2;
    config.humanization.reactionDelayMax = 2;

    const g = makeGame();

    const action = botDecideAction(g, config, -Infinity, 0);
    expect(action).not.toBeNull();
    expect(action!.x).toBeGreaterThanOrEqual(20);
    expect(action!.y).toBeGreaterThanOrEqual(20);
  });

  it("enforces click-rate limits for humanized presets", () => {
    const config = resolveBotConfig(defaultConfig, "good");
    config.humanization.startWave = 1;
    makeHumanInstant(config.humanization);
    config.humanization.minClickInterval = 5;
    config.targeting.cooldownNormal = 0;
    config.targeting.cooldownHighThreat = 0;
    config.targeting.cooldownLowAmmo = 0;

    const g = makeGame();

    const first = botDecideAction(g, config, -Infinity, 0);
    expect(first).not.toBeNull();
    const second = botDecideAction(g, config, 0, 3);
    expect(second).toBeNull();
    const third = botDecideAction(g, config, 0, 5);
    expect(third).not.toBeNull();
  });

  it("throttles cursor travel instead of hard-stopping fire", () => {
    const config = resolveBotConfig(defaultConfig, "average");
    config.humanization.startWave = 1;
    makeHumanInstant(config.humanization);
    config.humanization.cursorSpeedPxPerTick = 10;
    config.humanization.cursorTrackSpeedPxPerTick = 10;
    config.humanization.movementFireThrottleMultiplier = 0.4;
    config.targeting.cooldownNormal = 0;
    config.targeting.cooldownHighThreat = 0;
    config.targeting.cooldownLowAmmo = 0;

    const g = makeGame();
    g.missiles = [
      {
        alive: true,
        x: 860,
        y: 120,
        vx: 0,
        vy: 1,
        accel: 1,
        type: "missile" as const,
        trail: [],
      },
    ];

    const first = botDecideAction(g, config, -Infinity, 0);
    expect(first).not.toBeNull();
    expect(botDecideAction(g, config, 0, 20)).toBeNull();
    const action = botDecideAction(g, config, 0, 40);
    expect(action).not.toBeNull();
  });
});

describe("botDecideAction jet reservations", () => {
  it("does not immediately refire at the same shahed238 once a shot is committed", () => {
    const config = resolveBotConfig(defaultConfig, "perfect");
    const jet = {
      alive: true,
      x: 200,
      y: 140,
      vx: 7,
      vy: 0.6,
      pathIndex: 8,
      waypoints: [
        { x: 120, y: 120 },
        { x: 160, y: 128 },
        { x: 200, y: 140 },
        { x: 260, y: 170 },
        { x: 320, y: 240 },
        { x: 360, y: 340 },
      ],
      type: "drone",
      subtype: "shahed238",
      empSlowTimer: 0,
    };
    const g = {
      wave: 7,
      ammo: [10, 10, 10],
      launcherHP: [1, 1, 1],
      interceptors: [],
      missiles: [],
      drones: [jet],
      planes: [],
    } as unknown as GameState;

    const first = botDecideAction(g, config, 0, 100);
    expect(first).not.toBeNull();
    expect(first!.targetRef).toBe(jet);
    reserveBotTarget(g, first!.targetRef, first!.reservationUntil ?? 100, 100);

    const second = botDecideAction(g, config, 100, 130);
    expect(second).toBeNull();
  });
});
