import { describe, it, expect, beforeEach, vi } from "vitest";
import { GAMEPLAY_SCENIC_BASE_Y, GAMEPLAY_SCENIC_GROUND_Y, GROUND_Y, setRng } from "./game-logic.js";
import { buildBuildingAssets } from "./art-render.js";
import {
  __getBurjAssetCacheKeysForTest,
  __getBurjAssetsForTest,
  __getInterceptorSpriteAssetsForTest,
  __getInterceptorSpriteCacheKeysForTest,
  __getLauncherAssetCacheKeysForTest,
  __getLauncherAssetsForTest,
  __getTitleShahedBeaconAlphaForTest,
  __getTitleThreatAnimationTimeForTest,
  __getThreatSpriteAssetsForTest,
  __getThreatSpriteCacheKeysForTest,
  __resetRenderAssetCachesForTest,
  drawGame,
  drawTitle,
  drawGameOver,
  glow,
  glowOff,
  hash01,
  preloadRenderAssets,
  pulse,
  perfState,
} from "./game-render.js";
import { mulberry32 } from "./headless/rng.js";
import { initGame } from "./game-sim.js";
import type { GameState } from "./types";

const DEFAULT_GAMEPLAY_LAUNCHER_SCALE = 0.8 + 3 * 0.06;
const DEFAULT_THREAT_SPRITE_SCALE = 3;
const DEFAULT_INTERCEPTOR_SPRITE_SCALE = 2;

type CallEntry = { method: string; args: unknown[] };
type MockCtx = CanvasRenderingContext2D & Record<string, unknown>;

/** Stub CanvasRenderingContext2D — all methods are no-ops, properties are writable */
function mockCanvasContext(): { ctx: MockCtx; callLog: CallEntry[] } {
  const methods = [
    "fillRect",
    "strokeRect",
    "clearRect",
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "arc",
    "arcTo",
    "quadraticCurveTo",
    "bezierCurveTo",
    "rect",
    "fill",
    "stroke",
    "clip",
    "save",
    "restore",
    "translate",
    "rotate",
    "scale",
    "setTransform",
    "resetTransform",
    "drawImage",
    "fillText",
    "strokeText",
    "measureText",
    "createLinearGradient",
    "createRadialGradient",
    "setLineDash",
    "getLineDash",
    "ellipse",
    "roundRect",
  ];

  const raw: Record<string, unknown> = {};
  const callLog: CallEntry[] = [];

  for (const m of methods) {
    if (m === "measureText") {
      raw[m] = () => ({ width: 50 });
    } else if (m === "createLinearGradient" || m === "createRadialGradient") {
      raw[m] = () => ({ addColorStop: () => {} });
    } else if (m === "getLineDash") {
      raw[m] = () => [];
    } else {
      raw[m] = (...args: unknown[]) => callLog.push({ method: m, args });
    }
  }

  // Writable properties
  raw.fillStyle = "";
  raw.strokeStyle = "";
  raw.lineWidth = 1;
  raw.lineCap = "butt";
  raw.lineJoin = "miter";
  raw.globalAlpha = 1;
  raw.globalCompositeOperation = "source-over";
  raw.font = "";
  raw.textAlign = "start";
  raw.textBaseline = "alphabetic";
  raw.shadowColor = "transparent";
  raw.shadowBlur = 0;
  raw.shadowOffsetX = 0;
  raw.shadowOffsetY = 0;
  raw.lineDashOffset = 0;
  raw.canvas = { width: 900, height: 640 };

  const ctx = raw as unknown as MockCtx;
  return { ctx, callLog };
}

// ── hash01 ──

describe("hash01", () => {
  it("returns a value in [0, 1)", () => {
    for (let i = 0; i < 100; i++) {
      const v = hash01(i, i * 3, i * 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic", () => {
    expect(hash01(5, 10, 15)).toBe(hash01(5, 10, 15));
  });

  it("different inputs produce different outputs", () => {
    const a = hash01(1, 2, 3);
    const b = hash01(4, 5, 6);
    expect(a).not.toBe(b);
  });

  it("works with default args", () => {
    const v = hash01(42);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

// ── pulse ──

describe("pulse", () => {
  it("returns value within [min, max]", () => {
    for (let t = 0; t < 100; t += 0.1) {
      const v = pulse(t, 1, 0, 0.2, 0.8);
      expect(v).toBeGreaterThanOrEqual(0.2 - 1e-10);
      expect(v).toBeLessThanOrEqual(0.8 + 1e-10);
    }
  });

  it("default args return value in [0, 1]", () => {
    const v = pulse(1.0, 2.0);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

// ── glow / glowOff ──

describe("glow and glowOff", () => {
  it("glow sets shadowColor and shadowBlur", () => {
    const { ctx } = mockCanvasContext();
    perfState.glowEnabled = true;
    glow(ctx, "#ff0000", 10);
    expect(ctx.shadowColor).toBe("#ff0000");
    expect(ctx.shadowBlur).toBeCloseTo(10 * 0.45);
  });

  it("glowOff clears shadowBlur", () => {
    const { ctx } = mockCanvasContext();
    perfState.glowEnabled = true;
    glow(ctx, "#ff0000", 10);
    glowOff(ctx);
    expect(ctx.shadowBlur).toBe(0);
  });

  it("glow is no-op when glowEnabled is false", () => {
    const { ctx } = mockCanvasContext();
    perfState.glowEnabled = false;
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    glow(ctx, "#ff0000", 10);
    expect(ctx.shadowColor).toBe("transparent");
    expect(ctx.shadowBlur).toBe(0);
  });

  it("glowOff is no-op when glowEnabled is false", () => {
    const { ctx } = mockCanvasContext();
    perfState.glowEnabled = false;
    ctx.shadowBlur = 5;
    glowOff(ctx);
    expect(ctx.shadowBlur).toBe(5);
  });
});

// ── drawGame ──

describe("drawGame", () => {
  let gameState: GameState;

  beforeEach(() => {
    setRng(mulberry32(42));
    gameState = initGame();
    // Advance time so drawing has something to render
    gameState.time = 1000;
    perfState.glowEnabled = true;
  });

  it("does not throw with valid game state", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawGame(ctx, gameState, { showShop: false })).not.toThrow();
  });

  it("supports portrait layout profiles without the desktop HUD", () => {
    const { ctx } = mockCanvasContext();
    expect(() =>
      drawGame(ctx, gameState, {
        showShop: false,
        layoutProfile: { showTopHud: false, showSystemLabels: false, crosshairArmLength: 24 },
      }),
    ).not.toThrow();
  });

  it("supports a fixed portrait combat camera", () => {
    const { ctx } = mockCanvasContext();
    expect(() =>
      drawGame(ctx, gameState, {
        showShop: false,
        layoutProfile: {
          showTopHud: false,
          cameraFrame: { scale: 1.12, left: 48, top: 64 },
        },
      }),
    ).not.toThrow();
  });

  it("supports injected baked building assets", () => {
    const { ctx } = mockCanvasContext();
    const buildingAssets = buildBuildingAssets(GAMEPLAY_SCENIC_BASE_Y);
    expect(() => drawGame(ctx, gameState, { showShop: false, buildingAssets })).not.toThrow();
  });

  it("calls canvas drawing methods", () => {
    const { ctx, callLog } = mockCanvasContext();
    drawGame(ctx, gameState, { showShop: false });
    expect(callLog.length).toBeGreaterThan(10);
    const methods = new Set(callLog.map((c) => c.method));
    expect(methods.has("fillRect")).toBe(true);
    expect(methods.has("beginPath")).toBe(true);
  });

  it("does not throw when game has active entities", () => {
    const { ctx } = mockCanvasContext();
    gameState.missiles.push({
      x: 400,
      y: 100,
      vx: 0,
      vy: 1,
      alive: true,
      accel: 0,
      type: "missile",
      trail: [{ x: 400, y: 90 }],
    });
    gameState.drones.push({
      x: 300,
      y: 200,
      vx: 1,
      vy: 0.5,
      alive: true,
      health: 2,
      type: "drone",
      subtype: "shahed136",
      collisionRadius: 30,
      wobble: 0,
    });
    gameState.explosions.push({
      x: 500,
      y: 300,
      radius: 20,
      maxRadius: 40,
      growing: true,
      alpha: 1,
      color: "#ffaa00",
      playerCaused: true,
      harmless: false,
      chain: false,
      rootExplosionId: null,
      ringRadius: 0,
      ringAlpha: 0,
      id: 1,
    });
    gameState.interceptors.push({
      x: 100,
      y: 500,
      vx: 0,
      vy: -3,
      targetX: 400,
      targetY: 100,
      alive: true,
      trail: [],
    });
    expect(() => drawGame(ctx, gameState, { showShop: false })).not.toThrow();
  });

  it("renders live gameplay variants without warming baked projectile or structure caches", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();

    gameState.missiles.push(
      {
        x: 410,
        y: 96,
        vx: 0.25,
        vy: 1.2,
        alive: true,
        accel: 1.01,
        type: "mirv",
        health: 2,
        maxHealth: 3,
        trail: [{ x: 408, y: 84 }],
      },
      {
        x: 438,
        y: 132,
        vx: 0.5,
        vy: 1.1,
        alive: true,
        accel: 1.02,
        type: "mirv_warhead",
        trail: [{ x: 435, y: 121 }],
      },
      {
        x: 466,
        y: 168,
        vx: 0.65,
        vy: 1.15,
        alive: true,
        accel: 1.01,
        type: "bomb",
        trail: [{ x: 462, y: 156 }],
      },
      {
        x: 494,
        y: 204,
        vx: 0.55,
        vy: 1.05,
        alive: true,
        accel: 1.01,
        type: "stack2",
        trail: [{ x: 490, y: 193 }],
      },
      {
        x: 522,
        y: 240,
        vx: 0.7,
        vy: 1.1,
        alive: true,
        accel: 1.01,
        type: "stack3",
        trail: [{ x: 517, y: 228 }],
      },
      {
        x: 550,
        y: 276,
        vx: 0.8,
        vy: 1.2,
        alive: true,
        accel: 1.01,
        type: "stack_child",
        trail: [{ x: 544, y: 263 }],
      },
    );
    gameState.drones.push(
      {
        x: 260,
        y: 248,
        vx: 1.2,
        vy: 0.15,
        alive: true,
        health: 1,
        type: "drone",
        subtype: "shahed136",
        collisionRadius: 24,
        wobble: 0,
        trail: [{ x: 248, y: 247 }],
      },
      {
        x: 286,
        y: 292,
        vx: 1.45,
        vy: 0.7,
        alive: true,
        health: 2,
        type: "drone",
        subtype: "shahed238",
        collisionRadius: 28,
        wobble: 0,
        diving: true,
        trail: [{ x: 272, y: 284 }],
      },
    );
    gameState.interceptors.push(
      {
        x: 120,
        y: 560,
        vx: 0.1,
        vy: -3.2,
        targetX: 410,
        targetY: 96,
        alive: true,
        trail: [{ x: 118, y: 573 }],
      },
      {
        x: 720,
        y: 406,
        vx: -2.8,
        vy: -0.45,
        targetX: 494,
        targetY: 204,
        alive: true,
        trail: [{ x: 735, y: 409 }],
        fromF15: true,
      },
    );

    expect(() => drawGame(ctx, gameState, { showShop: false, renderMode: "live" })).not.toThrow();
    expect(__getBurjAssetCacheKeysForTest()).toEqual([]);
    expect(__getLauncherAssetCacheKeysForTest()).toEqual([]);
    expect(__getThreatSpriteCacheKeysForTest()).toEqual([]);
    expect(__getInterceptorSpriteCacheKeysForTest()).toEqual([]);
  });

  it("does not throw with showShop true", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawGame(ctx, gameState, { showShop: true })).not.toThrow();
  });

  it("warms the gameplay Burj asset cache entry", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();

    drawGame(ctx, gameState, { showShop: false });

    expect(__getBurjAssetCacheKeysForTest()).toContain(`${GAMEPLAY_SCENIC_GROUND_Y}:2`);
  });

  it("warms the gameplay launcher asset cache entry", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();

    drawGame(ctx, gameState, { showShop: false });

    expect(__getLauncherAssetCacheKeysForTest()).toContain(`${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:0`);
  });

  it("warms the damaged gameplay launcher asset cache entry", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();
    gameState.upgrades.launcherKit = 2;

    drawGame(ctx, gameState, { showShop: false });

    expect(__getLauncherAssetCacheKeysForTest()).toContain(`${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:1`);
  });

  it("warms the gameplay threat sprite cache entry", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();

    drawGame(ctx, gameState, { showShop: false });

    expect(__getThreatSpriteCacheKeysForTest()).toContain(DEFAULT_THREAT_SPRITE_SCALE.toFixed(3));
  });

  it("warms the gameplay interceptor sprite cache entry", () => {
    const { ctx } = mockCanvasContext();
    __resetRenderAssetCachesForTest();

    drawGame(ctx, gameState, { showShop: false });

    expect(__getInterceptorSpriteCacheKeysForTest()).toContain(DEFAULT_INTERCEPTOR_SPRITE_SCALE.toFixed(3));
  });
});

// ── drawTitle ──

describe("drawTitle", () => {
  beforeEach(() => {
    __resetRenderAssetCachesForTest();
  });

  it("does not throw", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawTitle(ctx)).not.toThrow();
  });

  it("draws to the canvas", () => {
    const { ctx, callLog } = mockCanvasContext();
    drawTitle(ctx);
    expect(callLog.length).toBeGreaterThan(0);
  });

  it("supports an external title layout", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawTitle(ctx, { layoutProfile: { externalTitle: true } })).not.toThrow();
  });

  it("supports live title skyline rendering", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawTitle(ctx, { skylineRenderMode: "live" })).not.toThrow();
  });

  it("supports sharp baked title skyline rendering", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawTitle(ctx, { skylineRenderMode: "bakedSharp" })).not.toThrow();
  });

  it("keeps title threat animation time in seconds instead of 60fps frame units", () => {
    expect(__getTitleThreatAnimationTimeForTest(1, "shahed", 1)).toBeCloseTo(1.8 + 7 / 60);
    expect(__getTitleThreatAnimationTimeForTest(1, "missile", 2)).toBeCloseTo(2.4 + (2 * 5) / 60);
  });

  it("blinks title Shahed beacon light across time", () => {
    const samples = Array.from({ length: 20 }, (_, index) => __getTitleShahedBeaconAlphaForTest(index / 10, 0));

    expect(samples.some((alpha) => alpha === 0)).toBe(true);
    expect(samples.some((alpha) => alpha > 0.5)).toBe(true);
  });

  it("warms the title Burj asset cache entry", () => {
    const { ctx } = mockCanvasContext();

    drawTitle(ctx);

    expect(__getBurjAssetCacheKeysForTest()).toContain(`${GROUND_Y - 100}:2`);
  });

  it("warms the baked title launcher asset cache entry", () => {
    const { ctx } = mockCanvasContext();

    drawTitle(ctx);

    expect(__getLauncherAssetCacheKeysForTest()).toContain("1.000:0");
  });

  it("keeps title launchers live when the title skyline is live", () => {
    const { ctx } = mockCanvasContext();

    drawTitle(ctx, { skylineRenderMode: "live" });

    expect(__getLauncherAssetCacheKeysForTest()).toEqual([]);
  });

  it("keeps title threat sprites live when the title skyline is live", () => {
    const { ctx } = mockCanvasContext();

    drawTitle(ctx, { skylineRenderMode: "live" });

    expect(__getThreatSpriteCacheKeysForTest()).toEqual([]);
  });

  it("cycles through the full baked shahed animation across one second of title rendering", () => {
    const { ctx, callLog } = mockCanvasContext();
    const assets = __getThreatSpriteAssetsForTest(DEFAULT_THREAT_SPRITE_SCALE);
    const frameIndexByCanvas = new Map(assets.shahed136.animFrames.map((frame, index) => [frame, index]));
    const nowSpy = vi.spyOn(performance, "now");
    const seenFrameIndices = new Set<number>();

    try {
      for (let frame = 0; frame < 60; frame++) {
        callLog.length = 0;
        nowSpy.mockReturnValue(frame * (1000 / 60));
        drawTitle(ctx, { skylineRenderMode: "bakedSharp" });
        for (const call of callLog) {
          if (call.method !== "drawImage") continue;
          const frameIndex = frameIndexByCanvas.get(call.args[0] as HTMLCanvasElement);
          if (frameIndex !== undefined) seenFrameIndices.add(frameIndex);
        }
      }
    } finally {
      nowSpy.mockRestore();
    }

    expect(seenFrameIndices).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });
});

describe("Burj asset cache", () => {
  beforeEach(() => {
    __resetRenderAssetCachesForTest();
  });

  it("reuses assets for the same groundY and artScale", () => {
    const first = __getBurjAssetsForTest(GROUND_Y - 100, 2);
    const second = __getBurjAssetsForTest(GROUND_Y - 100, 2);

    expect(first).toBe(second);
    expect(__getBurjAssetCacheKeysForTest()).toEqual([`${GROUND_Y - 100}:2`]);
  });

  it("stores distinct cache entries for the title and gameplay variants", () => {
    __getBurjAssetsForTest(GROUND_Y - 100, 2);
    __getBurjAssetsForTest(GAMEPLAY_SCENIC_GROUND_Y, 2);

    expect(__getBurjAssetCacheKeysForTest()).toEqual([`${GAMEPLAY_SCENIC_GROUND_Y}:2`, `${GROUND_Y - 100}:2`]);
  });

  it("preloads both Burj cache variants", () => {
    preloadRenderAssets();

    expect(__getBurjAssetCacheKeysForTest()).toEqual([`${GAMEPLAY_SCENIC_GROUND_Y}:2`, `${GROUND_Y - 100}:2`]);
  });
});

describe("launcher asset cache", () => {
  beforeEach(() => {
    __resetRenderAssetCachesForTest();
  });

  it("reuses assets for the same scale and damage state", () => {
    const first = __getLauncherAssetsForTest(1, false);
    const second = __getLauncherAssetsForTest(1, false);

    expect(first).toBe(second);
    expect(__getLauncherAssetCacheKeysForTest()).toEqual(["1.000:0"]);
  });

  it("stores distinct cache entries for clean and damaged variants", () => {
    __getLauncherAssetsForTest(DEFAULT_GAMEPLAY_LAUNCHER_SCALE, false);
    __getLauncherAssetsForTest(DEFAULT_GAMEPLAY_LAUNCHER_SCALE, true);

    expect(__getLauncherAssetCacheKeysForTest()).toEqual([
      `${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:0`,
      `${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:1`,
    ]);
  });

  it("preloads common gameplay and title launcher variants", () => {
    preloadRenderAssets();

    expect(__getLauncherAssetCacheKeysForTest()).toEqual([
      `${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:0`,
      `${DEFAULT_GAMEPLAY_LAUNCHER_SCALE.toFixed(3)}:1`,
      "1.000:0",
    ]);
  });
});

describe("projectile sprite caches", () => {
  beforeEach(() => {
    __resetRenderAssetCachesForTest();
  });

  it("reuses threat sprite assets for the same scale", () => {
    const first = __getThreatSpriteAssetsForTest(DEFAULT_THREAT_SPRITE_SCALE);
    const second = __getThreatSpriteAssetsForTest(DEFAULT_THREAT_SPRITE_SCALE);

    expect(first).toBe(second);
    expect(__getThreatSpriteCacheKeysForTest()).toEqual([DEFAULT_THREAT_SPRITE_SCALE.toFixed(3)]);
  });

  it("reuses interceptor sprite assets for the same scale", () => {
    const first = __getInterceptorSpriteAssetsForTest(DEFAULT_INTERCEPTOR_SPRITE_SCALE);
    const second = __getInterceptorSpriteAssetsForTest(DEFAULT_INTERCEPTOR_SPRITE_SCALE);

    expect(first).toBe(second);
    expect(__getInterceptorSpriteCacheKeysForTest()).toEqual([DEFAULT_INTERCEPTOR_SPRITE_SCALE.toFixed(3)]);
  });

  it("preloads common gameplay projectile sprite variants", () => {
    preloadRenderAssets();

    expect(__getThreatSpriteCacheKeysForTest()).toEqual([DEFAULT_THREAT_SPRITE_SCALE.toFixed(3)]);
    expect(__getInterceptorSpriteCacheKeysForTest()).toEqual([DEFAULT_INTERCEPTOR_SPRITE_SCALE.toFixed(3)]);
  });
});

// ── drawGameOver ──

describe("drawGameOver", () => {
  it("does not throw with valid args", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawGameOver(ctx, 5000, 8, { missileKills: 30, droneKills: 10, shotsFired: 50 })).not.toThrow();
  });

  it("draws to the canvas", () => {
    const { ctx, callLog } = mockCanvasContext();
    drawGameOver(ctx, 5000, 8, { missileKills: 30, droneKills: 10, shotsFired: 50 });
    expect(callLog.length).toBeGreaterThan(0);
  });

  it("handles zero stats without throwing", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawGameOver(ctx, 0, 1, { missileKills: 0, droneKills: 0, shotsFired: 0 })).not.toThrow();
  });

  it("supports an external mobile summary layout", () => {
    const { ctx } = mockCanvasContext();
    expect(() =>
      drawGameOver(
        ctx,
        5000,
        8,
        { missileKills: 30, droneKills: 10, shotsFired: 50 },
        { layoutProfile: { externalGameOver: true } },
      ),
    ).not.toThrow();
  });
});
