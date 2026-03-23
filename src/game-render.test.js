import { describe, it, expect, beforeEach } from "vitest";
import { drawGame, drawTitle, drawGameOver, glow, glowOff, hash01, pulse, perfState } from "./game-render.js";
import { setRng } from "./game-logic.js";
import { mulberry32 } from "./headless/rng.js";
import { initGame } from "./game-sim.js";

/** Stub CanvasRenderingContext2D — all methods are no-ops, properties are writable */
function mockCanvasContext() {
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
  ];

  const ctx = {};
  const callLog = [];

  for (const m of methods) {
    if (m === "measureText") {
      ctx[m] = () => ({ width: 50 });
    } else if (m === "createLinearGradient" || m === "createRadialGradient") {
      ctx[m] = () => ({ addColorStop: () => {} });
    } else if (m === "getLineDash") {
      ctx[m] = () => [];
    } else {
      ctx[m] = (...args) => callLog.push({ method: m, args });
    }
  }

  // Writable properties
  ctx.fillStyle = "";
  ctx.strokeStyle = "";
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "";
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineDashOffset = 0;
  ctx.canvas = { width: 900, height: 640 };

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
    expect(ctx.shadowBlur).toBe(10);
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
  let gameState;

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
      type: "ballistic",
      trail: [{ x: 400, y: 90 }],
      glow: 0,
      targetX: 460,
      targetY: 570,
    });
    gameState.drones.push({
      x: 300,
      y: 200,
      vx: 1,
      vy: 0.5,
      alive: true,
      health: 2,
      maxHealth: 2,
      subtype: "shahed136",
      wobble: 0,
      propAngle: 0,
      trail: [],
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

  it("does not throw with showShop true", () => {
    const { ctx } = mockCanvasContext();
    expect(() => drawGame(ctx, gameState, { showShop: true })).not.toThrow();
  });
});

// ── drawTitle ──

describe("drawTitle", () => {
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
