import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  GAMEPLAY_SCENIC_GROUND_Y,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  GAMEPLAY_SCENIC_THREAT_FLOOR_Y,
  COL,
  BURJ_X,
  BURJ_H,
  LAUNCHERS,
  SCENIC_BUILDING_LAYOUT,
  getDefenseSitePlacement,
  getGameplayBuildingBounds,
  getGameplayBurjCollisionTop,
  getGameplayBurjHalfW,
  getGameplayLauncherPosition,
  getAmmoCapacity,
  getPhalanxTurrets,
  ov,
} from "./game-logic";
import { UPGRADES } from "./game-sim";
import type {
  GameState,
  Flare,
  Building,
  Plane,
  LaserBeam,
  PhalanxBullet,
  Missile,
  Drone,
  Interceptor,
  Hornet,
  Roadrunner,
  PatriotMissile,
  Explosion,
  Particle,
  EmpRing,
  DefenseSite,
  UpgradeKey,
} from "./types";

// FPS probe: measure first 60 frames, disable shadowBlur if avg FPS < 45
export const perfState = { frameCount: 0, startTime: 0, glowEnabled: true, probed: false };
const ARCADE_FONT_FAMILY = "'Courier New', monospace";
const GAME_TITLE_STARFIELD_BLEND = 1; //0.55;
const GAME_TITLE_STARFIELD_DENSITY = 260;

// Sky nebula background — loaded once, drawn every frame
let _skyImg: HTMLImageElement | null = null;
let _skyLoading = false;
function getSkyImage() {
  if (_skyImg) return _skyImg;
  if (_skyLoading) return null;
  if (typeof Image === "undefined") return null; // headless/test env
  _skyLoading = true;
  const img = new Image();
  img.src = new URL("../public/sky-nebula.png", import.meta.url).href;
  img.onload = () => {
    _skyImg = img;
  };
  img.onerror = () => {
    _skyLoading = false; // allow retry on next call
  };
  return null;
}

let _titleWaterImg: HTMLImageElement | null = null;
let _titleWaterLoading = false;
function getTitleWaterImage() {
  if (_titleWaterImg) return _titleWaterImg;
  if (_titleWaterLoading) return null;
  if (typeof Image === "undefined") return null; // headless/test env
  _titleWaterLoading = true;
  const img = new Image();
  img.src = new URL("./assets/title-water-reflection.png", import.meta.url).href;
  img.onload = () => {
    _titleWaterImg = img;
  };
  img.onerror = () => {
    _titleWaterLoading = false; // allow retry on next call
  };
  return null;
}

let _interceptorHitFlashImg: HTMLImageElement | null = null;
let _interceptorHitFlashLoading = false;
function getInterceptorHitFlashImage() {
  if (_interceptorHitFlashImg) return _interceptorHitFlashImg;
  if (_interceptorHitFlashLoading) return null;
  if (typeof Image === "undefined") return null; // headless/test env
  _interceptorHitFlashLoading = true;
  const img = new Image();
  img.src = new URL("./assets/explosion-hit-flash-b.png", import.meta.url).href;
  img.onload = () => {
    _interceptorHitFlashImg = img;
  };
  img.onerror = () => {
    _interceptorHitFlashLoading = false; // allow retry on next call
  };
  return null;
}

let _missileKillFlashImg: HTMLImageElement | null = null;
let _missileKillFlashLoading = false;
function getMissileKillFlashImage() {
  if (_missileKillFlashImg) return _missileKillFlashImg;
  if (_missileKillFlashLoading) return null;
  if (typeof Image === "undefined") return null;
  _missileKillFlashLoading = true;
  const img = new Image();
  img.src = new URL("./assets/explosion-missile-kill.png", import.meta.url).href;
  img.onload = () => {
    _missileKillFlashImg = img;
  };
  img.onerror = () => {
    _missileKillFlashLoading = false;
  };
  return null;
}

let _droneKillFlashImg: HTMLImageElement | null = null;
let _droneKillFlashLoading = false;
function getDroneKillFlashImage() {
  if (_droneKillFlashImg) return _droneKillFlashImg;
  if (_droneKillFlashLoading) return null;
  if (typeof Image === "undefined") return null;
  _droneKillFlashLoading = true;
  const img = new Image();
  img.src = new URL("./assets/explosion-drone-kill.png", import.meta.url).href;
  img.onload = () => {
    _droneKillFlashImg = img;
  };
  img.onerror = () => {
    _droneKillFlashLoading = false;
  };
  return null;
}

let _buildingDestroyBurstImg: HTMLImageElement | null = null;
let _buildingDestroyBurstLoading = false;
function getBuildingDestroyBurstImage() {
  if (_buildingDestroyBurstImg) return _buildingDestroyBurstImg;
  if (_buildingDestroyBurstLoading) return null;
  if (typeof Image === "undefined") return null;
  _buildingDestroyBurstLoading = true;
  const img = new Image();
  img.src = new URL("./assets/building-destroy-burst.png", import.meta.url).href;
  img.onload = () => {
    _buildingDestroyBurstImg = img;
  };
  img.onerror = () => {
    _buildingDestroyBurstLoading = false;
  };
  return null;
}

let _titleBurjGlowImg: HTMLImageElement | null = null;
let _titleBurjGlowLoading = false;
function getTitleBurjGlowImage() {
  if (_titleBurjGlowImg) return _titleBurjGlowImg;
  if (_titleBurjGlowLoading) return null;
  if (typeof Image === "undefined") return null;
  _titleBurjGlowLoading = true;
  const img = new Image();
  img.src = new URL("./assets/title-burj-glow.png", import.meta.url).href;
  img.onload = () => {
    _titleBurjGlowImg = img;
  };
  img.onerror = () => {
    _titleBurjGlowLoading = false;
  };
  return null;
}

let _burjMissileDecalImg: HTMLImageElement | null = null;
let _burjMissileDecalLoading = false;
function getBurjMissileDecalImage() {
  if (_burjMissileDecalImg) return _burjMissileDecalImg;
  if (_burjMissileDecalLoading) return null;
  if (typeof Image === "undefined") return null;
  _burjMissileDecalLoading = true;
  const img = new Image();
  img.src = new URL("./assets/burj-hit-decal-missile.png", import.meta.url).href;
  img.onload = () => {
    _burjMissileDecalImg = img;
  };
  img.onerror = () => {
    _burjMissileDecalLoading = false;
  };
  return null;
}

let _burjDroneDecalImg: HTMLImageElement | null = null;
let _burjDroneDecalLoading = false;
function getBurjDroneDecalImage() {
  if (_burjDroneDecalImg) return _burjDroneDecalImg;
  if (_burjDroneDecalLoading) return null;
  if (typeof Image === "undefined") return null;
  _burjDroneDecalLoading = true;
  const img = new Image();
  img.src = new URL("./assets/burj-hit-decal-drone.png", import.meta.url).href;
  img.onload = () => {
    _burjDroneDecalImg = img;
  };
  img.onerror = () => {
    _burjDroneDecalLoading = false;
  };
  return null;
}

interface CameraFrame {
  scale: number;
  left: number;
  top: number;
}

interface LayoutProfile {
  showTopHud: boolean;
  showSystemLabels: boolean;
  externalTitle: boolean;
  externalGameOver: boolean;
  crosshairFillRadius: number;
  crosshairOuterRadius: number;
  crosshairInnerRadius: number;
  crosshairGap: number;
  crosshairArmLength: number;
  mirvWarningFontSize: number;
  mirvWarningY: number;
  purchaseToastFontSize: number;
  purchaseToastY: number;
  lowAmmoFontSize: number;
  lowAmmoY: number;
  waveClearedY: number;
  multiKillLabelSize: number;
  multiKillBonusSize: number;
  cameraFrame: CameraFrame | null;
  renderHeight: number;
  buildingScale: number;
  burjScale: number;
  launcherScale: number;
  enemyScale: number;
  projectileScale: number;
  effectScale: number;
  planeScale: number;
}

const DEFAULT_LAYOUT_PROFILE: LayoutProfile = {
  showTopHud: false,
  showSystemLabels: false,
  externalTitle: true,
  externalGameOver: true,
  crosshairFillRadius: 22,
  crosshairOuterRadius: 16,
  crosshairInnerRadius: 18,
  crosshairGap: 9,
  crosshairArmLength: 24,
  mirvWarningFontSize: 32,
  mirvWarningY: 86,
  purchaseToastFontSize: 34,
  purchaseToastY: CANVAS_H * 0.38,
  lowAmmoFontSize: 42,
  lowAmmoY: CANVAS_H * 0.42,
  waveClearedY: CANVAS_H * 0.5,
  multiKillLabelSize: 34,
  multiKillBonusSize: 24,
  cameraFrame: null,
  renderHeight: CANVAS_H,
  buildingScale: 2,
  burjScale: 2,
  launcherScale: 3,
  enemyScale: 3,
  projectileScale: 2,
  effectScale: 2,
  planeScale: 3,
};

function resolveLayoutProfile(layoutProfile: Partial<LayoutProfile> = {}): LayoutProfile {
  return { ...DEFAULT_LAYOUT_PROFILE, ...layoutProfile };
}

function withAnchorScale(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  scale: number,
  draw: () => void,
) {
  if (scale === 1) {
    draw();
    return;
  }
  ctx.save();
  ctx.translate(anchorX, anchorY);
  ctx.scale(scale, scale);
  ctx.translate(-anchorX, -anchorY);
  draw();
  ctx.restore();
}

const GLOW_SCALE = 0.45;

export function glow(ctx: CanvasRenderingContext2D, color: string, radius: number) {
  if (!ov("glow.enabled", perfState.glowEnabled)) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * ov("glow.scale", GLOW_SCALE);
}

export function glowOff(ctx: CanvasRenderingContext2D) {
  if (!ov("glow.enabled", perfState.glowEnabled)) return;
  ctx.shadowBlur = 0;
}

function drawTitleStyleMissile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  {
    scale = 1,
    alpha = 1,
    trailLen = 58,
    trailPulse = 1,
  }: {
    scale?: number;
    alpha?: number;
    trailLen?: number;
    trailPulse?: number;
  } = {},
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  const len = trailLen * (0.84 + 0.16 * trailPulse);
  const trail = ctx.createLinearGradient(-len, 0, -2, 0);
  trail.addColorStop(0, "rgba(255, 150, 70, 0)");
  trail.addColorStop(0.45, "rgba(255, 150, 70, 0.14)");
  trail.addColorStop(0.82, "rgba(210, 220, 230, 0.28)");
  trail.addColorStop(1, "rgba(210, 220, 230, 0.05)");
  ctx.strokeStyle = trail;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-len, 0);
  ctx.lineTo(-2, 0);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 204, 140, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-len * 0.62, 0);
  ctx.lineTo(-6, 0);
  ctx.stroke();
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
  ctx.lineTo(-12, 0);
  ctx.lineTo(-2, 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe7b8";
  ctx.beginPath();
  ctx.moveTo(-2, -1);
  ctx.lineTo(-7, 0);
  ctx.lineTo(-2, 1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawStackCarrierMissile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  {
    scale = 1,
    alpha = 1,
    trailPulse = 1,
    payloadCount,
  }: {
    scale?: number;
    alpha?: number;
    trailPulse?: number;
    payloadCount: 2 | 3;
  },
) {
  const renderScale = 0.8;
  const bodyHalfH = payloadCount === 3 ? 5.2 : 4.6;
  const noseX = payloadCount === 3 ? 25 : 22.5;
  const bodyFrontX = payloadCount === 3 ? 15.5 : 14;
  const tailX = payloadCount === 3 ? -20.5 : -18;
  const trailLen = (payloadCount === 3 ? 60 : 52) * (0.82 + 0.18 * trailPulse);
  const payloadOffsets = payloadCount === 3 ? [-1.85, 0, 1.85] : [-1.3, 1.3];
  const finSpan = payloadCount === 3 ? 10 : 9;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale * renderScale, scale * renderScale);
  ctx.globalAlpha = alpha;

  const exhaust = ctx.createLinearGradient(-trailLen - 6, 0, tailX + 1, 0);
  exhaust.addColorStop(0, "rgba(255, 122, 36, 0)");
  exhaust.addColorStop(0.35, "rgba(255, 140, 58, 0.18)");
  exhaust.addColorStop(0.72, "rgba(238, 228, 216, 0.24)");
  exhaust.addColorStop(1, "rgba(255, 214, 148, 0.08)");
  ctx.strokeStyle = exhaust;
  ctx.lineCap = "round";
  ctx.lineWidth = payloadCount === 3 ? 4.1 : 3.7;
  ctx.beginPath();
  ctx.moveTo(-trailLen - 6, 0);
  ctx.lineTo(tailX + 1, 0);
  ctx.stroke();

  const outerWake = ctx.createLinearGradient(-trailLen * 0.92 - 4, 0, tailX - 2, 0);
  outerWake.addColorStop(0, "rgba(255, 112, 42, 0)");
  outerWake.addColorStop(0.6, "rgba(255, 164, 78, 0.12)");
  outerWake.addColorStop(1, "rgba(240, 246, 255, 0.05)");
  ctx.strokeStyle = outerWake;
  ctx.lineWidth = payloadCount === 3 ? 7.1 : 6.3;
  ctx.beginPath();
  ctx.moveTo(-trailLen * 0.92 - 4, 0);
  ctx.lineTo(tailX - 2, 0);
  ctx.stroke();

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

  glow(ctx, payloadCount === 3 ? "#ffc27a" : "#ffb56a", 8.5 * renderScale);
  ctx.fillStyle = "#ff9a4d";
  ctx.beginPath();
  ctx.moveTo(tailX, -2.8);
  ctx.lineTo(tailX - (payloadCount === 3 ? 14 : 11), 0);
  ctx.lineTo(tailX, 2.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffe4ae";
  ctx.beginPath();
  ctx.moveTo(tailX + 0.4, -1.4);
  ctx.lineTo(tailX - (payloadCount === 3 ? 7.2 : 5.8), 0);
  ctx.lineTo(tailX + 0.4, 1.4);
  ctx.closePath();
  ctx.fill();
  glowOff(ctx);

  ctx.restore();
}

export function hash01(a: number, b = 0, c = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

export function pulse(time: number, speed: number, phase = 0, min = 0, max = 1) {
  const t = 0.5 + 0.5 * Math.sin(time * speed + phase);
  return min + (max - min) * t;
}

type TitleTower = {
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

const TITLE_SKYLINE_TOWERS: TitleTower[] = [...SCENIC_BUILDING_LAYOUT];

const TITLE_LAUNCHER_ANGLES = [-1.1, -1.57, -2.05];

interface SharedSkyOptions {
  mode: "title" | "game";
  renderHeight: number;
  groundY: number;
  stars?: GameState["stars"];
}

interface SharedBurjOptions {
  mode: "title" | "game";
  groundY: number;
  alive: boolean;
  burjHealth?: number;
  artScale: number;
  t: number;
  burjDecals?: GameState["burjDecals"];
  burjDamageFx?: GameState["burjDamageFx"];
  burjHitFlashTimer?: number;
  burjHitFlashMax?: number;
  burjHitFlashX?: number;
  burjHitFlashY?: number;
}

interface SharedWaterOptions {
  groundY: number;
  renderHeight: number;
  tintBottomAlpha?: number;
}

interface SharedLauncherOptions {
  t: number;
  scale?: number;
  alpha?: number;
  damaged?: boolean;
  active?: boolean;
  muzzleFlash?: number;
  statusLabel?: string | null;
}

function drawSharedSky(
  ctx: CanvasRenderingContext2D,
  { mode, renderHeight, groundY, stars }: SharedSkyOptions,
  t: number,
) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGrad.addColorStop(0, "#050810");
  skyGrad.addColorStop(0.5, "#0a1030");
  skyGrad.addColorStop(1, mode === "title" ? "#151030" : "#120d24");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  ctx.save();
  ctx.fillStyle = mode === "title" ? "rgba(0,255,200,0.03)" : "rgba(0,255,200,0.018)";
  for (let y = 0; y < renderHeight; y += 3) {
    ctx.fillRect(0, y + ((t * 20) % 3), CANVAS_W, 1);
  }
  ctx.restore();

  const skyGlow = ctx.createLinearGradient(0, 0, 0, renderHeight);
  skyGlow.addColorStop(0, "#050812");
  skyGlow.addColorStop(0.5, "#0a1030");
  skyGlow.addColorStop(1, "#130f2d");
  ctx.fillStyle = skyGlow;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);

  if (mode === "game" && GAME_TITLE_STARFIELD_BLEND > 0) {
    const titleDrift = Math.sin(t * 0.08) * 4;
    for (let i = 0; i < GAME_TITLE_STARFIELD_DENSITY; i++) {
      const sx = (hash01(i, 2, 7) * CANVAS_W + titleDrift * 0.3) % CANVAS_W;
      const sy = hash01(i, 5, 11) * 1500 + 8;
      const tw = 0.55 + 0.45 * Math.sin(t * (0.7 + hash01(i, 1, 9)) + i * 0.9);
      const size = (0.7 + hash01(i, 3, 1) * 1.6) * 0.92;
      ctx.fillStyle = `rgba(220, 235, 255, ${(0.18 + tw * 0.32) * GAME_TITLE_STARFIELD_BLEND})`;
      ctx.fillRect(sx, sy, size, size);
    }
  }

  if (stars?.length) {
    stars.forEach((s) => {
      const tw = 0.3 + 0.7 * Math.sin(t * 2 + s.twinkle);
      const alpha = mode === "title" ? 0.14 + tw * 0.2 : 0.11 + tw * 0.16;
      ctx.fillStyle = `rgba(220, 235, 255, ${alpha})`;
      ctx.fillRect(s.x, s.y, s.size * 1.2, s.size * 1.2);
    });
  } else {
    const titleDrift = Math.sin(t * 0.08) * 4;
    for (let i = 0; i < 500; i++) {
      const sx = (hash01(i, 2, 7) * CANVAS_W + titleDrift * 0.3) % CANVAS_W;
      const sy = hash01(i, 5, 11) * 1500 + 8;
      const tw = 0.55 + 0.45 * Math.sin(t * (0.7 + hash01(i, 1, 9)) + i * 0.9);
      const size = 0.7 + hash01(i, 3, 1) * 1.6;
      ctx.fillStyle = `rgba(220, 235, 255, ${0.18 + tw * 0.32})`;
      ctx.fillRect(sx, sy, size, size);
    }
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
  bloom.addColorStop(0, mode === "title" ? "rgba(130, 220, 255, 0.18)" : "rgba(110, 205, 255, 0.12)");
  bloom.addColorStop(0.45, "rgba(90, 120, 255, 0.08)");
  bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CANVAS_W, renderHeight);
}

function drawSharedTower(
  ctx: CanvasRenderingContext2D,
  tower: TitleTower,
  baseY: number,
  t: number,
  offset = 0,
  glowScale = 1,
) {
  const x = tower.x + offset;
  const top = baseY - tower.h;
  const right = x + tower.w;
  const mid = x + tower.w / 2;

  ctx.save();
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

  if (tower.profile === "leftLandmark") {
    ctx.fillStyle = "rgba(245, 246, 250, 0.78)";
    ctx.fillRect(x + tower.w * 0.28, top + 22, 2.1, tower.h - 42);
    ctx.fillRect(x + tower.w * 0.39, top + 18, 1.4, tower.h - 52);
    for (let row = 0; row < 12; row++) {
      const wy = top + 26 + row * 12;
      ctx.fillStyle = row % 2 === 0 ? "rgba(250, 240, 212, 0.46)" : "rgba(215, 228, 246, 0.16)";
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.9);
    }
  } else if (tower.profile === "twinSpire") {
    ctx.fillStyle = "rgba(250, 244, 220, 0.54)";
    ctx.fillRect(x + tower.w * 0.23, top + 18, 1.6, tower.h - 28);
    ctx.fillRect(x + tower.w * 0.73, top + 18, 1.6, tower.h - 28);
    for (let row = 0; row < 11; row++) {
      const wy = top + 24 + row * 13;
      ctx.fillStyle = row % 3 === 0 ? "rgba(255, 232, 186, 0.48)" : "rgba(205, 220, 240, 0.1)";
      ctx.fillRect(x + 5, wy, tower.w - 10, 1.6);
    }
  } else if (tower.profile === "slantedBlock") {
    for (let row = 0; row < 10; row++) {
      const wy = top + 16 + row * 12;
      const inset = row * 0.95;
      ctx.fillStyle = "rgba(224, 236, 250, 0.18)";
      ctx.fillRect(x + 6 + inset, wy, tower.w - 18 - inset, 1.5);
    }
    ctx.fillStyle = "rgba(248, 244, 222, 0.52)";
    ctx.fillRect(right - 4, top + 9, 2, tower.h - 18);
  } else if (tower.profile === "eggTower") {
    for (let row = 0; row < 9; row++) {
      const wy = top + 22 + row * 11;
      const shrink = Math.abs(row - 4) * 0.8;
      ctx.fillStyle = "rgba(224, 238, 252, 0.2)";
      ctx.fillRect(x + 5 + shrink, wy, tower.w - 10 - shrink * 2, 1.7);
    }
    ctx.fillStyle = "rgba(248, 240, 214, 0.4)";
    ctx.fillRect(x + tower.w * 0.68, top + 18, 1.7, tower.h - 26);
  } else if (tower.profile === "bladeTower") {
    ctx.fillStyle = "rgba(236, 244, 255, 0.28)";
    ctx.fillRect(x + tower.w * 0.16, top + 12, 1.4, tower.h - 18);
    ctx.fillStyle = "rgba(255, 238, 205, 0.46)";
    ctx.fillRect(right - 3.2, top + 10, 1.8, tower.h - 16);
    for (let row = 0; row < 11; row++) {
      const wy = top + 20 + row * 14;
      ctx.fillStyle = row % 2 === 0 ? "rgba(215, 232, 248, 0.14)" : "rgba(255, 242, 214, 0.1)";
      ctx.fillRect(x + 6, wy, tower.w - 12, 1.35);
    }
  } else {
    const rows = Math.max(2, Math.floor(tower.h / 17));
    const cols = tower.windows;
    const winW = cols === 1 ? 3 : 4;
    const gap = cols === 1 ? 0 : 6;
    const startX = x + Math.max(2, (tower.w - cols * winW - (cols - 1) * gap) / 2);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const litSeed = hash01(tower.x, row, col);
        const lit = Math.sin(t * 0.06 + litSeed * 10 + row * 0.65 + col * 2.1) > -0.2;
        const wx = startX + col * (winW + gap);
        const wy = top + 10 + row * 14;
        if (wy > baseY - 8) continue;
        if (lit) {
          ctx.fillStyle = `rgba(255, 202, 132, ${0.2 + litSeed * 0.22})`;
          ctx.fillRect(wx - 1, wy - 1, winW + 2, 5);
          ctx.fillStyle = `rgba(255, 226, 176, ${0.42 + litSeed * 0.25})`;
          ctx.fillRect(wx, wy, winW, 3);
        } else {
          ctx.fillStyle = "rgba(4, 6, 12, 0.66)";
          ctx.fillRect(wx, wy, winW, 3);
        }
      }
    }
  }
  ctx.restore();
}

function mapGameplayBuildingTower(building: Building, index: number): TitleTower {
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

function drawGameplayForegroundBuildings(ctx: CanvasRenderingContext2D, game: GameState, t: number, groundY: number) {
  const baseY = groundY - 6;
  const burstImg = getBuildingDestroyBurstImage();
  game.buildings.forEach((building, index) => {
    if (!building.alive) {
      ctx.fillStyle = "#1b2230";
      ctx.fillRect(building.x - 2, baseY - 8, building.w + 4, 10);
      ctx.fillStyle = "rgba(255, 124, 80, 0.12)";
      ctx.fillRect(building.x, baseY - 10, building.w, 4);
      return;
    }
    const tower = mapGameplayBuildingTower(building, index);
    drawSharedTower(ctx, tower, baseY, t, 0, 0.48);
  });
  game.buildingDestroyFx.forEach((fx) => {
    const lifeT = fx.life / fx.maxLife;
    const flicker = 0.55 + 0.45 * Math.sin(t * 8 + fx.seed);
    const burstW = Math.max(34, fx.w * 1.8);
    const burstH = Math.max(34, fx.h * 0.95);
    const burstY = fx.y + (1 - lifeT) * 8;
    const coreR = Math.max(28, burstW * 0.52);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = lifeT * (1 + flicker * 0.55);
    const core = ctx.createRadialGradient(fx.x, burstY, 0, fx.x, burstY, coreR);
    core.addColorStop(0, "rgba(255,255,244,1)");
    core.addColorStop(0.18, "rgba(255,232,170,1)");
    core.addColorStop(0.45, "rgba(255,156,66,0.92)");
    core.addColorStop(0.72, "rgba(255,96,32,0.5)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(fx.x, burstY, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = lifeT * (0.95 + flicker * 0.35);
    ctx.fillStyle = "rgba(255,214,120,0.95)";
    ctx.beginPath();
    ctx.arc(fx.x, burstY, Math.max(14, burstW * 0.24), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = lifeT * (0.85 + flicker * 0.25);
    ctx.fillStyle = "rgba(255,248,220,0.95)";
    ctx.beginPath();
    ctx.arc(fx.x, burstY, Math.max(7, burstW * 0.11), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (burstImg) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = lifeT * (0.75 + flicker * 0.25);
      ctx.drawImage(burstImg, fx.x - burstW / 2, burstY - burstH / 2, burstW, burstH);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = lifeT * 0.28;
    ctx.fillStyle = "rgba(34, 20, 18, 0.95)";
    ctx.beginPath();
    ctx.ellipse(fx.x, burstY + 6, burstW * 0.34, burstH * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < 6; i++) {
      const offset = (i - 2.5) * 4.2;
      const rise = (1 - lifeT) * (5 + i * 1.6);
      const size = 2.2 + (i % 3) * 0.7;
      ctx.globalAlpha = lifeT * (0.46 - i * 0.04);
      ctx.fillStyle = i % 2 === 0 ? "#6f625e" : "#8d765f";
      ctx.beginPath();
      ctx.moveTo(fx.x + offset, burstY - rise - size);
      ctx.lineTo(fx.x + offset + size, burstY - rise);
      ctx.lineTo(fx.x + offset - size, burstY - rise + size * 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

function drawSharedBurj(
  ctx: CanvasRenderingContext2D,
  {
    mode,
    groundY,
    alive,
    burjHealth = 5,
    artScale,
    t,
    burjDecals = [],
    burjDamageFx = [],
    burjHitFlashTimer = 0,
    burjHitFlashMax = 0,
    burjHitFlashX = BURJ_X,
    burjHitFlashY = GROUND_Y - BURJ_H * 0.45,
  }: SharedBurjOptions,
) {
  const burjX = BURJ_X;
  const burjBaseY = groundY - 6;
  const burjHeight = BURJ_H;
  const burjDamageLevel = mode === "game" ? Math.max(0, Math.min(1, (5 - burjHealth) / 4)) : 0;
  const burjCritical = mode === "game" && burjHealth <= 1;
  const hitFlashT = burjHitFlashMax > 0 ? Math.max(0, Math.min(1, burjHitFlashTimer / burjHitFlashMax)) : 0;
  const burjLeftSections = [
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
  ];
  const burjRightSections = [
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
  ];

  function burjPath() {
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

  function halfWidthsAt(ht: number) {
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

  if (!alive) {
    ctx.fillStyle = "#1f2432";
    for (let i = 0; i < 8; i++) {
      const h1 = ((i * 7 + 3) % 13) / 13;
      const h2 = ((i * 11 + 5) % 13) / 13;
      ctx.fillRect(burjX - 18 + i * 5, burjBaseY - 12 - h1 * 24, 6, 12 + h2 * 18);
    }
    return;
  }

  const titleBurjGlowImg = getTitleBurjGlowImage();
  if (titleBurjGlowImg) {
    const glowW = 210 * artScale;
    const glowH = 410 * artScale;
    ctx.save();
    ctx.globalAlpha = mode === "title" ? 1 : 0.88;
    ctx.drawImage(titleBurjGlowImg, burjX - glowW / 2, burjBaseY - burjHeight - 95 * artScale, glowW, glowH);
    ctx.restore();
  }

  const podiumGlow = ctx.createRadialGradient(burjX, groundY - 20, 0, burjX, groundY - 20, 140);
  podiumGlow.addColorStop(0, "rgba(196, 242, 255, 0.32)");
  podiumGlow.addColorStop(0.32, "rgba(120, 210, 255, 0.22)");
  podiumGlow.addColorStop(0.62, "rgba(255, 180, 120, 0.12)");
  podiumGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = podiumGlow;
  ctx.fillRect(burjX - 140, groundY - 140, 280, 180);

  withAnchorScale(ctx, burjX, burjBaseY, artScale, () => {
    const missileDecalImg = getBurjMissileDecalImage();
    const droneDecalImg = getBurjDroneDecalImage();
    const burjGrad = ctx.createLinearGradient(burjX, burjBaseY - burjHeight, burjX, burjBaseY);
    burjGrad.addColorStop(0, "#fbfdff");
    burjGrad.addColorStop(0.08, "#dcecff");
    burjGrad.addColorStop(0.2, "#6e88a7");
    burjGrad.addColorStop(0.42, "#243446");
    burjGrad.addColorStop(0.7, "#182330");
    burjGrad.addColorStop(1, "#202a34");
    ctx.fillStyle = burjGrad;
    burjPath();
    ctx.fill();
    if (mode === "game" && burjDamageLevel > 0) {
      ctx.save();
      burjPath();
      ctx.clip();
      const distressShade = ctx.createLinearGradient(burjX, burjBaseY - burjHeight, burjX, burjBaseY);
      distressShade.addColorStop(0, `rgba(28, 18, 22, ${0.05 + burjDamageLevel * 0.08})`);
      distressShade.addColorStop(0.55, `rgba(30, 18, 20, ${0.08 + burjDamageLevel * 0.18})`);
      distressShade.addColorStop(1, `rgba(44, 16, 14, ${0.12 + burjDamageLevel * 0.24})`);
      ctx.fillStyle = distressShade;
      ctx.fillRect(burjX - 40, burjBaseY - burjHeight - 60, 80, burjHeight + 84);

      const emberVeil = ctx.createRadialGradient(
        burjX,
        burjBaseY - burjHeight * 0.3,
        0,
        burjX,
        burjBaseY - burjHeight * 0.3,
        60,
      );
      emberVeil.addColorStop(0, `rgba(255, 132, 82, ${burjDamageLevel * 0.1})`);
      emberVeil.addColorStop(0.7, `rgba(160, 62, 42, ${burjDamageLevel * 0.08})`);
      emberVeil.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = emberVeil;
      ctx.fillRect(burjX - 64, burjBaseY - burjHeight * 0.7, 128, 220);

      if (burjCritical) {
        const criticalPulse = 0.52 + 0.48 * Math.sin(t * 0.24);
        const alarm = ctx.createLinearGradient(burjX - 24, 0, burjX + 24, 0);
        alarm.addColorStop(0, "rgba(0,0,0,0)");
        alarm.addColorStop(0.3, `rgba(255, 72, 64, ${0.18 + criticalPulse * 0.2})`);
        alarm.addColorStop(0.6, `rgba(255, 176, 120, ${0.12 + criticalPulse * 0.12})`);
        alarm.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = alarm;
        ctx.fillRect(burjX - 28, burjBaseY - burjHeight - 48, 56, burjHeight + 66);
      }
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(236,246,255,0.28)";
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(burjX, burjBaseY - burjHeight - 44);
    ctx.lineTo(burjX, burjBaseY - 28);
    ctx.stroke();
    ctx.fillStyle = "rgba(250, 252, 255, 0.46)";
    ctx.fillRect(burjX - 0.55, burjBaseY - burjHeight + 18, 1.1, burjHeight - 18);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(burjX - 2.4, burjBaseY - burjHeight + 22, 4.8, 3.6);
    ctx.fillStyle = "rgba(225, 239, 255, 0.22)";
    for (let i = 0; i < 42; i++) {
      const ht = 0.04 + (i / 41) * 0.92;
      const ly = burjBaseY - burjHeight * ht;
      const { left, right } = halfWidthsAt(ht);
      const lw = left * 0.68;
      const rw = right * 0.68;
      if (lw < 1.2 && rw < 1.2) continue;
      const lit = Math.sin(t * 0.32 + i * 0.48) > -0.12;
      if (lit) {
        ctx.fillStyle = i === 13 || i === 23 || i === 33 ? "rgba(255, 255, 255, 0.62)" : "rgba(215, 232, 248, 0.11)";
        ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
      }
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
    brightBands.forEach((ht, index) => {
      const ly = burjBaseY - burjHeight * ht.ht;
      const { left, right } = halfWidthsAt(ht.ht);
      ctx.fillStyle = `rgba(252, 253, 255, ${ht.alpha})`;
      ctx.fillRect(burjX - left * 0.88, ly, left * 0.88 + right * 0.88, ht.thickness);
      ctx.fillStyle = `rgba(15, 24, 34, ${0.34 - index * 0.03})`;
      ctx.fillRect(burjX - left * 0.9, ly + ht.thickness, left * 0.9 + right * 0.9, 1.15);
      ctx.fillStyle = "rgba(130, 200, 255, 0.12)";
      ctx.fillRect(burjX - left * 0.86, ly - 0.7, left * 0.86 + right * 0.86, 0.55);
    });

    ctx.fillStyle = "rgba(10, 18, 28, 0.56)";
    ctx.fillRect(burjX - 8.2, burjBaseY - burjHeight + 158, 16.4, 10);
    ctx.fillRect(burjX - 11.4, burjBaseY - burjHeight + 224, 22.8, 10);
    ctx.fillStyle = "rgba(248, 252, 255, 0.82)";
    ctx.fillRect(burjX - 7.1, burjBaseY - burjHeight + 166, 14.2, 2.6);

    const beaconBlink = Math.max(0, Math.sin(t * 3.0));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    ctx.fillStyle = `rgba(128, 60, 40, ${0.25 + 0.75 * beaconIntensity})`;
    ctx.fillRect(burjX - 0.7, burjBaseY - burjHeight - 50, 1.4, 10);
    if (beaconIntensity > 0.05) {
      const beaconGlow = ctx.createRadialGradient(
        burjX,
        burjBaseY - burjHeight - 46,
        0,
        burjX,
        burjBaseY - burjHeight - 46,
        8,
      );
      beaconGlow.addColorStop(0, `rgba(255, 60, 40, ${0.36 * beaconIntensity})`);
      beaconGlow.addColorStop(1, "rgba(255, 0, 0, 0)");
      ctx.fillStyle = beaconGlow;
      ctx.fillRect(burjX - 8, burjBaseY - burjHeight - 54, 16, 16);
    }

    ctx.save();
    burjPath();
    ctx.clip();
    const leftGlow = ctx.createLinearGradient(burjX - 20, 0, burjX + 5, 0);
    leftGlow.addColorStop(0, "rgba(255,255,255,0.26)");
    leftGlow.addColorStop(0.35, "rgba(170,220,255,0.14)");
    leftGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = leftGlow;
    ctx.fillRect(burjX - 18, burjBaseY - burjHeight - 50, 22, burjHeight + 50);

    const rightShade = ctx.createLinearGradient(burjX - 1, 0, burjX + 19, 0);
    rightShade.addColorStop(0, "rgba(0,0,0,0)");
    rightShade.addColorStop(0.45, "rgba(10,16,24,0.16)");
    rightShade.addColorStop(1, "rgba(5,8,15,0.38)");
    ctx.fillStyle = rightShade;
    ctx.fillRect(burjX - 1, burjBaseY - burjHeight - 50, 18, burjHeight + 50);

    for (let i = 0; i < 58; i++) {
      const ht = 0.03 + (i / 57) * 0.94;
      const ly = burjBaseY - burjHeight * ht;
      const { left, right } = halfWidthsAt(ht);
      const lw = left * 0.64;
      const rw = right * 0.64;
      if (lw < 0.95 && rw < 0.95) continue;
      const lit = Math.sin(t * 0.22 + i * 0.37) > -0.28;
      if (lit) {
        const warmBand = i === 16 || i === 28 || i === 39 || i === 49;
        ctx.fillStyle = warmBand ? "rgba(252, 252, 255, 0.9)" : "rgba(230, 244, 255, 0.16)";
        ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
        if (!warmBand && i % 6 === 0) {
          ctx.fillStyle = "rgba(100, 180, 255, 0.08)";
          ctx.fillRect(burjX - lw, ly + 0.88, lw + rw, 0.28);
        }
      }
    }
    if (mode === "game" && (burjDecals.length > 0 || burjDamageFx.length > 0)) {
      burjDecals.forEach((decal) => {
        const decalImg = decal.kind === "drone" ? droneDecalImg : missileDecalImg;
        const size = 48 * decal.scale;
        const localX = burjX + (decal.x - burjX) / artScale;
        const localY = burjBaseY + (decal.y - burjBaseY) / artScale;
        if (decalImg) {
          ctx.save();
          ctx.translate(localX, localY);
          ctx.rotate(decal.rotation);
          ctx.globalAlpha = decal.kind === "drone" ? 1 : 0.98;
          ctx.drawImage(decalImg, -size / 2, -size / 2, size, size);
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(localX, localY);
          ctx.rotate(decal.rotation);
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = decal.kind === "drone" ? "rgba(48,26,22,0.9)" : "rgba(60,30,24,0.9)";
          ctx.beginPath();
          ctx.ellipse(0, 0, size * 0.38, size * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
      burjDamageFx.forEach((fx) => {
        const localX = burjX + (fx.x - burjX) / artScale;
        const localY = burjBaseY + (fx.y - burjBaseY) / artScale;
        const lifeT = 1;
        const flicker = 0.55 + 0.45 * Math.sin(t * 6 + fx.seed);
        const emberBoost = 1 + burjDamageLevel * 0.9 + (burjCritical ? 0.45 : 0);
        ctx.globalAlpha = lifeT * 0.88;
        ctx.fillStyle = "rgba(28,20,18,0.92)";
        ctx.beginPath();
        ctx.arc(localX + Math.sin(fx.seed) * 2, localY - 3, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = lifeT * (0.96 + flicker * 0.96) * emberBoost;
        const flame = ctx.createRadialGradient(localX, localY, 0, localX, localY, 20);
        flame.addColorStop(0, "rgba(255,246,214,1)");
        flame.addColorStop(0.24, "rgba(255,182,90,1)");
        flame.addColorStop(0.68, "rgba(255,96,34,0.56)");
        flame.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.arc(localX, localY, 20 + flicker * 3.2 + burjDamageLevel * 3, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 3; i++) {
          const phase = fx.seed + i * 0.9;
          const flameH = (11 + i * 4.2) * (0.85 + 0.35 * Math.sin(t * 7 + phase) + burjDamageLevel * 0.18);
          const flameW = 4.2 + i * 1.35;
          ctx.globalAlpha = lifeT * (1 - i * 0.14);
          ctx.fillStyle = i === 0 ? "#fff0c8" : i === 1 ? "#ffb458" : "#ff6e2f";
          ctx.beginPath();
          ctx.moveTo(localX + Math.sin(phase) * 1.8, localY + 1.5);
          ctx.quadraticCurveTo(
            localX - flameW * 0.6 + Math.cos(phase) * 1.4,
            localY - flameH * 0.45,
            localX + Math.sin(phase + 0.25) * 0.8,
            localY - flameH,
          );
          ctx.quadraticCurveTo(
            localX + flameW * 0.6 + Math.sin(phase) * 1.1,
            localY - flameH * 0.35,
            localX + Math.sin(phase) * 1.8,
            localY + 1.5,
          );
          ctx.fill();
        }
        if (burjDamageLevel >= 0.5) {
          ctx.globalAlpha = (0.12 + burjDamageLevel * 0.14 + (burjCritical ? 0.08 : 0)) * (0.72 + 0.28 * flicker);
          ctx.fillStyle = "rgba(34, 26, 28, 0.95)";
          ctx.beginPath();
          ctx.ellipse(
            localX + Math.sin(fx.seed * 1.7 + t * 0.03) * 4,
            localY - (13 + Math.cos(fx.seed + t * 0.025) * 3),
            8 + burjDamageLevel * 3,
            14 + burjDamageLevel * 4,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      });
      if (hitFlashT > 0) {
        const localX = burjX + (burjHitFlashX - burjX) / artScale;
        const localY = burjBaseY + (burjHitFlashY - burjBaseY) / artScale;
        const flashPop = Math.pow(hitFlashT, 0.45);
        const orangeTail = Math.pow(hitFlashT, 0.78);
        const flashFade = 1 - hitFlashT;
        const hitGlow = ctx.createRadialGradient(localX, localY, 0, localX, localY, 46 + 42 * flashPop);
        hitGlow.addColorStop(0, `rgba(255,252,244,${1 * flashPop})`);
        hitGlow.addColorStop(0.24, `rgba(255,214,142,${0.96 * flashPop})`);
        hitGlow.addColorStop(0.56, `rgba(255,112,52,${0.74 * orangeTail})`);
        hitGlow.addColorStop(0.82, `rgba(255,76,34,${0.22 * orangeTail})`);
        hitGlow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = hitGlow;
        ctx.fillRect(localX - 92, localY - 92, 184, 184);
        ctx.fillStyle = `rgba(255,246,220,${0.98 * flashPop})`;
        ctx.beginPath();
        ctx.arc(localX, localY, 8 + 10 * flashPop, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,188,104,${0.46 * orangeTail})`;
        ctx.beginPath();
        ctx.arc(localX, localY, 14 + 16 * flashPop, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,238,196,${0.7 * flashPop})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(localX, localY, 12 + 18 * flashPop, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,156,88,${0.38 * orangeTail})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(localX, localY, 20 + 34 * flashFade, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,210,170,${0.34 * flashPop})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(localX, localY, 30 + 46 * flashFade, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  });

  ctx.fillStyle = `rgba(22, 28, 40, ${0.84 + 0.08 * Math.sin(t * 0.32)})`;
  ctx.beginPath();
  ctx.moveTo(burjX - 104, burjBaseY + 2);
  ctx.lineTo(burjX - 88, burjBaseY - 12);
  ctx.lineTo(burjX - 58, burjBaseY - 15);
  ctx.lineTo(burjX - 36, burjBaseY - 8);
  ctx.lineTo(burjX - 16, burjBaseY - 3);
  ctx.lineTo(burjX + 16, burjBaseY - 3);
  ctx.lineTo(burjX + 36, burjBaseY - 8);
  ctx.lineTo(burjX + 58, burjBaseY - 15);
  ctx.lineTo(burjX + 88, burjBaseY - 12);
  ctx.lineTo(burjX + 104, burjBaseY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 214, 150, 0.28)";
  ctx.fillRect(burjX - 58, burjBaseY - 14, 116, 2.5);
  ctx.fillStyle = "rgba(236, 246, 255, 0.46)";
  ctx.fillRect(burjX - 28, groundY - 8, 56, 7);
  ctx.fillStyle = "rgba(180, 220, 255, 0.34)";
  ctx.fillRect(burjX - 12, groundY - 13, 24, 4);

  if (mode === "game" && burjCritical) {
    const criticalPulse = 0.5 + 0.5 * Math.sin(t * 0.22);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const alarmRing = ctx.createRadialGradient(
      burjX,
      burjBaseY - burjHeight - 32,
      0,
      burjX,
      burjBaseY - burjHeight - 32,
      28,
    );
    alarmRing.addColorStop(0, `rgba(255, 90, 76, ${0.34 + criticalPulse * 0.34})`);
    alarmRing.addColorStop(0.38, `rgba(255, 170, 110, ${0.18 + criticalPulse * 0.22})`);
    alarmRing.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = alarmRing;
    ctx.fillRect(burjX - 28, burjBaseY - burjHeight - 60, 56, 56);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = `rgba(255, 110, 92, ${0.32 + criticalPulse * 0.3})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(burjX, burjBaseY - burjHeight - 32, 18 + criticalPulse * 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSharedWater(
  ctx: CanvasRenderingContext2D,
  { groundY, renderHeight, tintBottomAlpha = 0.18 }: SharedWaterOptions,
  t: number,
) {
  const waterTop = groundY + 8;
  const waterBottom = renderHeight;
  const titleWaterImg = getTitleWaterImage();
  if (titleWaterImg) {
    ctx.drawImage(titleWaterImg, 0, waterTop, CANVAS_W + 10, waterBottom - waterTop);
    const waterGrade = ctx.createLinearGradient(0, waterTop, 0, waterBottom);
    waterGrade.addColorStop(0, "rgba(22, 34, 60, 0.18)");
    waterGrade.addColorStop(0.5, "rgba(8, 20, 40, 0.08)");
    waterGrade.addColorStop(1, `rgba(0, 0, 0, ${tintBottomAlpha})`);
    ctx.fillStyle = waterGrade;
    ctx.fillRect(0, waterTop, CANVAS_W, waterBottom - waterTop);
    return;
  }

  const waterGrad = ctx.createLinearGradient(0, waterTop, 0, waterBottom);
  waterGrad.addColorStop(0, "rgba(34, 40, 56, 0.96)");
  waterGrad.addColorStop(0.28, "rgba(26, 32, 46, 0.96)");
  waterGrad.addColorStop(0.72, "rgba(18, 24, 36, 0.98)");
  waterGrad.addColorStop(1, "rgba(12, 16, 26, 1)");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, waterTop, CANVAS_W, waterBottom - waterTop);

  ctx.fillStyle = "rgba(255, 242, 214, 0.18)";
  ctx.fillRect(0, waterTop, CANVAS_W, 2);
  const waterRipple = ctx.createLinearGradient(0, waterTop + 6, 0, waterBottom);
  waterRipple.addColorStop(0, "rgba(120, 160, 200, 0.06)");
  waterRipple.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = waterRipple;
  for (let y = waterTop + 8; y < waterBottom; y += 9) {
    const inset = 10 + Math.sin(t * 1.8 + y * 0.07) * 8;
    ctx.fillRect(inset, y, CANVAS_W - inset * 2, 1);
  }
}

function drawBurjWarningPlate(
  ctx: CanvasRenderingContext2D,
  {
    groundY,
    burjHealth,
    burjHitFlashTimer,
    burjHitFlashMax,
    t,
    artScale = 2,
  }: {
    groundY: number;
    burjHealth: number;
    burjHitFlashTimer: number;
    burjHitFlashMax: number;
    t: number;
    artScale?: number;
  },
) {
  const maxBurjHealth = 5;
  const burjBaseY = groundY - 6;
  const hitFlashT = burjHitFlashMax > 0 ? Math.max(0, Math.min(1, burjHitFlashTimer / burjHitFlashMax)) : 0;
  const burjCritical = burjHealth <= 1;

  const pulse = 0.5 + 0.5 * Math.sin(t * 0.22);
  const flashPulse = 0.55 + 0.45 * Math.sin(t * 0.55);
  const warningY = burjBaseY + 24 * artScale;
  const warningW = 102 * artScale;
  const warningH = burjCritical ? 24 * artScale : 18 * artScale;
  const plateX = BURJ_X - warningW / 2;
  const plateY = warningY - warningH + 2;
  const plateInset = 11 * artScale;
  const barX = plateX + plateInset;
  const barY = plateY + 5 * artScale;
  const barW = warningW - plateInset * 2;
  const barH = 7 * artScale;
  const segmentGap = 2 * artScale;
  const segmentW = (barW - segmentGap * (maxBurjHealth - 1)) / maxBurjHealth;
  const readoutY = burjCritical ? plateY + warningH - 4 * artScale : plateY + warningH - 2.5 * artScale;

  ctx.save();
  ctx.lineWidth = 1.4 * artScale;

  ctx.fillStyle = "rgba(6, 10, 18, 0.42)";
  ctx.beginPath();
  ctx.moveTo(BURJ_X - warningW * 0.32, plateY + warningH + 3 * artScale);
  ctx.lineTo(BURJ_X + warningW * 0.32, plateY + warningH + 3 * artScale);
  ctx.lineTo(BURJ_X + warningW * 0.24, plateY + warningH + 7 * artScale);
  ctx.lineTo(BURJ_X - warningW * 0.24, plateY + warningH + 7 * artScale);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(28, 34, 48, 0.88)";
  ctx.beginPath();
  ctx.moveTo(plateX + 7 * artScale, plateY + warningH);
  ctx.lineTo(plateX + 13 * artScale, plateY + 1 * artScale);
  ctx.lineTo(plateX + 20 * artScale, plateY + 1 * artScale);
  ctx.lineTo(plateX + 16 * artScale, plateY + warningH);
  ctx.closePath();
  ctx.moveTo(plateX + warningW - 7 * artScale, plateY + warningH);
  ctx.lineTo(plateX + warningW - 13 * artScale, plateY + 1 * artScale);
  ctx.lineTo(plateX + warningW - 20 * artScale, plateY + 1 * artScale);
  ctx.lineTo(plateX + warningW - 16 * artScale, plateY + warningH);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(plateX + 10 * artScale, plateY + 2 * artScale);
  ctx.lineTo(plateX + warningW - 10 * artScale, plateY + 2 * artScale);
  ctx.lineTo(plateX + warningW, plateY + warningH * 0.48);
  ctx.lineTo(plateX + warningW - 8 * artScale, plateY + warningH);
  ctx.lineTo(plateX + 8 * artScale, plateY + warningH);
  ctx.lineTo(plateX, plateY + warningH * 0.48);
  ctx.closePath();

  if (burjCritical) {
    const criticalFill = ctx.createLinearGradient(0, plateY, 0, plateY + warningH);
    criticalFill.addColorStop(0, `rgba(110, 16, 18, ${0.86 + pulse * 0.08})`);
    criticalFill.addColorStop(0.45, `rgba(58, 10, 14, ${0.9})`);
    criticalFill.addColorStop(1, `rgba(28, 8, 12, ${0.96})`);
    ctx.fillStyle = criticalFill;
    ctx.strokeStyle = `rgba(255, 120, 100, ${0.58 + pulse * 0.26})`;
  } else {
    const plateFill = ctx.createLinearGradient(0, plateY, 0, plateY + warningH);
    plateFill.addColorStop(0, `rgba(44, 58, 82, ${0.9 + hitFlashT * 0.08})`);
    plateFill.addColorStop(0.48, `rgba(24, 30, 42, ${0.94})`);
    plateFill.addColorStop(1, `rgba(14, 18, 28, 0.96)`);
    ctx.fillStyle = plateFill;
    ctx.strokeStyle = `rgba(132, 170, 220, ${0.36 + hitFlashT * 0.28})`;
  }
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = burjCritical
    ? `rgba(255, 212, 196, ${0.16 + pulse * 0.08})`
    : `rgba(202, 228, 255, ${0.12 + hitFlashT * 0.1})`;
  ctx.fillRect(plateX + 18 * artScale, plateY + 4 * artScale, warningW - 36 * artScale, 1.5 * artScale);

  ctx.fillStyle = burjCritical ? "rgba(20, 4, 4, 0.82)" : "rgba(8, 12, 18, 0.82)";
  ctx.fillRect(barX - 2 * artScale, barY - 2 * artScale, barW + 4 * artScale, barH + 4 * artScale);

  for (let i = 0; i < maxBurjHealth; i += 1) {
    const segX = barX + i * (segmentW + segmentGap);
    const active = i < burjHealth;
    const hotSegment = hitFlashT > 0 && i === Math.max(0, burjHealth - 1);
    if (active) {
      const segFill = ctx.createLinearGradient(0, barY, 0, barY + barH);
      if (burjCritical) {
        segFill.addColorStop(0, `rgba(255, ${110 + pulse * 30}, ${96 + pulse * 16}, 0.96)`);
        segFill.addColorStop(1, "rgba(164, 24, 28, 0.96)");
      } else if (hotSegment) {
        segFill.addColorStop(0, `rgba(255, ${214 + flashPulse * 24}, 168, 0.98)`);
        segFill.addColorStop(1, "rgba(210, 92, 34, 0.96)");
      } else {
        segFill.addColorStop(0, "rgba(124, 220, 255, 0.96)");
        segFill.addColorStop(1, "rgba(54, 136, 204, 0.96)");
      }
      ctx.fillStyle = segFill;
      ctx.fillRect(segX, barY, segmentW, barH);
      if (hotSegment || burjCritical) {
        glow(ctx, burjCritical ? "rgba(255,88,80,0.92)" : "rgba(255,180,124,0.92)", 8 * artScale);
        ctx.fillRect(segX, barY, segmentW, barH);
        glowOff(ctx);
      }
    } else {
      ctx.fillStyle = burjCritical ? "rgba(52, 12, 14, 0.84)" : "rgba(24, 32, 44, 0.82)";
      ctx.fillRect(segX, barY, segmentW, barH);
    }
    ctx.strokeStyle = burjCritical ? "rgba(255, 138, 122, 0.44)" : "rgba(154, 196, 244, 0.28)";
    ctx.strokeRect(segX, barY, segmentW, barH);
  }

  if (hitFlashT > 0) {
    const barFlash = Math.pow(hitFlashT, 0.58);
    const barFlashGlow = ctx.createLinearGradient(0, barY - 6 * artScale, 0, barY + barH + 6 * artScale);
    barFlashGlow.addColorStop(0, `rgba(255, 232, 172, ${0.04 + barFlash * 0.18})`);
    barFlashGlow.addColorStop(0.5, `rgba(255, 178, 92, ${0.16 + barFlash * 0.32})`);
    barFlashGlow.addColorStop(1, `rgba(255, 104, 48, ${0.06 + barFlash * 0.16})`);
    ctx.fillStyle = barFlashGlow;
    ctx.fillRect(barX - 8 * artScale, barY - 7 * artScale, barW + 16 * artScale, barH + 14 * artScale);
    glow(ctx, "rgba(255,176,96,0.92)", 12 * artScale);
    ctx.fillStyle = `rgba(255, 248, 220, ${0.18 + barFlash * 0.26})`;
    ctx.fillRect(barX, barY, barW, barH);
    glowOff(ctx);
    ctx.strokeStyle = `rgba(255, 220, 168, ${0.32 + barFlash * 0.42})`;
    ctx.lineWidth = 1.2 * artScale;
    ctx.strokeRect(barX - 3 * artScale, barY - 3 * artScale, barW + 6 * artScale, barH + 6 * artScale);
  }

  ctx.textAlign = "center";
  if (burjCritical) {
    glow(ctx, "rgba(255,80,72,0.95)", 12 * artScale);
    ctx.font = `bold ${9 * artScale}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = `rgba(255, 214, 196, ${0.92 + pulse * 0.08})`;
    ctx.fillText("CRITICAL", BURJ_X, readoutY);
    glowOff(ctx);
  } else if (hitFlashT > 0) {
    glow(ctx, "rgba(255,184,120,0.95)", 12 * artScale);
    ctx.font = `bold ${8.5 * artScale}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = `rgba(255, 238, 210, ${0.94 + flashPulse * 0.04})`;
    ctx.fillText(`${Math.max(0, burjHealth)} HP`, BURJ_X, readoutY);
    glowOff(ctx);
  }

  ctx.textAlign = "left";
  ctx.restore();
}

function drawSharedLauncher(
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
  if (!active) {
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(lx - 10, ly + 3);
    ctx.lineTo(lx - 8, ly - 2);
    ctx.lineTo(lx - 2, ly - 3);
    ctx.lineTo(lx + 3, ly - 1);
    ctx.lineTo(lx + 9, ly - 2);
    ctx.lineTo(lx + 10, ly + 3);
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.save();
  ctx.translate(lx, ly);
  ctx.scale(scale, scale);
  ctx.translate(-lx, -ly);
  ctx.globalAlpha = alpha;

  const shadow = ctx.createRadialGradient(lx, ly + 18, 0, lx, ly + 18, 44);
  shadow.addColorStop(0, "rgba(4, 8, 16, 0.55)");
  shadow.addColorStop(0.7, "rgba(4, 8, 16, 0.18)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.fillRect(lx - 46, ly - 6, 92, 50);

  const haze = ctx.createRadialGradient(lx, ly - 4, 0, lx, ly - 4, 60);
  haze.addColorStop(0, "rgba(88, 150, 210, 0.12)");
  haze.addColorStop(0.45, "rgba(56, 104, 168, 0.06)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(lx - 60, ly - 54, 120, 110);

  const glow = ctx.createRadialGradient(lx, ly + 8, 0, lx, ly + 8, 52);
  glow.addColorStop(0, damaged ? "rgba(255, 126, 110, 0.22)" : "rgba(0, 210, 255, 0.26)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(lx - 52, ly - 26, 104, 68);

  ctx.fillStyle = damaged ? "#30222a" : "#182434";
  ctx.beginPath();
  ctx.moveTo(lx - 34, ly + 12);
  ctx.lineTo(lx - 24, ly - 6);
  ctx.lineTo(lx + 24, ly - 6);
  ctx.lineTo(lx + 34, ly + 12);
  ctx.lineTo(lx + 22, ly + 18);
  ctx.lineTo(lx - 22, ly + 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(4, 10, 18, 0.85)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(lx - 34, ly + 12);
  ctx.lineTo(lx - 24, ly - 6);
  ctx.lineTo(lx + 24, ly - 6);
  ctx.lineTo(lx + 34, ly + 12);
  ctx.stroke();
  ctx.strokeStyle = damaged ? "rgba(164, 116, 120, 0.24)" : "rgba(58, 116, 164, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(lx - 33, ly + 11.5);
  ctx.lineTo(lx - 24, ly - 5.5);
  ctx.lineTo(lx + 24, ly - 5.5);
  ctx.lineTo(lx + 33, ly + 11.5);
  ctx.stroke();

  ctx.fillStyle = damaged ? "#2b2632" : "#223247";
  ctx.beginPath();
  ctx.moveTo(lx - 22, ly + 5);
  ctx.lineTo(lx - 16, ly - 11);
  ctx.lineTo(lx - 6, ly - 16);
  ctx.lineTo(lx + 10, ly - 16);
  ctx.lineTo(lx + 18, ly - 8);
  ctx.lineTo(lx + 22, ly + 4);
  ctx.lineTo(lx + 12, ly + 10);
  ctx.lineTo(lx - 14, ly + 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(6, 12, 22, 0.88)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.fillStyle = damaged ? "rgba(255, 120, 110, 0.08)" : "rgba(120, 205, 255, 0.16)";
  ctx.beginPath();
  ctx.moveTo(lx - 16, ly - 8);
  ctx.lineTo(lx - 5, ly - 13);
  ctx.lineTo(lx + 8, ly - 13);
  ctx.lineTo(lx + 13, ly - 8);
  ctx.lineTo(lx + 12, ly - 6);
  ctx.lineTo(lx - 14, ly - 6);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = damaged ? "#3a2d38" : "#2a3d56";
  ctx.beginPath();
  ctx.ellipse(lx, ly - 10, 13, 9, 0, Math.PI, 0);
  ctx.lineTo(lx + 10, ly - 4);
  ctx.lineTo(lx - 10, ly - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(6, 12, 22, 0.82)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = damaged ? "rgba(255, 126, 110, 0.22)" : "rgba(120, 210, 255, 0.42)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(lx, ly - 10, 13, Math.PI + 0.22, -0.12);
  ctx.stroke();

  const rimDir = lx < BURJ_X ? 1 : -1;
  ctx.fillStyle = damaged ? "rgba(255, 142, 120, 0.12)" : "rgba(150, 232, 255, 0.2)";
  ctx.fillRect(lx + rimDir * 11 - 1.5, ly - 14, 3, 20);
  ctx.fillStyle = damaged ? "rgba(255, 142, 120, 0.08)" : "rgba(150, 232, 255, 0.12)";
  ctx.fillRect(lx + rimDir * 19 - 1, ly - 4, 2, 10);

  const servoPulse = 0.46 + 0.28 * Math.sin(t * 2.2 + lx * 0.018);
  ctx.fillStyle = damaged ? `rgba(255, 140, 110, ${servoPulse * 0.5})` : `rgba(120, 235, 255, ${servoPulse})`;
  ctx.fillRect(lx - 3, ly - 2, 6, 6);
  const servoGlow = ctx.createRadialGradient(lx, ly + 1, 0, lx, ly + 1, 14);
  servoGlow.addColorStop(
    0,
    damaged ? `rgba(255, 140, 110, ${servoPulse * 0.55})` : `rgba(120, 235, 255, ${servoPulse})`,
  );
  servoGlow.addColorStop(
    0.5,
    damaged ? `rgba(200, 110, 90, ${servoPulse * 0.25})` : `rgba(86, 196, 255, ${servoPulse * 0.5})`,
  );
  servoGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = servoGlow;
  ctx.fillRect(lx - 14, ly - 13, 28, 28);

  ctx.strokeStyle = damaged ? "rgba(84, 54, 60, 0.95)" : "rgba(50, 70, 94, 0.95)";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(lx - 7, ly + 8);
  ctx.lineTo(lx - 16, ly + 18);
  ctx.stroke();

  ctx.save();
  ctx.translate(lx + 2, ly - 12);
  ctx.rotate(barrelAngle);
  ctx.fillStyle = damaged ? "#5a3a3a" : "#3b526c";
  ctx.beginPath();
  ctx.moveTo(-2, -4.2);
  ctx.lineTo(24, -3.2);
  ctx.quadraticCurveTo(31, -1.1, 34, 0);
  ctx.quadraticCurveTo(31, 1.1, 24, 3.2);
  ctx.lineTo(-2, 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(8, 14, 24, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = damaged ? "#3a2930" : "#1d2b3d";
  ctx.fillRect(2, -1.2, 24, 2.4);
  ctx.strokeStyle = damaged ? "rgba(255, 150, 120, 0.18)" : "rgba(136, 218, 255, 0.34)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, -3.1);
  ctx.lineTo(26, -2.1);
  ctx.stroke();
  ctx.fillStyle = damaged ? "rgba(255, 150, 120, 0.08)" : "rgba(150, 230, 255, 0.16)";
  ctx.fillRect(6, -3, 14, 1.3);
  ctx.fillStyle = damaged ? "#412d36" : "#2a3e56";
  ctx.fillRect(-4, -5.4, 7, 10.8);

  const pulse = 0.38 + 0.26 * Math.sin(t * 2.4 + lx * 0.02);
  const flashStrength = Math.max(pulse, muzzleFlash);
  const muzzleX = Math.cos(barrelAngle) * 34;
  const muzzleY = Math.sin(barrelAngle) * 34;
  const mGlow = ctx.createRadialGradient(muzzleX, muzzleY, 0, muzzleX, muzzleY, 10 + muzzleFlash * 6);
  mGlow.addColorStop(
    0,
    damaged ? `rgba(255, 160, 110, ${flashStrength * 0.35})` : `rgba(0, 255, 200, ${flashStrength})`,
  );
  mGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = mGlow;
  ctx.fillRect(muzzleX - 10, muzzleY - 10, 20, 20);
  ctx.restore();

  if (statusLabel) {
    ctx.textAlign = "center";
    ctx.font = `bold 8px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = damaged ? "rgba(255, 132, 110, 0.72)" : "rgba(128, 236, 255, 0.72)";
    ctx.fillText(statusLabel, lx, ly + 30);
    ctx.textAlign = "left";
  }

  ctx.restore();
}

function UNUSED_drawSky(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Sky — base gradient always drawn, nebula layered on top at low opacity
  const skyGrad = ctx.createLinearGradient(0, 0, 0, layout.renderHeight);
  skyGrad.addColorStop(0, COL.sky1);
  skyGrad.addColorStop(0.4, COL.sky2);
  skyGrad.addColorStop(0.7, COL.sky3);
  skyGrad.addColorStop(1, COL.ground);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, layout.renderHeight);

  // Nebula overlay — subtle texture, not dominant
  const skyImg = getSkyImage();
  if (skyImg) {
    ctx.globalAlpha = ov("sky.nebulaOpacity", 0.4);
    ctx.drawImage(skyImg, 0, 0, CANVAS_W, layout.renderHeight);
    ctx.globalAlpha = 1;
  }

  // Animated twinkling stars
  game.stars.forEach((s) => {
    const twinkle = 0.35 + 0.65 * Math.sin(game.time * ov("sky.starTwinkleSpeed", 0.02) + s.twinkle);
    const drawStar = (y: number) => {
      if (y < 0 || y > layout.renderHeight) return;
      ctx.globalAlpha = twinkle;
      glow(ctx, "#ffffff", 3 + s.size * 3);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    };
    drawStar(s.y);
  });
  ctx.globalAlpha = 1;

  // Moon — crescent with warm glow
  glow(ctx, "#ffe8b0", 24);
  ctx.fillStyle = "#ffe8b0";
  ctx.beginPath();
  ctx.arc(780, 60, 25, 0, Math.PI * 2);
  ctx.fill();
  glowOff(ctx);
  ctx.fillStyle = skyImg ? "#0a0e1a" : COL.sky1;
  ctx.beginPath();
  ctx.arc(788, 55, 22, 0, Math.PI * 2);
  ctx.fill();

  // Atmospheric bloom over the skyline
  const skylineGlow = ctx.createRadialGradient(BURJ_X, GROUND_Y - 60, 40, BURJ_X, GROUND_Y - 60, 420);
  skylineGlow.addColorStop(0, "rgba(80, 180, 255, 0.16)");
  skylineGlow.addColorStop(0.45, "rgba(50, 120, 220, 0.09)");
  skylineGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = skylineGlow;
  ctx.fillRect(0, 0, CANVAS_W, GROUND_Y + 30);

  const heatBand = ctx.createLinearGradient(0, GROUND_Y - 140, 0, GROUND_Y + 10);
  heatBand.addColorStop(0, "rgba(255, 160, 90, 0)");
  heatBand.addColorStop(0.55, "rgba(255, 120, 70, 0.06)");
  heatBand.addColorStop(1, "rgba(255, 90, 50, 0.12)");
  ctx.fillStyle = heatBand;
  ctx.fillRect(0, GROUND_Y - 140, CANVAS_W, 170);

  // Distant skyline silhouettes and dunes
  ctx.fillStyle = "rgba(20, 26, 46, 0.75)";
  for (let i = 0; i < 12; i++) {
    const x = i * 82 + ((i % 2) * 10 - 6);
    const w = 42 + (i % 3) * 18;
    const h = 28 + ((i * 17) % 4) * 12;
    ctx.fillRect(x, GROUND_Y - 40 - h, w, h);
  }
  ctx.fillStyle = "rgba(38, 30, 58, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  for (let x = 0; x <= CANVAS_W; x += 30) {
    const y = GROUND_Y - 18 - Math.sin(x * 0.012 + game.time * 0.01) * 7 - Math.cos(x * 0.02) * 4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(CANVAS_W, CANVAS_H);
  ctx.lineTo(0, CANVAS_H);
  ctx.closePath();
  ctx.fill();
}

function drawDecoyFlares(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Decoy flares
  game.flares.forEach((f: Flare) => {
    if (!f.alive) return;
    const alpha = Math.min(1, f.life / 24);
    const flicker = 0.78 + 0.22 * Math.sin(game.time * 0.25 + f.x * 0.03);
    if (f.trail?.length) {
      f.trail.forEach((t, i) => {
        const tAlpha = alpha * (i / f.trail.length) * 0.32;
        const radius = (1.5 + (i / f.trail.length) * 3.5) * layout.effectScale;
        ctx.fillStyle = `rgba(255,170,90,${tAlpha})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = alpha * flicker;
    withAnchorScale(ctx, f.x, f.y, layout.projectileScale, () => {
      ctx.fillStyle = COL.flare;
      glow(ctx, COL.flare, 16 * layout.effectScale);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 5 + Math.sin(game.time * 0.18 + f.id) * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,230,180,0.65)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 8 + Math.sin(game.time * 0.16 + f.id) * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff4d0";
      ctx.beginPath();
      ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,245,220,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.x - 6, f.y);
      ctx.lineTo(f.x + 6, f.y);
      ctx.moveTo(f.x, f.y - 6);
      ctx.lineTo(f.x, f.y + 6);
      ctx.stroke();
    });
    glowOff(ctx);
    ctx.globalAlpha = 1;
  });
}

function UNUSED_drawGroundAndBuildings(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Ground
  ctx.fillStyle = COL.sand;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 20);
  groundGrad.addColorStop(0, "#3a3060");
  groundGrad.addColorStop(1, COL.sand);
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y, CANVAS_W, 20);

  // Buildings
  game.buildings.forEach((b: Building) => {
    withAnchorScale(ctx, b.x + b.w / 2, CITY_Y, layout.buildingScale, () => {
      if (!b.alive) {
        ctx.fillStyle = "#333";
        ctx.fillRect(b.x, CITY_Y - 8, b.w, 8);
        return;
      }
      const bTop = CITY_Y - b.h;
      // Main face — subtle left-right gradient for 3D
      const bGrad = ctx.createLinearGradient(b.x, bTop, b.x + b.w, CITY_Y);
      bGrad.addColorStop(0, "#1e2a48");
      bGrad.addColorStop(0.4, "#151e35");
      bGrad.addColorStop(1, "#0c1320");
      ctx.fillStyle = bGrad;
      ctx.fillRect(b.x, bTop, b.w, b.h);

      // Rooftop cap
      ctx.fillStyle = "#2a3555";
      ctx.fillRect(b.x - 1, bTop, b.w + 2, 3);

      // Left edge highlight
      const edgeGlow = ctx.createLinearGradient(b.x, bTop, b.x + 8, bTop);
      edgeGlow.addColorStop(0, "rgba(180,210,255,0.1)");
      edgeGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = edgeGlow;
      ctx.fillRect(b.x, bTop, 8, b.h);

      // Right edge shadow
      const edgeDark = ctx.createLinearGradient(b.x + b.w - 6, bTop, b.x + b.w, bTop);
      edgeDark.addColorStop(0, "rgba(0,0,0,0)");
      edgeDark.addColorStop(1, "rgba(0,0,0,0.15)");
      ctx.fillStyle = edgeDark;
      ctx.fillRect(b.x + b.w - 6, bTop, 6, b.h);

      // Subtle outline
      ctx.strokeStyle = "rgba(80,120,200,0.1)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(b.x, bTop, b.w, b.h);

      // Windows — warm glow
      const winW = 4,
        winH = 5,
        gap = 8,
        cols = b.windows;
      const startX = b.x + (b.w - cols * (winW + gap) + gap) / 2;
      for (let row = 0; row < Math.floor(b.h / 15); row++) {
        for (let col = 0; col < cols; col++) {
          const seed = hash01(b.x, row, col);
          const lit = Math.sin(game.time * (0.006 + seed * 0.01) + b.x * 0.03 + row * 0.8 + col * 2.4) > -0.35;
          const brightness = 0.55 + 0.45 * Math.sin(game.time * (0.01 + seed * 0.02) + row + col * 2 + seed * 4);
          if (lit) {
            // Warm window with slight glow spill
            const wx = startX + col * (winW + gap);
            const wy = bTop + 10 + row * 15;
            ctx.globalAlpha = 0.08 + brightness * 0.06;
            ctx.fillStyle = "#ffcc66";
            ctx.fillRect(wx - 1, wy - 1, winW + 2, winH + 2);
            ctx.globalAlpha = 0.5 + brightness * 0.35;
            ctx.fillStyle = COL.buildingLit;
            ctx.fillRect(wx, wy, winW, winH);
          } else {
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = "#080c18";
            ctx.fillRect(startX + col * (winW + gap), bTop + 10 + row * 15, winW, winH);
          }
        }
      }
      ctx.globalAlpha = 1;
    });
  });
}

function UNUSED_drawBurjKhalifa(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Burj Khalifa
  if (game.burjAlive) {
    const bx = BURJ_X,
      by = CITY_Y,
      bh = BURJ_H;
    withAnchorScale(ctx, bx, by, layout.burjScale, () => {
      ctx.save();

      // Setback tiers — the real Burj has Y-shaped cross section with visible steps
      // Each tier: [heightFraction, halfWidth] — top to bottom
      const tiers = [
        [1.0, 3], // top of tower
        [0.88, 4], // first setback
        [0.73, 6], // second setback
        [0.58, 8.5], // third setback
        [0.42, 10.5], // fourth — observation deck area
        [0.38, 12], // observation deck bulge
        [0.35, 10.5], // below deck, steps back in
        [0.22, 12], // fifth setback
        [0.1, 14], // base widening
        [0.0, 16], // ground level
      ];

      // Build tower silhouette from tiers
      function burjPath() {
        ctx.beginPath();
        ctx.moveTo(bx, by - bh - 30); // spire tip
        ctx.lineTo(bx - 1.5, by - bh - 12);
        // Left side — top to bottom
        for (const [hf, hw] of tiers) {
          ctx.lineTo(bx - hw, by - bh * hf);
        }
        // Right side — bottom to top
        for (let i = tiers.length - 1; i >= 0; i--) {
          ctx.lineTo(bx + tiers[i][1], by - bh * tiers[i][0]);
        }
        ctx.lineTo(bx + 1.5, by - bh - 12);
        ctx.closePath();
      }

      // Helper: get half-width at a given height fraction
      function hwAt(ht: number) {
        for (let j = 0; j < tiers.length - 1; j++) {
          if (ht >= tiers[j + 1][0] && ht <= tiers[j][0]) {
            const frac = (ht - tiers[j + 1][0]) / (tiers[j][0] - tiers[j + 1][0]);
            return tiers[j + 1][1] + (tiers[j][1] - tiers[j + 1][1]) * frac;
          }
        }
        return 16;
      }

      // === DRAMATIC GLOW AURA — drawn BEFORE the tower body ===
      // Large warm corona radiating from the tower
      const auraGrad = ctx.createRadialGradient(bx, by - bh * 0.3, 10, bx, by - bh * 0.3, 180);
      auraGrad.addColorStop(0, `rgba(255,200,120,${ov("burj.coronaAlpha", 0.1)})`);
      auraGrad.addColorStop(0.3, "rgba(255,170,80,0.05)");
      auraGrad.addColorStop(0.6, "rgba(200,140,60,0.02)");
      auraGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = auraGrad;
      ctx.fillRect(bx - 180, by - bh - 30, 360, bh + 60);

      // Vertical light beam behind tower (uplight effect)
      const beamGrad = ctx.createLinearGradient(bx - 30, by, bx + 30, by);
      beamGrad.addColorStop(0, "rgba(0,0,0,0)");
      beamGrad.addColorStop(0.3, "rgba(255,200,140,0.04)");
      beamGrad.addColorStop(0.5, "rgba(255,220,160,0.06)");
      beamGrad.addColorStop(0.7, "rgba(255,200,140,0.04)");
      beamGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = beamGrad;
      ctx.fillRect(bx - 30, by - bh - 40, 60, bh + 50);

      // === TOWER BODY ===
      // Warm golden gradient — looks lit up at night
      const burjGrad = ctx.createLinearGradient(bx, by, bx, by - bh);
      burjGrad.addColorStop(0, "#a89878"); // warm base, dialed down
      burjGrad.addColorStop(0.2, "#a89888");
      burjGrad.addColorStop(0.4, "#b0a898");
      burjGrad.addColorStop(0.65, "#c0c0c8");
      burjGrad.addColorStop(0.85, "#d0d0d8");
      burjGrad.addColorStop(1, "#dde0e8"); // bright moonlit top
      ctx.fillStyle = burjGrad;
      burjPath();
      ctx.fill();

      // Clip for interior details
      ctx.save();
      burjPath();
      ctx.clip();

      // Strong left highlight — bright moonlight edge
      const moonHL = ctx.createLinearGradient(bx - 16, 0, bx, 0);
      moonHL.addColorStop(0, "rgba(255,255,255,0.3)");
      moonHL.addColorStop(0.4, "rgba(220,230,255,0.12)");
      moonHL.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = moonHL;
      ctx.fillRect(bx - 16, by - bh - 30, 18, bh + 30);

      // Deep right shadow
      const rightShade = ctx.createLinearGradient(bx, 0, bx + 16, 0);
      rightShade.addColorStop(0, "rgba(0,0,0,0)");
      rightShade.addColorStop(0.4, "rgba(0,0,0,0.1)");
      rightShade.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = rightShade;
      ctx.fillRect(bx, by - bh - 30, 18, bh + 30);

      // Warm uplight on lower half
      const uplightGrad = ctx.createLinearGradient(bx, by, bx, by - bh * 0.5);
      uplightGrad.addColorStop(0, `rgba(255,180,80,${ov("burj.uplightAlpha", 0.08)})`);
      uplightGrad.addColorStop(0.5, "rgba(255,160,60,0.03)");
      uplightGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = uplightGrad;
      ctx.fillRect(bx - 16, by - bh * 0.5, 32, bh * 0.5);

      // Setback tier shadows
      for (let i = 1; i < tiers.length; i++) {
        const [hf, hw] = tiers[i];
        const [, prevHw] = tiers[i - 1];
        if (hw > prevHw) {
          const ly = by - bh * hf;
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(bx - hw, ly, hw * 2, 3);
          ctx.fillStyle = "rgba(255,240,200,0.1)";
          ctx.fillRect(bx - hw, ly - 1, hw * 2, 1);
        }
      }

      // Window bands — bright warm strips, more visible
      for (let i = 0; i < 30; i++) {
        const t = i / 30;
        const ht = 0.03 + 0.92 * t;
        const ly = by - bh * ht;
        const lw = hwAt(ht) * 0.75;
        if (lw < 2) continue;
        const lit = Math.sin(game.time * 0.05 + i * 0.5) > -0.4;
        if (lit) {
          const warmth = 1 - t;
          const r = Math.floor(200 + warmth * 55);
          const g = Math.floor(160 + warmth * 60);
          const b = Math.floor(80 + (1 - warmth) * 140);
          const a = 0.12 + 0.1 * Math.sin(game.time * 0.05 + i);
          ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
          ctx.fillRect(bx - lw, ly, lw * 2, 2);
        }
      }

      // Observation deck — bright warm glow band
      const deckY = by - bh * 0.4;
      ctx.fillStyle = "rgba(255,220,140,0.25)";
      ctx.fillRect(bx - 12, deckY, 24, 12);
      ctx.fillStyle = "rgba(255,255,220,0.15)";
      ctx.fillRect(bx - 11, deckY + 2, 22, 8);
      for (let w = -9; w <= 8; w += 3) {
        ctx.fillStyle = "rgba(255,240,180,0.3)";
        ctx.fillRect(bx + w, deckY + 3, 2, 5);
      }

      ctx.restore(); // end clip

      // Bright outline glow — the tower glows against the dark sky
      glow(ctx, "#ffcc66", ov("burj.outlineGlowRadius", 25) + Math.sin(game.time * 0.03) * 8);
      ctx.strokeStyle = "rgba(255,200,120,0.25)";
      ctx.lineWidth = 1.2;
      burjPath();
      ctx.stroke();
      glowOff(ctx);

      // Secondary cool blue edge glow
      glow(ctx, COL.burjGlow, 10);
      ctx.strokeStyle = "rgba(100,160,255,0.15)";
      ctx.lineWidth = 0.6;
      burjPath();
      ctx.stroke();
      glowOff(ctx);

      // Central spine — bright bright white
      const spineGlow = ctx.createLinearGradient(bx, by, bx, by - bh - 25);
      spineGlow.addColorStop(0, "rgba(255,220,160,0.2)");
      spineGlow.addColorStop(0.3, "rgba(255,240,200,0.35)");
      spineGlow.addColorStop(0.7, "rgba(255,255,255,0.45)");
      spineGlow.addColorStop(1, "rgba(255,255,255,0.6)");
      ctx.fillStyle = spineGlow;
      ctx.fillRect(bx - 0.5, by - bh - 25, 1, bh + 20);

      // Warm ground pool — light spilling onto ground from tower
      const poolGrad = ctx.createRadialGradient(bx, by + 5, 5, bx, by + 5, ov("burj.basePoolRadius", 150));
      poolGrad.addColorStop(0, `rgba(255,180,100,${ov("burj.basePoolAlpha", 0.08)})`);
      poolGrad.addColorStop(0.3, "rgba(255,160,80,0.04)");
      poolGrad.addColorStop(0.6, "rgba(200,120,50,0.015)");
      poolGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = poolGrad;
      ctx.fillRect(bx - 150, by - 20, 300, 60);

      // Base podium — wide, warmly lit
      ctx.fillStyle = "#5a4a38";
      ctx.fillRect(bx - 24, by - 6, 48, 6);
      const podGrad = ctx.createLinearGradient(bx - 24, by - 6, bx - 24, by);
      podGrad.addColorStop(0, "rgba(255,200,120,0.15)");
      podGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = podGrad;
      ctx.fillRect(bx - 24, by - 6, 48, 6);

      // Aviation warning light — dramatic red pulse
      const redPulse = Math.sin(game.time * 0.1);
      if (redPulse > 0.3) {
        const redAlpha = (redPulse - 0.3) / 0.7;
        ctx.fillStyle = "#ff0000";
        glow(ctx, "#ff0000", 20 + redAlpha * 15);
        ctx.globalAlpha = 0.5 + redAlpha * 0.5;
        ctx.beginPath();
        ctx.arc(bx, by - bh - 30, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        glowOff(ctx);
      }
      if (game.upgrades.ironBeam > 0) {
        const lvl = game.upgrades.ironBeam;
        const chargeTime = [360, 240, 180][lvl - 1];
        const chargeRatio = Math.min(game.ironBeamTimer / chargeTime, 1);
        const ready = chargeRatio >= 1;
        const cx = bx,
          cy = by - bh * 0.6,
          r = 5;
        ctx.strokeStyle = "rgba(255,34,0,0.15)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = ready ? "#ff2200" : `rgba(255,34,0,${0.3 + chargeRatio * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * chargeRatio);
        ctx.stroke();
        if (ready) {
          const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.12);
          ctx.fillStyle = `rgba(255,34,0,${0.6 + pulse * 0.4})`;
          glow(ctx, "#ff2200", 10);
        } else {
          ctx.fillStyle = `rgba(255,34,0,${0.15 + chargeRatio * 0.3})`;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (ready) glowOff(ctx);
      }
      ctx.restore();
      const hpW = 40,
        hpH = 4;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW, hpH);
      ctx.fillStyle = game.burjHealth > 2 ? "#44ff88" : game.burjHealth > 1 ? "#ffaa00" : "#ff3333";
      ctx.fillRect(bx - hpW / 2, by - bh - 50, hpW * (game.burjHealth / 5), hpH);
    });
  } else {
    withAnchorScale(ctx, BURJ_X, CITY_Y, layout.burjScale, () => {
      ctx.fillStyle = "#444";
      // Use deterministic pseudo-random offsets based on index to avoid per-frame jitter
      for (let i = 0; i < 8; i++) {
        const h1 = ((i * 7 + 3) % 13) / 13;
        const h2 = ((i * 11 + 5) % 13) / 13;
        ctx.fillRect(BURJ_X - 15 + i * 4, CITY_Y - 10 - h1 * 20, 5, 10 + h2 * 15);
      }
    });
  }
}

function drawPlanes(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // F-15 Eagle fighter jets
  game.planes.forEach((p: Plane) => {
    if (!p.alive) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.vx < 0) ctx.scale(-1, 1);
    // Bank when evading
    if (p.evadeTimer > 0) {
      const bankAngle = p.vy > 0 ? 0.3 : -0.3;
      ctx.rotate(bankAngle);
    }
    ctx.scale(layout.planeScale, layout.planeScale);
    // Fuselage — sleek fighter body
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
    // Nose cone — pointed
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
    // Engine nozzles (twin)
    ctx.fillStyle = "#4a5060";
    ctx.beginPath();
    ctx.ellipse(-22, -2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-22, 2, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Afterburner glow
    const abLen = 5 + 4 * pulse(game.time, 0.35, p.x * 0.04 + p.y * 0.02);
    ctx.fillStyle = "#ff8844";
    glow(ctx, "#ff6600", 8);
    ctx.beginPath();
    ctx.moveTo(-22, -3);
    ctx.lineTo(-22 - abLen, -2);
    ctx.lineTo(-22, -1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-22, 1);
    ctx.lineTo(-22 - abLen, 2);
    ctx.lineTo(-22, 3);
    ctx.closePath();
    ctx.fill();
    glowOff(ctx);
    // Cockpit
    ctx.fillStyle = "rgba(100,200,255,0.4)";
    ctx.beginPath();
    ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Nav lights
    if (Math.sin(p.blinkTimer * 0.15) > 0) {
      ctx.fillStyle = "#f00";
      glow(ctx, "#f00", 6);
      ctx.beginPath();
      ctx.arc(-10, -14, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f0";
      glow(ctx, "#0f0", 6);
      ctx.beginPath();
      ctx.arc(-10, 14, 1.5, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    }
    ctx.restore();
  });
}

function drawLasersAndBullets(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Iron Beam lasers
  game.laserBeams.forEach((b: LaserBeam) => {
    const alpha = b.life! / b.maxLife!;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL.laser;
    glow(ctx, COL.laser, 15 * layout.effectScale);
    ctx.lineWidth = 3 * layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x1!, b.y1!);
    ctx.lineTo(b.x2!, b.y2!);
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x1!, b.y1!);
    ctx.lineTo(b.x2!, b.y2!);
    ctx.stroke();
    glowOff(ctx);
    ctx.globalAlpha = 1;
  });

  // Phalanx bullets
  game.phalanxBullets.forEach((b: PhalanxBullet) => {
    if (b.cx === undefined) return;
    ctx.fillStyle = COL.phalanx;
    ctx.globalAlpha = 0.8;
    const bulletSize = 2 * layout.projectileScale;
    ctx.fillRect(b.cx - bulletSize / 2, b.cy! - bulletSize / 2, bulletSize, bulletSize);
    ctx.strokeStyle = "rgba(255,136,68,0.4)";
    ctx.lineWidth = layout.projectileScale;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.cx, b.cy!);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

function drawMissiles(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Missiles
  game.missiles.forEach((m: Missile) => {
    const angle = Math.atan2(m.vy, m.vx);

    if (m.type === "mirv") {
      // MIRV — large imposing ballistic missile
      ctx.save();
      // Thick smoke trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.5;
        const r = (3 + (1 - i / m.trail.length) * 5) * layout.effectScale;
        ctx.fillStyle = `rgba(200,160,120,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      // Hot inner trail
      for (let i = Math.max(0, m.trail.length - 8); i < m.trail.length; i++) {
        const a = ((i - (m.trail.length - 8)) / 8) * 0.7;
        ctx.fillStyle = `rgba(255,180,60,${a})`;
        ctx.beginPath();
        ctx.arc(m.trail[i].x, m.trail[i].y, 2.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);

      // Pulsing red glow
      glow(ctx, "#ff2200", (15 + Math.sin(game.time * 0.2) * 5) * layout.effectScale);

      // Body — large gunmetal
      ctx.fillStyle = "#445060";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(8, -4.5);
      ctx.lineTo(-14, -4.5);
      ctx.lineTo(-14, 4.5);
      ctx.lineTo(8, 4.5);
      ctx.closePath();
      ctx.fill();

      // Red nosecone
      ctx.fillStyle = "#cc2200";
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(14, -4.5);
      ctx.lineTo(14, 4.5);
      ctx.closePath();
      ctx.fill();

      // Stage separation bands (white rings)
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(2, -4.5);
      ctx.lineTo(2, 4.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, -4.5);
      ctx.lineTo(-6, 4.5);
      ctx.stroke();

      // Large fins
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

      // Oversized exhaust
      const mFlameLen = 10 + 8 * pulse(game.time, 0.3, m.x * 0.015 + m.y * 0.02);
      ctx.fillStyle = "#ff6633";
      ctx.beginPath();
      ctx.moveTo(-14, -3.5);
      ctx.lineTo(-14 - mFlameLen, 0);
      ctx.lineTo(-14, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcc66";
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-14 - mFlameLen * 0.5, 0);
      ctx.lineTo(-14, 2);
      ctx.closePath();
      ctx.fill();

      glowOff(ctx);

      // Health bar (only when damaged)
      if (m.health! < m.maxHealth!) {
        ctx.rotate(-angle); // un-rotate for horizontal health bar
        const barW = 24;
        const barH = 3;
        const ratio = m.health! / m.maxHealth!;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(-barW / 2, -16, barW, barH);
        ctx.fillStyle = ratio > 0.5 ? "#44ff44" : ratio > 0.25 ? "#ffaa00" : "#ff2222";
        ctx.fillRect(-barW / 2, -16, barW * ratio, barH);
      }

      ctx.restore();
    } else if (m.type === "mirv_warhead") {
      // MIRV warhead — smaller, red-orange, glowing
      ctx.save();
      // Trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.4;
        ctx.fillStyle = `rgba(220,100,50,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);
      // Pulsing glow
      glow(ctx, "#dd4422", (8 + Math.sin(game.time * 0.4) * 3) * layout.effectScale);
      // Body
      ctx.fillStyle = "#dd4422";
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(3, -2);
      ctx.lineTo(-5, -2);
      ctx.lineTo(-5, 2);
      ctx.lineTo(3, 2);
      ctx.closePath();
      ctx.fill();
      // Bright flame
      const wFlameLen = 5 + 4 * pulse(game.time, 0.4, m.x * 0.02 + m.y * 0.025);
      ctx.fillStyle = "#ff8844";
      ctx.beginPath();
      ctx.moveTo(-5, -1.5);
      ctx.lineTo(-5 - wFlameLen, 0);
      ctx.lineTo(-5, 1.5);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
      ctx.restore();
    } else if (m.type === "bomb") {
      // Bomb trail
      ctx.beginPath();
      m.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(255,100,0,${(i / m.trail.length) * 0.6})`;
        ctx.lineWidth = 1.5 * layout.effectScale;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (m.trail.length > 1) ctx.stroke();
      withAnchorScale(ctx, m.x, m.y, layout.enemyScale, () => {
        ctx.fillStyle = "#ff8800";
        glow(ctx, "#ff6600", 8 * layout.effectScale);
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
      glowOff(ctx);
    } else if (m.type === "stack2" || m.type === "stack3" || m.type === "stack_child") {
      const trailPulse = 0.55 + 0.45 * Math.sin(game.time * 0.9 + m.x * 0.018 + m.y * 0.02);
      if (m.type === "stack2" || m.type === "stack3") {
        drawStackCarrierMissile(ctx, m.x, m.y, angle, {
          scale: layout.enemyScale,
          alpha: 0.98,
          trailPulse,
          payloadCount: m.type === "stack3" ? 3 : 2,
        });
      } else {
        drawTitleStyleMissile(ctx, m.x, m.y, angle, {
          scale: layout.enemyScale,
          alpha: 0.98,
          trailLen: 34,
          trailPulse,
        });
      }
    } else {
      // Ballistic missile — cooler metallic body with title-style hot exhaust
      ctx.save();
      // Smoke trail
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.24;
        const r = (1.8 + (1 - i / m.trail.length) * 2.6) * layout.effectScale;
        ctx.fillStyle = `rgba(112,126,148,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      if (m.trail.length > 1) {
        ctx.beginPath();
        m.trail.forEach((t, i) => {
          if (i === 0) ctx.moveTo(t.x, t.y);
          else ctx.lineTo(t.x, t.y);
        });
        ctx.strokeStyle = "rgba(208,220,232,0.18)";
        ctx.lineWidth = 2 * layout.effectScale;
        ctx.stroke();
      }
      for (let i = Math.max(0, m.trail.length - 8); i < m.trail.length; i++) {
        const a = ((i - (m.trail.length - 8)) / 8) * 0.55;
        ctx.fillStyle = `rgba(255,188,92,${a})`;
        ctx.beginPath();
        ctx.arc(m.trail[i].x, m.trail[i].y, 1.25 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.translate(m.x, m.y);
      ctx.rotate(angle);
      ctx.scale(layout.enemyScale, layout.enemyScale);

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

      const exhaustFlicker = 0.55 + 0.45 * Math.sin(game.time * 0.9 + m.x * 0.018 + m.y * 0.02);
      const flameLen = 7 + 10 * exhaustFlicker;
      glow(ctx, "#ff9850", 11 * layout.effectScale);
      ctx.fillStyle = `rgba(255, 102, 42, ${0.62 + exhaustFlicker * 0.24})`;
      ctx.beginPath();
      ctx.moveTo(-9.3, -1.85);
      ctx.lineTo(-10.6 - flameLen, 0);
      ctx.lineTo(-9.3, 1.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 222, 144, ${0.54 + exhaustFlicker * 0.22})`;
      ctx.beginPath();
      ctx.moveTo(-9.1, -0.85);
      ctx.lineTo(-10.1 - flameLen * 0.56, 0);
      ctx.lineTo(-9.1, 0.85);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);

      ctx.restore();
    }

    if (m.luredByFlare) {
      ctx.strokeStyle = "rgba(255,180,90,0.8)";
      ctx.lineWidth = 1.5 * layout.effectScale;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(m.x, m.y, (8 + Math.sin(game.time * 0.22 + m.x * 0.01) * 1.5) * layout.effectScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });
}

function drawDrones(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Drones (Shaheds)
  game.drones.forEach((d: Drone) => {
    const facing = d.vx > 0 ? 1 : -1;
    const trail = d.trail ?? [];
    const trailAngle = trail.length
      ? Math.atan2(d.y - trail[trail.length - 1].y, d.x - trail[trail.length - 1].x)
      : Math.atan2(d.vy || 0, d.vx || 1);
    const dirX = Math.cos(trailAngle);
    const dirY = Math.sin(trailAngle);
    if (trail.length > 0 && d.subtype === "shahed238") {
      ctx.save();
      const pulseAmt = pulse(game.time, 0.55, d.x * 0.02 + d.y * 0.03);
      const jetTailX = d.x - dirX * 14 * layout.enemyScale;
      const jetTailY = d.y - dirY * 14 * layout.enemyScale;
      const jetTrailLen = (22 + 8 * pulseAmt) * layout.enemyScale;
      const jetTrail = ctx.createLinearGradient(
        jetTailX - dirX * jetTrailLen,
        jetTailY - dirY * jetTrailLen,
        jetTailX,
        jetTailY,
      );
      jetTrail.addColorStop(0, "rgba(255, 130, 60, 0)");
      jetTrail.addColorStop(0.45, "rgba(255, 130, 60, 0.16)");
      jetTrail.addColorStop(0.82, "rgba(210, 220, 230, 0.24)");
      jetTrail.addColorStop(1, "rgba(255, 205, 120, 0.08)");
      ctx.strokeStyle = jetTrail;
      ctx.lineWidth = 3.8 * layout.effectScale * layout.enemyScale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(jetTailX - dirX * jetTrailLen, jetTailY - dirY * jetTrailLen);
      ctx.lineTo(jetTailX, jetTailY);
      ctx.stroke();

      trail.forEach((t, i) => {
        const alpha = (i / trail.length) * 0.2;
        const radius = (1.6 + (i / trail.length) * 2.4) * layout.effectScale;
        ctx.fillStyle = `rgba(255, 150, 82, ${alpha})`;
        ctx.beginPath();
        ctx.arc(t.x - dirX * 12 * layout.enemyScale, t.y - dirY * 12 * layout.enemyScale, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.subtype === "shahed238" || d.diving) {
      const angle = Math.atan2(d.vy, d.vx);
      ctx.rotate(angle);
    } else {
      ctx.scale(facing, 1);
    }
    ctx.scale(layout.enemyScale, layout.enemyScale);

    if (d.subtype === "shahed136" && trail.length > 0) {
      const smokeLen = 9 + Math.min(trail.length, 12) * 0.75;
      const smokeGrad = ctx.createLinearGradient(-10.8 - smokeLen, 0, -10.3, 0);
      smokeGrad.addColorStop(0, "rgba(120,128,136,0)");
      smokeGrad.addColorStop(0.48, "rgba(136,144,152,0.18)");
      smokeGrad.addColorStop(1, "rgba(190,198,206,0.28)");
      ctx.strokeStyle = smokeGrad;
      ctx.lineWidth = 1.25 * layout.effectScale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-10.8 - smokeLen, 0);
      ctx.lineTo(-10.3, 0);
      ctx.stroke();

      const emberAlpha = 0.14 + Math.min(trail.length, 8) * 0.02;
      ctx.fillStyle = `rgba(196,170,118,${emberAlpha})`;
      ctx.beginPath();
      ctx.arc(-10.6, 0, 0.46 * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (d.subtype === "shahed238") {
      // Jet Shahed-238 — sleek delta wing, larger
      ctx.fillStyle = "#4a4a5a";
      // Fuselage
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -3);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-10, 3);
      ctx.closePath();
      ctx.fill();
      // Delta wings
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
      // Jet exhaust
      const exLen = 7 + 5 * pulse(game.time, 0.55, d.x * 0.02 + d.y * 0.03);
      ctx.fillStyle = "#ff6600";
      glow(ctx, "#ff4400", 12 * layout.effectScale);
      ctx.beginPath();
      ctx.moveTo(-14, -2);
      ctx.lineTo(-14 - exLen, 0);
      ctx.lineTo(-14, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffcc44";
      glowOff(ctx);
      ctx.beginPath();
      ctx.moveTo(-14, -1);
      ctx.lineTo(-14 - exLen * 0.5, 0);
      ctx.lineTo(-14, 1);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
      // Dive warning indicator
      if (d.diving) {
        ctx.strokeStyle = "#ff2200";
        ctx.globalAlpha = 0.5 + Math.sin(game.time * 0.3) * 0.3;
        ctx.lineWidth = layout.effectScale;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } else {
      // Prop Shahed-136 — slimmer flying wing with subtle prop bloom
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
      const pa = game.time * 0.8;
      const wobble = Math.cos(pa) * 1.1;
      ctx.strokeStyle = "rgba(226,232,242,0.82)";
      ctx.lineWidth = layout.effectScale * 0.68;
      ctx.beginPath();
      ctx.moveTo(-11 + wobble, -3.6);
      ctx.lineTo(-11 - wobble, 3.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-11 - wobble, -2.9);
      ctx.lineTo(-11 + wobble, 2.9);
      ctx.stroke();
      const propGlow = ctx.createRadialGradient(-11, 0, 0, -11, 0, 4.8);
      propGlow.addColorStop(0, "rgba(255, 136, 76, 0.2)");
      propGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = propGlow;
      ctx.fillRect(-16, -5, 10, 10);
    }

    // Blinking nav light
    if (Math.sin(game.time * 0.15) > 0) {
      ctx.fillStyle = d.subtype === "shahed238" ? "#ff2200" : "#ff4400";
      glow(ctx, ctx.fillStyle, 2 * layout.effectScale);
      ctx.beginPath();
      ctx.arc(0, 0, 0.75 * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    }
    ctx.restore();
  });
}

function drawInterceptors(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Interceptors (player green, F-15 blue-white)
  game.interceptors.forEach((ic: Interceptor) => {
    const isF15 = ic.fromF15;
    if (isF15) {
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(150,200,255,${(i / ic.trail.length) * 0.6})`;
        ctx.lineWidth = 1.5 * layout.effectScale;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (ic.trail.length > 1) ctx.stroke();
      withAnchorScale(ctx, ic.x, ic.y, layout.projectileScale, () => {
        ctx.fillStyle = "#aaccff";
        glow(ctx, "#6699ff", 6 * layout.effectScale);
        ctx.beginPath();
        ctx.arc(ic.x, ic.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
      glowOff(ctx);
      return;
    }

    ic.trail.forEach((t, i) => {
      const alpha = (i / Math.max(1, ic.trail.length)) * 0.34;
      const radius = (1.1 + (i / Math.max(1, ic.trail.length)) * 2.8) * layout.effectScale;
      ctx.fillStyle = `rgba(110,220,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });

    if (ic.trail.length > 1) {
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      ctx.strokeStyle = "rgba(132,232,255,0.28)";
      ctx.lineWidth = 2.2 * layout.effectScale;
      ctx.stroke();
    }

    const heading =
      typeof ic.heading === "number"
        ? ic.heading
        : ic.trail.length >= 1
          ? Math.atan2(ic.y - ic.trail[ic.trail.length - 1].y, ic.x - ic.trail[ic.trail.length - 1].x)
          : -Math.PI / 2;

    ctx.save();
    ctx.translate(ic.x, ic.y);
    ctx.rotate(heading);
    ctx.scale(layout.projectileScale, layout.projectileScale);

    const exhaustFlicker = 0.55 + 0.45 * Math.sin(game.time * 0.85 + ic.x * 0.018 + ic.y * 0.022);
    const exhaustLen = 18 + 18 * exhaustFlicker;
    const exhaustAlpha = 0.78 + 0.22 * exhaustFlicker;

    ctx.fillStyle = `rgba(90, 220, 255, ${exhaustAlpha * 0.28})`;
    ctx.beginPath();
    ctx.moveTo(-8.4, -3.8);
    ctx.lineTo(-22 - exhaustLen * 0.78, 0);
    ctx.lineTo(-8.4, 3.8);
    ctx.closePath();
    ctx.fill();

    glow(ctx, "#8ce8ff", 12 * layout.effectScale);
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
    glowOff(ctx);
    ctx.restore();
  });
}

function drawUpgradeProjectiles(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Wild Hornets
  game.hornets.forEach((h: Hornet) => {
    const heading =
      h.trail.length >= 1 ? Math.atan2(h.y - h.trail[h.trail.length - 1].y, h.x - h.trail[h.trail.length - 1].x) : 0;
    ctx.beginPath();
    h.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(255,204,0,${(i / h.trail.length) * 0.6})`;
      ctx.lineWidth = 1.5 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (h.trail.length > 1) ctx.stroke();
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(heading + Math.PI / 2);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    ctx.fillStyle = COL.hornet;
    glow(ctx, COL.hornet, 8 * layout.effectScale);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.5, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-3.5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,244,160,0.85)";
    ctx.fillRect(-0.8, -4, 1.6, 5);
    ctx.fillStyle = "rgba(255,204,0,0.45)";
    ctx.fillRect(-6, 0, 4, 1.6);
    ctx.fillRect(2, 0, 4, 1.6);
    ctx.restore();
    glowOff(ctx);
  });

  // Roadrunners
  game.roadrunners.forEach((r: Roadrunner) => {
    ctx.beginPath();
    r.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(68,170,255,${(i / r.trail.length) * 0.7})`;
      ctx.lineWidth = 2 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (r.trail.length > 1) ctx.stroke();
    ctx.fillStyle = COL.roadrunner;
    glow(ctx, COL.roadrunner, 10 * layout.effectScale);
    ctx.save();
    ctx.translate(r.x, r.y);
    // Rotate to face direction of travel
    let angle = -Math.PI / 2; // default: pointing up (launch phase)
    if (r.trail.length >= 2) {
      const prev = r.trail[r.trail.length - 1];
      angle = Math.atan2(r.y - prev.y, r.x - prev.x) + Math.PI / 2;
    }
    ctx.rotate(angle);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    ctx.fillStyle = "#2c4760";
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#7fd5ff";
    ctx.fillRect(-1.5, -8, 3, 5);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(-0.7, -5, 1.4, 2);
    ctx.restore();
    glowOff(ctx);
  });

  // Patriot missiles
  game.patriotMissiles.forEach((p: PatriotMissile) => {
    ctx.beginPath();
    p.trail.forEach((t, i) => {
      ctx.strokeStyle = `rgba(136,255,68,${(i / p.trail.length) * 0.7})`;
      ctx.lineWidth = 2.5 * layout.effectScale;
      if (i === 0) ctx.moveTo(t.x, t.y);
      else ctx.lineTo(t.x, t.y);
    });
    if (p.trail.length > 1) ctx.stroke();
    // Rotate to face direction of travel
    let pAngle = -Math.PI / 2;
    if (p.trail.length >= 2) {
      const prev = p.trail[p.trail.length - 1];
      pAngle = Math.atan2(p.y - prev.y, p.x - prev.x) + Math.PI / 2;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pAngle);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    glow(ctx, COL.patriot, 12 * layout.effectScale);
    // Missile body
    ctx.fillStyle = "#2a5a2a";
    ctx.fillRect(-3, -8, 6, 16);
    // Nosecone
    ctx.fillStyle = COL.patriot;
    ctx.beginPath();
    ctx.moveTo(-3, -8);
    ctx.lineTo(0, -13);
    ctx.lineTo(3, -8);
    ctx.fill();
    // Fins
    ctx.fillStyle = "#1a4a1a";
    ctx.fillRect(-5, 5, 2, 4);
    ctx.fillRect(3, 5, 2, 4);
    // Exhaust flame
    ctx.fillStyle = "#ffaa22";
    const flameLen = 5 + 4 * pulse(game.time, 0.5, p.x * 0.02 + p.y * 0.015);
    ctx.beginPath();
    ctx.moveTo(-2, 8);
    ctx.lineTo(0, 8 + flameLen);
    ctx.lineTo(2, 8);
    ctx.fill();
    ctx.restore();
    glowOff(ctx);
  });
}

function drawExplosionsAndParticles(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  game.explosions.forEach((ex: Explosion) => {
    if ((ex.linkAlpha ?? 0) <= 0 || ex.linkFromX == null || ex.linkFromY == null) return;
    const dx = ex.x - ex.linkFromX;
    const dy = ex.y - ex.linkFromY;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len;
    const ny = dx / len;
    const width = (8 + (ex.chainLevel ?? 0) * 2.2) * layout.effectScale;
    const alpha = Math.min(1, (ex.linkAlpha ?? 0) * ex.alpha);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha * 0.9;
    const grad = ctx.createLinearGradient(ex.linkFromX, ex.linkFromY, ex.x, ex.y);
    grad.addColorStop(0, "rgba(255, 248, 210, 0)");
    grad.addColorStop(0.2, "rgba(255, 220, 128, 0.9)");
    grad.addColorStop(0.55, "rgba(255, 150, 64, 0.75)");
    grad.addColorStop(1, "rgba(255, 84, 24, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(ex.linkFromX + nx * width * 0.25, ex.linkFromY + ny * width * 0.25);
    ctx.lineTo(ex.x + nx * width * 0.5, ex.y + ny * width * 0.5);
    ctx.lineTo(ex.x - nx * width * 0.5, ex.y - ny * width * 0.5);
    ctx.lineTo(ex.linkFromX - nx * width * 0.25, ex.linkFromY - ny * width * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,252,240,0.8)";
    ctx.lineWidth = Math.max(1, width * 0.12);
    ctx.beginPath();
    ctx.moveTo(ex.linkFromX, ex.linkFromY);
    ctx.lineTo(ex.x, ex.y);
    ctx.stroke();
    ctx.restore();
  });

  // Explosions
  game.explosions.forEach((ex: Explosion) => {
    const r = ex.radius * layout.effectScale;
    if (r < 1) return;
    const chainBoost = 1 + (ex.chainLevel ?? 0) * 0.12 + (ex.heroPulse ?? 0) * 0.08;
    const rootBoost =
      ex.rootExplosionId == null && (ex.kills ?? 0) >= 2 ? 1 + Math.min(0.45, (ex.kills ?? 0) * 0.08) : 1;
    const boostedR = r * chainBoost * rootBoost;

    const isInterceptorBlast = ex.playerCaused && !ex.chain;
    if (isInterceptorBlast) {
      // Interceptor detonation — sprite-backed flash for crisp hit confirmation.
      const flashImg = getInterceptorHitFlashImage();
      const flashThreshold = ov("explosion.flashThreshold", 0.85);
      const flashPop = Math.max(0, (ex.alpha - flashThreshold) / Math.max(0.0001, 1 - flashThreshold));
      const bloomAlpha = Math.min(1, ex.alpha * 0.75 + flashPop * 0.45);
      const bloomR = (r * (1.55 + flashPop * 0.35)) / 4;

      ctx.globalAlpha = bloomAlpha;
      const bloom = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, bloomR);
      bloom.addColorStop(0, "rgba(255,255,240,0.95)");
      bloom.addColorStop(0.2, "rgba(255,210,120,0.45)");
      bloom.addColorStop(0.55, "rgba(255,120,40,0.18)");
      bloom.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, bloomR, 0, Math.PI * 2);
      ctx.fill();

      if (flashImg) {
        const spriteSize = (r * (2.3 + flashPop * 0.3)) / 4;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, ex.alpha * 1.1);
        ctx.drawImage(flashImg, ex.x - spriteSize / 2, ex.y - spriteSize / 2, spriteSize, spriteSize);
        ctx.restore();
      } else {
        const popR = (r * 0.2) / 4;
        if (ex.alpha > flashThreshold) {
          const flashT = (ex.alpha - flashThreshold) * 0.5;
          ctx.globalAlpha = flashT;
          ctx.fillStyle = ex.color;
          ctx.beginPath();
          ctx.arc(ex.x, ex.y, popR, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = flashT;
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(ex.x, ex.y, popR * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        if (ex.alpha > 0.2 && ex.alpha <= flashThreshold) {
          const t = 1 - (ex.alpha - 0.2) / Math.max(0.0001, flashThreshold - 0.2);
          const emberR = ((r * 0.15) / 4) * (1 - t);
          ctx.globalAlpha = (1 - t) * 0.8;
          ctx.fillStyle = ex.color;
          ctx.beginPath();
          ctx.arc(ex.x, ex.y, emberR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (ex.visualType === "missile" || ex.visualType === "drone") {
      const isDroneKill = ex.visualType === "drone";
      const flashImg = isDroneKill ? getDroneKillFlashImage() : getMissileKillFlashImage();
      const bloomR = boostedR * (isDroneKill ? 0.92 : 0.82);
      const spriteSize = boostedR * (isDroneKill ? 1.18 : 1.02);

      const splashR = boostedR * (isDroneKill ? 2.2 : 2.05);
      const splash = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, splashR);
      if (isDroneKill) {
        splash.addColorStop(0, "rgba(255, 220, 184, 0.3)");
        splash.addColorStop(0.16, "rgba(255, 132, 72, 0.24)");
        splash.addColorStop(0.38, "rgba(216, 74, 34, 0.14)");
      } else {
        splash.addColorStop(0, "rgba(255, 242, 204, 0.32)");
        splash.addColorStop(0.16, "rgba(255, 190, 96, 0.24)");
        splash.addColorStop(0.38, "rgba(255, 122, 34, 0.12)");
      }
      splash.addColorStop(0.62, "rgba(255, 82, 40, 0.04)");
      splash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = ex.alpha;
      ctx.fillStyle = splash;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, splashR, 0, Math.PI * 2);
      ctx.fill();

      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, boostedR);
      if (isDroneKill) {
        grad.addColorStop(0, "#fff6ea");
        grad.addColorStop(0.14, "#ffd4a0");
        grad.addColorStop(0.38, "#ff8f3e");
        grad.addColorStop(0.72, "rgba(116,26,14,0.12)");
      } else {
        grad.addColorStop(0, "#fffcee");
        grad.addColorStop(0.14, "#ffe89f");
        grad.addColorStop(0.38, "#ffbc3c");
        grad.addColorStop(0.72, "rgba(255,92,18,0.1)");
      }
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = ex.alpha * (isDroneKill ? 0.92 : 0.88);
      const bloom = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, bloomR);
      if (isDroneKill) {
        bloom.addColorStop(0, "rgba(255,232,196,0.92)");
        bloom.addColorStop(0.24, "rgba(255,152,68,0.44)");
        bloom.addColorStop(0.58, "rgba(224,72,30,0.16)");
      } else {
        bloom.addColorStop(0, "rgba(255,246,215,0.96)");
        bloom.addColorStop(0.2, "rgba(255,204,96,0.46)");
        bloom.addColorStop(0.52, "rgba(255,118,28,0.15)");
      }
      bloom.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, bloomR, 0, Math.PI * 2);
      ctx.fill();

      if (flashImg) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, ex.alpha * 1.05);
        ctx.drawImage(flashImg, ex.x - spriteSize / 2, ex.y - spriteSize / 2, spriteSize, spriteSize);
        ctx.restore();
      } else {
        const coreR = boostedR * (isDroneKill ? 0.34 : 0.3);
        ctx.globalAlpha = ex.alpha * 0.9;
        ctx.fillStyle = isDroneKill ? "#ff8833" : "#ffcc55";
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, coreR, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = ex.alpha * 0.65;
        ctx.fillStyle = "#fff4cc";
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, coreR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // All other explosions — gradient fireball
      ctx.globalAlpha = ex.alpha;
      const splashR = boostedR * 2.05;
      const splash = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, splashR);
      splash.addColorStop(0, "rgba(255, 240, 206, 0.34)");
      splash.addColorStop(0.16, "rgba(255, 184, 120, 0.24)");
      splash.addColorStop(0.38, "rgba(255, 116, 60, 0.12)");
      splash.addColorStop(0.62, "rgba(255, 82, 40, 0.04)");
      splash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = splash;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, splashR, 0, Math.PI * 2);
      ctx.fill();

      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, boostedR);
      const warmStop = ov("explosion.fireballWarmStop", 0.15);
      const colorStop = Math.max(warmStop, ov("explosion.fireballColorStop", 0.4));
      const fadeStop = Math.max(colorStop, ov("explosion.fireballFadeStop", 0.75));
      grad.addColorStop(0, "#fff");
      grad.addColorStop(warmStop, "#ffeeaa");
      grad.addColorStop(colorStop, ex.color);
      grad.addColorStop(fadeStop, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shockwave ring
    if (ex.ringAlpha > 0) {
      const ringR = ex.ringRadius * layout.effectScale;
      ctx.globalAlpha = ex.ringAlpha * ex.alpha * (1 + (ex.heroPulse ?? 0) * 0.18);
      ctx.strokeStyle = ex.color;
      ctx.lineWidth = Math.max(
        1,
        ov("explosion.ringWidth", 3) *
          layout.effectScale *
          ex.ringAlpha *
          (1 + (ex.chainLevel ?? 0) * 0.18 + (ex.heroPulse ?? 0) * 0.25),
      );
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      if ((ex.heroPulse ?? 0) > 0.12) {
        ctx.globalAlpha = ex.ringAlpha * ex.alpha * 0.45 * (ex.heroPulse ?? 0);
        ctx.lineWidth *= 0.65;
        ctx.beginPath();
        ctx.arc(ex.x, ex.y, ringR + 10 * layout.effectScale * (ex.heroPulse ?? 0), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
  ctx.globalAlpha = 1;

  // Particles
  game.particles.forEach((p: Particle) => {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    if (p.type === "debris") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle!);
      ctx.fillStyle = p.color;
      const w = p.w! * layout.effectScale * 1.5;
      const h = p.h! * layout.effectScale * 1.5;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.type === "spark") {
      // Bright streak with longer velocity trail
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size * layout.effectScale * 1.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 5, p.y - p.vy * 5);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.7 * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * layout.effectScale, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;

  // Explosion light casting — warm glow illuminates surroundings
  if (game.explosions.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    game.explosions.forEach((ex) => {
      if (ex.alpha < 0.15) return;
      const r = ex.radius * layout.effectScale;
      if (r < 5) return;
      const intensity = ex.alpha * ov("explosion.lightIntensity", 0.12);
      const lightR = r * ov("explosion.lightRadiusMul", 4);
      const grad = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, lightR);
      // Parse explosion color for tinting, fallback to warm orange
      grad.addColorStop(0, `rgba(255, 180, 100, ${intensity})`);
      grad.addColorStop(0.3, `rgba(255, 140, 60, ${intensity * 0.5})`);
      grad.addColorStop(0.7, `rgba(200, 80, 30, ${intensity * 0.15})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(ex.x - lightR, ex.y - lightR, lightR * 2, lightR * 2);
    });
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
}

function drawGroundStructures(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  const scenicLauncherY = GAMEPLAY_SCENIC_LAUNCHER_Y;
  // Launchers
  LAUNCHERS.forEach((l, i) => {
    const launcherMaxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
    const damaged = launcherMaxHP === 2 && game.launcherHP[i] === 1;
    const ammoMax = getAmmoCapacity(game.wave, game.upgrades.launcherKit);
    const ammoRatio = game.ammo[i] / ammoMax;
    const angle = Math.atan2(game.crosshairY - l.y, game.crosshairX - l.x);
    const barrelAngle = Math.min(-0.2, Math.max(angle, -Math.PI + 0.2));
    const fireTick = game.launcherFireTick ? game.launcherFireTick[i] : 0;
    const tickNow = game._replayTick || 0;
    const fireAge = tickNow - fireTick;
    const muzzleFlash = fireAge < 6 ? 1 - fireAge / 6 : 0;

    drawSharedLauncher(ctx, l.x, scenicLauncherY, barrelAngle, {
      t: game.time / 60,
      scale: 0.8 + layout.launcherScale * 0.06,
      damaged,
      active: game.launcherHP[i] > 0,
      muzzleFlash,
      statusLabel: null,
    });

    if (game.launcherHP[i] <= 0) return;

    if (game.ammo[i] <= 0) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = `bold 10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillStyle = "rgba(40, 8, 10, 0.86)";
      ctx.strokeStyle = "rgba(255, 92, 80, 0.72)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(l.x - 15, scenicLauncherY + 30, 30, 12, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffd3ca";
      ctx.fillText("OUT", l.x, scenicLauncherY + 39);
      ctx.textAlign = "left";
      ctx.restore();
    } else if (ammoRatio <= 0.3) {
      ctx.save();
      ctx.translate(l.x, scenicLauncherY + 34);
      ctx.fillStyle = "rgba(52, 18, 10, 0.88)";
      ctx.strokeStyle = "rgba(255, 184, 92, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(8, 7);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff0cf";
      ctx.font = `bold 10px ${ARCADE_FONT_FAMILY}`;
      ctx.textAlign = "center";
      ctx.fillText("!", 0, 4);
      ctx.textAlign = "left";
      ctx.restore();
    }

    const maxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
    for (let h = 0; h < maxHP; h++) {
      ctx.fillStyle = h < game.launcherHP[i] ? "#44ff88" : "#333";
      ctx.beginPath();
      ctx.arc(l.x - 4 + h * 8, scenicLauncherY + 39, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Phalanx turrets
  if (game.upgrades.phalanx > 0) {
    const turrets = getPhalanxTurrets(game.upgrades.phalanx);
    turrets.forEach((t) => {
      ctx.fillStyle = "#556677";
      ctx.fillRect(t.x - 6, t.y, 12, 10);
      ctx.fillStyle = "#778899";
      ctx.fillRect(t.x - 4, t.y - 6, 8, 8);
      ctx.save();
      ctx.translate(t.x, t.y - 4);
      ctx.rotate(game.time * 0.3);
      ctx.fillStyle = "#99aabb";
      ctx.fillRect(-1, -8, 2, 8);
      ctx.restore();
      if (layout.showSystemLabels) {
        ctx.fillStyle = "rgba(255,136,68,0.6)";
        ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
        ctx.fillText("CIWS", t.x - 10, t.y + 18);
      }
    });
  }

  // Patriot launcher — TEL vehicle with SAM arm
  if (game.upgrades.patriot > 0) {
    const patriotSite = getDefenseSitePlacement("patriot");
    const patX = patriotSite?.x ?? 334;
    const patY = patriotSite?.y ?? GROUND_Y;
    ctx.save();
    ctx.translate(patX, patY);
    ctx.scale(3, 3);
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
    // Missile tubes
    ctx.fillStyle = "#3a4830";
    ctx.fillRect(-2, -16, 2, 6);
    ctx.fillRect(0.5, -16, 2, 6);
    // Missile tips
    ctx.fillStyle = "#88ff44";
    glow(ctx, "#88ff44", 2);
    ctx.fillRect(-1.5, -17, 1.5, 1.5);
    ctx.fillRect(1, -17, 1.5, 1.5);
    glowOff(ctx);
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
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(136,255,68,0.6)";
      ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("PAC-3", patX - 20, patY + 10);
    }
  }

  // Wild Hornets — hex hive launcher
  if (game.upgrades.wildHornets > 0) {
    const hornetSite = getDefenseSitePlacement("wildHornets");
    const hx = hornetSite?.x ?? 206;
    const hy = hornetSite?.y ?? GROUND_Y;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(3, 3);
    const cellR = 5;
    const cells = [
      { x: 0, y: -8 },
      { x: -6, y: -4.5 },
      { x: 6, y: -4.5 },
      { x: -3, y: -1 },
      { x: 3, y: -1 },
    ];
    // Base platform
    ctx.fillStyle = "#2a2a20";
    ctx.fillRect(-14, -1, 28, 4);
    const lvl = game.upgrades.wildHornets;
    const filledCells = [2, 3, 5][lvl - 1];
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
      // Drone inside filled cells
      if (i < filledCells) {
        ctx.fillStyle = COL.hornet;
        glow(ctx, COL.hornet, 3);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y - 2.5);
        ctx.lineTo(c.x + 2, c.y + 1.5);
        ctx.lineTo(c.x, c.y + 0.5);
        ctx.lineTo(c.x - 2, c.y + 1.5);
        ctx.closePath();
        ctx.fill();
        glowOff(ctx);
      }
    });
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(255,204,0,0.6)";
      ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("HORNETS", hx - 18, hy + 12);
    }
  }

  // Roadrunner launcher — open container with missiles
  if (game.upgrades.roadrunner > 0) {
    const roadrunnerSite = getDefenseSitePlacement("roadrunner");
    const rrX = roadrunnerSite?.x ?? 678;
    const rrY = roadrunnerSite?.y ?? GROUND_Y;
    ctx.save();
    ctx.translate(rrX, rrY);
    ctx.scale(3, 3);
    // Container walls (3 walls, no top)
    ctx.fillStyle = "#1e2e3e";
    ctx.fillRect(-14, -10, 2, 12); // left wall
    ctx.fillRect(12, -10, 2, 12); // right wall
    ctx.fillRect(-14, 0, 28, 2); // bottom
    // Back wall
    ctx.fillStyle = "#162636";
    ctx.fillRect(-12, -10, 24, 2);
    // Missiles inside (count by level)
    const rrCount = Math.min(game.upgrades.roadrunner, 3);
    for (let i = 0; i < rrCount; i++) {
      ctx.fillStyle = "#2c4760";
      ctx.fillRect(-9 + i * 8, -9, 4, 9);
      // Nose cone
      ctx.fillStyle = "#44aaff";
      glow(ctx, "#44aaff", 2);
      ctx.beginPath();
      ctx.moveTo(-7 + i * 8, -12);
      ctx.lineTo(-9 + i * 8, -9);
      ctx.lineTo(-5 + i * 8, -9);
      ctx.closePath();
      ctx.fill();
      glowOff(ctx);
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
    ctx.restore();
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(68,170,255,0.6)";
      ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("ROADRUNNER", rrX - 25, rrY + 12);
    }
  }

  // Flare launcher — integrated dispensers near top of Burj
  if (game.upgrades.flare > 0) {
    const flareY = GROUND_Y - BURJ_H * 0.97;
    const lvl = game.upgrades.flare;
    const towerHW = 3.5; // approximate half-width at this height

    // Flush-mounted dispenser panels on both sides of the tower
    // Left dispenser
    ctx.fillStyle = "#8a7a68";
    ctx.fillRect(BURJ_X - towerHW - 4, flareY - 4, 4, 8);
    // Dispenser tubes (count by level)
    ctx.fillStyle = "#ff9944";
    const leftTubes = Math.min(lvl, 2);
    for (let i = 0; i < leftTubes; i++) {
      ctx.fillRect(BURJ_X - towerHW - 3.5, flareY - 3 + i * 4, 3, 2);
    }

    // Right dispenser
    ctx.fillStyle = "#8a7a68";
    ctx.fillRect(BURJ_X + towerHW, flareY - 4, 4, 8);
    ctx.fillStyle = "#ff9944";
    const rightTubes = lvl >= 2 ? lvl - 1 : 0;
    for (let i = 0; i < rightTubes; i++) {
      ctx.fillRect(BURJ_X + towerHW + 0.5, flareY - 3 + i * 4, 3, 2);
    }

    // Warm glow when flares are launching
    if (game.flares.some((f) => f.alive && f.life > f.maxLife - 10)) {
      ctx.fillStyle = "rgba(255,160,60,0.35)";
      ctx.beginPath();
      ctx.arc(BURJ_X, flareY, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(255,136,51,0.6)";
      ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("FLARE", BURJ_X - 15, flareY + 16);
    }
  }

  // EMP emitter — mounted at center of Burj
  if (game.upgrades.emp > 0) {
    const empY = GROUND_Y - BURJ_H * 0.67;
    const lvl = game.upgrades.emp;
    // Mounting ring on Burj
    ctx.strokeStyle = "#7a5a9a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(BURJ_X, empY, 7, 0, Math.PI * 2);
    ctx.stroke();
    // Coil nodes (more at higher levels)
    const nodeCount = lvl + 1;
    ctx.fillStyle = "#8866aa";
    for (let i = 0; i < nodeCount; i++) {
      const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
      const nx = BURJ_X + Math.cos(angle) * 7;
      const ny = empY + Math.sin(angle) * 7;
      ctx.beginPath();
      ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center core
    ctx.fillStyle = "#6644aa";
    ctx.beginPath();
    ctx.arc(BURJ_X, empY, 3, 0, Math.PI * 2);
    ctx.fill();
    // Charging arcs between nodes
    if (game.empCharge > 0 && game.empChargeMax > 0) {
      const chargeRatio = game.empCharge / game.empChargeMax;
      ctx.strokeStyle = COL.emp;
      ctx.globalAlpha = chargeRatio * 0.7;
      glow(ctx, COL.emp, 6 * chargeRatio);
      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodeCount; i++) {
        const angle = (i / nodeCount) * Math.PI * 2 - Math.PI / 2;
        const nx = BURJ_X + Math.cos(angle) * 7;
        const ny = empY + Math.sin(angle) * 7;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        const wobble = Math.sin(game.time * 0.4 + i * 2) * 3 * chargeRatio;
        ctx.quadraticCurveTo(BURJ_X + wobble, empY - wobble, BURJ_X, empY);
        ctx.stroke();
      }
      glowOff(ctx);
      ctx.globalAlpha = 1;
    }
    // Ready pulse
    if (game.empReady) {
      const pulse = 0.3 + 0.5 * Math.sin(game.time * 0.2);
      ctx.fillStyle = COL.emp;
      glow(ctx, COL.emp, 18);
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.arc(BURJ_X, empY, 12, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
      ctx.globalAlpha = 1;
    }
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(204,68,255,0.6)";
      ctx.font = `7px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("EMP", BURJ_X - 8, empY + 20);
    }
  }

  // EMP shockwave rings
  game.empRings.forEach((ring: EmpRing) => {
    if (!ring.alive) return;
    const progress = ring.radius / ring.maxRadius;
    ctx.save();

    // Screen-wide flash at the start
    if (progress < 0.15) {
      const flashAlpha = (1 - progress / 0.15) * 0.25;
      ctx.fillStyle = COL.emp;
      ctx.globalAlpha = flashAlpha;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.globalAlpha = 1;
    }

    // Filled shockwave area — faint violet wash behind the ring
    const washAlpha = ring.alpha * 0.08;
    if (washAlpha > 0.005) {
      const wash = ctx.createRadialGradient(ring.x, ring.y, 0, ring.x, ring.y, ring.radius);
      wash.addColorStop(0, "rgba(204,68,255,0)");
      wash.addColorStop(0.7, "rgba(204,68,255,0)");
      wash.addColorStop(1, `rgba(204,68,255,${washAlpha})`);
      ctx.fillStyle = wash;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Main thick outer ring with heavy glow
    ctx.globalAlpha = ring.alpha;
    ctx.strokeStyle = COL.emp;
    glow(ctx, COL.emp, 40 + ring.radius * 0.08);
    ctx.lineWidth = 6 + (1 - progress) * 4;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();

    // Second ring slightly inside — creates thickness
    ctx.strokeStyle = "#dd88ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, Math.max(0, ring.radius - 8), 0, Math.PI * 2);
    ctx.stroke();

    // White-hot core ring
    ctx.strokeStyle = "#fff";
    glow(ctx, "#fff", 8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
    glowOff(ctx);

    // Electric lightning arcs — more of them, longer, forked
    ctx.globalAlpha = ring.alpha * 0.9;
    const arcCount = 10 + Math.floor(ring.radius * 0.04);
    for (let i = 0; i < arcCount; i++) {
      const angle = (i / arcCount) * Math.PI * 2 + game.time * 0.15 + Math.random() * 0.3;
      const ax = ring.x + Math.cos(angle) * ring.radius;
      const ay = ring.y + Math.sin(angle) * ring.radius;
      const len = 12 + ring.radius * 0.06;
      // Main bolt
      ctx.strokeStyle = Math.random() > 0.3 ? "#dd88ff" : "#fff";
      glow(ctx, "#cc44ff", 6);
      ctx.lineWidth = Math.random() > 0.5 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      const mx = ax + (Math.random() - 0.5) * len;
      const my = ay + (Math.random() - 0.5) * len;
      ctx.lineTo(mx, my);
      // Fork
      const fx = mx + (Math.random() - 0.5) * len * 0.6;
      const fy = my + (Math.random() - 0.5) * len * 0.6;
      ctx.lineTo(fx, fy);
      ctx.stroke();
      // Second fork from midpoint
      if (Math.random() > 0.5) {
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + (Math.random() - 0.5) * len * 0.5, my + (Math.random() - 0.5) * len * 0.5);
        ctx.stroke();
      }
      glowOff(ctx);
    }

    // Trailing sparks inside the ring area
    ctx.globalAlpha = ring.alpha * 0.4;
    for (let i = 0; i < 12; i++) {
      const sa = Math.random() * Math.PI * 2;
      const sr = ring.radius * (0.6 + Math.random() * 0.35);
      const sx = ring.x + Math.cos(sa) * sr;
      const sy = ring.y + Math.sin(sa) * sr;
      ctx.fillStyle = Math.random() > 0.5 ? "#cc44ff" : "#aa66ff";
      ctx.fillRect(sx, sy, 2, 2);
    }

    ctx.restore();
  });

  // Defense sites — destroyed rubble or alive glow
  game.defenseSites.forEach((site: DefenseSite) => {
    const hw = site.hw ?? 0;
    const hh = site.hh ?? 0;
    if (!site.alive) {
      // Rubble
      ctx.fillStyle = "#333";
      ctx.fillRect(site.x - hw * 0.6, site.y - 3, hw * 1.2, 6);
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(site.x - hw * 0.3, site.y - 5, hw * 0.4, 4);
      ctx.fillRect(site.x + 2, site.y - 4, hw * 0.3, 3);
      ctx.fillStyle = "rgba(255,60,0,0.15)";
      ctx.fillRect(site.x - hw * 0.6, site.y - 5, hw * 1.2, 8);
    } else {
      // Subtle targeting indicator glow
      const def = UPGRADES[site.key as UpgradeKey];
      const pulse = 0.2 + 0.15 * Math.sin(game.time * 0.06);
      ctx.strokeStyle = def ? def.color : "#44ffaa";
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1;
      ctx.strokeRect(site.x - hw, site.y - hh, hw * 2, hh * 2);
      ctx.globalAlpha = 1;
    }
  });
}

function drawHUD(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // Vignette and CRT-style glass finish
  const vignette = ctx.createRadialGradient(
    CANVAS_W / 2,
    layout.renderHeight * 0.45,
    180,
    CANVAS_W / 2,
    layout.renderHeight * 0.45,
    620,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.08)");
  vignette.addColorStop(1, `rgba(2,4,12,${ov("sky.vignetteAlpha", 0.42)})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, CANVAS_W, layout.renderHeight);
  ctx.fillStyle = "rgba(140, 220, 255, 0.035)";
  ctx.fillRect(0, 0, CANVAS_W, 1);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let y = 0; y < layout.renderHeight; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);

  // HUD
  if (layout.showTopHud) {
    ctx.fillStyle = "rgba(0,10,20,0.7)";
    ctx.fillRect(0, 0, CANVAS_W, 46);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 46);
    ctx.lineTo(CANVAS_W, 46);
    ctx.stroke();
    ctx.font = `bold 16px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = COL.gold;
    ctx.fillText(`$ ${game.score}`, 16, 29);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`WAVE ${game.wave}`, 156, 29);
    ctx.fillStyle = game.burjAlive ? "#44ff88" : "#ff4444";
    ctx.fillText(`BURJ:${game.burjAlive ? "OK" : "XX"}`, 300, 29);
    ctx.fillStyle = COL.hud;
    ctx.fillText(`AMMO ${game.ammo[0]}|${game.ammo[1]}|${game.ammo[2]}`, 438, 29);
    if (game.empChargeMax > 0) {
      const empCx = 642;
      const empCy = 23;
      const empR = 10;
      const chargeRatio = game.empChargeMax > 0 ? game.empCharge / game.empChargeMax : 0;
      ctx.strokeStyle = "rgba(204,68,255,0.2)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(empCx, empCy, empR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COL.emp;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(empCx, empCy, empR, -Math.PI / 2, -Math.PI / 2 + chargeRatio * Math.PI * 2);
      ctx.stroke();
      if (game.empReady) {
        const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.2);
        glow(ctx, COL.emp, 10);
        ctx.fillStyle = COL.emp;
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(empCx, empCy, empR, 0, Math.PI * 2);
        ctx.fill();
        glowOff(ctx);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.font = `bold 9px ${ARCADE_FONT_FAMILY}`;
        ctx.fillText("SPC", empCx - 10, empCy + 3);
        ctx.font = `bold 16px ${ARCADE_FONT_FAMILY}`;
      } else {
        ctx.fillStyle = COL.emp;
        ctx.font = `9px ${ARCADE_FONT_FAMILY}`;
        ctx.fillText("\uD83C\uDF00", empCx - 6, empCy + 4);
        ctx.font = `bold 16px ${ARCADE_FONT_FAMILY}`;
      }
    }
    if (game._replay) {
      ctx.fillStyle = "#ff8844";
      ctx.fillText("REPLAY", 742, 29);
    }
    if (game._fpsDisplay) {
      ctx.fillStyle = game._fpsDisplay >= 50 ? "#556677" : game._fpsDisplay >= 30 ? "#ffaa44" : "#ff4444";
      ctx.font = `12px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText(`${game._fpsDisplay} FPS`, CANVAS_W - 88, 29);
      ctx.font = `bold 16px ${ARCADE_FONT_FAMILY}`;
    }
  }

  // MIRV INCOMING warning
  const activeMirvs = game.missiles.filter((m) => m.alive && m.type === "mirv");
  if (activeMirvs.length > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.15);
    ctx.save();
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    ctx.font = `bold ${layout.mirvWarningFontSize}px ${ARCADE_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff2200";
    glow(ctx, "#ff2200", 8 + pulse * 6);
    ctx.fillText("\u26A0 MIRV INCOMING \u26A0", CANVAS_W / 2, layout.mirvWarningY);
    glow(ctx, "transparent", 0);
    ctx.restore();
  }

  // Purchase toast (replay mode)
  if (game._purchaseToast && game._purchaseToast.timer > 0) {
    const toast = game._purchaseToast;
    const alpha = Math.min(1, toast.timer / 30); // fade out last ~0.5s (30 ticks)
    const items = toast.items.map((key) => UPGRADES[key as UpgradeKey]?.name || key);
    // Deduplicate and count
    const counts: Record<string, number> = {};
    items.forEach((name) => {
      counts[name] = (counts[name] || 0) + 1;
    });
    const label = Object.entries(counts)
      .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
      .join(", ");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${layout.purchaseToastFontSize}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = "#44ffaa";
    ctx.textAlign = "center";
    const who = game._replayIsHuman ? "PLAYER" : "BOT";
    ctx.fillText(`${who} BOUGHT: ${label}`, CANVAS_W / 2, layout.purchaseToastY);
    ctx.restore();
    ctx.textAlign = "left";
    toast.timer -= 1; // 1 tick per render frame (matched to fixed timestep)
  }

  // Wave progress bar
  if (layout.showTopHud) {
    const wpX = 620,
      wpW = 130,
      wpH = 10,
      wpY = 16;
    const scheduleLen = game.schedule ? game.schedule.length : 1;
    const waveProgress = Math.min(game.scheduleIdx / scheduleLen, 1);
    const threatsLeft = game.missiles.length + game.drones.length;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = waveProgress >= 1 ? "#44ff88" : COL.hud;
    ctx.fillRect(wpX, wpY, wpW * waveProgress, wpH);
    ctx.strokeStyle = "rgba(0,255,200,0.3)";
    ctx.strokeRect(wpX, wpY, wpW, wpH);
    ctx.fillStyle = "#aabbcc";
    ctx.font = `12px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText(
      waveProgress >= 1 ? `CLEAR ${threatsLeft}` : `${game.scheduleIdx}/${scheduleLen}`,
      wpX + wpW + 6,
      wpY + 7,
    );
    ctx.font = `bold 12px ${ARCADE_FONT_FAMILY}`;

    const activeUpgrades = Object.entries(game.upgrades).filter(([, value]) => value > 0);
    if (activeUpgrades.length > 0) {
      let ux = 640;
      activeUpgrades.forEach(([key, level]) => {
        const def = UPGRADES[key as UpgradeKey];
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.9;
        ctx.font = `14px ${ARCADE_FONT_FAMILY}`;
        ctx.fillText(`${def.icon}${level}`, ux, 23);
        ux += 44;
      });
      ctx.globalAlpha = 1;
    }
  }

  // Low ammo warning — flash for 3 seconds then disappear
  const totalAmmo = game.ammo.reduce((s, a) => s + a, 0);
  const maxTotalAmmo = game.ammo.reduce(
    (s, _, i) => s + (game.launcherHP[i] > 0 ? getAmmoCapacity(game.wave, game.upgrades.launcherKit) : 0),
    0,
  );
  const isLowAmmo = maxTotalAmmo > 0 && totalAmmo / maxTotalAmmo < 0.25 && !game.waveComplete;
  if (isLowAmmo && !game._lowAmmoTimer) {
    game._lowAmmoTimer = 180; // ~3 seconds at 60fps
  }
  if (!isLowAmmo) {
    game._lowAmmoTimer = 0;
  }
  if ((game._lowAmmoTimer ?? 0) > 0) {
    game._lowAmmoTimer = (game._lowAmmoTimer ?? 0) - 1;
    const flash = 0.5 + 0.5 * Math.sin(game.time * 0.2);
    const fadeOut = Math.min(1, (game._lowAmmoTimer ?? 0) / 30);
    ctx.save();
    ctx.globalAlpha = flash * 0.9 * fadeOut;
    ctx.textAlign = "center";
    ctx.font = `bold ${layout.lowAmmoFontSize}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = COL.warning;
    glow(ctx, COL.warning, 20);
    ctx.fillText("\u26A0 LOW AMMO \u26A0", CANVAS_W / 2, layout.lowAmmoY);
    glowOff(ctx);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // Multi-kill toast
  if (game.multiKillToast && game.multiKillToast.timer > 0) {
    const mk = game.multiKillToast;
    const fadeOut = Math.min(1, mk.timer / 20);
    const rise = (90 - mk.timer) * 0.5;
    const pulse = 1 + (mk.pulse ?? 0) * 0.28;
    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.textAlign = "center";
    const toastX = mk.x ?? CANVAS_W / 2;
    const toastY = mk.y ?? 200;
    const plateW = 220 + (mk.kills ?? 2) * 18;
    const plateH = 64;
    ctx.fillStyle = "rgba(24, 8, 4, 0.48)";
    ctx.fillRect(toastX - plateW / 2, toastY - 62 - rise, plateW, plateH);
    ctx.strokeStyle = "rgba(255, 204, 112, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(toastX - plateW / 2, toastY - 62 - rise, plateW, plateH);
    ctx.font = `bold ${layout.multiKillLabelSize * pulse}px ${ARCADE_FONT_FAMILY}`;
    const labelColor = mk.label === "MEGA KILL" ? "#ff4444" : mk.label === "TRIPLE KILL" ? "#ffaa00" : "#ffdd00";
    ctx.fillStyle = labelColor;
    glow(ctx, labelColor, 15 + (mk.pulse ?? 0) * 10);
    ctx.fillText(mk.label ?? "", toastX, toastY - 30 - rise);
    ctx.font = `bold ${layout.multiKillBonusSize}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = "#00ffcc";
    ctx.fillText(`+${mk.bonus}`, toastX, toastY - 10 - rise);
    glowOff(ctx);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // Wave cleared banner
  if (game.waveComplete && (game.waveClearedTimer ?? 0) > 0) {
    const alpha = Math.min(1, (game.waveClearedTimer ?? 0) / 20);
    const bannerCX = CANVAS_W / 2;
    const bannerCY = layout.waveClearedY - 14;
    const bannerW = 420;
    const bannerH = 70;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,20,10,0.65)";
    ctx.fillRect(bannerCX - bannerW / 2, bannerCY - bannerH / 2, bannerW, bannerH);
    ctx.strokeStyle = COL.hud;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bannerCX - bannerW / 2, bannerCY - bannerH / 2, bannerW, bannerH);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold 40px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = COL.hud;
    ctx.fillText(`WAVE ${game.wave} CLEARED`, bannerCX, bannerCY);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  { showShop = false, layoutProfile = {} as Partial<LayoutProfile> } = {},
) {
  const layout = resolveLayoutProfile(layoutProfile);
  const sceneTime = game.time / 60;
  const scenicGroundY = GAMEPLAY_SCENIC_GROUND_Y;
  const scenicThreatFloorY = GAMEPLAY_SCENIC_THREAT_FLOOR_Y;
  let sx = 0,
    sy = 0;
  if (game.shakeTimer > 0 && !game._debugMode) {
    sx = (Math.random() - 0.5) * game.shakeIntensity * 2;
    sy = (Math.random() - 0.5) * game.shakeIntensity * 2;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.save();
  if (layout.cameraFrame && layout.cameraFrame.scale && layout.cameraFrame.scale > 1) {
    ctx.scale(layout.cameraFrame.scale, layout.cameraFrame.scale);
    ctx.translate(-(layout.cameraFrame.left ?? 0), -(layout.cameraFrame.top ?? 0));
  }

  drawSharedSky(
    ctx,
    {
      mode: "game",
      renderHeight: layout.renderHeight,
      groundY: scenicGroundY,
      stars: game.stars,
    },
    sceneTime,
  );
  drawSharedBurj(ctx, {
    mode: "game",
    groundY: scenicGroundY,
    alive: game.burjAlive,
    burjHealth: game.burjHealth,
    artScale: 2,
    t: sceneTime,
    burjDecals: game.burjDecals,
    burjDamageFx: game.burjDamageFx,
    burjHitFlashTimer: game.burjHitFlashTimer,
    burjHitFlashMax: game.burjHitFlashMax,
    burjHitFlashX: game.burjHitFlashX,
    burjHitFlashY: game.burjHitFlashY,
  });
  drawGameplayForegroundBuildings(ctx, game, sceneTime, scenicGroundY);
  drawSharedWater(
    ctx,
    {
      groundY: scenicGroundY,
      renderHeight: layout.renderHeight,
      tintBottomAlpha: 0.18,
    },
    sceneTime,
  );
  drawDecoyFlares(ctx, game, layout);
  drawPlanes(ctx, game, layout);
  drawLasersAndBullets(ctx, game, layout);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CANVAS_W, scenicThreatFloorY);
  ctx.clip();
  drawMissiles(ctx, game, layout);
  drawDrones(ctx, game, layout);
  drawInterceptors(ctx, game, layout);
  drawUpgradeProjectiles(ctx, game, layout);
  drawExplosionsAndParticles(ctx, game, layout);
  ctx.restore();
  drawGroundStructures(ctx, game, layout);
  drawBurjWarningPlate(ctx, {
    groundY: scenicGroundY,
    burjHealth: game.burjHealth,
    burjHitFlashTimer: game.burjHitFlashTimer,
    burjHitFlashMax: game.burjHitFlashMax,
    t: sceneTime,
    artScale: 2,
  });

  // Crosshair
  if (!showShop) {
    const cx = game.crosshairX,
      cy = game.crosshairY;
    ctx.strokeStyle = "rgba(0,255,200,0.7)";
    ctx.lineWidth = 1;
    glow(ctx, COL.hud, 10);
    ctx.beginPath();
    ctx.moveTo(cx - layout.crosshairArmLength, cy);
    ctx.lineTo(cx - layout.crosshairGap, cy);
    ctx.moveTo(cx + layout.crosshairGap, cy);
    ctx.lineTo(cx + layout.crosshairArmLength, cy);
    ctx.moveTo(cx, cy - layout.crosshairArmLength);
    ctx.lineTo(cx, cy - layout.crosshairGap);
    ctx.moveTo(cx, cy + layout.crosshairGap);
    ctx.lineTo(cx, cy + layout.crosshairArmLength);
    ctx.stroke();
    glowOff(ctx);
  }

  // Debug collision overlay — drawn inside camera transform
  if (game._showColliders) {
    drawCollisionOverlay(ctx, game);
  }

  // Upgrade range overlay — editor mode
  if (game._showUpgradeRanges) {
    drawUpgradeRangeOverlay(ctx);
  }

  ctx.restore();
  ctx.restore();

  drawHUD(ctx, game, layout);
}

function drawUpgradeRangeOverlay(ctx: CanvasRenderingContext2D) {
  ctx.save();

  const phalanxRange = ov("upgrade.phalanxRange", 160);
  const systems = [
    {
      key: "upgrade.ironBeam",
      name: "IRON BEAM",
      x: ov("upgrade.ironBeam.x", BURJ_X),
      y: ov("upgrade.ironBeam.y", 959),
      color: "#ff2200",
      range: ov("upgrade.ironBeamRange", 368),
    },
    {
      key: "upgrade.phalanx1",
      name: "PHALANX",
      x: ov("upgrade.phalanx1.x", 553),
      y: ov("upgrade.phalanx1.y", 1498),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.phalanx2",
      name: "PHALANX",
      x: ov("upgrade.phalanx2.x", 860),
      y: ov("upgrade.phalanx2.y", 1504),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.phalanx3",
      name: "PHALANX",
      x: ov("upgrade.phalanx3.x", 59),
      y: ov("upgrade.phalanx3.y", GROUND_Y - 30),
      color: "#ff8844",
      range: phalanxRange,
    },
    {
      key: "upgrade.patriot",
      name: "PATRIOT",
      x: ov("upgrade.patriot.x", 334),
      y: ov("upgrade.patriot.y", 1511),
      color: "#88ff44",
    },
    {
      key: "upgrade.emp",
      name: "EMP",
      x: ov("upgrade.emp.x", 462),
      y: ov("upgrade.emp.y", 1047),
      color: "#cc44ff",
      range: ov("upgrade.empRange", 1100),
    },
    {
      key: "upgrade.flares",
      name: "FLARES",
      x: ov("upgrade.flares.x", BURJ_X),
      y: ov("upgrade.flares.y", 837),
      color: "#ff8833",
      range: ov("upgrade.flareActivationRange", 320),
    },
    {
      key: "upgrade.hornets",
      name: "HORNETS",
      x: ov("upgrade.hornets.x", 206),
      y: ov("upgrade.hornets.y", 1511),
      color: "#ffcc00",
    },
    {
      key: "upgrade.roadrunner",
      name: "ROADRUNNER",
      x: ov("upgrade.roadrunner.x", 678),
      y: ov("upgrade.roadrunner.y", GROUND_Y - 15),
      color: "#44aaff",
    },
    {
      key: "upgrade.launcherKit",
      name: "LAUNCHER KIT",
      x: ov("upgrade.launcherKit.x", 772),
      y: ov("upgrade.launcherKit.y", 1513),
      color: "#66aaff",
    },
  ];

  for (const sys of systems) {
    // Range area
    if (sys.range) {
      const ry = sys.y;
      ctx.fillStyle = sys.color;
      ctx.globalAlpha = 0.06;
      ctx.beginPath();
      ctx.arc(sys.x, ry, sys.range, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = sys.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(sys.x, ry, sys.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Position marker
    ctx.strokeStyle = sys.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(sys.x, sys.y, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = sys.color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(sys.x, sys.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.globalAlpha = 1;
    ctx.font = `bold 20px ${ARCADE_FONT_FAMILY}`;
    const tx = sys.x + 26;
    const ty = sys.y + 6;
    const tw = ctx.measureText(sys.name).width;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(tx - 3, ty - 15, tw + 6, 20);
    ctx.fillStyle = sys.color;
    ctx.fillText(sys.name, tx, ty);
  }

  // Launchers
  LAUNCHERS.forEach((_, i) => {
    const l = getGameplayLauncherPosition(i);
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(l.x, l.y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = `bold 18px ${ARCADE_FONT_FAMILY}`;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(l.x + 22, l.y - 11, 32, 20);
    ctx.fillStyle = "#00ffcc";
    ctx.fillText(`L${i + 1}`, l.x + 25, l.y + 6);
  });

  ctx.restore();
}

function drawCollisionOverlay(ctx: CanvasRenderingContext2D, game: GameState) {
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5;

  // Burj — triangle matching linear collision (tip at top, base 64px wide at ground)
  if (game.burjAlive) {
    const burjTop = getGameplayBurjCollisionTop(2);
    ctx.strokeStyle = "cyan";
    ctx.beginPath();
    ctx.moveTo(BURJ_X, burjTop);
    for (let y = burjTop + 8; y <= GAMEPLAY_SCENIC_GROUND_Y - 6; y += 18) {
      ctx.lineTo(BURJ_X + getGameplayBurjHalfW(y, 2), y);
    }
    for (let y = GAMEPLAY_SCENIC_GROUND_Y - 6; y >= burjTop + 8; y -= 18) {
      ctx.lineTo(BURJ_X - getGameplayBurjHalfW(y, 2), y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Launchers — match the title-style gameplay anchor
  ctx.strokeStyle = "lime";
  LAUNCHERS.forEach((_, i) => {
    if (game.launcherHP[i] > 0) {
      const l = getGameplayLauncherPosition(i);
      ctx.strokeRect(l.x - 45, l.y - 36, 90, 36);
    }
  });

  // Buildings — match the shared title-style tower geometry
  ctx.strokeStyle = "yellow";
  game.buildings.forEach((b) => {
    if (b.alive) {
      const bounds = getGameplayBuildingBounds(b);
      ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    }
  });

  // Defense sites
  ctx.strokeStyle = "magenta";
  game.defenseSites.forEach((site) => {
    if (site.alive) {
      const hw = site.hw ?? 0;
      const hh = site.hh ?? 0;
      ctx.strokeRect(site.x - hw, site.y - hh, hw * 2, hh * 2);
    }
  });

  // Missiles & bombs
  ctx.strokeStyle = "red";
  game.missiles.forEach((m) => {
    if (!m.alive) return;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Drones
  ctx.strokeStyle = "orange";
  game.drones.forEach((d) => {
    if (!d.alive) return;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 12, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Interceptors — proximity fuse radius
  ctx.strokeStyle = "#44ffaa";
  game.interceptors.forEach((ic) => {
    if (!ic.alive) return;
    ctx.beginPath();
    ctx.arc(ic.x, ic.y, 18, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Explosions — current radius
  ctx.strokeStyle = "white";
  game.explosions.forEach((ex) => {
    if (ex.alpha < 0.05) return;
    ctx.beginPath();
    ctx.arc(ex.x, ex.y, ex.radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.restore();
}

export function drawTitle(ctx: CanvasRenderingContext2D, { layoutProfile = {} as Partial<LayoutProfile> } = {}) {
  const layout = resolveLayoutProfile(layoutProfile);
  const t = performance.now() / 1000;
  const cx = CANVAS_W / 2;
  const titleGroundY = GROUND_Y - 100;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  skyGrad.addColorStop(0, "#050810");
  skyGrad.addColorStop(0.5, "#0a1030");
  skyGrad.addColorStop(1, "#151030");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.save();
  ctx.fillStyle = "rgba(0,255,200,0.03)";
  for (let y = 0; y < CANVAS_H; y += 3) {
    ctx.fillRect(0, y + ((t * 20) % 3), CANVAS_W, 1);
  }
  ctx.restore();
  ctx.textAlign = "center";

  const skyGlow = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
  skyGlow.addColorStop(0, "#050812");
  skyGlow.addColorStop(0.5, "#0a1030");
  skyGlow.addColorStop(1, "#130f2d");
  ctx.fillStyle = skyGlow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const titleDrift = Math.sin(t * 0.08) * 4;
  const titleFlicker = 0.95 + 0.03 * Math.sin(t * 2.875) + 0.015 * Math.sin(t * 7.925 + 0.5);
  const titleFlickerSoft = 0.96 + 0.02 * Math.sin(t * 2.425 + 1.4) + 0.01 * Math.sin(t * 6.775);

  // Stars
  for (let i = 0; i < 500; i++) {
    const sx = (hash01(i, 2, 7) * CANVAS_W + titleDrift * 0.3) % CANVAS_W;
    const sy = hash01(i, 5, 11) * 1500 + 8;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.7 + hash01(i, 1, 9)) + i * 0.9);
    const size = 0.7 + hash01(i, 3, 1) * 1.6;
    ctx.fillStyle = `rgba(220, 235, 255, ${0.18 + tw * 0.32})`;
    ctx.fillRect(sx, sy, size, size);
  }

  // Moon
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

  // Title haze / city bloom
  const bloom = ctx.createRadialGradient(BURJ_X, 410, 20, BURJ_X, 410, 320);
  bloom.addColorStop(0, "rgba(130, 220, 255, 0.18)");
  bloom.addColorStop(0.45, "rgba(90, 120, 255, 0.08)");
  bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  type TitleTower = {
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

  const titleSkylineTowers: TitleTower[] = TITLE_SKYLINE_TOWERS;

  function drawTitleTower(tower: TitleTower, offset = 0) {
    const baseY = titleGroundY - 6;
    const x = tower.x + offset;
    const top = baseY - tower.h;
    const right = x + tower.w;
    const mid = x + tower.w / 2;

    ctx.save();
    if (tower.glow) {
      const glow = ctx.createRadialGradient(mid, top + tower.h * 0.3, 0, mid, top + tower.h * 0.3, tower.w * 1.8);
      glow.addColorStop(0, `rgba(120, 190, 255, ${tower.glow})`);
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

    if (tower.profile === "leftLandmark") {
      ctx.fillStyle = "rgba(245, 246, 250, 0.78)";
      ctx.fillRect(x + tower.w * 0.28, top + 22, 2.1, tower.h - 42);
      ctx.fillRect(x + tower.w * 0.39, top + 18, 1.4, tower.h - 52);
      for (let row = 0; row < 12; row++) {
        const wy = top + 26 + row * 12;
        ctx.fillStyle = row % 2 === 0 ? "rgba(250, 240, 212, 0.46)" : "rgba(215, 228, 246, 0.16)";
        ctx.fillRect(x + 6, wy, tower.w - 12, 1.9);
      }
    } else if (tower.profile === "twinSpire") {
      ctx.fillStyle = "rgba(250, 244, 220, 0.54)";
      ctx.fillRect(x + tower.w * 0.23, top + 18, 1.6, tower.h - 28);
      ctx.fillRect(x + tower.w * 0.73, top + 18, 1.6, tower.h - 28);
      for (let row = 0; row < 11; row++) {
        const wy = top + 24 + row * 13;
        ctx.fillStyle = row % 3 === 0 ? "rgba(255, 232, 186, 0.48)" : "rgba(205, 220, 240, 0.1)";
        ctx.fillRect(x + 5, wy, tower.w - 10, 1.6);
      }
    } else if (tower.profile === "slantedBlock") {
      for (let row = 0; row < 10; row++) {
        const wy = top + 16 + row * 12;
        const inset = row * 0.95;
        ctx.fillStyle = "rgba(224, 236, 250, 0.18)";
        ctx.fillRect(x + 6 + inset, wy, tower.w - 18 - inset, 1.5);
      }
      ctx.fillStyle = "rgba(248, 244, 222, 0.52)";
      ctx.fillRect(right - 4, top + 9, 2, tower.h - 18);
    } else if (tower.profile === "eggTower") {
      for (let row = 0; row < 9; row++) {
        const wy = top + 22 + row * 11;
        const shrink = Math.abs(row - 4) * 0.8;
        ctx.fillStyle = "rgba(224, 238, 252, 0.2)";
        ctx.fillRect(x + 5 + shrink, wy, tower.w - 10 - shrink * 2, 1.7);
      }
      ctx.fillStyle = "rgba(248, 240, 214, 0.4)";
      ctx.fillRect(x + tower.w * 0.68, top + 18, 1.7, tower.h - 26);
    } else if (tower.profile === "bladeTower") {
      ctx.fillStyle = "rgba(236, 244, 255, 0.28)";
      ctx.fillRect(x + tower.w * 0.16, top + 12, 1.4, tower.h - 18);
      ctx.fillStyle = "rgba(255, 238, 205, 0.46)";
      ctx.fillRect(right - 3.2, top + 10, 1.8, tower.h - 16);
      for (let row = 0; row < 11; row++) {
        const wy = top + 20 + row * 14;
        ctx.fillStyle = row % 2 === 0 ? "rgba(215, 232, 248, 0.14)" : "rgba(255, 242, 214, 0.1)";
        ctx.fillRect(x + 6, wy, tower.w - 12, 1.35);
      }
    } else {
      const rows = Math.max(2, Math.floor(tower.h / 17));
      const cols = tower.windows;
      const winW = cols === 1 ? 3 : 4;
      const gap = cols === 1 ? 0 : 6;
      const startX = x + Math.max(2, (tower.w - cols * winW - (cols - 1) * gap) / 2);
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const litSeed = hash01(tower.x, row, col);
          const lit = Math.sin(t * 0.06 + litSeed * 10 + row * 0.65 + col * 2.1) > -0.2;
          const wx = startX + col * (winW + gap);
          const wy = top + 10 + row * 14;
          if (wy > baseY - 8) continue;
          if (lit) {
            ctx.fillStyle = `rgba(255, 202, 132, ${0.2 + litSeed * 0.22})`;
            ctx.fillRect(wx - 1, wy - 1, winW + 2, 5);
            ctx.fillStyle = `rgba(255, 226, 176, ${0.42 + litSeed * 0.25})`;
            ctx.fillRect(wx, wy, winW, 3);
          } else {
            ctx.fillStyle = "rgba(4, 6, 12, 0.66)";
            ctx.fillRect(wx, wy, winW, 3);
          }
        }
      }
    }
    ctx.restore();
  }

  titleSkylineTowers.forEach((tower, i) => drawTitleTower(tower, Math.sin(t * 0.05 + i * 0.8) * 1.35));

  // Central glowing Burj
  const burjX = cx;
  const burjBaseY = titleGroundY - 6;
  const burjHeight = BURJ_H;
  const burjLeftSections = [
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
  ];
  const burjRightSections = [
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
  ];

  function titleBurjPath() {
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

  function titleHalfWidthsAt(ht: number) {
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

  const titleBurjGlowImg = getTitleBurjGlowImage();
  if (titleBurjGlowImg) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(titleBurjGlowImg, burjX - 210, burjBaseY - burjHeight - 190, 420, 820);
    ctx.restore();
  }

  const podiumShimmer = 0.78 + 0.08 * Math.sin(t * 0.32);
  ctx.save();
  ctx.fillStyle = `rgba(22, 28, 40, ${0.9 * podiumShimmer})`;
  ctx.beginPath();
  ctx.moveTo(burjX - 104, burjBaseY + 2);
  ctx.lineTo(burjX - 88, burjBaseY - 12);
  ctx.lineTo(burjX - 58, burjBaseY - 15);
  ctx.lineTo(burjX - 36, burjBaseY - 8);
  ctx.lineTo(burjX - 16, burjBaseY - 3);
  ctx.lineTo(burjX + 16, burjBaseY - 3);
  ctx.lineTo(burjX + 36, burjBaseY - 8);
  ctx.lineTo(burjX + 58, burjBaseY - 15);
  ctx.lineTo(burjX + 88, burjBaseY - 12);
  ctx.lineTo(burjX + 104, burjBaseY + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 214, 150, 0.28)";
  ctx.fillRect(burjX - 58, burjBaseY - 14, 116, 2.5);
  ctx.restore();

  ctx.save();
  ctx.translate(burjX, burjBaseY);
  ctx.scale(2, 2);
  ctx.translate(-burjX, -burjBaseY);
  const burjGrad = ctx.createLinearGradient(burjX, burjBaseY - burjHeight, burjX, burjBaseY);
  burjGrad.addColorStop(0, "#fbfdff");
  burjGrad.addColorStop(0.08, "#dcecff");
  burjGrad.addColorStop(0.2, "#6e88a7");
  burjGrad.addColorStop(0.42, "#243446");
  burjGrad.addColorStop(0.7, "#182330");
  burjGrad.addColorStop(1, "#202a34");
  ctx.fillStyle = burjGrad;
  titleBurjPath();
  ctx.fill();
  ctx.strokeStyle = "rgba(236,246,255,0.28)";
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(burjX, burjBaseY - burjHeight - 44);
  ctx.lineTo(burjX, burjBaseY - 28);
  ctx.stroke();
  ctx.fillStyle = "rgba(250, 252, 255, 0.46)";
  ctx.fillRect(burjX - 0.55, burjBaseY - burjHeight + 18, 1.1, burjHeight - 18);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillRect(burjX - 2.4, burjBaseY - burjHeight + 22, 4.8, 3.6);
  ctx.fillStyle = "rgba(225, 239, 255, 0.22)";
  for (let i = 0; i < 42; i++) {
    const ht = 0.04 + (i / 41) * 0.92;
    const ly = burjBaseY - burjHeight * ht;
    const { left, right } = titleHalfWidthsAt(ht);
    const lw = left * 0.68;
    const rw = right * 0.68;
    if (lw < 1.2 && rw < 1.2) continue;
    const lit = Math.sin(t * 0.32 + i * 0.48) > -0.12;
    if (lit) {
      ctx.fillStyle = i === 13 || i === 23 || i === 33 ? "rgba(255, 255, 255, 0.62)" : "rgba(215, 232, 248, 0.11)";
      ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
    }
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
  brightBands.forEach((ht, index) => {
    const ly = burjBaseY - burjHeight * ht.ht;
    const { left, right } = titleHalfWidthsAt(ht.ht);
    ctx.fillStyle = `rgba(252, 253, 255, ${ht.alpha})`;
    ctx.fillRect(burjX - left * 0.88, ly, left * 0.88 + right * 0.88, ht.thickness);
    ctx.fillStyle = `rgba(15, 24, 34, ${0.34 - index * 0.03})`;
    ctx.fillRect(burjX - left * 0.9, ly + ht.thickness, left * 0.9 + right * 0.9, 1.15);
    ctx.fillStyle = "rgba(130, 200, 255, 0.12)";
    ctx.fillRect(burjX - left * 0.86, ly - 0.7, left * 0.86 + right * 0.86, 0.55);
  });
  ctx.fillStyle = "rgba(10, 18, 28, 0.56)";
  ctx.fillRect(burjX - 8.2, burjBaseY - burjHeight + 158, 16.4, 10);
  ctx.fillRect(burjX - 11.4, burjBaseY - burjHeight + 224, 22.8, 10);
  ctx.fillStyle = "rgba(248, 252, 255, 0.82)";
  ctx.fillRect(burjX - 7.1, burjBaseY - burjHeight + 166, 14.2, 2.6);
  // Aviation beacon — sharp blink
  const beaconBlink = Math.max(0, Math.sin(t * 3.0));
  const beaconIntensity = Math.pow(beaconBlink, 0.3);
  ctx.fillStyle = `rgba(128, 60, 40, ${0.25 + 0.75 * beaconIntensity})`;
  ctx.fillRect(burjX - 0.7, burjBaseY - burjHeight - 50, 1.4, 10);
  if (beaconIntensity > 0.05) {
    const beaconGlow = ctx.createRadialGradient(
      burjX,
      burjBaseY - burjHeight - 46,
      0,
      burjX,
      burjBaseY - burjHeight - 46,
      8,
    );
    beaconGlow.addColorStop(0, `rgba(255, 60, 40, ${0.36 * beaconIntensity})`);
    beaconGlow.addColorStop(1, "rgba(255, 0, 0, 0)");
    ctx.fillStyle = beaconGlow;
    ctx.fillRect(burjX - 8, burjBaseY - burjHeight - 54, 16, 16);
  }

  ctx.save();
  titleBurjPath();
  ctx.clip();
  const leftGlow = ctx.createLinearGradient(burjX - 20, 0, burjX + 5, 0);
  leftGlow.addColorStop(0, "rgba(255,255,255,0.26)");
  leftGlow.addColorStop(0.35, "rgba(170,220,255,0.14)");
  leftGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = leftGlow;
  ctx.fillRect(burjX - 18, burjBaseY - burjHeight - 50, 22, burjHeight + 50);

  const rightShade = ctx.createLinearGradient(burjX - 1, 0, burjX + 19, 0);
  rightShade.addColorStop(0, "rgba(0,0,0,0)");
  rightShade.addColorStop(0.45, "rgba(10,16,24,0.16)");
  rightShade.addColorStop(1, "rgba(5,8,15,0.38)");
  ctx.fillStyle = rightShade;
  ctx.fillRect(burjX - 1, burjBaseY - burjHeight - 50, 18, burjHeight + 50);

  for (let i = 0; i < 58; i++) {
    const ht = 0.03 + (i / 57) * 0.94;
    const ly = burjBaseY - burjHeight * ht;
    const { left, right } = titleHalfWidthsAt(ht);
    const lw = left * 0.64;
    const rw = right * 0.64;
    if (lw < 0.95 && rw < 0.95) continue;
    const lit = Math.sin(t * 0.22 + i * 0.37) > -0.28;
    if (lit) {
      const warmBand = i === 16 || i === 28 || i === 39 || i === 49;
      ctx.fillStyle = warmBand ? "rgba(252, 252, 255, 0.9)" : "rgba(230, 244, 255, 0.16)";
      ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
      if (!warmBand && i % 6 === 0) {
        ctx.fillStyle = "rgba(100, 180, 255, 0.08)";
        ctx.fillRect(burjX - lw, ly + 0.88, lw + rw, 0.28);
      }
    }
  }

  const deckY = burjBaseY - burjHeight * 0.48;
  ctx.fillStyle = "rgba(252, 252, 255, 0.62)";
  ctx.fillRect(burjX - 8.5, deckY, 17, 6);
  ctx.fillStyle = "rgba(110, 190, 255, 0.18)";
  ctx.fillRect(burjX - 6.8, deckY + 1.2, 13.6, 3.8);
  for (let w = -5; w <= 4; w += 2) {
    ctx.fillStyle = "rgba(255, 240, 205, 0.22)";
    ctx.fillRect(burjX + w, deckY + 1.8, 1, 2.4);
  }
  ctx.restore();
  ctx.restore();

  // Base glow/podium
  ctx.save();
  const podiumGlow = ctx.createRadialGradient(burjX, titleGroundY - 20, 0, burjX, titleGroundY - 20, 140);
  podiumGlow.addColorStop(0, "rgba(196, 242, 255, 0.32)");
  podiumGlow.addColorStop(0.32, "rgba(120, 210, 255, 0.22)");
  podiumGlow.addColorStop(0.62, "rgba(255, 180, 120, 0.12)");
  podiumGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = podiumGlow;
  ctx.fillRect(burjX - 140, titleGroundY - 140, 280, 180);
  ctx.fillStyle = "rgba(236, 246, 255, 0.46)";
  ctx.fillRect(burjX - 28, titleGroundY - 8, 56, 7);
  ctx.fillStyle = "rgba(180, 220, 255, 0.34)";
  ctx.fillRect(burjX - 12, titleGroundY - 13, 24, 4);
  ctx.restore();

  // Waterfront strip and reflections
  const waterTop = titleGroundY + 8;
  const waterBottom = CANVAS_H;
  ctx.save();
  const titleWaterImg = getTitleWaterImage();
  if (titleWaterImg) {
    ctx.drawImage(titleWaterImg, 0, waterTop, CANVAS_W + 10, waterBottom - waterTop);

    // A light cool tint keeps the bitmap aligned with the scene's night palette.
    const waterGrade = ctx.createLinearGradient(0, waterTop, 0, waterBottom);
    waterGrade.addColorStop(0, "rgba(22, 34, 60, 0.18)");
    waterGrade.addColorStop(0.5, "rgba(8, 20, 40, 0.08)");
    waterGrade.addColorStop(1, "rgba(0, 0, 0, 0.18)");
    ctx.fillStyle = waterGrade;
    ctx.fillRect(0, waterTop, CANVAS_W, waterBottom - waterTop);
  } else {
    const waterGrad = ctx.createLinearGradient(0, waterTop, 0, waterBottom);
    waterGrad.addColorStop(0, "rgba(34, 40, 56, 0.96)");
    waterGrad.addColorStop(0.28, "rgba(26, 32, 46, 0.96)");
    waterGrad.addColorStop(0.72, "rgba(18, 24, 36, 0.98)");
    waterGrad.addColorStop(1, "rgba(12, 16, 26, 1)");
    ctx.fillStyle = waterGrad;
    ctx.fillRect(0, waterTop, CANVAS_W, waterBottom - waterTop);

    ctx.fillStyle = "rgba(255, 242, 214, 0.18)";
    ctx.fillRect(0, waterTop, CANVAS_W, 2);

    const waterRipple = ctx.createLinearGradient(0, waterTop + 6, 0, waterBottom);
    waterRipple.addColorStop(0, "rgba(120, 160, 200, 0.06)");
    waterRipple.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = waterRipple;
    for (let y = waterTop + 8; y < waterBottom; y += 9) {
      const inset = 10 + Math.sin(t * 1.8 + y * 0.07) * 8;
      ctx.fillRect(inset, y, CANVAS_W - inset * 2, 1);
    }

    const reflectionColumns = [
      { x: 112, w: 16, alpha: 0.22, color: "255,236,196" },
      { x: 170, w: 14, alpha: 0.18, color: "255,224,178" },
      { x: burjX, w: 34, alpha: 0.36, color: "250,248,240" },
      { x: 562, w: 24, alpha: 0.18, color: "220,234,252" },
      { x: 610, w: 18, alpha: 0.14, color: "214,230,250" },
      { x: 644, w: 16, alpha: 0.16, color: "255,228,188" },
    ];
    reflectionColumns.forEach((ref, i) => {
      for (let y = waterTop + 4; y < waterBottom - 4; y += 4) {
        const drift = Math.sin(t * 2.1 + i * 1.7 + y * 0.11) * 3.2;
        const segmentW = ref.w * (0.72 + 0.28 * Math.sin(i + y * 0.09) ** 2);
        const alpha = ref.alpha * (1 - ((y - waterTop) / (waterBottom - waterTop)) * 0.78);
        ctx.fillStyle = `rgba(${ref.color}, ${alpha})`;
        ctx.fillRect(ref.x - segmentW / 2 + drift, y, segmentW, 2);
      }
    });

    ctx.fillStyle = "rgba(255, 248, 235, 0.12)";
    ctx.fillRect(burjX - 18, waterTop + 2, 36, 3);
  }
  ctx.restore();

  // Launcher silhouettes on title screen
  function drawTitleLauncher(lx: number, ly: number, barrelAngle: number, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Dark grounding shadow to separate from skyline clutter.
    const shadow = ctx.createRadialGradient(lx, ly + 18, 0, lx, ly + 18, 44);
    shadow.addColorStop(0, "rgba(4, 8, 16, 0.55)");
    shadow.addColorStop(0.7, "rgba(4, 8, 16, 0.18)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(lx - 46, ly - 6, 92, 50);

    // Soft atmospheric veil pushes the launcher forward from the skyline.
    const haze = ctx.createRadialGradient(lx, ly - 4, 0, lx, ly - 4, 60);
    haze.addColorStop(0, "rgba(88, 150, 210, 0.12)");
    haze.addColorStop(0.45, "rgba(56, 104, 168, 0.06)");
    haze.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = haze;
    ctx.fillRect(lx - 60, ly - 54, 120, 110);

    // Grounded atmospheric bloom
    const glow = ctx.createRadialGradient(lx, ly + 8, 0, lx, ly + 8, 52);
    glow.addColorStop(0, "rgba(0, 210, 255, 0.26)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(lx - 52, ly - 26, 104, 68);

    // Embedded launch platform
    ctx.fillStyle = "#182434";
    ctx.beginPath();
    ctx.moveTo(lx - 34, ly + 12);
    ctx.lineTo(lx - 24, ly - 6);
    ctx.lineTo(lx + 24, ly - 6);
    ctx.lineTo(lx + 34, ly + 12);
    ctx.lineTo(lx + 22, ly + 18);
    ctx.lineTo(lx - 22, ly + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(4, 10, 18, 0.85)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(lx - 34, ly + 12);
    ctx.lineTo(lx - 24, ly - 6);
    ctx.lineTo(lx + 24, ly - 6);
    ctx.lineTo(lx + 34, ly + 12);
    ctx.stroke();
    ctx.strokeStyle = "rgba(58, 116, 164, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx - 33, ly + 11.5);
    ctx.lineTo(lx - 24, ly - 5.5);
    ctx.lineTo(lx + 24, ly - 5.5);
    ctx.lineTo(lx + 33, ly + 11.5);
    ctx.stroke();
    ctx.fillStyle = "rgba(0, 230, 255, 0.12)";
    ctx.fillRect(lx - 18, ly + 12, 36, 2);

    // Main carriage
    ctx.fillStyle = "#223247";
    ctx.beginPath();
    ctx.moveTo(lx - 22, ly + 5);
    ctx.lineTo(lx - 16, ly - 11);
    ctx.lineTo(lx - 6, ly - 16);
    ctx.lineTo(lx + 10, ly - 16);
    ctx.lineTo(lx + 18, ly - 8);
    ctx.lineTo(lx + 22, ly + 4);
    ctx.lineTo(lx + 12, ly + 10);
    ctx.lineTo(lx - 14, ly + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(6, 12, 22, 0.88)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = "rgba(120, 205, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(lx - 16, ly - 8);
    ctx.lineTo(lx - 5, ly - 13);
    ctx.lineTo(lx + 8, ly - 13);
    ctx.lineTo(lx + 13, ly - 8);
    ctx.lineTo(lx + 12, ly - 6);
    ctx.lineTo(lx - 14, ly - 6);
    ctx.closePath();
    ctx.fill();

    // Turret cap
    ctx.fillStyle = "#2a3d56";
    ctx.beginPath();
    ctx.ellipse(lx, ly - 10, 13, 9, 0, Math.PI, 0);
    ctx.lineTo(lx + 10, ly - 4);
    ctx.lineTo(lx - 10, ly - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(6, 12, 22, 0.82)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = "rgba(120, 210, 255, 0.42)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(lx, ly - 10, 13, Math.PI + 0.22, -0.12);
    ctx.stroke();

    // Burj-facing cyan rim light
    const rimDir = lx < burjX ? 1 : -1;
    ctx.fillStyle = "rgba(150, 232, 255, 0.2)";
    ctx.fillRect(lx + rimDir * 11 - 1.5, ly - 14, 3, 20);
    ctx.fillStyle = "rgba(150, 232, 255, 0.12)";
    ctx.fillRect(lx + rimDir * 19 - 1, ly - 4, 2, 10);

    // Slow servo indicator light
    const servoPulse = 0.46 + 0.28 * Math.sin(t * 2.2 + lx * 0.018);
    ctx.fillStyle = `rgba(120, 235, 255, ${servoPulse})`;
    ctx.fillRect(lx - 3, ly - 2, 6, 6);
    const servoGlow = ctx.createRadialGradient(lx, ly + 1, 0, lx, ly + 1, 14);
    servoGlow.addColorStop(0, `rgba(120, 235, 255, ${servoPulse})`);
    servoGlow.addColorStop(0.5, `rgba(86, 196, 255, ${servoPulse * 0.5})`);
    servoGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = servoGlow;
    ctx.fillRect(lx - 14, ly - 13, 28, 28);

    // Visible status LEDs on the launcher body.
    const ledPulse = 0.5 + 0.3 * Math.sin(t * 10.8 + lx * 0.027);
    ctx.fillStyle = `rgba(118, 238, 255, ${0.7 * ledPulse})`;
    ctx.fillRect(lx - 12, ly - 6, 3, 5);
    ctx.fillRect(lx - 7, ly - 8, 3, 6);
    const warnPulse = 0.38 + 0.22 * Math.sin(t * 0.9 + lx * 0.013 + 1.2);
    ctx.fillStyle = `rgba(255, 188, 112, ${warnPulse})`;
    ctx.fillRect(lx + 8, ly - 6, 3, 5);

    // Rear support strut for asymmetry
    ctx.strokeStyle = "rgba(50, 70, 94, 0.95)";
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(lx - 7, ly + 8);
    ctx.lineTo(lx - 16, ly + 18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(112, 190, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx - 7, ly + 7);
    ctx.lineTo(lx - 14, ly + 15);
    ctx.stroke();

    // Barrel
    ctx.save();
    ctx.translate(lx + 2, ly - 12);
    ctx.rotate(barrelAngle);
    ctx.fillStyle = "#3b526c";
    ctx.beginPath();
    ctx.moveTo(-2, -4.2);
    ctx.lineTo(24, -3.2);
    ctx.quadraticCurveTo(31, -1.1, 34, 0);
    ctx.quadraticCurveTo(31, 1.1, 24, 3.2);
    ctx.lineTo(-2, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(8, 14, 24, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = "#1d2b3d";
    ctx.fillRect(2, -1.2, 24, 2.4);
    ctx.strokeStyle = "rgba(136, 218, 255, 0.34)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -3.1);
    ctx.lineTo(26, -2.1);
    ctx.stroke();
    ctx.fillStyle = "rgba(150, 230, 255, 0.16)";
    ctx.fillRect(6, -3, 14, 1.3);

    // Barrel collar
    ctx.fillStyle = "#2a3e56";
    ctx.fillRect(-4, -5.4, 7, 10.8);
    ctx.fillStyle = "rgba(132, 214, 255, 0.18)";
    ctx.fillRect(-2.5, -4.2, 2, 8.4);

    // Muzzle glow pulse
    const muzzleX = Math.cos(barrelAngle) * 34;
    const muzzleY = Math.sin(barrelAngle) * 34;
    const pulse = 0.38 + 0.26 * Math.sin(t * 2.4 + lx * 0.02);
    const mGlow = ctx.createRadialGradient(muzzleX, muzzleY, 0, muzzleX, muzzleY, 10);
    mGlow.addColorStop(0, `rgba(0, 255, 200, ${pulse})`);
    mGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = mGlow;
    ctx.fillRect(muzzleX - 10, muzzleY - 10, 20, 20);

    // Faint charge halo near the barrel root.
    const chargePulse = 0.16 + 0.16 * Math.sin(t * 1.45 + lx * 0.03 + 0.8);
    const chargeGlow = ctx.createRadialGradient(4, 0, 0, 4, 0, 14);
    chargeGlow.addColorStop(0, `rgba(126, 228, 255, ${chargePulse})`);
    chargeGlow.addColorStop(0.65, `rgba(80, 176, 255, ${chargePulse * 0.5})`);
    chargeGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = chargeGlow;
    ctx.fillRect(-10, -14, 28, 28);
    ctx.fillStyle = `rgba(142, 236, 255, ${0.5 + chargePulse * 0.8})`;
    ctx.fillRect(1, -1.3, 10, 2.6);
    ctx.restore();

    ctx.restore();
  }

  // Barrel base angles: left launcher points up-right, center straight up, right up-left
  const titleLauncherAngles = [-1.1, -1.57, -2.05];
  LAUNCHERS.forEach((l, i) => {
    const sweep = Math.sin(t * 0.45 + i * 1.2) * 0.18;
    const angle = Math.min(-0.25, Math.max(titleLauncherAngles[i] + sweep, -Math.PI + 0.25));
    drawTitleLauncher(l.x, l.y - 105, angle, 0.92);
  });

  function drawTitleShahed(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, scale = 1, alpha = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#4f4f60";
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -3);
    ctx.lineTo(-14, 0);
    ctx.lineTo(-10, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3e3e4d";
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
    ctx.fillStyle = "#5a5a6b";
    ctx.beginPath();
    ctx.moveTo(-14, -2);
    ctx.lineTo(-14.8, 0);
    ctx.lineTo(-14, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#868698";
    ctx.beginPath();
    ctx.arc(-14, 0, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Animated exhaust — flicker length and brightness
    const exhaustFlicker = 0.55 + 0.45 * Math.sin(t * 1.8 + x * 0.07);
    const exhaustLen = 4 + 6 * exhaustFlicker;
    const exhaustAlpha = 0.55 + 0.45 * exhaustFlicker;
    ctx.fillStyle = `rgba(255, 100, 40, ${exhaustAlpha})`;
    ctx.beginPath();
    ctx.moveTo(-14, -1.2);
    ctx.lineTo(-14 - exhaustLen, 0);
    ctx.lineTo(-14, 1.2);
    ctx.closePath();
    ctx.fill();
    // Inner hot core
    ctx.fillStyle = `rgba(255, 220, 120, ${exhaustAlpha * 0.7})`;
    ctx.beginPath();
    ctx.moveTo(-14, -0.5);
    ctx.lineTo(-14 - exhaustLen * 0.5, 0);
    ctx.lineTo(-14, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTitleMissileStreak(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    scale = 1,
    alpha = 1,
    trailLen = 58,
    trailPulse = 1,
  ) {
    drawTitleStyleMissile(ctx, x, y, angle, { scale, alpha, trailLen, trailPulse });
  }

  const titleAircraft = [
    { kind: "shahed", x: 125, y: 520, scale: 2, phase: 0.1 },
    { kind: "shahed", x: 100, y: 620, scale: 2, phase: 0.1 },
    { kind: "shahed", x: 150, y: 800, scale: 2, phase: 0.1 },
    { kind: "missile", x: 752, y: 550, scale: 2, phase: 0.32 },
    { kind: "missile", x: 702, y: 786, scale: 2, phase: 0.32 },
    { kind: "missile", x: 758, y: 836, scale: 2, phase: 0.56 },
  ];
  const titleTargetX = BURJ_X;
  const titleTargetY = burjBaseY - burjHeight + 18;
  titleAircraft.forEach((obj, index) => {
    const x = obj.x;
    const y = obj.y;
    const aimAngle = Math.atan2(titleTargetY - y, titleTargetX - x);
    const trailPulse = 0.55 + 0.45 * Math.sin(t * 1.8 + obj.phase * 7 + index * 0.6);
    ctx.save();
    ctx.strokeStyle = obj.kind === "shahed" ? "rgba(255, 210, 150, 0.1)" : "rgba(210, 220, 230, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(titleTargetX, titleTargetY);
    ctx.stroke();
    ctx.restore();
    if (obj.kind === "shahed") {
      ctx.save();
      const shahedTrail = 74 + 18 * trailPulse;
      const shahedTrailFade = 0.18 + 0.08 * trailPulse;
      const shahedTrailGrad = ctx.createLinearGradient(
        x - Math.cos(aimAngle) * shahedTrail,
        y - Math.sin(aimAngle) * shahedTrail,
        x,
        y,
      );
      shahedTrailGrad.addColorStop(0, "rgba(255, 150, 70, 0)");
      shahedTrailGrad.addColorStop(0.75, `rgba(255, 150, 70, ${shahedTrailFade})`);
      shahedTrailGrad.addColorStop(1, "rgba(210, 220, 230, 0.06)");
      ctx.strokeStyle = shahedTrailGrad;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(aimAngle) * shahedTrail, y - Math.sin(aimAngle) * shahedTrail);
      ctx.lineTo(x, y);
      ctx.stroke();
      drawTitleShahed(ctx, x, y, aimAngle + 0.08, obj.scale, 0.88);
      ctx.restore();
    } else {
      ctx.save();
      const missileTrailFade = 0.08 * trailPulse;
      ctx.strokeStyle = "rgba(210, 214, 220, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(aimAngle) * 34, y - Math.sin(aimAngle) * 34);
      ctx.lineTo(x, y);
      ctx.stroke();
      drawTitleMissileStreak(ctx, x, y, aimAngle + 0.04, obj.scale, 1, 80, missileTrailFade);
      ctx.restore();
    }
  });

  // Slow ambient drift for the distant skyline
  const skylineDrift = Math.sin(t * 0.05) * 1.8;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(40 + i * 100 + skylineDrift, GROUND_Y - 82 - (i % 2) * 6, 2, 10);
  }
  ctx.restore();

  // Title copy
  if (!layout.externalTitle) {
    ctx.save();
    ctx.strokeStyle = `rgba(0, 255, 200, ${0.08 + (titleFlickerSoft - 0.95) * 1.3})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(120, 54, CANVAS_W - 240, 188);
    ctx.restore();

    ctx.fillStyle = COL.hud;
    glow(ctx, COL.hud, 24);
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(Math.sin(t * 7.925) * 0.5, 0);
    ctx.globalAlpha = titleFlicker;
    ctx.font = `bold 72px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("DUBAI", cx, 128);
    ctx.restore();

    ctx.save();
    ctx.translate(Math.sin(t * 7.35 + 0.5) * 0.35, 0);
    ctx.globalAlpha = titleFlickerSoft;
    ctx.font = `bold 82px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("MISSILE COMMAND", cx, 200);
    ctx.restore();
    glowOff(ctx);

    ctx.fillStyle = "#ff6e52";
    ctx.save();
    ctx.translate(Math.sin(t * 5.775 + 1.2) * 0.25, 0);
    ctx.globalAlpha = 0.92 + 0.04 * Math.sin(t * 8.9 + 0.3);
    ctx.font = `bold 34px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("DEFEND THE CITY", cx, 262);
    ctx.fillText("PROTECT THE BURJ KHALIFA", cx, 310);
    ctx.restore();

    const beaconBlink = Math.max(0, Math.sin(t * 3.0));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    const pulse = 0.18 + beaconIntensity * 0.82;
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.save();
    ctx.translate(Math.sin(t * 5.425 + 2.4) * 0.25, 0);
    ctx.globalAlpha = pulse * (0.9 + 0.06 * Math.sin(t * 4.875));
    ctx.font = `bold 36px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("PRESS START", cx, 500);
    ctx.restore();
  } else {
    const pulse = 0.3 + 0.2 * Math.sin(t * 2.4);
    ctx.fillStyle = `rgba(0,255,200,${pulse})`;
    ctx.beginPath();
    ctx.arc(cx, 500, 72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.font = `bold 18px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("TACTICAL FEED", cx, 560);
  }
  ctx.textAlign = "left";
}

export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  finalScore: number,
  finalWave: number,
  finalStats: { missileKills: number; droneKills: number; shotsFired: number },
  { layoutProfile = {} as Partial<LayoutProfile> } = {},
) {
  const layout = resolveLayoutProfile(layoutProfile);
  const t = performance.now() / 1000;
  const cx = CANVAS_W / 2;
  // externalGameOver card clips to ~640px tall; non-external is unused in portrait but scales for full canvas
  const s = layout.externalGameOver ? 1 : CANVAS_H / 640;
  ctx.fillStyle = "#080008";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Animated embers / ash
  for (let i = 0; i < 300; i++) {
    const px = (Math.sin(i * 73.1 + t * 0.3) * 0.5 + 0.5) * CANVAS_W;
    const py = (i * 37.7 + t * 20) % CANVAS_H;
    ctx.fillStyle = `rgba(255,${50 + (i % 60)},0,${0.03 + Math.sin(i + t) * 0.02})`;
    ctx.fillRect(px, py, 2, 2);
  }
  // Ruined Burj silhouette
  ctx.fillStyle = "rgba(60,20,10,0.4)";
  ctx.beginPath();
  ctx.moveTo(cx - 12 * s, 500 * s);
  ctx.lineTo(cx - 8 * s, 400 * s);
  ctx.lineTo(cx - 5 * s, 360 * s);
  ctx.lineTo(cx - 3 * s, 340 * s);
  ctx.lineTo(cx + 2 * s, 350 * s);
  ctx.lineTo(cx + 6 * s, 380 * s);
  ctx.lineTo(cx + 10 * s, 420 * s);
  ctx.lineTo(cx + 12 * s, 500 * s);
  ctx.closePath();
  ctx.fill();
  // Smoke wisps
  for (let i = 0; i < 5; i++) {
    const sx = cx + Math.sin(t + i * 1.3) * 15 * s;
    const sy = 330 * s - i * 20 * s - ((t * 8 * s) % (40 * s));
    ctx.globalAlpha = 0.1 - i * 0.015;
    ctx.fillStyle = "#442222";
    ctx.beginPath();
    ctx.arc(sx, sy, (8 + i * 3) * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Title
  ctx.textAlign = "center";
  ctx.fillStyle = COL.warning;
  glow(ctx, "#ff0000", 30);
  ctx.font = `bold ${Math.round(48 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText("CITY FALLEN", cx, 140 * s);
  glowOff(ctx);
  if (layout.externalGameOver) {
    ctx.strokeStyle = "rgba(255,60,60,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 190, 170 * s);
    ctx.lineTo(cx + 190, 170 * s);
    ctx.stroke();
    ctx.fillStyle = "#7d6670";
    ctx.font = `bold ${Math.round(18 * s)}px ${ARCADE_FONT_FAMILY}`;
    ctx.fillText("THE DEFENSE NET HAS COLLAPSED", cx, 214 * s);
    ctx.textAlign = "left";
    return;
  }
  // Divider line
  ctx.strokeStyle = "rgba(255,60,60,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CANVAS_W / 2 - 150, 160);
  ctx.lineTo(CANVAS_W / 2 + 150, 160);
  ctx.stroke();
  // Stats
  ctx.fillStyle = "#887766";
  ctx.font = `${Math.round(13 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText("AFTER ACTION REPORT", cx, 195 * s);
  ctx.fillStyle = "#ccbbaa";
  ctx.font = `${Math.round(20 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText(`SCORE: ${finalScore}`, cx, 240 * s);
  ctx.fillStyle = "#aa9988";
  ctx.font = `${Math.round(16 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText(`WAVES SURVIVED: ${finalWave}`, cx, 275 * s);
  // Rating
  let rating, ratingColor;
  if (finalWave >= 10) {
    rating = "LEGENDARY COMMANDER";
    ratingColor = COL.gold;
  } else if (finalWave >= 7) {
    rating = "VETERAN DEFENDER";
    ratingColor = "#44ffaa";
  } else if (finalWave >= 4) {
    rating = "CAPABLE OFFICER";
    ratingColor = "#88aacc";
  } else {
    rating = "CADET";
    ratingColor = "#886655";
  }
  ctx.fillStyle = ratingColor;
  ctx.font = `bold ${Math.round(14 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText(rating, cx, 310 * s);
  // Combat stats
  ctx.strokeStyle = "rgba(255,60,60,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 120, 330 * s);
  ctx.lineTo(cx + 120, 330 * s);
  ctx.stroke();
  ctx.fillStyle = "#887766";
  ctx.font = `${Math.round(11 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText("COMBAT RECORD", cx, 352 * s);
  ctx.fillStyle = "#aa9988";
  ctx.font = `${Math.round(14 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText(`MISSILES DESTROYED: ${finalStats.missileKills}`, cx, 378 * s);
  ctx.fillText(`DRONES KILLED: ${finalStats.droneKills}`, cx, 400 * s);
  ctx.fillText(`SHOTS FIRED: ${finalStats.shotsFired}`, cx, 422 * s);
  const totalKills = finalStats.missileKills + finalStats.droneKills;
  const hitRatio = finalStats.shotsFired > 0 ? Math.round((totalKills / finalStats.shotsFired) * 100) : 0;
  ctx.fillStyle = hitRatio >= 50 ? "#44ff88" : hitRatio >= 25 ? "#ffaa44" : "#ff4444";
  ctx.font = `bold ${Math.round(14 * s)}px ${ARCADE_FONT_FAMILY}`;
  ctx.fillText(`HIT RATIO: ${hitRatio}%`, cx, 448 * s);
  ctx.textAlign = "left";
}
