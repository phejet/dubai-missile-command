import { CANVAS_W, BURJ_H, BURJ_X, SCENIC_BUILDING_LAYOUT } from "./game-logic";
import type { Building, Star } from "./types";

const SKY_FRAME_COUNT = 8;
const SKY_PERIOD_SECONDS = 24;
const GAME_TITLE_STARFIELD_DENSITY = 260;
const HERO_STAR_THRESHOLD = 0.72;
const BURJ_ANIM_FRAME_COUNT = 8;
const BURJ_ANIM_PERIOD_SECONDS = 20;
const LAUNCHER_ANIM_FRAME_COUNT = 8;
const LAUNCHER_ANIM_PERIOD_SECONDS = 10;
const GLOW_MARGIN = 80;
const GAMEPLAY_BUILDING_ANIM_FRAME_COUNT = 8;
const GAMEPLAY_BUILDING_ANIM_PERIOD_SECONDS = 20;
const TITLE_BUILDING_ANIM_FRAME_COUNT = 8;
const TITLE_BUILDING_BAKE_PERIOD_SECONDS = 40;
const TITLE_BUILDING_LIT_THRESHOLD = 0.08;
const ARCADE_FONT_FAMILY = "'Courier New', monospace";
const PROJECTILE_ANIM_FRAME_COUNT = 8;

export interface SkyAssets {
  frames: HTMLCanvasElement[];
  frameCount: number;
  period: number;
}

export interface BurjAssets {
  staticSprite: HTMLCanvasElement;
  animFrames: HTMLCanvasElement[];
  offset: { x: number; y: number };
  frameCount: number;
  period: number;
  resolutionScale: number;
}

export interface BuildingAssets {
  staticSprites: HTMLCanvasElement[];
  animFrames: HTMLCanvasElement[][];
  staticOffsets: Array<{ x: number; y: number }>;
  animOffsets: Array<{ x: number; y: number }>;
  frameCount: number;
  period: number;
}

export interface LauncherAssets {
  chassisStaticSprite: HTMLCanvasElement;
  chassisAnimFrames: HTMLCanvasElement[];
  chassisOffset: { x: number; y: number };
  turretSprite: HTMLCanvasElement;
  turretOffset: { x: number; y: number };
  turretPivot: { x: number; y: number };
  frameCount: number;
  period: number;
  resolutionScale: number;
  scale: number;
  damaged: boolean;
}

export type ThreatSpriteKind =
  | "missile"
  | "mirv"
  | "mirv_warhead"
  | "bomb"
  | "stack_carrier_2"
  | "stack_carrier_3"
  | "stack_child"
  | "shahed136"
  | "shahed238";

export type InterceptorSpriteKind = "playerInterceptor" | "f15Interceptor";

export type UpgradeProjectileKind = "wildHornet" | "roadrunner" | "patriotSam";

export interface ProjectileSpriteAsset {
  staticSprite: HTMLCanvasElement;
  animFrames: HTMLCanvasElement[];
  offset: { x: number; y: number };
  frameCount: number;
  period: number;
  resolutionScale: number;
  scale: number;
}

export type ThreatSpriteAssets = Record<ThreatSpriteKind, ProjectileSpriteAsset>;
export type InterceptorSpriteAssets = Record<InterceptorSpriteKind, ProjectileSpriteAsset>;
export type UpgradeProjectileSpriteAssets = Record<UpgradeProjectileKind, ProjectileSpriteAsset>;

export interface StaticSpriteAsset {
  sprite: HTMLCanvasElement;
  offset: { x: number; y: number };
  width: number;
  height: number;
  resolutionScale: number;
  scale: number;
}

export interface PlaneAssets {
  f15Airframe: StaticSpriteAsset;
}

export interface DefenseSiteAssets {
  patriotTEL: StaticSpriteAsset;
  phalanxBase: StaticSpriteAsset;
  wildHornetsHive: [StaticSpriteAsset, StaticSpriteAsset, StaticSpriteAsset];
  roadrunnerContainer: [StaticSpriteAsset, StaticSpriteAsset, StaticSpriteAsset];
  flareDispenser: [StaticSpriteAsset, StaticSpriteAsset, StaticSpriteAsset];
  empEmitter: [StaticSpriteAsset, StaticSpriteAsset, StaticSpriteAsset];
}

export interface ExplosionGlowAssets {
  light: StaticSpriteAsset;
  splash: StaticSpriteAsset;
  fireball: StaticSpriteAsset;
  core: StaticSpriteAsset;
  ring: StaticSpriteAsset;
}

export interface EmpRingAssets {
  wash: StaticSpriteAsset;
  ring: StaticSpriteAsset;
}

export interface EffectSpriteAssets {
  explosion: ExplosionGlowAssets;
  emp: EmpRingAssets;
  laserBeam: StaticSpriteAsset;
  phalanxBullet: StaticSpriteAsset;
}

export type TitleTower = {
  x: number;
  w: number;
  h: number;
  windows: number;
  profile?: "generic" | "leftLandmark" | "twinSpire" | "slantedBlock" | "eggTower" | "bladeTower";
  roof?:
    | "flat"
    | "spire"
    | "crown"
    | "slantL"
    | "slantR"
    | "needle"
    | "roundedCrownL"
    | "twinCrown"
    | "curvedR"
    | "curvedL"
    | "tapered";
  glow?: number;
};

type PreparedStar = Star & {
  seed: number;
  hero: boolean;
};

interface DrawSharedTowerOptions {
  structureOnly?: boolean;
  animOnly?: boolean;
  litOnlyAnim?: boolean;
  litThreshold?: number;
  quantizedAnim?: boolean;
}

export interface SharedLauncherOptions {
  t: number;
  scale?: number;
  alpha?: number;
  damaged?: boolean;
  active?: boolean;
  muzzleFlash?: number;
  statusLabel?: string | null;
}

const LAUNCHER_CHASSIS_BOUNDS = { x: -56, y: -30, width: 112, height: 74 } as const;
const LAUNCHER_TURRET_BOUNDS = { x: -12, y: -15, width: 56, height: 30 } as const;
const LAUNCHER_TURRET_PIVOT = { x: 2, y: -16 } as const;
type SpriteBounds = { x: number; y: number; width: number; height: number };
const DEFAULT_MISSILE_BOUNDS = { x: -34, y: -14, width: 52, height: 28 } as const;
const MIRV_BOUNDS = { x: -44, y: -20, width: 72, height: 40 } as const;
const MIRV_WARHEAD_BOUNDS = { x: -22, y: -10, width: 34, height: 20 } as const;
const BOMB_BOUNDS = { x: -12, y: -12, width: 24, height: 24 } as const;
const STACK2_BOUNDS = { x: -42, y: -16, width: 72, height: 32 } as const;
const STACK3_BOUNDS = { x: -44, y: -18, width: 76, height: 36 } as const;
const STACK_CHILD_BOUNDS = { x: -22, y: -10, width: 36, height: 20 } as const;
const SHAHED_136_BOUNDS = { x: -18, y: -14, width: 36, height: 28 } as const;
const SHAHED_238_BOUNDS = { x: -28, y: -18, width: 52, height: 36 } as const;
const PLAYER_INTERCEPTOR_BOUNDS = { x: -40, y: -12, width: 58, height: 24 } as const;
const F15_INTERCEPTOR_BOUNDS = { x: -14, y: -10, width: 24, height: 20 } as const;
const WILD_HORNET_BOUNDS = { x: -8, y: -7, width: 16, height: 13 } as const;
const ROADRUNNER_BOUNDS = { x: -7, y: -12, width: 14, height: 19 } as const;
const PATRIOT_SAM_BOUNDS = { x: -7, y: -15, width: 14, height: 26 } as const;

const UPGRADE_PROJECTILE_COLORS = {
  hornetBody: "#ffcc00",
  hornetBright: "rgba(255,244,160,0.85)",
  hornetWing: "rgba(255,204,0,0.45)",
  roadrunnerBody: "#2c4760",
  roadrunnerFin: "#7fd5ff",
  roadrunnerHighlight: "rgba(255,255,255,0.85)",
  patriotBody: "#2a5a2a",
  patriotNose: "#88ff44",
  patriotFin: "#1a4a1a",
} as const;

export const TITLE_SKYLINE_TOWERS: TitleTower[] = [...SCENIC_BUILDING_LAYOUT];

function hash01(a: number, b = 0, c = 0, d = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

function getLauncherReadyLightAlpha(time: number) {
  return 0.18 + 0.28 * (0.5 + 0.5 * Math.sin(time * 1.35 + 0.8));
}

function getLauncherChargeAlpha(time: number) {
  return 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(time * 1.6 + 0.45));
}

function getLauncherMuzzleBlink(time: number, phase = 0) {
  const blink = Math.max(0, Math.sin(time * 3.1 + phase));
  return Math.pow(blink, 0.4);
}

function getLauncherPalette(damaged: boolean) {
  return {
    base: damaged ? "#6a3028" : "#4e5e38",
    body: damaged ? "#7a3c34" : "#5c7044",
    turret: damaged ? "#8a4c44" : "#6a8050",
    tubeUpper: damaged ? "#6a3830" : "#506440",
    tubeLower: damaged ? "#6a3830" : "#445936",
    collarTop: damaged ? "#7a3c36" : "#526640",
    collarBottom: damaged ? "#562a26" : "#384a2a",
    shadow: "rgba(6, 10, 4, 0.92)",
    edge: damaged ? "rgba(240, 160, 130, 0.34)" : "rgba(190, 230, 120, 0.3)",
    chassisBloomA: damaged ? "rgba(255, 180, 140, 0.1)" : "rgba(200, 255, 180, 0.08)",
    chassisBloomB: damaged ? "rgba(220, 100, 80, 0.08)" : "rgba(120, 210, 100, 0.07)",
    readyCore: damaged ? "255, 142, 118" : "160, 244, 100",
    readyGlow: damaged ? "255, 108, 82" : "120, 220, 88",
    rimLight: damaged ? "rgba(255, 142, 120, 0.12)" : "rgba(160, 230, 100, 0.12)",
    panelFill: damaged ? "rgba(255, 100, 70, 0.12)" : "rgba(200, 240, 120, 0.14)",
    panelLine: damaged ? "rgba(130, 70, 58, 0.46)" : "rgba(90, 130, 58, 0.42)",
    ventFill: damaged ? "rgba(60, 24, 18, 0.9)" : "rgba(28, 40, 16, 0.9)",
    wheelFill: damaged ? "rgba(80, 36, 28, 0.9)" : "rgba(36, 52, 22, 0.9)",
    wheelLine: damaged ? "rgba(100, 52, 40, 0.5)" : "rgba(70, 100, 48, 0.5)",
    support: damaged ? "rgba(100, 52, 42, 0.9)" : "rgba(70, 100, 48, 0.9)",
    supportGlow: damaged ? "rgba(200, 90, 70, 0.16)" : "rgba(160, 220, 80, 0.14)",
    chargeCore: damaged ? "255, 132, 104" : "148, 236, 94",
    chargeGlow: damaged ? "214, 90, 70" : "90, 190, 60",
    muzzleCore: "255, 255, 200",
    muzzleGlow: "255, 52, 28",
  };
}

function drawLauncherWreckLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#1a1210";
  ctx.beginPath();
  ctx.moveTo(-28, 4);
  ctx.lineTo(-18, -6);
  ctx.lineTo(14, -6);
  ctx.lineTo(26, 4);
  ctx.lineTo(24, 12);
  ctx.lineTo(-24, 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(180, 50, 30, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLauncherChassisLocal(
  ctx: CanvasRenderingContext2D,
  {
    damaged,
    readyLightAlpha = 0,
    drawReadyLight = true,
  }: {
    damaged: boolean;
    readyLightAlpha?: number;
    drawReadyLight?: boolean;
  },
) {
  const palette = getLauncherPalette(damaged);

  const bloom = ctx.createRadialGradient(0, 6, 0, 0, 6, 58);
  bloom.addColorStop(0, palette.chassisBloomA);
  bloom.addColorStop(0.38, palette.chassisBloomB);
  bloom.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(-56, -30, 112, 74);

  const baseGradient = ctx.createLinearGradient(-28, 0, 28, 0);
  baseGradient.addColorStop(0, "#303e22");
  baseGradient.addColorStop(0.5, palette.base);
  baseGradient.addColorStop(1, "#2c3a1e");
  ctx.fillStyle = baseGradient;
  ctx.beginPath();
  ctx.moveTo(-30, 2);
  ctx.lineTo(-28, -2);
  ctx.lineTo(28, -2);
  ctx.lineTo(30, 2);
  ctx.lineTo(28, 14);
  ctx.lineTo(-28, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-29, 2.5);
  ctx.lineTo(-27, -1.5);
  ctx.lineTo(27, -1.5);
  ctx.lineTo(29, 2.5);
  ctx.stroke();

  ctx.fillStyle = palette.wheelFill;
  for (let i = 0; i < 7; i++) ctx.fillRect(-25 + i * 8, 5, 5, 7);
  ctx.strokeStyle = palette.wheelLine;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-26, 13);
  ctx.lineTo(26, 13);
  ctx.stroke();

  const bodyGradient = ctx.createLinearGradient(-22, -14, 22, -14);
  bodyGradient.addColorStop(0, "#384e26");
  bodyGradient.addColorStop(0.3, palette.body);
  bodyGradient.addColorStop(0.75, "#4a602e");
  bodyGradient.addColorStop(1, "#344824");
  ctx.fillStyle = bodyGradient;
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-24, -8);
  ctx.lineTo(-16, -14);
  ctx.lineTo(16, -14);
  ctx.lineTo(22, -8);
  ctx.lineTo(24, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.72;
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.lineTo(-23, -7.5);
  ctx.lineTo(-15.5, -13.5);
  ctx.lineTo(15.5, -13.5);
  ctx.lineTo(21.5, -7.5);
  ctx.stroke();

  ctx.fillStyle = palette.panelFill;
  ctx.beginPath();
  ctx.moveTo(-10, -12);
  ctx.lineTo(-6, -15);
  ctx.lineTo(8, -15);
  ctx.lineTo(12, -12);
  ctx.lineTo(10, -10);
  ctx.lineTo(-8, -10);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = palette.panelLine;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-20, -4);
  ctx.lineTo(20, -4);
  ctx.moveTo(-8, 0);
  ctx.lineTo(-8, -8);
  ctx.moveTo(8, 0);
  ctx.lineTo(8, -8);
  ctx.stroke();

  ctx.fillStyle = palette.ventFill;
  ctx.fillRect(-4, -8, 3, 3);
  ctx.fillRect(1, -8, 3, 3);

  ctx.strokeStyle = palette.support;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-24, 12);
  ctx.stroke();
  ctx.strokeStyle = palette.supportGlow;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-23, 11);
  ctx.stroke();

  const rimDir = 1;
  ctx.fillStyle = palette.rimLight;
  ctx.fillRect(rimDir * 18 - 1.2, -12, 2.4, 18);

  if (!drawReadyLight) return;

  const readyGlow = ctx.createRadialGradient(1, 2, 0, 1, 2, 10);
  readyGlow.addColorStop(0, `rgba(${palette.readyGlow}, ${readyLightAlpha * 0.72})`);
  readyGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = readyGlow;
  ctx.fillRect(-10, -8, 24, 20);
  ctx.fillStyle = `rgba(${palette.readyCore}, ${0.18 + readyLightAlpha * 0.82})`;
  ctx.fillRect(-1.5, -0.5, 4.5, 4.5);
}

function drawLauncherTurretLocal(ctx: CanvasRenderingContext2D, damaged: boolean) {
  const palette = getLauncherPalette(damaged);
  const turretGradient = ctx.createLinearGradient(-10, 0, 22, 0);
  turretGradient.addColorStop(0, "#3c5228");
  turretGradient.addColorStop(0.35, palette.turret);
  turretGradient.addColorStop(1, "#445e30");
  ctx.fillStyle = turretGradient;
  ctx.beginPath();
  ctx.moveTo(-10, -6);
  ctx.lineTo(20, -5);
  ctx.lineTo(24, -2.5);
  ctx.lineTo(24, 2.5);
  ctx.lineTo(20, 5);
  ctx.lineTo(-10, 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-9, -5.5);
  ctx.lineTo(20, -4.5);
  ctx.lineTo(23, -2);
  ctx.stroke();

  ctx.fillStyle = palette.tubeUpper;
  ctx.beginPath();
  ctx.moveTo(20, -6.5);
  ctx.lineTo(38, -5);
  ctx.lineTo(38.5, -2.5);
  ctx.lineTo(20, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(20, -6);
  ctx.lineTo(37, -4.5);
  ctx.stroke();

  ctx.fillStyle = palette.tubeLower;
  ctx.beginPath();
  ctx.moveTo(20, 2);
  ctx.lineTo(38.5, 2.5);
  ctx.lineTo(38, 5);
  ctx.lineTo(20, 6.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(20, 2.5);
  ctx.lineTo(37, 3.8);
  ctx.stroke();

  ctx.fillStyle = damaged ? "#3a1e18" : "#2a3418";
  ctx.fillRect(22, -2, 16.5, 4);

  const collarGradient = ctx.createLinearGradient(-10, -7, -10, 7);
  collarGradient.addColorStop(0, palette.collarTop);
  collarGradient.addColorStop(1, palette.collarBottom);
  ctx.fillStyle = collarGradient;
  ctx.fillRect(-10, -7, 12, 14);
  ctx.strokeStyle = palette.shadow;
  ctx.lineWidth = 1;
  ctx.strokeRect(-10, -7, 12, 14);
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-9, -6.5);
  ctx.lineTo(1, -6.5);
  ctx.stroke();
}

function drawLauncherTurretEffectsLocal(
  ctx: CanvasRenderingContext2D,
  time: number,
  phase: number,
  damaged: boolean,
  muzzleFlash: number,
) {
  const palette = getLauncherPalette(damaged);
  const chargeAlpha = getLauncherChargeAlpha(time);
  const chargeGlow = ctx.createRadialGradient(4, 0, 0, 4, 0, 12);
  chargeGlow.addColorStop(0, `rgba(${palette.chargeCore}, ${chargeAlpha * 0.9})`);
  chargeGlow.addColorStop(0.62, `rgba(${palette.chargeGlow}, ${chargeAlpha * 0.3})`);
  chargeGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = chargeGlow;
  ctx.fillRect(-7, -12, 24, 24);
  ctx.fillStyle = `rgba(${palette.chargeCore}, ${0.18 + chargeAlpha * 0.42})`;
  ctx.fillRect(2, -1, 9, 2);

  const blinkIntensity = getLauncherMuzzleBlink(time, phase);
  const flashStrength = Math.max(blinkIntensity, muzzleFlash);
  const muzzleRadius = 7 + muzzleFlash * 6;
  const muzzleGlow = ctx.createRadialGradient(40, 0, 0, 40, 0, muzzleRadius + 4);
  muzzleGlow.addColorStop(0, `rgba(${palette.muzzleGlow}, ${flashStrength * 0.62})`);
  muzzleGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = muzzleGlow;
  ctx.fillRect(29, -(muzzleRadius + 4), (muzzleRadius + 4) * 2, (muzzleRadius + 4) * 2);
  ctx.fillStyle = `rgba(${palette.muzzleCore}, ${0.46 + blinkIntensity * 0.4})`;
  ctx.fillRect(38.5, -1, 2, 2);
  ctx.fillStyle = `rgba(${palette.muzzleGlow}, ${0.48 + blinkIntensity * 0.34})`;
  ctx.fillRect(38, -1.5, 3, 3);
}

function getLauncherBakeResolution(scale: number) {
  return Math.max(1, Math.ceil(scale * 2));
}

export function buildLauncherAssets(scale: number, damaged: boolean): LauncherAssets {
  const resolutionScale = getLauncherBakeResolution(scale);

  const chassisStaticSprite = createSpriteCanvas(
    LAUNCHER_CHASSIS_BOUNDS.width * scale,
    LAUNCHER_CHASSIS_BOUNDS.height * scale,
    resolutionScale,
  );
  const chassisStaticCtx = chassisStaticSprite.getContext("2d");
  if (chassisStaticCtx) {
    chassisStaticCtx.scale(scale * resolutionScale, scale * resolutionScale);
    chassisStaticCtx.translate(-LAUNCHER_CHASSIS_BOUNDS.x, -LAUNCHER_CHASSIS_BOUNDS.y);
    drawLauncherChassisLocal(chassisStaticCtx, { damaged, drawReadyLight: false });
  }

  const chassisAnimFrames = Array.from({ length: LAUNCHER_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(
      LAUNCHER_CHASSIS_BOUNDS.width * scale,
      LAUNCHER_CHASSIS_BOUNDS.height * scale,
      resolutionScale,
    );
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(scale * resolutionScale, scale * resolutionScale);
      ctx.translate(-LAUNCHER_CHASSIS_BOUNDS.x, -LAUNCHER_CHASSIS_BOUNDS.y);
      drawLauncherChassisLocal(ctx, {
        damaged,
        readyLightAlpha: getLauncherReadyLightAlpha(
          (frameIndex / LAUNCHER_ANIM_FRAME_COUNT) * LAUNCHER_ANIM_PERIOD_SECONDS,
        ),
      });
    }
    return canvas;
  });

  const turretSprite = createSpriteCanvas(
    LAUNCHER_TURRET_BOUNDS.width * scale,
    LAUNCHER_TURRET_BOUNDS.height * scale,
    resolutionScale,
  );
  const turretCtx = turretSprite.getContext("2d");
  if (turretCtx) {
    turretCtx.scale(scale * resolutionScale, scale * resolutionScale);
    turretCtx.translate(-LAUNCHER_TURRET_BOUNDS.x, -LAUNCHER_TURRET_BOUNDS.y);
    drawLauncherTurretLocal(turretCtx, damaged);
  }

  return {
    chassisStaticSprite,
    chassisAnimFrames,
    chassisOffset: {
      x: LAUNCHER_CHASSIS_BOUNDS.x * scale,
      y: LAUNCHER_CHASSIS_BOUNDS.y * scale,
    },
    turretSprite,
    turretOffset: {
      x: LAUNCHER_TURRET_BOUNDS.x * scale,
      y: LAUNCHER_TURRET_BOUNDS.y * scale,
    },
    turretPivot: {
      x: LAUNCHER_TURRET_PIVOT.x * scale,
      y: LAUNCHER_TURRET_PIVOT.y * scale,
    },
    frameCount: LAUNCHER_ANIM_FRAME_COUNT,
    period: LAUNCHER_ANIM_PERIOD_SECONDS,
    resolutionScale,
    scale,
    damaged,
  };
}

export function drawBakedLauncher(
  ctx: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  barrelAngle: number,
  assets: LauncherAssets,
  {
    t,
    alpha = 1,
    muzzleFlash = 0,
    sharpFrames = false,
  }: Pick<SharedLauncherOptions, "t" | "alpha" | "muzzleFlash"> & { sharpFrames?: boolean },
) {
  const phase = (((t % assets.period) + assets.period) % assets.period) / assets.period;
  const frameProgress = phase * assets.frameCount;
  const frameIndex = Math.floor(frameProgress) % assets.frameCount;
  const blend = frameProgress % 1;
  const chassisW = assets.chassisStaticSprite.width / assets.resolutionScale;
  const chassisH = assets.chassisStaticSprite.height / assets.resolutionScale;
  const turretW = assets.turretSprite.width / assets.resolutionScale;
  const turretH = assets.turretSprite.height / assets.resolutionScale;

  ctx.save();
  ctx.translate(lx, ly);
  ctx.globalAlpha = alpha;
  ctx.drawImage(assets.chassisStaticSprite, assets.chassisOffset.x, assets.chassisOffset.y, chassisW, chassisH);
  ctx.globalAlpha = alpha * (sharpFrames ? 1 : 1 - blend);
  ctx.drawImage(
    assets.chassisAnimFrames[frameIndex],
    assets.chassisOffset.x,
    assets.chassisOffset.y,
    chassisW,
    chassisH,
  );
  if (!sharpFrames) {
    ctx.globalAlpha = alpha * blend;
    ctx.drawImage(
      assets.chassisAnimFrames[(frameIndex + 1) % assets.frameCount],
      assets.chassisOffset.x,
      assets.chassisOffset.y,
      chassisW,
      chassisH,
    );
  }
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(assets.turretPivot.x, assets.turretPivot.y);
  ctx.rotate(barrelAngle);
  ctx.drawImage(assets.turretSprite, assets.turretOffset.x, assets.turretOffset.y, turretW, turretH);
  ctx.scale(assets.scale, assets.scale);
  drawLauncherTurretEffectsLocal(ctx, t, lx * 0.0068, assets.damaged, muzzleFlash);
  ctx.restore();
  ctx.restore();
}

export function drawSharedLauncher(
  ctx: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  barrelAngle: number,
  {
    t,
    scale = 1,
    alpha = 1,
    damaged = false,
    active = true,
    muzzleFlash = 0,
    statusLabel = null,
  }: SharedLauncherOptions,
) {
  ctx.save();
  ctx.translate(lx, ly);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;

  if (!active) {
    ctx.globalAlpha = alpha * 0.72;
    drawLauncherWreckLocal(ctx);
    ctx.restore();
    return;
  }

  drawLauncherChassisLocal(ctx, {
    damaged,
    readyLightAlpha: getLauncherReadyLightAlpha(t),
  });
  ctx.save();
  ctx.translate(LAUNCHER_TURRET_PIVOT.x, LAUNCHER_TURRET_PIVOT.y);
  ctx.rotate(barrelAngle);
  drawLauncherTurretLocal(ctx, damaged);
  drawLauncherTurretEffectsLocal(ctx, t, lx * 0.0068, damaged, muzzleFlash);
  ctx.restore();

  if (statusLabel) {
    ctx.textAlign = "center";
    ctx.font = `bold 8px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = damaged ? "rgba(255, 132, 110, 0.72)" : "rgba(128, 236, 255, 0.72)";
    ctx.fillText(statusLabel, 0, 30);
    ctx.textAlign = "left";
  }

  ctx.restore();
}

function getProjectileBakeResolution(scale: number) {
  return Math.max(1, Math.ceil(scale * 2));
}

function getProjectileFramePhase(frameIndex: number, frameCount: number) {
  return (frameIndex % frameCount) / frameCount;
}

function buildProjectileSpriteAsset(
  scale: number,
  bounds: SpriteBounds,
  period: number,
  drawFrame: (ctx: CanvasRenderingContext2D, framePhase: number) => void,
): ProjectileSpriteAsset {
  const resolutionScale = getProjectileBakeResolution(scale);
  const paint = (canvas: HTMLCanvasElement, framePhase: number) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale * resolutionScale, scale * resolutionScale);
    ctx.translate(-bounds.x, -bounds.y);
    drawFrame(ctx, framePhase);
  };

  const staticSprite = createSpriteCanvas(bounds.width * scale, bounds.height * scale, resolutionScale);
  paint(staticSprite, 0);

  const animFrames = Array.from({ length: PROJECTILE_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(bounds.width * scale, bounds.height * scale, resolutionScale);
    paint(canvas, getProjectileFramePhase(frameIndex, PROJECTILE_ANIM_FRAME_COUNT));
    return canvas;
  });

  return {
    staticSprite,
    animFrames,
    offset: { x: bounds.x * scale, y: bounds.y * scale },
    frameCount: PROJECTILE_ANIM_FRAME_COUNT,
    period,
    resolutionScale,
    scale,
  };
}

function drawDefaultMissileLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(10, 0, -11, 0);
  bodyGrad.addColorStop(0, "#fbfdff");
  bodyGrad.addColorStop(0.18, "#d9e2ec");
  bodyGrad.addColorStop(0.55, "#8798ac");
  bodyGrad.addColorStop(1, "#46576d");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(4.8, -2.3);
  ctx.lineTo(-7.6, -2.15);
  ctx.lineTo(-9.7, -0.9);
  ctx.lineTo(-9.7, 0.9);
  ctx.lineTo(-7.6, 2.15);
  ctx.lineTo(4.8, 2.3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(16, 24, 36, 0.72)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.strokeStyle = "rgba(242, 248, 255, 0.56)";
  ctx.lineWidth = 0.68;
  ctx.stroke();

  ctx.fillStyle = "#dfe7f1";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(5.1, -1.7);
  ctx.lineTo(5.1, 1.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(182, 232, 255, 0.5)";
  ctx.fillRect(-0.7, -1.42, 5.9, 0.72);
  ctx.fillStyle = "#41586f";
  ctx.fillRect(-5.1, -0.48, 7.5, 0.96);
  ctx.strokeStyle = "rgba(250,252,255,0.72)";
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-2.7, -2);
  ctx.lineTo(5.8, -1.42);
  ctx.stroke();

  ctx.fillStyle = "#a2b3c4";
  ctx.beginPath();
  ctx.moveTo(-6, -2.05);
  ctx.lineTo(-10.8, -5.9);
  ctx.lineTo(-7.9, -1.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6, 2.05);
  ctx.lineTo(-10.8, 5.9);
  ctx.lineTo(-7.9, 1.3);
  ctx.closePath();
  ctx.fill();

  const exhaustPulse = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const flameLen = 6 + 8 * exhaustPulse;
  const flameGlow = ctx.createRadialGradient(-13, 0, 0, -13, 0, 14);
  flameGlow.addColorStop(0, `rgba(255, 152, 80, ${0.1 + exhaustPulse * 0.16})`);
  flameGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = flameGlow;
  ctx.beginPath();
  ctx.ellipse(-13, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 102, 42, ${0.62 + exhaustPulse * 0.24})`;
  ctx.beginPath();
  ctx.moveTo(-9.3, -1.85);
  ctx.lineTo(-10.6 - flameLen, 0);
  ctx.lineTo(-9.3, 1.85);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 222, 144, ${0.54 + exhaustPulse * 0.22})`;
  ctx.beginPath();
  ctx.moveTo(-9.1, -0.85);
  ctx.lineTo(-10.1 - flameLen * 0.56, 0);
  ctx.lineTo(-9.1, 0.85);
  ctx.closePath();
  ctx.fill();
}

function drawMirvLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const glowAlpha = 0.18 + Math.sin(framePhase * Math.PI * 2) * 0.06;
  const pulseGlow = ctx.createRadialGradient(6, 0, 0, 6, 0, 30);
  pulseGlow.addColorStop(0, `rgba(255, 40, 0, ${0.34 + glowAlpha})`);
  pulseGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = pulseGlow;
  ctx.fillRect(-24, -22, 52, 44);

  ctx.fillStyle = "#445060";
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(8, -4.5);
  ctx.lineTo(-14, -4.5);
  ctx.lineTo(-14, 4.5);
  ctx.lineTo(8, 4.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#cc2200";
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(14, -4.5);
  ctx.lineTo(14, 4.5);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, -4.5);
  ctx.lineTo(2, 4.5);
  ctx.moveTo(-6, -4.5);
  ctx.lineTo(-6, 4.5);
  ctx.stroke();

  ctx.fillStyle = "#556878";
  ctx.beginPath();
  ctx.moveTo(-14, -4.5);
  ctx.lineTo(-18, -11);
  ctx.lineTo(-10, -4.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14, 4.5);
  ctx.lineTo(-18, 11);
  ctx.lineTo(-10, 4.5);
  ctx.closePath();
  ctx.fill();

  const flameLen = 10 + 8 * (0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2));
  ctx.fillStyle = "#ff6633";
  ctx.beginPath();
  ctx.moveTo(-14, -3.5);
  ctx.lineTo(-14 - flameLen, 0);
  ctx.lineTo(-14, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc66";
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-14 - flameLen * 0.5, 0);
  ctx.lineTo(-14, 2);
  ctx.closePath();
  ctx.fill();
}

function drawMirvWarheadLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const glow = ctx.createRadialGradient(2, 0, 0, 2, 0, 16);
  glow.addColorStop(0, `rgba(221, 68, 34, ${0.34 + pulse * 0.18})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-12, -10, 24, 20);

  ctx.fillStyle = "#dd4422";
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(3, -2);
  ctx.lineTo(-5, -2);
  ctx.lineTo(-5, 2);
  ctx.lineTo(3, 2);
  ctx.closePath();
  ctx.fill();

  const flameLen = 5 + 4 * pulse;
  ctx.fillStyle = "#ff8844";
  ctx.beginPath();
  ctx.moveTo(-5, -1.5);
  ctx.lineTo(-5 - flameLen, 0);
  ctx.lineTo(-5, 1.5);
  ctx.closePath();
  ctx.fill();
}

function drawBombLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 8.5);
  glow.addColorStop(0, `rgba(255, 136, 0, ${0.36 + pulse * 0.2})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff8800";
  ctx.beginPath();
  ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 238, 196, 0.64)";
  ctx.beginPath();
  ctx.arc(0.8, -0.6, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawStackChildLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const flamePulse = 0.84 + 0.16 * (0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2));
  ctx.fillStyle = "#d6d9de";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-2, -3);
  ctx.lineTo(-2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8f96a0";
  ctx.beginPath();
  ctx.moveTo(-2, -3);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-4, -3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 3);
  ctx.lineTo(-6, 6);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff884480";
  ctx.beginPath();
  ctx.moveTo(-2, -2);
  ctx.lineTo(-12 * flamePulse, 0);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe7b8";
  ctx.beginPath();
  ctx.moveTo(-2, -1);
  ctx.lineTo(-7 * flamePulse, 0);
  ctx.lineTo(-2, 1);
  ctx.closePath();
  ctx.fill();
}

function drawStackCarrierLocal(ctx: CanvasRenderingContext2D, payloadCount: 2 | 3, framePhase: number) {
  const renderScale = 0.8;
  const bodyHalfH = payloadCount === 3 ? 5.2 : 4.6;
  const noseX = payloadCount === 3 ? 25 : 22.5;
  const bodyFrontX = payloadCount === 3 ? 15.5 : 14;
  const tailX = payloadCount === 3 ? -20.5 : -18;
  const payloadOffsets = payloadCount === 3 ? [-1.85, 0, 1.85] : [-1.3, 1.3];
  const finSpan = payloadCount === 3 ? 10 : 9;
  const flameLen =
    payloadCount === 3 ? 14 + 4 * Math.sin(framePhase * Math.PI * 2) : 11 + 3 * Math.sin(framePhase * Math.PI * 2);

  ctx.save();
  ctx.scale(renderScale, renderScale);

  const shell = ctx.createLinearGradient(tailX, -bodyHalfH, noseX, bodyHalfH);
  shell.addColorStop(0, "#465363");
  shell.addColorStop(0.35, "#718091");
  shell.addColorStop(0.7, "#d6dde6");
  shell.addColorStop(1, "#f1f5fa");
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.moveTo(noseX, 0);
  ctx.lineTo(bodyFrontX, -bodyHalfH * 0.78);
  ctx.lineTo(4, -bodyHalfH);
  ctx.lineTo(-9, -bodyHalfH * 0.92);
  ctx.lineTo(tailX, -bodyHalfH * 0.38);
  ctx.lineTo(tailX, bodyHalfH * 0.38);
  ctx.lineTo(-9, bodyHalfH * 0.92);
  ctx.lineTo(4, bodyHalfH);
  ctx.lineTo(bodyFrontX, bodyHalfH * 0.78);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(24, 32, 42, 0.18)";
  ctx.beginPath();
  ctx.moveTo(bodyFrontX - 2, -bodyHalfH * 0.42);
  ctx.lineTo(4.5, -bodyHalfH * 0.63);
  ctx.lineTo(-11.5, -bodyHalfH * 0.34);
  ctx.lineTo(-11.5, bodyHalfH * 0.34);
  ctx.lineTo(4.5, bodyHalfH * 0.63);
  ctx.lineTo(bodyFrontX - 2, bodyHalfH * 0.42);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(250, 252, 255, 0.55)";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-9, -bodyHalfH * 0.58);
  ctx.lineTo(12, -bodyHalfH * 0.34);
  ctx.stroke();

  ctx.strokeStyle = "rgba(23, 28, 36, 0.34)";
  ctx.lineWidth = 0.9;
  [-10, -1.5].forEach((bandX) => {
    ctx.beginPath();
    ctx.moveTo(bandX, -bodyHalfH * 0.62);
    ctx.lineTo(bandX, bodyHalfH * 0.62);
    ctx.stroke();
  });

  ctx.fillStyle = payloadCount === 3 ? "#4d5968" : "#55606f";
  ctx.beginPath();
  ctx.moveTo(tailX, -bodyHalfH * 0.42);
  ctx.lineTo(tailX - 5.5, -finSpan * 0.7);
  ctx.lineTo(tailX + 3.2, -bodyHalfH * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tailX, bodyHalfH * 0.42);
  ctx.lineTo(tailX - 5.5, finSpan * 0.7);
  ctx.lineTo(tailX + 3.2, bodyHalfH * 0.14);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 186, 96, 0.16)";
  ctx.beginPath();
  ctx.moveTo(bodyFrontX + 0.4, -bodyHalfH * 0.34);
  ctx.lineTo(noseX - 1.5, 0);
  ctx.lineTo(bodyFrontX + 0.4, bodyHalfH * 0.34);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 212, 148, 0.42)";
  ctx.lineWidth = 0.8;
  payloadOffsets.forEach((offset) => {
    ctx.beginPath();
    ctx.moveTo(4.2, offset);
    ctx.lineTo(15.8, offset);
    ctx.stroke();
  });

  payloadOffsets.forEach((offset) => {
    const halo = ctx.createLinearGradient(4, offset, 17, offset);
    halo.addColorStop(0, "rgba(255, 156, 74, 0.08)");
    halo.addColorStop(0.55, "rgba(255, 214, 150, 0.38)");
    halo.addColorStop(1, "rgba(255, 244, 214, 0.14)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(11, offset, 7.1, 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(250, 252, 255, 0.68)";
    ctx.beginPath();
    ctx.ellipse(15.2, offset, 1.1, 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(34, 42, 52, 0.45)";
  ctx.lineWidth = 0.7;
  const seamTop = payloadOffsets[0] - 0.92;
  const seamBottom = payloadOffsets[payloadOffsets.length - 1] + 0.92;
  ctx.beginPath();
  ctx.moveTo(4.1, seamTop);
  ctx.lineTo(4.1, seamBottom);
  ctx.stroke();
  if (payloadCount === 3) {
    ctx.beginPath();
    ctx.moveTo(10.3, seamTop);
    ctx.lineTo(10.3, seamBottom);
    ctx.stroke();
  }

  const exhaustGlow = ctx.createRadialGradient(tailX - 4, 0, 0, tailX - 4, 0, 18);
  exhaustGlow.addColorStop(0, `rgba(255, 194, 122, ${0.18 + framePhase * 0.12})`);
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(tailX - 20, -12, 28, 24);

  ctx.fillStyle = "#ff9a4d";
  ctx.beginPath();
  ctx.moveTo(tailX, -2.8);
  ctx.lineTo(tailX - flameLen, 0);
  ctx.lineTo(tailX, 2.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe4ae";
  ctx.beginPath();
  ctx.moveTo(tailX + 0.4, -1.4);
  ctx.lineTo(tailX - flameLen * 0.52, 0);
  ctx.lineTo(tailX + 0.4, 1.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawShahed136Local(ctx: CanvasRenderingContext2D, framePhase: number) {
  const bodyGrad = ctx.createLinearGradient(13, 0, -11, 0);
  bodyGrad.addColorStop(0, "#b4afbc");
  bodyGrad.addColorStop(0.34, "#706c7e");
  bodyGrad.addColorStop(1, "#353b4b");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(4.4, -1.9);
  ctx.lineTo(-7.8, -2.4);
  ctx.lineTo(-10.8, 0);
  ctx.lineTo(-7.8, 2.4);
  ctx.lineTo(4.4, 1.9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(14,18,28,0.82)";
  ctx.lineWidth = 0.85;
  ctx.stroke();
  ctx.strokeStyle = "rgba(236,242,250,0.4)";
  ctx.lineWidth = 0.62;
  ctx.stroke();

  ctx.fillStyle = "#495367";
  ctx.beginPath();
  ctx.moveTo(5.8, -1.25);
  ctx.lineTo(-5.6, -10.2);
  ctx.lineTo(-8.2, -1.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(236,242,250,0.34)";
  ctx.lineWidth = 0.56;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(5.8, 1.25);
  ctx.lineTo(-5.6, 10.2);
  ctx.lineTo(-8.2, 1.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(236,242,250,0.34)";
  ctx.lineWidth = 0.56;
  ctx.stroke();

  ctx.fillStyle = "rgba(222, 236, 255, 0.3)";
  ctx.fillRect(-0.4, -0.95, 6.5, 0.52);

  ctx.fillStyle = "#5b6980";
  ctx.beginPath();
  ctx.moveTo(-6.2, -1.2);
  ctx.lineTo(-9.8, -4.3);
  ctx.lineTo(-8.2, -0.9);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6.2, 1.2);
  ctx.lineTo(-9.8, 4.3);
  ctx.lineTo(-8.2, 0.9);
  ctx.closePath();
  ctx.fill();

  const propAngle = Math.cos(framePhase * Math.PI * 2) * 1.1;
  ctx.strokeStyle = "rgba(226,232,242,0.82)";
  ctx.lineWidth = 0.68;
  ctx.beginPath();
  ctx.moveTo(-11 + propAngle, -3.6);
  ctx.lineTo(-11 - propAngle, 3.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-11 - propAngle, -2.9);
  ctx.lineTo(-11 + propAngle, 2.9);
  ctx.stroke();

  const propGlow = ctx.createRadialGradient(-11, 0, 0, -11, 0, 4.8);
  propGlow.addColorStop(0, "rgba(255, 136, 76, 0.2)");
  propGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = propGlow;
  ctx.beginPath();
  ctx.arc(-11, 0, 4.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawShahed238Local(ctx: CanvasRenderingContext2D, framePhase: number) {
  ctx.fillStyle = "#4a4a5a";
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -3);
  ctx.lineTo(-14, 0);
  ctx.lineTo(-10, 3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3a3a4a";
  ctx.beginPath();
  ctx.moveTo(4, -2);
  ctx.lineTo(-8, -14);
  ctx.lineTo(-12, -2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, 2);
  ctx.lineTo(-8, 14);
  ctx.lineTo(-12, 2);
  ctx.closePath();
  ctx.fill();

  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const exhaustGlow = ctx.createRadialGradient(-15, 0, 0, -15, 0, 16);
  exhaustGlow.addColorStop(0, `rgba(255, 68, 0, ${0.26 + pulse * 0.26})`);
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(-32, -14, 24, 28);

  const exLen = 7 + 5 * pulse;
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.moveTo(-14, -2);
  ctx.lineTo(-14 - exLen, 0);
  ctx.lineTo(-14, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffcc44";
  ctx.beginPath();
  ctx.moveTo(-14, -1);
  ctx.lineTo(-14 - exLen * 0.5, 0);
  ctx.lineTo(-14, 1);
  ctx.closePath();
  ctx.fill();
}

function drawPlayerInterceptorLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const exhaustFlicker = 0.55 + 0.45 * Math.sin(framePhase * Math.PI * 2);
  const exhaustLen = 18 + 18 * exhaustFlicker;
  const exhaustAlpha = 0.78 + 0.22 * exhaustFlicker;
  const exhaustGlow = ctx.createRadialGradient(-18, 0, 0, -18, 0, 22);
  exhaustGlow.addColorStop(0, "rgba(140, 232, 255, 0.28)");
  exhaustGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = exhaustGlow;
  ctx.fillRect(-42, -16, 34, 32);

  ctx.fillStyle = `rgba(90, 220, 255, ${exhaustAlpha * 0.28})`;
  ctx.beginPath();
  ctx.moveTo(-8.4, -3.8);
  ctx.lineTo(-22 - exhaustLen * 0.78, 0);
  ctx.lineTo(-8.4, 3.8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#c7f6ff";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(2.4, -2.2);
  ctx.lineTo(-9.6, -2);
  ctx.lineTo(-11.3, -0.72);
  ctx.lineTo(-11.3, 0.72);
  ctx.lineTo(-9.6, 2);
  ctx.lineTo(2.4, 2.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#8ce8ff";
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(3.8, -1.2);
  ctx.lineTo(3.8, 1.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2b4e6b";
  ctx.fillRect(-6.2, -0.55, 12.2, 1.1);
  ctx.fillStyle = "rgba(220, 250, 255, 0.58)";
  ctx.fillRect(-0.4, -1.45, 5.4, 0.55);

  ctx.fillStyle = "#88cfff";
  ctx.beginPath();
  ctx.moveTo(-2.8, -2.2);
  ctx.lineTo(-8.8, -4.9);
  ctx.lineTo(-5.6, -1.2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2.8, 2.2);
  ctx.lineTo(-8.8, 4.9);
  ctx.lineTo(-5.6, 1.2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = `rgba(255, 112, 48, ${exhaustAlpha})`;
  ctx.beginPath();
  ctx.moveTo(-9.8, -2.4);
  ctx.lineTo(-13.5 - exhaustLen, 0);
  ctx.lineTo(-9.8, 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgba(255, 220, 128, ${exhaustAlpha * 0.78})`;
  ctx.beginPath();
  ctx.moveTo(-9.6, -1.2);
  ctx.lineTo(-11.8 - exhaustLen * 0.72, 0);
  ctx.lineTo(-9.6, 1.2);
  ctx.closePath();
  ctx.fill();
}

function drawF15InterceptorLocal(ctx: CanvasRenderingContext2D, framePhase: number) {
  const pulse = 0.5 + 0.5 * Math.sin(framePhase * Math.PI * 2);
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
  halo.addColorStop(0, `rgba(102, 153, 255, ${0.3 + pulse * 0.22})`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d7ebff";
  ctx.beginPath();
  ctx.moveTo(5.2, 0);
  ctx.lineTo(0.8, -1.4);
  ctx.lineTo(-3.6, -1.1);
  ctx.lineTo(-4.9, 0);
  ctx.lineTo(-3.6, 1.1);
  ctx.lineTo(0.8, 1.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#7fb4ff";
  ctx.beginPath();
  ctx.moveTo(-0.8, -1.4);
  ctx.lineTo(-4.3, -3.2);
  ctx.lineTo(-2.8, -0.55);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.8, 1.4);
  ctx.lineTo(-4.3, 3.2);
  ctx.lineTo(-2.8, 0.55);
  ctx.closePath();
  ctx.fill();
}

function drawWildHornetLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetBody;
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3.5, 4);
  ctx.lineTo(0, 2);
  ctx.lineTo(-3.5, 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetBright;
  ctx.fillRect(-0.8, -4, 1.6, 5);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.hornetWing;
  ctx.fillRect(-6, 0, 4, 1.6);
  ctx.fillRect(2, 0, 4, 1.6);
}

function drawRoadrunnerLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerBody;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerFin;
  ctx.fillRect(-1.5, -8, 3, 5);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.roadrunnerHighlight;
  ctx.fillRect(-0.7, -5, 1.4, 2);
}

function drawPatriotSamLocal(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotBody;
  ctx.fillRect(-3, -8, 6, 16);
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotNose;
  ctx.beginPath();
  ctx.moveTo(-3, -8);
  ctx.lineTo(0, -13);
  ctx.lineTo(3, -8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = UPGRADE_PROJECTILE_COLORS.patriotFin;
  ctx.fillRect(-5, 5, 2, 4);
  ctx.fillRect(3, 5, 2, 4);
}

export function buildUpgradeProjectileSpriteAssets(scale: number): UpgradeProjectileSpriteAssets {
  return {
    wildHornet: buildProjectileSpriteAsset(scale, WILD_HORNET_BOUNDS, 0.8, drawWildHornetLocal),
    roadrunner: buildProjectileSpriteAsset(scale, ROADRUNNER_BOUNDS, 0.8, drawRoadrunnerLocal),
    patriotSam: buildProjectileSpriteAsset(scale, PATRIOT_SAM_BOUNDS, 0.8, drawPatriotSamLocal),
  };
}

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

function buildStaticSpriteAsset(
  scale: number,
  bounds: SpriteBounds,
  draw: (ctx: CanvasRenderingContext2D) => void,
): StaticSpriteAsset {
  const resolutionScale = getProjectileBakeResolution(scale);
  const sprite = createSpriteCanvas(bounds.width * scale, bounds.height * scale, resolutionScale);
  const ctx = sprite.getContext("2d");
  if (ctx) {
    ctx.scale(scale * resolutionScale, scale * resolutionScale);
    ctx.translate(-bounds.x, -bounds.y);
    draw(ctx);
  }
  return {
    sprite,
    offset: { x: bounds.x * scale, y: bounds.y * scale },
    width: bounds.width * scale,
    height: bounds.height * scale,
    resolutionScale,
    scale,
  };
}

function buildEffectSpriteAsset(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): StaticSpriteAsset {
  const resolutionScale = 2;
  const sprite = createSpriteCanvas(width, height, resolutionScale);
  const ctx = sprite.getContext("2d");
  if (ctx) {
    ctx.scale(resolutionScale, resolutionScale);
    draw(ctx, width, height);
  }
  return {
    sprite,
    offset: { x: -width / 2, y: -height / 2 },
    width,
    height,
    resolutionScale,
    scale: 1,
  };
}

function drawCenteredRadialGlow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stops: Array<[number, string]>,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

export function buildExplosionGlowAssets(): ExplosionGlowAssets {
  return {
    light: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0.9)"],
        [0.24, "rgba(255, 255, 255, 0.36)"],
        [0.58, "rgba(255, 255, 255, 0.1)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    splash: buildEffectSpriteAsset(192, 192, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0.55)"],
        [0.18, "rgba(255, 255, 255, 0.34)"],
        [0.42, "rgba(255, 255, 255, 0.14)"],
        [0.74, "rgba(255, 255, 255, 0.04)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    fireball: buildEffectSpriteAsset(128, 128, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 1)"],
        [0.16, "rgba(255, 245, 206, 0.94)"],
        [0.42, "rgba(255, 255, 255, 0.55)"],
        [0.78, "rgba(255, 255, 255, 0.08)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    core: buildEffectSpriteAsset(64, 64, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 1)"],
        [0.34, "rgba(255, 255, 255, 0.86)"],
        [0.72, "rgba(255, 255, 255, 0.22)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    ring: buildEffectSpriteAsset(160, 160, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.72, "rgba(255, 255, 255, 0)"],
        [0.82, "rgba(255, 255, 255, 0.78)"],
        [0.9, "rgba(255, 255, 255, 0.28)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
  };
}

export function buildEmpRingAssets(): EmpRingAssets {
  return {
    wash: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.58, "rgba(255, 255, 255, 0)"],
        [0.88, "rgba(255, 255, 255, 0.22)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
    ring: buildEffectSpriteAsset(256, 256, (ctx, width, height) => {
      drawCenteredRadialGlow(ctx, width, height, [
        [0, "rgba(255, 255, 255, 0)"],
        [0.66, "rgba(255, 255, 255, 0)"],
        [0.76, "rgba(255, 255, 255, 0.9)"],
        [0.82, "rgba(255, 255, 255, 0.52)"],
        [0.9, "rgba(255, 255, 255, 0.18)"],
        [1, "rgba(255, 255, 255, 0)"],
      ]);
    }),
  };
}

export function buildEffectSpriteAssets(): EffectSpriteAssets {
  return {
    explosion: buildExplosionGlowAssets(),
    emp: buildEmpRingAssets(),
    laserBeam: buildEffectSpriteAsset(128, 24, (ctx, width, height) => {
      const cy = height / 2;
      const glow = ctx.createLinearGradient(0, cy, 0, height);
      glow.addColorStop(0, "rgba(255, 255, 255, 0)");
      glow.addColorStop(0.35, "rgba(255, 255, 255, 0.34)");
      glow.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
      glow.addColorStop(0.65, "rgba(255, 255, 255, 0.34)");
      glow.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }),
    phalanxBullet: buildEffectSpriteAsset(96, 12, (ctx, width, height) => {
      const beam = ctx.createLinearGradient(0, 0, width, 0);
      beam.addColorStop(0, "rgba(255, 255, 255, 0)");
      beam.addColorStop(0.28, "rgba(255, 255, 255, 0.24)");
      beam.addColorStop(0.72, "rgba(255, 255, 255, 0.92)");
      beam.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = beam;
      ctx.fillRect(0, 0, width, height);
    }),
  };
}

export function drawBakedStaticSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: StaticSpriteAsset,
  { alpha = 1, angle = 0 }: { alpha?: number; angle?: number } = {},
) {
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(asset.sprite, asset.offset.x, asset.offset.y, asset.width, asset.height);
  ctx.restore();
}

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

export function buildThreatSpriteAssets(scale: number): ThreatSpriteAssets {
  return {
    missile: buildProjectileSpriteAsset(scale, DEFAULT_MISSILE_BOUNDS, 0.8, drawDefaultMissileLocal),
    mirv: buildProjectileSpriteAsset(scale, MIRV_BOUNDS, 1, drawMirvLocal),
    mirv_warhead: buildProjectileSpriteAsset(scale, MIRV_WARHEAD_BOUNDS, 0.9, drawMirvWarheadLocal),
    bomb: buildProjectileSpriteAsset(scale, BOMB_BOUNDS, 0.9, drawBombLocal),
    stack_carrier_2: buildProjectileSpriteAsset(scale, STACK2_BOUNDS, 0.9, (ctx, framePhase) =>
      drawStackCarrierLocal(ctx, 2, framePhase),
    ),
    stack_carrier_3: buildProjectileSpriteAsset(scale, STACK3_BOUNDS, 0.9, (ctx, framePhase) =>
      drawStackCarrierLocal(ctx, 3, framePhase),
    ),
    stack_child: buildProjectileSpriteAsset(scale, STACK_CHILD_BOUNDS, 0.8, drawStackChildLocal),
    shahed136: buildProjectileSpriteAsset(scale, SHAHED_136_BOUNDS, 0.6, drawShahed136Local),
    shahed238: buildProjectileSpriteAsset(scale, SHAHED_238_BOUNDS, 0.8, drawShahed238Local),
  };
}

export function buildInterceptorSpriteAssets(scale: number): InterceptorSpriteAssets {
  return {
    playerInterceptor: buildProjectileSpriteAsset(scale, PLAYER_INTERCEPTOR_BOUNDS, 0.8, drawPlayerInterceptorLocal),
    f15Interceptor: buildProjectileSpriteAsset(scale, F15_INTERCEPTOR_BOUNDS, 0.8, drawF15InterceptorLocal),
  };
}

function getThreatSpritePeriod(kind: ThreatSpriteKind): number {
  switch (kind) {
    case "mirv":
      return 1;
    case "mirv_warhead":
    case "bomb":
    case "stack_carrier_2":
    case "stack_carrier_3":
    case "shahed238":
      return 0.9;
    case "shahed136":
      return 0.6;
    case "missile":
    case "stack_child":
    default:
      return 0.8;
  }
}

function getInterceptorSpritePeriod(kind: InterceptorSpriteKind): number {
  switch (kind) {
    case "playerInterceptor":
    case "f15Interceptor":
    default:
      return 0.8;
  }
}

function getFramePhaseForTime(t: number, period: number): number {
  return (((t % period) + period) % period) / period;
}

export function drawLiveThreatSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  kind: ThreatSpriteKind,
  { t, scale = 1, alpha = 1 }: { t: number; scale?: number; alpha?: number },
) {
  const framePhase = getFramePhaseForTime(t, getThreatSpritePeriod(kind));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  switch (kind) {
    case "mirv":
      drawMirvLocal(ctx, framePhase);
      break;
    case "mirv_warhead":
      drawMirvWarheadLocal(ctx, framePhase);
      break;
    case "bomb":
      drawBombLocal(ctx, framePhase);
      break;
    case "stack_carrier_2":
      drawStackCarrierLocal(ctx, 2, framePhase);
      break;
    case "stack_carrier_3":
      drawStackCarrierLocal(ctx, 3, framePhase);
      break;
    case "stack_child":
      drawStackChildLocal(ctx, framePhase);
      break;
    case "shahed136":
      drawShahed136Local(ctx, framePhase);
      break;
    case "shahed238":
      drawShahed238Local(ctx, framePhase);
      break;
    case "missile":
    default:
      drawDefaultMissileLocal(ctx, framePhase);
      break;
  }
  ctx.restore();
}

export function drawLiveInterceptorSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  kind: InterceptorSpriteKind,
  { t, scale = 1, alpha = 1 }: { t: number; scale?: number; alpha?: number },
) {
  const framePhase = getFramePhaseForTime(t, getInterceptorSpritePeriod(kind));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  if (kind === "f15Interceptor") drawF15InterceptorLocal(ctx, framePhase);
  else drawPlayerInterceptorLocal(ctx, framePhase);
  ctx.restore();
}

export function drawBakedProjectileSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  asset: ProjectileSpriteAsset,
  { t, alpha = 1, sharpFrames = false }: { t: number; alpha?: number; sharpFrames?: boolean },
) {
  const spriteW = asset.staticSprite.width / asset.resolutionScale;
  const spriteH = asset.staticSprite.height / asset.resolutionScale;
  const frameCount = Math.max(1, asset.frameCount);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;

  if (asset.animFrames.length === 0 || frameCount <= 1) {
    ctx.drawImage(asset.staticSprite, asset.offset.x, asset.offset.y, spriteW, spriteH);
    ctx.restore();
    return;
  }

  const phase = (((t % asset.period) + asset.period) % asset.period) / asset.period;
  const frameProgress = phase * frameCount;
  const frameIndex = Math.floor(frameProgress) % frameCount;
  const blend = frameProgress % 1;

  ctx.globalAlpha = alpha * (sharpFrames ? 1 : 1 - blend);
  ctx.drawImage(asset.animFrames[frameIndex], asset.offset.x, asset.offset.y, spriteW, spriteH);
  if (!sharpFrames) {
    ctx.globalAlpha = alpha * blend;
    ctx.drawImage(asset.animFrames[(frameIndex + 1) % frameCount], asset.offset.x, asset.offset.y, spriteW, spriteH);
  }
  ctx.restore();
}

function getStarTwinkleProfile(time: number, phase: number, seed: number) {
  const hero = seed > HERO_STAR_THRESHOLD;
  const seedA = hash01(seed, phase, 1.7);
  const seedB = hash01(seed, phase, 8.3);
  const seedC = hash01(seed, phase, 15.1);
  const timeA = time + seedA * 23 + seedB * 11;
  const timeB = time + seedB * 31 + seedC * 7;
  const timeC = time + seedC * 41 + seedA * 13;
  const twinkleRate = 1.05;
  const shimmer =
    0.55 +
    0.28 * Math.sin(timeA * twinkleRate * (0.74 + seedA * 0.43) + phase * (0.92 + seedB * 0.28) + seedC * Math.PI * 2) +
    0.17 * Math.sin(timeB * twinkleRate * (1.48 + seedC * 0.62) + phase * (0.34 + seedA * 0.12) + seedB * Math.PI * 2);
  const flareWave =
    0.5 +
    0.5 *
      Math.sin(
        timeB * twinkleRate * (0.52 + seedA * 0.28) +
          phase * (0.74 + seedB * 0.24) +
          seedC * 9.7 +
          Math.sin(timeC * twinkleRate * (0.43 + seedC * 0.24) + seedA * 7.3) * 1.4,
      );
  const flare = hero ? Math.pow(flareWave, 2.2) : 0;
  return { shimmer, flare };
}

function createStubCanvasContext(width: number, height: number): CanvasRenderingContext2D {
  const raw: Record<string, unknown> = {
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    clip: () => {},
    stroke: () => {},
    scale: () => {},
    rotate: () => {},
    ellipse: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    setTransform: () => {},
    drawImage: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    canvas: { width, height },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    font: "10px sans-serif",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  };
  return raw as unknown as CanvasRenderingContext2D;
}

export function getLightFlicker(time: number, seed: number) {
  const seedA = hash01(seed, 1.1, 3.7);
  const seedB = hash01(seed, 5.9, 8.2);
  const seedC = hash01(seed, 11.7, 2.4);
  const swell = 0.5 + 0.5 * Math.sin(time * (0.0056 + seedA * 0.00595) + seedB * Math.PI * 2);
  const flutter =
    0.5 +
    0.5 *
      Math.sin(
        time * (0.020125 + seedB * 0.01925) +
          seedC * Math.PI * 2 +
          Math.sin(time * (0.01085 + seedA * 0.0049) + seedB * 7.1) * (0.35 + seedC * 0.5),
      );
  const sparkle = Math.pow(0.5 + 0.5 * Math.sin(time * (0.042 + seedC * 0.02625) + seedA * 8.4), 5);
  return Math.min(1, 0.32 + swell * 0.26 + flutter * 0.3 + sparkle * 0.42);
}

export function drawFlickerWindows(
  ctx: CanvasRenderingContext2D,
  {
    x,
    y,
    w,
    h,
    rows,
    cols,
    time,
    seed,
    warmBias = 0.5,
    paneW = 3,
    paneH = 3,
    gapX = 4,
    gapY = 6,
    drawUnlit = true,
    litThreshold = -0.42,
    groupRows = 1,
    groupCols = 1,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    rows: number;
    cols: number;
    time: number;
    seed: number;
    warmBias?: number;
    paneW?: number;
    paneH?: number;
    gapX?: number;
    gapY?: number;
    drawUnlit?: boolean;
    litThreshold?: number;
    groupRows?: number;
    groupCols?: number;
  },
) {
  const totalW = cols * paneW + (cols - 1) * gapX;
  const totalH = rows * paneH + (rows - 1) * gapY;
  const startX = x + Math.max(0, (w - totalW) * 0.5);
  const startY = y + Math.max(0, (h - totalH) * 0.5);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const groupRow = Math.floor(row / groupRows);
      const groupCol = Math.floor(col / groupCols);
      const lightSeed = hash01(seed, groupRow, groupCol);
      const paneX = startX + col * (paneW + gapX);
      const paneY = startY + row * (paneH + gapY);
      const lit =
        Math.sin(time * (0.044 + lightSeed * 0.028) + groupRow * 1.17 + groupCol * 2.03 + lightSeed * 12) >
        litThreshold;
      if (!lit) {
        if (!drawUnlit) continue;
        ctx.fillStyle = "rgba(3, 6, 12, 0.74)";
        ctx.fillRect(paneX, paneY, paneW, paneH);
        continue;
      }
      const flicker = getLightFlicker(time, seed * 13 + groupRow * 1.9 + groupCol * 2.7);
      const warm = hash01(seed, groupRow, groupCol, 4.7) < warmBias;
      const spillRgb = warm ? "255, 198, 122" : "210, 232, 255";
      const coreRgb = warm ? "255, 234, 186" : "236, 246, 255";
      ctx.fillStyle = `rgba(${spillRgb}, ${0.06 + flicker * 0.24})`;
      ctx.fillRect(paneX - 1, paneY - 1, paneW + 2, paneH + 2);
      ctx.fillStyle = `rgba(${coreRgb}, ${0.12 + flicker * 0.72})`;
      ctx.fillRect(paneX, paneY, paneW, paneH);
    }
  }
}

export function drawSharedTower(
  ctx: CanvasRenderingContext2D,
  tower: TitleTower,
  baseY: number,
  t: number,
  offset = 0,
  glowScale = 1,
  opts: DrawSharedTowerOptions = {},
) {
  if (opts.structureOnly && opts.animOnly) return;
  const x = tower.x + offset;
  const top = baseY - tower.h;
  const right = x + tower.w;
  const mid = x + tower.w / 2;

  ctx.save();
  if (!opts.animOnly) {
    if (tower.glow) {
      const glow = ctx.createRadialGradient(mid, top + tower.h * 0.3, 0, mid, top + tower.h * 0.3, tower.w * 1.8);
      glow.addColorStop(0, `rgba(120, 190, 255, ${tower.glow * glowScale})`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - tower.w, top - tower.w, tower.w * 3, tower.h + tower.w * 2);
    }

    ctx.beginPath();
    switch (tower.roof ?? "flat") {
      case "spire":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 12);
        ctx.lineTo(mid - 2, top + 12);
        ctx.lineTo(mid, top - 16);
        ctx.lineTo(mid + 2, top + 12);
        ctx.lineTo(right, top + 12);
        ctx.lineTo(right, baseY);
        break;
      case "needle":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 8);
        ctx.lineTo(mid - 3, top + 8);
        ctx.lineTo(mid - 1, top - 24);
        ctx.lineTo(mid + 1, top - 24);
        ctx.lineTo(mid + 3, top + 8);
        ctx.lineTo(right, top + 8);
        ctx.lineTo(right, baseY);
        break;
      case "crown":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 16);
        ctx.lineTo(x + tower.w * 0.22, top + 4);
        ctx.lineTo(mid - 3, top + 14);
        ctx.lineTo(mid, top - 12);
        ctx.lineTo(mid + 3, top + 14);
        ctx.lineTo(x + tower.w * 0.78, top + 4);
        ctx.lineTo(right, top + 16);
        ctx.lineTo(right, baseY);
        break;
      case "roundedCrownL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 34);
        ctx.quadraticCurveTo(x + tower.w * 0.06, top + 6, x + tower.w * 0.34, top + 4);
        ctx.lineTo(x + tower.w * 0.34, top - 18);
        ctx.lineTo(x + tower.w * 0.43, top - 18);
        ctx.lineTo(x + tower.w * 0.43, top + 6);
        ctx.quadraticCurveTo(x + tower.w * 0.68, top + 8, right, top + 24);
        ctx.lineTo(right, baseY);
        break;
      case "twinCrown":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 18);
        ctx.lineTo(x + tower.w * 0.18, top + 10);
        ctx.lineTo(x + tower.w * 0.22, top - 16);
        ctx.lineTo(x + tower.w * 0.3, top - 16);
        ctx.lineTo(x + tower.w * 0.34, top + 12);
        ctx.lineTo(x + tower.w * 0.5, top + 16);
        ctx.lineTo(x + tower.w * 0.66, top + 12);
        ctx.lineTo(x + tower.w * 0.7, top - 16);
        ctx.lineTo(x + tower.w * 0.78, top - 16);
        ctx.lineTo(x + tower.w * 0.82, top + 10);
        ctx.lineTo(right, top + 18);
        ctx.lineTo(right, baseY);
        break;
      case "curvedR":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 42);
        ctx.quadraticCurveTo(x + tower.w * 0.12, top + 20, x + tower.w * 0.46, top + 12);
        ctx.quadraticCurveTo(x + tower.w * 0.9, top + 26, right, top + 46);
        ctx.lineTo(right, baseY);
        break;
      case "curvedL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 46);
        ctx.quadraticCurveTo(x + tower.w * 0.18, top + 18, x + tower.w * 0.58, top + 10);
        ctx.quadraticCurveTo(x + tower.w * 0.88, top + 6, right, top + 24);
        ctx.lineTo(right, baseY);
        break;
      case "tapered":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x + tower.w * 0.04, top + 22);
        ctx.lineTo(mid - 3, top + 10);
        ctx.lineTo(mid, top - 8);
        ctx.lineTo(mid + 3, top + 10);
        ctx.lineTo(right - tower.w * 0.04, top + 22);
        ctx.lineTo(right, baseY);
        break;
      case "slantL":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 4);
        ctx.lineTo(right, top + 18);
        ctx.lineTo(right, baseY);
        break;
      case "slantR":
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top + 18);
        ctx.lineTo(right, top + 4);
        ctx.lineTo(right, baseY);
        break;
      default:
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, top);
        ctx.lineTo(right, top);
        ctx.lineTo(right, baseY);
        break;
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 12, 22, 0.95)";
    ctx.fill();

    ctx.fillStyle = "rgba(18, 24, 38, 0.94)";
    ctx.fillRect(x + 1, top + 2, Math.max(0, tower.w - 2), 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.fillRect(right - 3, top + 8, 3, tower.h - 8);
  }

  if (!opts.structureOnly && tower.profile === "leftLandmark") {
    const ribAlphaA = getLightFlicker(t, tower.x * 0.09 + tower.h * 0.03 + 1.1);
    const ribAlphaB = getLightFlicker(t, tower.x * 0.07 + tower.w * 0.13 + 2.6);
    ctx.fillStyle = `rgba(245, 246, 250, ${0.46 + ribAlphaA * 0.38})`;
    ctx.fillRect(x + tower.w * 0.28, top + 22, 2.1, tower.h - 42);
    ctx.fillStyle = `rgba(225, 238, 252, ${0.26 + ribAlphaB * 0.26})`;
    ctx.fillRect(x + tower.w * 0.39, top + 18, 1.4, tower.h - 52);
    for (let row = 0; row < 12; row++) {
      const wy = top + 26 + row * 12;
      const rowFlicker = getLightFlicker(t, tower.x * 0.11 + row * 1.7 + 4.2);
      ctx.fillStyle =
        row % 2 === 0
          ? `rgba(250, 240, 212, ${0.08 + rowFlicker * 0.72})`
          : `rgba(215, 228, 246, ${0.02 + rowFlicker * 0.28})`;
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.9);
    }
    drawFlickerWindows(ctx, {
      x: x + tower.w * 0.48,
      y: top + 28,
      w: tower.w * 0.28,
      h: tower.h - 44,
      rows: 10,
      cols: 2,
      time: t,
      seed: tower.x * 0.17 + 2.1,
      warmBias: 0.75,
      paneW: 2,
      paneH: 3,
      gapX: 4,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "twinSpire") {
    const spineA = getLightFlicker(t, tower.x * 0.08 + 6.1);
    const spineB = getLightFlicker(t, tower.x * 0.11 + 8.7);
    ctx.fillStyle = `rgba(250, 244, 220, ${0.24 + spineA * 0.34})`;
    ctx.fillRect(x + tower.w * 0.23, top + 18, 1.6, tower.h - 28);
    ctx.fillStyle = `rgba(242, 236, 214, ${0.22 + spineB * 0.32})`;
    ctx.fillRect(x + tower.w * 0.73, top + 18, 1.6, tower.h - 28);
    for (let row = 0; row < 11; row++) {
      const wy = top + 24 + row * 13;
      const rowFlicker = getLightFlicker(t, tower.x * 0.06 + row * 2.1 + 9.2);
      ctx.fillStyle =
        row % 3 === 0
          ? `rgba(255, 232, 186, ${0.06 + rowFlicker * 0.68})`
          : `rgba(205, 220, 240, ${0.01 + rowFlicker * 0.22})`;
      ctx.fillRect(x + 5, wy, tower.w - 10, 1.6);
    }
    drawFlickerWindows(ctx, {
      x: x + 6,
      y: top + 28,
      w: tower.w - 12,
      h: tower.h - 40,
      rows: 9,
      cols: 3,
      time: t,
      seed: tower.x * 0.19 + 4.8,
      warmBias: 0.68,
      paneW: 2.2,
      paneH: 3,
      gapX: 5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "slantedBlock") {
    for (let row = 0; row < 10; row++) {
      const wy = top + 16 + row * 12;
      const inset = row * 0.95;
      const rowFlicker = getLightFlicker(t, tower.x * 0.09 + row * 1.9 + 12.4);
      ctx.fillStyle = `rgba(224, 236, 250, ${0.02 + rowFlicker * 0.32})`;
      ctx.fillRect(x + 6 + inset, wy, tower.w - 18 - inset, 1.5);
    }
    ctx.fillStyle = `rgba(248, 244, 222, ${0.22 + getLightFlicker(t, tower.x * 0.05 + 15.1) * 0.34})`;
    ctx.fillRect(right - 4, top + 9, 2, tower.h - 18);
    drawFlickerWindows(ctx, {
      x: x + 7,
      y: top + 24,
      w: tower.w - 16,
      h: tower.h - 34,
      rows: 8,
      cols: 3,
      time: t,
      seed: tower.x * 0.13 + 7.4,
      warmBias: 0.58,
      paneW: 2.6,
      paneH: 2.8,
      gapX: 5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "eggTower") {
    for (let row = 0; row < 9; row++) {
      const wy = top + 22 + row * 11;
      const shrink = Math.abs(row - 4) * 0.8;
      const rowFlicker = getLightFlicker(t, tower.x * 0.08 + row * 1.4 + 18.3);
      ctx.fillStyle = `rgba(224, 238, 252, ${0.02 + rowFlicker * 0.36})`;
      ctx.fillRect(x + 5 + shrink, wy, tower.w - 10 - shrink * 2, 1.7);
    }
    ctx.fillStyle = `rgba(248, 240, 214, ${0.16 + getLightFlicker(t, tower.x * 0.05 + 22.8) * 0.24})`;
    ctx.fillRect(x + tower.w * 0.68, top + 18, 1.7, tower.h - 26);
    drawFlickerWindows(ctx, {
      x: x + 8,
      y: top + 30,
      w: tower.w - 16,
      h: tower.h - 46,
      rows: 7,
      cols: 3,
      time: t,
      seed: tower.x * 0.11 + 10.2,
      warmBias: 0.62,
      paneW: 2.3,
      paneH: 2.8,
      gapX: 4.5,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else if (tower.profile === "bladeTower") {
    ctx.fillStyle = `rgba(236, 244, 255, ${0.1 + getLightFlicker(t, tower.x * 0.09 + 25.2) * 0.22})`;
    ctx.fillRect(x + tower.w * 0.16, top + 12, 1.4, tower.h - 18);
    ctx.fillStyle = `rgba(255, 238, 205, ${0.2 + getLightFlicker(t, tower.x * 0.07 + 28.9) * 0.28})`;
    ctx.fillRect(right - 3.2, top + 10, 1.8, tower.h - 16);
    for (let row = 0; row < 11; row++) {
      const wy = top + 20 + row * 14;
      const rowFlicker = getLightFlicker(t, tower.x * 0.1 + row * 2.4 + 31.3);
      ctx.fillStyle =
        row % 2 === 0
          ? `rgba(215, 232, 248, ${0.01 + rowFlicker * 0.26})`
          : `rgba(255, 242, 214, ${0.01 + rowFlicker * 0.2})`;
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.35);
    }
    drawFlickerWindows(ctx, {
      x: x + 7,
      y: top + 24,
      w: tower.w - 14,
      h: tower.h - 38,
      rows: 9,
      cols: 2,
      time: t,
      seed: tower.x * 0.09 + 12.6,
      warmBias: 0.45,
      paneW: 2.4,
      paneH: 3,
      gapX: 6,
      gapY: 8,
      drawUnlit: !opts.litOnlyAnim,
      litThreshold: opts.litThreshold,
      groupRows: opts.quantizedAnim ? 2 : 1,
      groupCols: opts.quantizedAnim ? 2 : 1,
    });
  } else {
    const rows = Math.max(2, Math.floor(tower.h / 17));
    const cols = tower.windows;
    const winW = cols === 1 ? 3 : 4;
    const gap = cols === 1 ? 0 : 6;
    const startX = x + Math.max(2, (tower.w - cols * winW - (cols - 1) * gap) / 2);
    const groupRows = opts.quantizedAnim ? 2 : 1;
    const groupCols = opts.quantizedAnim ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const groupRow = Math.floor(row / groupRows);
        const groupCol = Math.floor(col / groupCols);
        const litSeed = hash01(tower.x, groupRow, groupCol);
        const lit = Math.sin(t * 0.06 + litSeed * 10 + groupRow * 0.65 + groupCol * 2.1) > (opts.litThreshold ?? -0.2);
        const flicker = getLightFlicker(t, litSeed * 100 + tower.w * 0.07 + tower.h * 0.01);
        const wx = startX + col * (winW + gap);
        const wy = top + 10 + row * 14;
        if (wy > baseY - 8) continue;
        if (lit) {
          ctx.fillStyle = `rgba(255, 202, 132, ${0.02 + litSeed * 0.06 + flicker * 0.44})`;
          ctx.fillRect(wx - 1, wy - 1, winW + 2, 5);
          ctx.fillStyle = `rgba(255, 226, 176, ${0.05 + litSeed * 0.08 + flicker * 0.84})`;
          ctx.fillRect(wx, wy, winW, 3);
          if (flicker > 0.64) {
            ctx.fillStyle = `rgba(255, 236, 194, ${(flicker - 0.64) * 1.15})`;
            ctx.fillRect(wx, wy, winW, 1.4);
          }
        } else if (!opts.litOnlyAnim) {
          ctx.fillStyle = "rgba(4, 6, 12, 0.66)";
          ctx.fillRect(wx, wy, winW, 3);
        }
      }
    }
  }
  ctx.restore();
}

export function mapGameplayBuildingTower(
  building: Pick<Building, "x" | "w" | "h" | "windows">,
  index: number,
): TitleTower {
  const scenicTower = TITLE_SKYLINE_TOWERS[index];
  return {
    x: building.x,
    w: building.w,
    h: building.h,
    windows: building.windows,
    profile: scenicTower?.profile ?? "generic",
    roof: scenicTower?.roof ?? "flat",
    glow: scenicTower?.glow ?? 0.06,
  };
}

function buildTowerAssets(
  towers: readonly TitleTower[],
  baseY: number,
  glowScale: number,
  frameCount: number,
  period: number,
  litOnlyAnim = false,
  quantizedAnim = false,
): BuildingAssets {
  const staticSprites: HTMLCanvasElement[] = [];
  const animFrames: HTMLCanvasElement[][] = [];
  const staticOffsets: Array<{ x: number; y: number }> = [];
  const animOffsets: Array<{ x: number; y: number }> = [];

  for (const tower of towers) {
    const top = baseY - tower.h;
    const staticCanvas = createSpriteCanvas(tower.w + GLOW_MARGIN * 2, tower.h + GLOW_MARGIN);
    const staticCtx = staticCanvas.getContext("2d");
    if (staticCtx) {
      staticCtx.translate(-tower.x + GLOW_MARGIN, -top + GLOW_MARGIN);
      drawSharedTower(staticCtx, tower, baseY, 0, 0, glowScale, { structureOnly: true });
    }
    staticSprites.push(staticCanvas);
    staticOffsets.push({
      x: tower.x - GLOW_MARGIN,
      y: top - GLOW_MARGIN,
    });

    const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
      const canvas = createSpriteCanvas(tower.w, tower.h);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.translate(-tower.x, -top);
        drawSharedTower(ctx, tower, baseY, (frameIndex / frameCount) * period, 0, glowScale, {
          animOnly: true,
          litOnlyAnim,
          litThreshold: litOnlyAnim ? TITLE_BUILDING_LIT_THRESHOLD : undefined,
          quantizedAnim,
        });
      }
      return canvas;
    });
    animFrames.push(frames);
    animOffsets.push({ x: tower.x, y: top });
  }

  return {
    staticSprites,
    animFrames,
    staticOffsets,
    animOffsets,
    frameCount,
    period,
  };
}

export function buildBuildingAssets(baseY: number): BuildingAssets {
  const towers = SCENIC_BUILDING_LAYOUT.map((building, index) => mapGameplayBuildingTower(building, index));
  return buildTowerAssets(
    towers,
    baseY,
    0.48,
    GAMEPLAY_BUILDING_ANIM_FRAME_COUNT,
    GAMEPLAY_BUILDING_ANIM_PERIOD_SECONDS,
  );
}

export function buildTitleBuildingAssets(baseY: number): BuildingAssets {
  return buildTowerAssets(
    TITLE_SKYLINE_TOWERS,
    baseY,
    1,
    TITLE_BUILDING_ANIM_FRAME_COUNT,
    TITLE_BUILDING_BAKE_PERIOD_SECONDS,
    true,
    true,
  );
}

export const burjLeftSections = [
  { top: 1.0, bottom: 0.982, w: 0.7 },
  { top: 0.982, bottom: 0.958, w: 0.9 },
  { top: 0.958, bottom: 0.928, w: 1.15 },
  { top: 0.928, bottom: 0.892, w: 1.55 },
  { top: 0.892, bottom: 0.85, w: 2.0 },
  { top: 0.85, bottom: 0.802, w: 2.45 },
  { top: 0.802, bottom: 0.748, w: 3.4 },
  { top: 0.748, bottom: 0.69, w: 4.1 },
  { top: 0.69, bottom: 0.626, w: 5.6 },
  { top: 0.626, bottom: 0.556, w: 7.5 },
  { top: 0.556, bottom: 0.48, w: 8.6 },
  { top: 0.48, bottom: 0.398, w: 11.4 },
  { top: 0.398, bottom: 0.312, w: 13.2 },
  { top: 0.312, bottom: 0.222, w: 16.8 },
  { top: 0.222, bottom: 0.12, w: 18.9 },
  { top: 0.12, bottom: 0.0, w: 22.2 },
] as const;

export const burjRightSections = [
  { top: 1.0, bottom: 0.982, w: 0.7 },
  { top: 0.982, bottom: 0.958, w: 0.98 },
  { top: 0.958, bottom: 0.928, w: 1.34 },
  { top: 0.928, bottom: 0.892, w: 1.8 },
  { top: 0.892, bottom: 0.85, w: 2.35 },
  { top: 0.85, bottom: 0.802, w: 3.1 },
  { top: 0.802, bottom: 0.748, w: 4.05 },
  { top: 0.748, bottom: 0.69, w: 5.3 },
  { top: 0.69, bottom: 0.626, w: 6.5 },
  { top: 0.626, bottom: 0.556, w: 7.2 },
  { top: 0.556, bottom: 0.48, w: 10.2 },
  { top: 0.48, bottom: 0.398, w: 11.2 },
  { top: 0.398, bottom: 0.312, w: 15.6 },
  { top: 0.312, bottom: 0.222, w: 16.5 },
  { top: 0.222, bottom: 0.12, w: 20.7 },
  { top: 0.12, bottom: 0.0, w: 21.8 },
] as const;

export function burjPath(ctx: CanvasRenderingContext2D, burjBaseY: number, burjX = BURJ_X, burjHeight = BURJ_H) {
  const tipY = burjBaseY - burjHeight - 50;
  const upperY = burjBaseY - burjHeight - 18;
  ctx.beginPath();
  ctx.moveTo(burjX, tipY);
  ctx.lineTo(burjX - 0.78, upperY);
  ctx.lineTo(burjX - burjLeftSections[0].w, burjBaseY - burjHeight * burjLeftSections[0].top);
  for (let i = 0; i < burjLeftSections.length; i++) {
    const section = burjLeftSections[i];
    const bottomY = burjBaseY - burjHeight * section.bottom;
    ctx.lineTo(burjX - section.w, bottomY);
    const next = burjLeftSections[i + 1];
    if (next) ctx.lineTo(burjX - next.w, bottomY);
  }
  for (let i = burjRightSections.length - 1; i >= 0; i--) {
    const section = burjRightSections[i];
    const bottomY = burjBaseY - burjHeight * section.bottom;
    const topY = burjBaseY - burjHeight * section.top;
    ctx.lineTo(burjX + section.w, bottomY);
    ctx.lineTo(burjX + section.w, topY);
    const prev = burjRightSections[i - 1];
    if (prev) ctx.lineTo(burjX + prev.w, topY);
  }
  ctx.lineTo(burjX + 0.78, upperY);
  ctx.closePath();
}

export function halfWidthsAt(ht: number) {
  let left = burjLeftSections[burjLeftSections.length - 1].w;
  let right = burjRightSections[burjRightSections.length - 1].w;
  for (const section of burjLeftSections) {
    if (ht <= section.top && ht >= section.bottom) {
      left = section.w;
      break;
    }
  }
  for (const section of burjRightSections) {
    if (ht <= section.top && ht >= section.bottom) {
      right = section.w;
      break;
    }
  }
  return { left, right };
}

function toBurjLocalX(x: number, artScale: number) {
  return BURJ_X + (x - BURJ_X) / artScale;
}

function toBurjLocalY(y: number, burjBaseY: number, artScale: number) {
  return burjBaseY + (y - burjBaseY) / artScale;
}

function getBurjSpriteBounds(groundY: number, artScale: number) {
  const burjBaseY = groundY - 6;
  const minX = Math.floor(Math.min(BURJ_X - 24, toBurjLocalX(BURJ_X - 140, artScale)) - 4);
  const maxX = Math.ceil(Math.max(BURJ_X + 24, toBurjLocalX(BURJ_X + 140, artScale)) + 4);
  const minY = Math.floor(Math.min(burjBaseY - BURJ_H - 54, toBurjLocalY(groundY - 140, burjBaseY, artScale)) - 4);
  const maxY = Math.ceil(Math.max(burjBaseY + 6, toBurjLocalY(groundY + 40, burjBaseY, artScale)) + 4);
  return {
    burjBaseY,
    offset: { x: minX, y: minY },
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getBurjBakeResolution(artScale: number) {
  // Counteract the 2x title/gameplay anchor scaling so the prebaked Burj keeps edge detail.
  return Math.max(1, Math.ceil(artScale));
}

function drawBurjStaticSprite(ctx: CanvasRenderingContext2D, groundY: number, artScale: number) {
  const burjBaseY = groundY - 6;
  const podiumCenterY = toBurjLocalY(groundY - 20, burjBaseY, artScale);
  const podiumRadius = 140 / artScale;
  const podiumGlow = ctx.createRadialGradient(BURJ_X, podiumCenterY, 0, BURJ_X, podiumCenterY, podiumRadius);
  podiumGlow.addColorStop(0, "rgba(196, 242, 255, 0.32)");
  podiumGlow.addColorStop(0.32, "rgba(120, 210, 255, 0.22)");
  podiumGlow.addColorStop(0.62, "rgba(255, 180, 120, 0.12)");
  podiumGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = podiumGlow;
  ctx.fillRect(BURJ_X - podiumRadius, podiumCenterY - podiumRadius, podiumRadius * 2, podiumRadius * 1.3);

  const burjGrad = ctx.createLinearGradient(BURJ_X, burjBaseY - BURJ_H, BURJ_X, burjBaseY);
  burjGrad.addColorStop(0, "#fbfdff");
  burjGrad.addColorStop(0.08, "#dcecff");
  burjGrad.addColorStop(0.2, "#6e88a7");
  burjGrad.addColorStop(0.42, "#243446");
  burjGrad.addColorStop(0.7, "#182330");
  burjGrad.addColorStop(1, "#202a34");
  ctx.fillStyle = burjGrad;
  burjPath(ctx, burjBaseY);
  ctx.fill();

  ctx.strokeStyle = "rgba(236,246,255,0.28)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(BURJ_X, burjBaseY - BURJ_H - 44);
  ctx.lineTo(BURJ_X, burjBaseY - 28);
  ctx.stroke();

  ctx.fillStyle = "rgba(10, 18, 28, 0.56)";
  ctx.fillRect(BURJ_X - 8.2, burjBaseY - BURJ_H + 158, 16.4, 10);
  ctx.fillRect(BURJ_X - 11.4, burjBaseY - BURJ_H + 224, 22.8, 10);
}

function drawBurjAnimFrame(ctx: CanvasRenderingContext2D, groundY: number, time: number) {
  const burjBaseY = groundY - 6;
  const spineFlicker = getLightFlicker(time, 41.7);
  const crownFlicker = getLightFlicker(time, 44.1);
  ctx.fillStyle = `rgba(250, 252, 255, ${0.06 + spineFlicker * 0.68})`;
  ctx.fillRect(BURJ_X - 0.55, burjBaseY - BURJ_H + 18, 1.1, BURJ_H - 18);
  ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + crownFlicker * 0.88})`;
  ctx.fillRect(BURJ_X - 2.4, burjBaseY - BURJ_H + 22, 4.8, 3.6);
  ctx.fillStyle = "rgba(225, 239, 255, 0.16)";
  for (let i = 0; i < 42; i++) {
    const ht = 0.04 + (i / 41) * 0.92;
    const ly = burjBaseY - BURJ_H * ht;
    const { left, right } = halfWidthsAt(ht);
    const lw = left * 0.68;
    const rw = right * 0.68;
    if (lw < 1.2 && rw < 1.2) continue;
    const lit = Math.sin(time * 0.32 + i * 0.48) > -0.12;
    if (!lit) continue;
    const bandFlicker = getLightFlicker(time, 47.5 + i * 0.63);
    ctx.fillStyle =
      i === 13 || i === 23 || i === 33
        ? `rgba(255, 255, 255, ${0.04 + bandFlicker * 0.82})`
        : `rgba(215, 232, 248, ${0.01 + bandFlicker * 0.22})`;
    ctx.fillRect(BURJ_X - lw, ly, lw + rw, 0.72);
  }

  const brightBands = [
    { ht: 0.11, alpha: 0.96, thickness: 3.1 },
    { ht: 0.2, alpha: 0.92, thickness: 2.6 },
    { ht: 0.31, alpha: 0.88, thickness: 2.3 },
    { ht: 0.44, alpha: 0.82, thickness: 2.1 },
    { ht: 0.59, alpha: 0.76, thickness: 1.9 },
    { ht: 0.75, alpha: 0.68, thickness: 1.7 },
    { ht: 0.88, alpha: 0.6, thickness: 1.45 },
  ];
  brightBands.forEach((band, index) => {
    const ly = burjBaseY - BURJ_H * band.ht;
    const { left, right } = halfWidthsAt(band.ht);
    const bandFlicker = getLightFlicker(time, 83.1 + index * 1.9);
    ctx.fillStyle = `rgba(252, 253, 255, ${band.alpha * (0.26 + bandFlicker * 0.94)})`;
    ctx.fillRect(BURJ_X - left * 0.88, ly, left * 0.88 + right * 0.88, band.thickness);
    ctx.fillStyle = `rgba(15, 24, 34, ${0.34 - index * 0.03})`;
    ctx.fillRect(BURJ_X - left * 0.9, ly + band.thickness, left * 0.9 + right * 0.9, 1.15);
    ctx.fillStyle = `rgba(130, 200, 255, ${0.01 + bandFlicker * 0.24})`;
    ctx.fillRect(BURJ_X - left * 0.86, ly - 0.7, left * 0.86 + right * 0.86, 0.55);
  });

  ctx.fillStyle = `rgba(248, 252, 255, ${0.08 + getLightFlicker(time, 97.2) * 0.92})`;
  ctx.fillRect(BURJ_X - 7.1, burjBaseY - BURJ_H + 166, 14.2, 2.6);
  ctx.fillStyle = `rgba(255, 224, 176, ${0.04 + getLightFlicker(time, 101.4) * 0.56})`;
  ctx.fillRect(BURJ_X - 9.4, burjBaseY - BURJ_H + 232, 18.8, 2.1);

  const accentLights = [
    { ht: 0.18, width: 0.54, thickness: 1.4, seed: 106.2, color: "255, 236, 194" },
    { ht: 0.36, width: 0.5, thickness: 1.2, seed: 109.8, color: "214, 236, 255" },
    { ht: 0.52, width: 0.46, thickness: 1.15, seed: 113.3, color: "255, 228, 168" },
    { ht: 0.68, width: 0.38, thickness: 1.05, seed: 117.1, color: "220, 240, 255" },
  ];
  accentLights.forEach((light) => {
    const ly = burjBaseY - BURJ_H * light.ht;
    const { left, right } = halfWidthsAt(light.ht);
    const flicker = getLightFlicker(time, light.seed);
    const span = (left + right) * 0.5 * light.width;
    ctx.fillStyle = `rgba(${light.color}, ${0.02 + flicker * 0.68})`;
    ctx.fillRect(BURJ_X - span * 0.5, ly, span, light.thickness);
  });
}

export function buildBurjAssets(groundY: number, artScale: number): BurjAssets {
  const bounds = getBurjSpriteBounds(groundY, artScale);
  const resolutionScale = getBurjBakeResolution(artScale);
  const staticSprite = createSpriteCanvas(bounds.width, bounds.height, resolutionScale);
  const staticCtx = staticSprite.getContext("2d");
  if (staticCtx) {
    staticCtx.scale(resolutionScale, resolutionScale);
    staticCtx.translate(-bounds.offset.x, -bounds.offset.y);
    drawBurjStaticSprite(staticCtx, groundY, artScale);
  }

  const animFrames = Array.from({ length: BURJ_ANIM_FRAME_COUNT }, (_, frameIndex) => {
    const canvas = createSpriteCanvas(bounds.width, bounds.height, resolutionScale);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(resolutionScale, resolutionScale);
      ctx.translate(-bounds.offset.x, -bounds.offset.y);
      drawBurjAnimFrame(ctx, groundY, (frameIndex / BURJ_ANIM_FRAME_COUNT) * BURJ_ANIM_PERIOD_SECONDS);
    }
    return canvas;
  });

  return {
    staticSprite,
    animFrames,
    offset: bounds.offset,
    frameCount: BURJ_ANIM_FRAME_COUNT,
    period: BURJ_ANIM_PERIOD_SECONDS,
    resolutionScale,
  };
}

export function createSpriteCanvas(width: number, height: number, resolutionScale = 1): HTMLCanvasElement {
  const pixelWidth = Math.max(1, Math.round(width * resolutionScale));
  const pixelHeight = Math.max(1, Math.round(height * resolutionScale));
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    return canvas;
  }

  const ctx = createStubCanvasContext(pixelWidth, pixelHeight);
  return {
    width: pixelWidth,
    height: pixelHeight,
    getContext: (kind: string) => (kind === "2d" ? ctx : null),
  } as unknown as HTMLCanvasElement;
}

function drawStaticBackground(ctx: CanvasRenderingContext2D, renderHeight: number, groundY: number) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGrad.addColorStop(0, "#050810");
  skyGrad.addColorStop(0.5, "#0a1030");
  skyGrad.addColorStop(1, "#120d24");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  ctx.save();
  ctx.fillStyle = "rgba(0,255,200,0.018)";
  for (let y = 0; y < renderHeight; y += 3) ctx.fillRect(0, y, CANVAS_W, 1);
  ctx.restore();

  const skyGlow = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGlow.addColorStop(0, "#050812");
  skyGlow.addColorStop(0.5, "#0a1030");
  skyGlow.addColorStop(1, "#130f2d");
  ctx.fillStyle = skyGlow;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  for (let i = 0; i < GAME_TITLE_STARFIELD_DENSITY; i++) {
    const sx = hash01(i, 2, 7) * CANVAS_W;
    const sy = hash01(i, 5, 11) * 1500 + 8;
    const size = (0.7 + hash01(i, 3, 1) * 1.6) * 0.92;
    ctx.fillStyle = "rgba(220, 235, 255, 0.428)";
    ctx.fillRect(sx, sy, size, size);
  }

  ctx.save();
  ctx.translate(764, 56);
  ctx.fillStyle = "rgba(235, 232, 214, 0.9)";
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#070912";
  ctx.beginPath();
  ctx.arc(6, -3, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const bloom = ctx.createRadialGradient(BURJ_X, groundY - 220, 20, BURJ_X, groundY - 220, 320);
  bloom.addColorStop(0, "rgba(110, 205, 255, 0.12)");
  bloom.addColorStop(0.45, "rgba(90, 120, 255, 0.08)");
  bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);
}

function drawBakedStars(ctx: CanvasRenderingContext2D, stars: PreparedStar[], time: number) {
  for (const star of stars) {
    if (star.hero) continue;
    ctx.fillStyle = "rgba(220, 235, 255, 0.158)";
    ctx.fillRect(star.x, star.y, star.size * 1.2, star.size * 1.2);
  }

  ctx.fillStyle = "rgb(220,235,255)";
  for (const star of stars) {
    if (!star.hero) continue;
    const { shimmer, flare } = getStarTwinkleProfile(time, star.twinkle, star.seed);
    const alpha = 0.08 + shimmer * 0.1 + flare * 0.42;
    const sizeMul = 1 + flare * 0.95;
    ctx.globalAlpha = alpha;
    ctx.fillRect(star.x, star.y, star.size * 1.2 * sizeMul, star.size * 1.2 * sizeMul);
    if (flare > 0.12) {
      ctx.fillStyle = "rgb(255,255,255)";
      ctx.globalAlpha = 0.12 + flare * 0.52;
      const reach = star.size * (0.8 + flare * 2.4);
      ctx.fillRect(star.x - reach, star.y, reach * 2.4, Math.max(1, star.size * 0.45));
      ctx.fillRect(star.x, star.y - reach, Math.max(1, star.size * 0.45), reach * 2.4);
      ctx.fillStyle = "rgb(220,235,255)";
    }
  }
  ctx.globalAlpha = 1;
}

export function buildSkyAssets(stars: Star[], renderHeight: number, groundY: number): SkyAssets {
  const preparedStars: PreparedStar[] = stars.map((star) => {
    const seed = hash01(star.x, star.y, star.twinkle);
    return { ...star, seed, hero: seed > HERO_STAR_THRESHOLD };
  });

  const frames = Array.from({ length: SKY_FRAME_COUNT }, (_, index) => {
    const canvas = createSpriteCanvas(CANVAS_W, renderHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    drawStaticBackground(ctx, renderHeight, groundY);
    drawBakedStars(ctx, preparedStars, (index / SKY_FRAME_COUNT) * SKY_PERIOD_SECONDS);
    return canvas;
  });

  return {
    frames,
    frameCount: SKY_FRAME_COUNT,
    period: SKY_PERIOD_SECONDS,
  };
}
