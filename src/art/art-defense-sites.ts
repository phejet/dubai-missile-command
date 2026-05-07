import { buildStaticSpriteAsset } from "./art-core";
import type { DefenseSiteAssets, PlaneAssets } from "./art-core";

const PATRIOT_TEL_BOUNDS = { x: -18, y: -22, width: 36, height: 27 } as const;
const PHALANX_BASE_BOUNDS = { x: -7, y: -7, width: 14, height: 18 } as const;
const WILD_HORNETS_HIVE_BOUNDS = { x: -16, y: -15, width: 32, height: 21 } as const;
const ROADRUNNER_CONTAINER_BOUNDS = { x: -15, y: -13, width: 30, height: 17 } as const;
const FLARE_DISPENSER_BOUNDS = { x: -10, y: -5, width: 20, height: 10 } as const;
const EMP_EMITTER_BOUNDS = { x: -10, y: -10, width: 20, height: 20 } as const;
const PATRIOT_TEL_SCALE = 3;
const HIVE_SCALE = 3;
const ROADRUNNER_CONTAINER_SCALE = 3;
const PHALANX_BASE_SCALE = 1;
const FLARE_DISPENSER_SCALE = 1;
const EMP_EMITTER_SCALE = 1;


function drawPatriotTELLocal(ctx: CanvasRenderingContext2D) {
  // Truck body
  ctx.fillStyle = "#3a4a30";
  ctx.fillRect(-16, -5, 32, 7);
  // Cab
  ctx.fillStyle = "#4a5a40";
  ctx.fillRect(-16, -9, 8, 5);
  ctx.fillStyle = "#6a8a60";
  ctx.fillRect(-15, -8, 4, 2);
  // Angled launcher arm
  ctx.save();
  ctx.translate(4, -5);
  ctx.rotate(-0.45);
  ctx.fillStyle = "#4a5a3a";
  ctx.fillRect(-3, -16, 6, 14);
  ctx.fillStyle = "#3a4830";
  ctx.fillRect(-2, -16, 2, 6);
  ctx.fillRect(0.5, -16, 2, 6);
  ctx.shadowColor = "#88ff44";
  ctx.shadowBlur = 2;
  ctx.fillStyle = "#88ff44";
  ctx.fillRect(-1.5, -17, 1.5, 1.5);
  ctx.fillRect(1, -17, 1.5, 1.5);
  ctx.shadowBlur = 0;
  ctx.restore();
  // Wheels
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(-12, 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-6, 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(8, 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(14, 1, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawPhalanxBaseLocal(ctx: CanvasRenderingContext2D) {
  // Origin at turret pivot (top of base). Base extends downward, dome extends upward.
  ctx.fillStyle = "#556677";
  ctx.fillRect(-6, 0, 12, 10);
  ctx.fillStyle = "#778899";
  ctx.fillRect(-4, -6, 8, 8);
}

function drawWildHornetsHiveLocal(ctx: CanvasRenderingContext2D, level: number) {
  const cellR = 5;
  const cells = [
    { x: 0, y: -8 },
    { x: -6, y: -4.5 },
    { x: 6, y: -4.5 },
    { x: -3, y: -1 },
    { x: 3, y: -1 },
  ];
  const filledCells = [2, 3, 5][Math.max(0, Math.min(2, level - 1))];
  // Base platform
  ctx.fillStyle = "#2a2a20";
  ctx.fillRect(-14, -1, 28, 4);
  cells.forEach((c, i) => {
    ctx.strokeStyle = "#6a6a40";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let a = 0; a < 6; a++) {
      const angle = (Math.PI / 3) * a - Math.PI / 6;
      const px = c.x + cellR * Math.cos(angle);
      const py = c.y + cellR * Math.sin(angle);
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = i < filledCells ? "#1a1a10" : "#222218";
    ctx.fill();
    ctx.stroke();
    if (i < filledCells) {
      ctx.shadowColor = "#ffcc00";
      ctx.shadowBlur = 3;
      ctx.fillStyle = "#ffcc00";
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 2.5);
      ctx.lineTo(c.x + 2, c.y + 1.5);
      ctx.lineTo(c.x, c.y + 0.5);
      ctx.lineTo(c.x - 2, c.y + 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
}

function drawRoadrunnerContainerLocal(ctx: CanvasRenderingContext2D, level: number) {
  const rrCount = Math.max(1, Math.min(level, 3));
  // Container walls (3 walls, no top)
  ctx.fillStyle = "#1e2e3e";
  ctx.fillRect(-14, -10, 2, 12);
  ctx.fillRect(12, -10, 2, 12);
  ctx.fillRect(-14, 0, 28, 2);
  // Back wall
  ctx.fillStyle = "#162636";
  ctx.fillRect(-12, -10, 24, 2);
  // Missiles inside
  for (let i = 0; i < rrCount; i++) {
    ctx.fillStyle = "#2c4760";
    ctx.fillRect(-9 + i * 8, -9, 4, 9);
    ctx.shadowColor = "#44aaff";
    ctx.shadowBlur = 2;
    ctx.fillStyle = "#44aaff";
    ctx.beginPath();
    ctx.moveTo(-7 + i * 8, -12);
    ctx.lineTo(-9 + i * 8, -9);
    ctx.lineTo(-5 + i * 8, -9);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // Blue accent stripe
  ctx.fillStyle = "#44aaff";
  ctx.globalAlpha = 0.3;
  ctx.fillRect(-14, -1, 28, 1.5);
  ctx.globalAlpha = 1;
  // Base legs
  ctx.fillStyle = "#2a3a4a";
  ctx.fillRect(-12, 1, 4, 2);
  ctx.fillRect(8, 1, 4, 2);
}

function drawFlareDispenserLocal(ctx: CanvasRenderingContext2D, level: number) {
  // Anchor (0,0) is the flare-emitter centerline on the Burj (BURJ_X, flareY).
  const towerHW = 3.5;
  // Left panel
  ctx.fillStyle = "#8a7a68";
  ctx.fillRect(-towerHW - 4, -4, 4, 8);
  ctx.fillStyle = "#ff9944";
  const leftTubes = Math.min(level, 2);
  for (let i = 0; i < leftTubes; i++) {
    ctx.fillRect(-towerHW - 3.5, -3 + i * 4, 3, 2);
  }
  // Right panel
  ctx.fillStyle = "#8a7a68";
  ctx.fillRect(towerHW, -4, 4, 8);
  ctx.fillStyle = "#ff9944";
  const rightTubes = level >= 2 ? level - 1 : 0;
  for (let i = 0; i < rightTubes; i++) {
    ctx.fillRect(towerHW + 0.5, -3 + i * 4, 3, 2);
  }
}

function drawEmpEmitterLocal(ctx: CanvasRenderingContext2D, level: number) {
  // Anchor (0,0) is the emitter center on the Burj (BURJ_X, empY).
  const nodeCount = level + 1;
  // Mounting ring
  ctx.strokeStyle = "#7a5a9a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.stroke();
  // Coil nodes
  ctx.fillStyle = "#8866aa";
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
    const nx = Math.cos(angle) * 7;
    const ny = Math.sin(angle) * 7;
    ctx.beginPath();
    ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Center core
  ctx.fillStyle = "#6644aa";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
}

const F15_AIRFRAME_BOUNDS = { x: -23, y: -17, width: 54, height: 34 } as const;
const F15_AIRFRAME_SCALE = 1;

function drawF15AirframeLocal(ctx: CanvasRenderingContext2D) {
  // Fuselage
  ctx.fillStyle = "#7888a0";
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(10, -3);
  ctx.lineTo(-18, -3.5);
  ctx.lineTo(-22, -2);
  ctx.lineTo(-22, 2);
  ctx.lineTo(-18, 3.5);
  ctx.lineTo(10, 3);
  ctx.closePath();
  ctx.fill();
  // Nose cone
  ctx.fillStyle = "#5a6a80";
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(30, 0);
  ctx.lineTo(22, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(30, 0);
  ctx.lineTo(22, 1.5);
  ctx.closePath();
  ctx.fill();
  // Swept wings
  ctx.fillStyle = "#687890";
  ctx.beginPath();
  ctx.moveTo(2, -3);
  ctx.lineTo(-8, -16);
  ctx.lineTo(-14, -14);
  ctx.lineTo(-6, -3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, 3);
  ctx.lineTo(-8, 16);
  ctx.lineTo(-14, 14);
  ctx.lineTo(-6, 3);
  ctx.closePath();
  ctx.fill();
  // Twin vertical stabilizers
  ctx.fillStyle = "#5a6878";
  ctx.beginPath();
  ctx.moveTo(-16, -3.5);
  ctx.lineTo(-20, -10);
  ctx.lineTo(-22, -9);
  ctx.lineTo(-20, -3.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-16, 3.5);
  ctx.lineTo(-20, 10);
  ctx.lineTo(-22, 9);
  ctx.lineTo(-20, 3.5);
  ctx.closePath();
  ctx.fill();
  // Engine nozzles
  ctx.fillStyle = "#4a5060";
  ctx.beginPath();
  ctx.ellipse(-22, -2, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-22, 2, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cockpit
  ctx.fillStyle = "rgba(100,200,255,0.4)";
  ctx.beginPath();
  ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function buildPlaneAssets(): PlaneAssets {
  return {
    f15Airframe: buildStaticSpriteAsset(F15_AIRFRAME_SCALE, F15_AIRFRAME_BOUNDS, drawF15AirframeLocal),
  };
}

export function buildDefenseSiteAssets(): DefenseSiteAssets {
  const hiveLevels = [1, 2, 3].map((lvl) =>
    buildStaticSpriteAsset(HIVE_SCALE, WILD_HORNETS_HIVE_BOUNDS, (ctx) => drawWildHornetsHiveLocal(ctx, lvl)),
  ) as DefenseSiteAssets["wildHornetsHive"];
  const rrLevels = [1, 2, 3].map((lvl) =>
    buildStaticSpriteAsset(ROADRUNNER_CONTAINER_SCALE, ROADRUNNER_CONTAINER_BOUNDS, (ctx) =>
      drawRoadrunnerContainerLocal(ctx, lvl),
    ),
  ) as DefenseSiteAssets["roadrunnerContainer"];
  const flareLevels = [1, 2, 3].map((lvl) =>
    buildStaticSpriteAsset(FLARE_DISPENSER_SCALE, FLARE_DISPENSER_BOUNDS, (ctx) => drawFlareDispenserLocal(ctx, lvl)),
  ) as DefenseSiteAssets["flareDispenser"];
  const empLevels = [1, 2, 3].map((lvl) =>
    buildStaticSpriteAsset(EMP_EMITTER_SCALE, EMP_EMITTER_BOUNDS, (ctx) => drawEmpEmitterLocal(ctx, lvl)),
  ) as DefenseSiteAssets["empEmitter"];
  return {
    patriotTEL: buildStaticSpriteAsset(PATRIOT_TEL_SCALE, PATRIOT_TEL_BOUNDS, drawPatriotTELLocal),
    phalanxBase: buildStaticSpriteAsset(PHALANX_BASE_SCALE, PHALANX_BASE_BOUNDS, drawPhalanxBaseLocal),
    wildHornetsHive: hiveLevels,
    roadrunnerContainer: rrLevels,
    flareDispenser: flareLevels,
    empEmitter: empLevels,
  };
}
