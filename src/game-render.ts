import {
  CANVAS_W,
  CANVAS_H,
  GROUND_Y,
  CITY_Y,
  GAMEPLAY_SCENIC_BASE_Y,
  GAMEPLAY_SCENIC_GROUND_Y,
  GAMEPLAY_WATERLINE_Y,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  GAMEPLAY_SCENIC_THREAT_FLOOR_Y,
  WATER_SURFACE_OFFSET,
  COL,
  BURJ_X,
  BURJ_H,
  LAUNCHERS,
  getDefenseSitePlacement,
  getGameplayBuildingBounds,
  getGameplayBurjCollisionTop,
  getGameplayBurjHalfW,
  getGameplayLauncherPosition,
  getPhalanxTurrets,
  ov,
} from "./game-logic";
import {
  TITLE_SKYLINE_TOWERS,
  drawBakedLauncher,
  drawBakedProjectileSprite,
  drawBakedStaticSprite,
  drawFlickerWindows,
  drawLiveInterceptorSprite,
  drawLiveThreatSprite,
  drawSharedLauncher,
  drawSharedTower,
  getBurjHalfWidths,
  getCanvasRenderResources,
  getLightFlicker,
  mapGameplayBuildingTower,
  preloadCanvasRenderResources,
  traceBurjPath,
  type BuildingAssets,
  type BurjAssets,
  type DefenseSiteAssets,
  type InterceptorSpriteAssets,
  type InterceptorSpriteKind,
  type LauncherAssets,
  type PlaneAssets,
  type SkyAssets,
  type ThreatSpriteAssets,
  type ThreatSpriteKind,
  type UpgradeProjectileSpriteAssets,
} from "./canvas-render-resources";
import { UPGRADE_FAMILIES } from "./game-sim-upgrades";
import { perfState, type GameOverSnapshot, type GameRenderer } from "./game-renderer";
import type {
  Building,
  DefenseSite,
  Drone,
  EmpRing,
  Explosion,
  Flare,
  GameState,
  Hornet,
  Interceptor,
  LaserBeam,
  Missile,
  Particle,
  PatriotMissile,
  PhalanxBullet,
  Plane,
  Roadrunner,
  Star,
} from "./types";

export { perfState };

const canvasRenderResources = getCanvasRenderResources();
const ARCADE_FONT_FAMILY = "'Courier New', monospace";
const TITLE_BUILDING_BLEND_WINDOW = 0.18;
const TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS = 4;
const GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS = TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS;
const TITLE_BUILDING_ANIM_ALPHA = 0.58;
const TITLE_BUILDING_PLAYBACK_RATE_JITTER = 0.24;
const TITLE_SHAHED_TIME_STAGGER_SECONDS = 7 / 60;
const TITLE_MISSILE_TIME_STAGGER_SECONDS = 5 / 60;
const TITLE_SHAHED_TIME_RATE = 1.8;
const TITLE_MISSILE_TIME_RATE = 2.4;

export type TitleSkylineRenderMode = "bakedBlend" | "bakedSharp" | "live";
export type SceneRenderMode = "bakedSharp" | "live";

function getTitleWaterImage() {
  return canvasRenderResources.getTitleWaterImage();
}

function getInterceptorHitFlashImage() {
  return canvasRenderResources.getInterceptorHitFlashImage();
}

function getMissileKillFlashImage() {
  return canvasRenderResources.getMissileKillFlashImage();
}

function getDroneKillFlashImage() {
  return canvasRenderResources.getDroneKillFlashImage();
}

function getBuildingDestroyBurstImage() {
  return canvasRenderResources.getBuildingDestroyBurstImage();
}

function getTitleBurjGlowImage() {
  return canvasRenderResources.getTitleBurjGlowImage();
}

function getBurjMissileDecalImage() {
  return canvasRenderResources.getBurjMissileDecalImage();
}

function getBurjDroneDecalImage() {
  return canvasRenderResources.getBurjDroneDecalImage();
}

export function preloadRenderAssets() {
  preloadCanvasRenderResources();
}

export function __resetRenderAssetCachesForTest() {
  canvasRenderResources.resetForTest();
}

export function __getBurjAssetCacheKeysForTest() {
  return canvasRenderResources.getBurjAssetCacheKeys();
}

export function __getBurjAssetsForTest(groundY: number, artScale: number) {
  return canvasRenderResources.getBurjAssets(groundY, artScale);
}

export function __getLauncherAssetCacheKeysForTest() {
  return canvasRenderResources.getLauncherAssetCacheKeys();
}

export function __getLauncherAssetsForTest(scale: number, damaged: boolean) {
  return canvasRenderResources.getLauncherAssets(scale, damaged);
}

export function __getThreatSpriteCacheKeysForTest() {
  return canvasRenderResources.getThreatSpriteCacheKeys();
}

export function __getThreatSpriteAssetsForTest(scale: number) {
  return canvasRenderResources.getThreatSpriteAssets(scale);
}

export function __getInterceptorSpriteCacheKeysForTest() {
  return canvasRenderResources.getInterceptorSpriteCacheKeys();
}

export function __getInterceptorSpriteAssetsForTest(scale: number) {
  return canvasRenderResources.getInterceptorSpriteAssets(scale);
}

export function __getUpgradeProjectileSpriteCacheKeysForTest() {
  return canvasRenderResources.getUpgradeProjectileSpriteCacheKeys();
}

export function __getUpgradeProjectileSpriteAssetsForTest(scale: number) {
  return canvasRenderResources.getUpgradeProjectileSpriteAssets(scale);
}

export function __getDefenseSiteAssetsForTest() {
  return canvasRenderResources.getDefenseSiteAssets();
}

export function __getPlaneAssetsForTest() {
  return canvasRenderResources.getPlaneAssets();
}

function getGameplaySkyAssets(stars: Star[], groundY: number): SkyAssets {
  return canvasRenderResources.getGameplaySkyAssets(stars, groundY);
}

function getTitleSkyAssets(): SkyAssets {
  return canvasRenderResources.getTitleSkyAssets();
}

function getTitleBuildingAssets(baseY: number): BuildingAssets {
  return canvasRenderResources.getTitleBuildingAssets(baseY);
}

function getGameplayBuildingAssets(baseY = GAMEPLAY_SCENIC_BASE_Y): BuildingAssets {
  return canvasRenderResources.getGameplayBuildingAssets(baseY);
}

function getBurjAssets(groundY: number, artScale: number): BurjAssets {
  return canvasRenderResources.getBurjAssets(groundY, artScale);
}

function getLauncherAssets(scale: number, damaged: boolean): LauncherAssets {
  return canvasRenderResources.getLauncherAssets(scale, damaged);
}

function getThreatSpriteAssets(scale: number): ThreatSpriteAssets {
  return canvasRenderResources.getThreatSpriteAssets(scale);
}

function getInterceptorSpriteAssets(scale: number): InterceptorSpriteAssets {
  return canvasRenderResources.getInterceptorSpriteAssets(scale);
}

function getUpgradeProjectileSpriteAssets(scale: number): UpgradeProjectileSpriteAssets {
  return canvasRenderResources.getUpgradeProjectileSpriteAssets(scale);
}

function getDefenseSiteAssets(): DefenseSiteAssets {
  return canvasRenderResources.getDefenseSiteAssets();
}

function getPlaneAssets(): PlaneAssets {
  return canvasRenderResources.getPlaneAssets();
}

function getThreatSpriteKind(m: Missile | Drone): ThreatSpriteKind {
  if (m.type === "drone") {
    return m.subtype === "shahed238" ? "shahed238" : "shahed136";
  }
  switch (m.type) {
    case "mirv":
      return "mirv";
    case "mirv_warhead":
      return "mirv_warhead";
    case "bomb":
      return "bomb";
    case "stack2":
      return "stack_carrier_2";
    case "stack3":
      return "stack_carrier_3";
    case "stack_child":
      return "stack_child";
    case "missile":
    default:
      return "missile";
  }
}

function getInterceptorSpriteKind(ic: Interceptor): InterceptorSpriteKind {
  return ic.fromF15 ? "f15Interceptor" : "playerInterceptor";
}

function getTitleThreatAnimationTime(timeSeconds: number, kind: "shahed" | "missile", index: number): number {
  if (kind === "shahed") {
    return timeSeconds * TITLE_SHAHED_TIME_RATE + index * TITLE_SHAHED_TIME_STAGGER_SECONDS;
  }
  return timeSeconds * TITLE_MISSILE_TIME_RATE + index * TITLE_MISSILE_TIME_STAGGER_SECONDS;
}

export function __getTitleThreatAnimationTimeForTest(timeSeconds: number, kind: "shahed" | "missile", index: number) {
  return getTitleThreatAnimationTime(timeSeconds, kind, index);
}

function getTitleShahedBeaconAlpha(timeSeconds: number, index: number): number {
  const wave = Math.sin(timeSeconds * 9 + index * 1.35);
  return wave > 0 ? 0.42 + wave * 0.48 : 0;
}

export function __getTitleShahedBeaconAlphaForTest(timeSeconds: number, index: number) {
  return getTitleShahedBeaconAlpha(timeSeconds, index);
}

function drawTitleShahedBeacon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  t: number,
  index: number,
) {
  const alpha = getTitleShahedBeaconAlpha(t, index);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ff3b22";
  glow(ctx, ctx.fillStyle, 2.4 * scale);
  ctx.beginPath();
  ctx.arc(x, y, 0.85 * scale, 0, Math.PI * 2);
  ctx.fill();
  glowOff(ctx);
  ctx.restore();
}

function drawDistortedWaterSprite(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH || w <= 0 || h <= 0) {
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  const bandH = 12;
  const bands = Math.max(1, Math.ceil(h / bandH));
  const srcBandH = srcH / bands;
  const amplitude = 3.1;
  const verticalAmplitude = 1.6;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  for (let i = 0; i < bands; i++) {
    const destY = y + i * bandH;
    const destH = Math.min(bandH + 1, y + h - destY);
    if (destH <= 0.5) continue;
    const baseSrcY = i * srcBandH;
    const seedA = 0.5 + 0.5 * Math.sin(i * 17.231 + 0.8);
    const seedB = 0.5 + 0.5 * Math.sin(i * 9.173 + 2.4);
    const seedC = 0.5 + 0.5 * Math.sin(i * 23.417 + 4.1);
    const swell = 0.68 + 0.32 * Math.sin(t * (0.42 + seedC * 0.18) + i * 0.11 + seedB * 5.2);
    const drift = Math.sin(t * (0.72 + seedA * 0.42) + i * (0.18 + seedB * 0.16) + seedC * 6.28);
    const chop = Math.sin(t * (1.65 + seedB * 0.95) + i * (0.43 + seedC * 0.31) + seedA * 6.28);
    const micro = Math.sin(t * (3.4 + seedC * 1.4) + i * (0.94 + seedA * 0.42) + seedB * 6.28);
    const verticalDrift =
      (Math.sin(t * (0.88 + seedB * 0.34) + i * (0.24 + seedA * 0.12) + seedC * 4.6) * 0.72 +
        Math.sin(t * (2.45 + seedC * 0.85) + i * (0.53 + seedB * 0.18) + seedA * 3.2) * 0.28) *
      verticalAmplitude;
    const wave = (drift * 0.74 + chop * 0.28 * swell + micro * 0.09) * amplitude;
    const stretch = 1 + (drift * 0.0055 + chop * 0.004 + micro * 0.002);
    const drawW = w * stretch;
    const drawX = x - (drawW - w) * 0.5 + wave;
    const srcY = Math.max(0, Math.min(srcH - srcBandH - 1, baseSrcY + verticalDrift));
    const srcSegH = Math.min(srcBandH + 1, srcH - srcY);
    ctx.globalAlpha = 0.97 - (i / bands) * 0.04;
    ctx.drawImage(img, 0, srcY, srcW, srcSegH, drawX, destY, drawW, destH);
  }

  ctx.restore();
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

function drawGradientTrail(
  ctx: CanvasRenderingContext2D,
  trail: Array<{ x: number; y: number }>,
  headX: number,
  headY: number,
  {
    outerRgb,
    coreRgb,
    headRgb,
    width,
    coreWidth,
    headRadius,
  }: {
    outerRgb: string;
    coreRgb: string;
    headRgb: string;
    width: number;
    coreWidth: number;
    headRadius: number;
  },
) {
  const points = trail
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .concat(Number.isFinite(headX) && Number.isFinite(headY) ? [{ x: headX, y: headY }] : []);
  if (points.length === 0) return;
  if (points.length >= 2) {
    const start = points[0];
    const end = points[points.length - 1];

    const outer = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    outer.addColorStop(0, `rgba(${outerRgb},0)`);
    outer.addColorStop(0.45, `rgba(${outerRgb},0.12)`);
    outer.addColorStop(0.82, `rgba(${outerRgb},0.34)`);
    outer.addColorStop(1, `rgba(${outerRgb},0.03)`);
    ctx.strokeStyle = outer;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    const core = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    core.addColorStop(0, `rgba(${coreRgb},0)`);
    core.addColorStop(0.52, `rgba(${coreRgb},0.1)`);
    core.addColorStop(0.88, `rgba(${coreRgb},0.6)`);
    core.addColorStop(1, `rgba(${coreRgb},0.04)`);
    ctx.strokeStyle = core;
    ctx.lineWidth = coreWidth;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  const headGlow = ctx.createRadialGradient(headX, headY, 0, headX, headY, headRadius * 2.6);
  headGlow.addColorStop(0, `rgba(${headRgb},0.42)`);
  headGlow.addColorStop(0.38, `rgba(${headRgb},0.18)`);
  headGlow.addColorStop(1, `rgba(${headRgb},0)`);
  ctx.fillStyle = headGlow;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(${headRgb},0.78)`;
  ctx.beginPath();
  ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
  ctx.fill();
}

function drawShahed136Exhaust(
  ctx: CanvasRenderingContext2D,
  { trailLength = 0, effectScale = 1 }: { trailLength?: number; effectScale?: number } = {},
) {
  if (trailLength <= 0) return;

  const smokeLen = 9 + Math.min(trailLength, 12) * 0.75;
  const smokeGrad = ctx.createLinearGradient(-10.8 - smokeLen, 0, -10.3, 0);
  smokeGrad.addColorStop(0, "rgba(120,128,136,0)");
  smokeGrad.addColorStop(0.48, "rgba(136,144,152,0.18)");
  smokeGrad.addColorStop(1, "rgba(190,198,206,0.28)");
  ctx.strokeStyle = smokeGrad;
  ctx.lineWidth = 1.25 * effectScale;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-10.8 - smokeLen, 0);
  ctx.lineTo(-10.3, 0);
  ctx.stroke();

  const emberAlpha = 0.14 + Math.min(trailLength, 8) * 0.02;
  ctx.fillStyle = `rgba(196,170,118,${emberAlpha})`;
  ctx.beginPath();
  ctx.arc(-10.6, 0, 0.46 * effectScale, 0, Math.PI * 2);
  ctx.fill();
}

export function hash01(a: number, b = 0, c = 0, d = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

export function pulse(time: number, speed: number, phase = 0, min = 0, max = 1) {
  const t = 0.5 + 0.5 * Math.sin(time * speed + phase);
  return min + (max - min) * t;
}

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
  burjAssets?: BurjAssets | null;
  sharpFrames?: boolean;
}

interface SharedWaterOptions {
  groundY: number;
  renderHeight: number;
  tintBottomAlpha?: number;
}

function drawSharedSky(ctx: CanvasRenderingContext2D, { groundY, stars }: SharedSkyOptions, t: number) {
  const assets = stars?.length ? getGameplaySkyAssets(stars, groundY) : getTitleSkyAssets();
  const { frames, frameCount, period } = assets;
  const phase = (t % period) / period;
  const frameIndex = Math.floor(phase * frameCount) % frameCount;
  const blend = (phase * frameCount) % 1;

  ctx.globalAlpha = 1 - blend;
  ctx.drawImage(frames[frameIndex], 0, 0);
  ctx.globalAlpha = blend;
  ctx.drawImage(frames[(frameIndex + 1) % frameCount], 0, 0);
  ctx.globalAlpha = 1;
}

function drawGameplayForegroundBuildings(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  t: number,
  groundY: number,
  renderMode: SceneRenderMode,
  buildingAssets?: BuildingAssets | null,
) {
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
    if (!buildingAssets || renderMode === "live") {
      drawSharedTower(ctx, tower, baseY, t, 0, 0.48);
      return;
    }

    const phase = (t % GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS) / GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS;
    const frameIndex = Math.floor(phase * buildingAssets.frameCount) % buildingAssets.frameCount;
    const blend = (phase * buildingAssets.frameCount) % 1;
    const staticSprite = buildingAssets.staticSprites[index];
    const anim = buildingAssets.animFrames[index];
    const staticOffset = buildingAssets.staticOffsets[index];
    const animOffset = buildingAssets.animOffsets[index];

    ctx.drawImage(staticSprite, staticOffset.x, staticOffset.y);
    ctx.globalAlpha = renderMode === "bakedSharp" ? 1 : 1 - blend;
    ctx.drawImage(anim[frameIndex], animOffset.x, animOffset.y);
    if (renderMode !== "bakedSharp") {
      ctx.globalAlpha = blend;
      ctx.drawImage(anim[(frameIndex + 1) % buildingAssets.frameCount], animOffset.x, animOffset.y);
    }
    ctx.globalAlpha = 1;
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
    burjAssets = null,
    sharpFrames = false,
  }: SharedBurjOptions,
) {
  const burjX = BURJ_X;
  const burjBaseY = groundY - 6;
  const burjHeight = BURJ_H;
  const burjDamageLevel = mode === "game" ? Math.max(0, Math.min(1, (5 - burjHealth) / 4)) : 0;
  const burjCritical = mode === "game" && burjHealth <= 1;
  const hitFlashT = burjHitFlashMax > 0 ? Math.max(0, Math.min(1, burjHitFlashTimer / burjHitFlashMax)) : 0;
  const missileDecalImg = getBurjMissileDecalImage();
  const droneDecalImg = getBurjDroneDecalImage();

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

  const drawDamageUnderlay = () => {
    if (mode !== "game" || burjDamageLevel <= 0) return;
    ctx.save();
    traceBurjPath(ctx, burjBaseY);
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
  };

  const drawLiveWindows = () => {
    drawFlickerWindows(ctx, {
      x: burjX - 8,
      y: burjBaseY - burjHeight + 176,
      w: 16,
      h: 58,
      rows: 5,
      cols: 2,
      time: t,
      seed: 121.4,
      warmBias: 0.52,
      paneW: 2,
      paneH: 2.4,
      gapX: 4.2,
      gapY: 7.2,
    });
    drawFlickerWindows(ctx, {
      x: burjX - 6,
      y: burjBaseY - burjHeight + 248,
      w: 12,
      h: 54,
      rows: 5,
      cols: 1,
      time: t,
      seed: 124.9,
      warmBias: 0.66,
      paneW: 2.2,
      paneH: 2.6,
      gapX: 0,
      gapY: 7.6,
    });
  };

  const drawLiveBeacon = () => {
    const beaconBlink = Math.max(0, Math.sin(t * 3.0));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    ctx.fillStyle = `rgba(128, 60, 40, ${0.25 + 0.75 * beaconIntensity})`;
    ctx.fillRect(burjX - 0.7, burjBaseY - burjHeight - 50, 1.4, 10);
    if (beaconIntensity <= 0.05) return;
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
    ctx.fillStyle = `rgba(255, 255, 220, ${0.7 + 0.3 * beaconIntensity})`;
    ctx.fillRect(burjX - 1, burjBaseY - burjHeight - 47, 2, 2);
    ctx.fillStyle = `rgba(255, 80, 40, ${0.9 * beaconIntensity})`;
    ctx.fillRect(burjX - 1.5, burjBaseY - burjHeight - 47.5, 3, 3);
  };

  const drawPostClipPass = () => {
    ctx.save();
    traceBurjPath(ctx, burjBaseY);
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
      const { left, right } = getBurjHalfWidths(ht);
      const lw = left * 0.64;
      const rw = right * 0.64;
      if (lw < 0.95 && rw < 0.95) continue;
      const lit = Math.sin(t * 0.22 + i * 0.37) > -0.28;
      if (!lit) continue;
      const warmBand = i === 16 || i === 28 || i === 39 || i === 49;
      ctx.fillStyle = warmBand ? "rgba(252, 252, 255, 0.9)" : "rgba(230, 244, 255, 0.16)";
      ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
      if (!warmBand && i % 6 === 0) {
        ctx.fillStyle = "rgba(100, 180, 255, 0.08)";
        ctx.fillRect(burjX - lw, ly + 0.88, lw + rw, 0.28);
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
    }

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

    ctx.restore();
  };

  if (!burjAssets) {
    const podiumGlow = ctx.createRadialGradient(burjX, groundY - 20, 0, burjX, groundY - 20, 140);
    podiumGlow.addColorStop(0, "rgba(196, 242, 255, 0.32)");
    podiumGlow.addColorStop(0.32, "rgba(120, 210, 255, 0.22)");
    podiumGlow.addColorStop(0.62, "rgba(255, 180, 120, 0.12)");
    podiumGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = podiumGlow;
    ctx.fillRect(burjX - 140, groundY - 140, 280, 180);
  }

  withAnchorScale(ctx, burjX, burjBaseY, artScale, () => {
    if (burjAssets) {
      const spriteW = burjAssets.staticSprite.width / burjAssets.resolutionScale;
      const spriteH = burjAssets.staticSprite.height / burjAssets.resolutionScale;
      // Keep the damage tint under the prebaked light layers to preserve the existing stack.
      ctx.drawImage(burjAssets.staticSprite, burjAssets.offset.x, burjAssets.offset.y, spriteW, spriteH);
      drawDamageUnderlay();
      const phase =
        ((((t % burjAssets.period) + burjAssets.period) % burjAssets.period) / burjAssets.period) *
        burjAssets.frameCount;
      const frameIndex = Math.floor(phase) % burjAssets.frameCount;
      const blend = phase % 1;
      ctx.globalAlpha = sharpFrames ? 1 : 1 - blend;
      ctx.drawImage(burjAssets.animFrames[frameIndex], burjAssets.offset.x, burjAssets.offset.y, spriteW, spriteH);
      if (!sharpFrames) {
        ctx.globalAlpha = blend;
        ctx.drawImage(
          burjAssets.animFrames[(frameIndex + 1) % burjAssets.frameCount],
          burjAssets.offset.x,
          burjAssets.offset.y,
          spriteW,
          spriteH,
        );
      }
      ctx.globalAlpha = 1;
    } else {
      const burjGrad = ctx.createLinearGradient(burjX, burjBaseY - burjHeight, burjX, burjBaseY);
      burjGrad.addColorStop(0, "#fbfdff");
      burjGrad.addColorStop(0.08, "#dcecff");
      burjGrad.addColorStop(0.2, "#6e88a7");
      burjGrad.addColorStop(0.42, "#243446");
      burjGrad.addColorStop(0.7, "#182330");
      burjGrad.addColorStop(1, "#202a34");
      ctx.fillStyle = burjGrad;
      traceBurjPath(ctx, burjBaseY);
      ctx.fill();

      drawDamageUnderlay();

      ctx.strokeStyle = "rgba(236,246,255,0.28)";
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(burjX, burjBaseY - burjHeight - 44);
      ctx.lineTo(burjX, burjBaseY - 28);
      ctx.stroke();
      const spineFlicker = getLightFlicker(t, 41.7);
      const crownFlicker = getLightFlicker(t, 44.1);
      ctx.fillStyle = `rgba(250, 252, 255, ${0.06 + spineFlicker * 0.68})`;
      ctx.fillRect(burjX - 0.55, burjBaseY - burjHeight + 18, 1.1, burjHeight - 18);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + crownFlicker * 0.88})`;
      ctx.fillRect(burjX - 2.4, burjBaseY - burjHeight + 22, 4.8, 3.6);
      ctx.fillStyle = "rgba(225, 239, 255, 0.16)";
      for (let i = 0; i < 42; i++) {
        const ht = 0.04 + (i / 41) * 0.92;
        const ly = burjBaseY - burjHeight * ht;
        const { left, right } = getBurjHalfWidths(ht);
        const lw = left * 0.68;
        const rw = right * 0.68;
        if (lw < 1.2 && rw < 1.2) continue;
        const lit = Math.sin(t * 0.32 + i * 0.48) > -0.12;
        if (!lit) continue;
        const bandFlicker = getLightFlicker(t, 47.5 + i * 0.63);
        ctx.fillStyle =
          i === 13 || i === 23 || i === 33
            ? `rgba(255, 255, 255, ${0.04 + bandFlicker * 0.82})`
            : `rgba(215, 232, 248, ${0.01 + bandFlicker * 0.22})`;
        ctx.fillRect(burjX - lw, ly, lw + rw, 0.72);
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
        const ly = burjBaseY - burjHeight * band.ht;
        const { left, right } = getBurjHalfWidths(band.ht);
        const bandFlicker = getLightFlicker(t, 83.1 + index * 1.9);
        ctx.fillStyle = `rgba(252, 253, 255, ${band.alpha * (0.26 + bandFlicker * 0.94)})`;
        ctx.fillRect(burjX - left * 0.88, ly, left * 0.88 + right * 0.88, band.thickness);
        ctx.fillStyle = `rgba(15, 24, 34, ${0.34 - index * 0.03})`;
        ctx.fillRect(burjX - left * 0.9, ly + band.thickness, left * 0.9 + right * 0.9, 1.15);
        ctx.fillStyle = `rgba(130, 200, 255, ${0.01 + bandFlicker * 0.24})`;
        ctx.fillRect(burjX - left * 0.86, ly - 0.7, left * 0.86 + right * 0.86, 0.55);
      });

      ctx.fillStyle = "rgba(10, 18, 28, 0.56)";
      ctx.fillRect(burjX - 8.2, burjBaseY - burjHeight + 158, 16.4, 10);
      ctx.fillRect(burjX - 11.4, burjBaseY - burjHeight + 224, 22.8, 10);
      ctx.fillStyle = `rgba(248, 252, 255, ${0.08 + getLightFlicker(t, 97.2) * 0.92})`;
      ctx.fillRect(burjX - 7.1, burjBaseY - burjHeight + 166, 14.2, 2.6);
      ctx.fillStyle = `rgba(255, 224, 176, ${0.04 + getLightFlicker(t, 101.4) * 0.56})`;
      ctx.fillRect(burjX - 9.4, burjBaseY - burjHeight + 232, 18.8, 2.1);

      const accentLights = [
        { ht: 0.18, width: 0.54, thickness: 1.4, seed: 106.2, color: "255, 236, 194" },
        { ht: 0.36, width: 0.5, thickness: 1.2, seed: 109.8, color: "214, 236, 255" },
        { ht: 0.52, width: 0.46, thickness: 1.15, seed: 113.3, color: "255, 228, 168" },
        { ht: 0.68, width: 0.38, thickness: 1.05, seed: 117.1, color: "220, 240, 255" },
      ];
      accentLights.forEach((light) => {
        const ly = burjBaseY - burjHeight * light.ht;
        const { left, right } = getBurjHalfWidths(light.ht);
        const flicker = getLightFlicker(t, light.seed);
        const span = (left + right) * 0.5 * light.width;
        ctx.fillStyle = `rgba(${light.color}, ${0.02 + flicker * 0.68})`;
        ctx.fillRect(burjX - span * 0.5, ly, span, light.thickness);
      });
    }

    drawLiveWindows();
    drawLiveBeacon();
    drawPostClipPass();
  });

  // Horizon line — glow separating buildings from water
  const horizonGlow = ctx.createLinearGradient(0, groundY - 6, 0, groundY + 8);
  horizonGlow.addColorStop(0, "rgba(180, 200, 230, 0.0)");
  horizonGlow.addColorStop(0.4, "rgba(140, 165, 200, 0.38)");
  horizonGlow.addColorStop(0.6, "rgba(100, 130, 170, 0.22)");
  horizonGlow.addColorStop(1, "rgba(60, 90, 130, 0.0)");
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, groundY - 6, CANVAS_W, 14);
  ctx.fillStyle = "rgba(210, 230, 255, 0.55)";
  ctx.fillRect(0, groundY - 1, CANVAS_W, 2);
  // Ground strip — fills the WATER_SURFACE_OFFSET gap so buildings have a solid base
  ctx.fillStyle = "rgba(22, 30, 44, 0.96)";
  ctx.fillRect(0, groundY, CANVAS_W, WATER_SURFACE_OFFSET);

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
  const waterTop = groundY + WATER_SURFACE_OFFSET;
  const waterBottom = renderHeight;
  const titleWaterImg = getTitleWaterImage();
  if (titleWaterImg) {
    drawDistortedWaterSprite(ctx, titleWaterImg, 0, waterTop, CANVAS_W + 10, waterBottom - waterTop, t);
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

function drawPlanes(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  // F-15 Eagle fighter jets
  const planeAssets = getPlaneAssets();
  const airframe = planeAssets.f15Airframe;
  game.planes.forEach((p: Plane) => {
    if (!p.alive) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.vx < 0) ctx.scale(-1, 1);
    if (p.evadeTimer > 0) {
      const bankAngle = p.vy > 0 ? 0.3 : -0.3;
      ctx.rotate(bankAngle);
    }
    ctx.scale(layout.planeScale, layout.planeScale);
    // Baked airframe: fuselage, nose, wings, stabilizers, nozzles, cockpit.
    ctx.drawImage(airframe.sprite, airframe.offset.x, airframe.offset.y, airframe.width, airframe.height);
    // Live afterburner glow
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
    // Nav lights blink
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

function drawMissiles(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  layout: LayoutProfile,
  renderMode: SceneRenderMode,
  t: number,
) {
  const spriteAssets = renderMode === "live" ? null : getThreatSpriteAssets(layout.enemyScale);
  game.missiles.forEach((m: Missile) => {
    const angle = Math.atan2(m.vy, m.vx);

    if (m.type === "mirv") {
      ctx.save();
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.5;
        const r = (3 + (1 - i / m.trail.length) * 5) * layout.effectScale;
        ctx.fillStyle = `rgba(200,160,120,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fill();
      });
      for (let i = Math.max(0, m.trail.length - 8); i < m.trail.length; i++) {
        const a = ((i - (m.trail.length - 8)) / 8) * 0.7;
        ctx.fillStyle = `rgba(255,180,60,${a})`;
        ctx.beginPath();
        ctx.arc(m.trail[i].x, m.trail[i].y, 2.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (renderMode === "live") drawLiveThreatSprite(ctx, m.x, m.y, angle, "mirv", { t, scale: layout.enemyScale });
      else drawBakedProjectileSprite(ctx, m.x, m.y, angle, spriteAssets!.mirv, { t, sharpFrames: true });

      if (m.health! < m.maxHealth!) {
        const barW = 24 * layout.enemyScale;
        const barH = 3 * layout.enemyScale;
        const ratio = m.health! / m.maxHealth!;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(m.x - barW / 2, m.y - 16 * layout.enemyScale, barW, barH);
        ctx.fillStyle = ratio > 0.5 ? "#44ff44" : ratio > 0.25 ? "#ffaa00" : "#ff2222";
        ctx.fillRect(m.x - barW / 2, m.y - 16 * layout.enemyScale, barW * ratio, barH);
      }
    } else if (m.type === "mirv_warhead") {
      ctx.save();
      m.trail.forEach((t, i) => {
        const a = (i / m.trail.length) * 0.4;
        ctx.fillStyle = `rgba(220,100,50,${a})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5 * layout.effectScale, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
      if (renderMode === "live") {
        drawLiveThreatSprite(ctx, m.x, m.y, angle, "mirv_warhead", { t, scale: layout.enemyScale });
      } else {
        drawBakedProjectileSprite(ctx, m.x, m.y, angle, spriteAssets!.mirv_warhead, { t, sharpFrames: true });
      }
    } else if (m.type === "bomb") {
      drawGradientTrail(ctx, m.trail, m.x, m.y, {
        outerRgb: "255,118,40",
        coreRgb: "255,214,156",
        headRgb: "255,150,72",
        width: 3.2 * layout.effectScale,
        coreWidth: 1.3 * layout.effectScale,
        headRadius: 1.6 * layout.effectScale,
      });
      if (renderMode === "live") drawLiveThreatSprite(ctx, m.x, m.y, angle, "bomb", { t, scale: layout.enemyScale });
      else drawBakedProjectileSprite(ctx, m.x, m.y, angle, spriteAssets!.bomb, { t, sharpFrames: true });
    } else if (m.type === "stack2" || m.type === "stack3" || m.type === "stack_child") {
      drawGradientTrail(ctx, m.trail, m.x, m.y, {
        outerRgb: "255,140,58",
        coreRgb: m.type === "stack_child" ? "255,231,184" : "238,228,216",
        headRgb: m.type === "stack_child" ? "255,180,92" : "255,214,148",
        width: (m.type === "stack3" ? 5.4 : m.type === "stack2" ? 4.8 : 3.2) * layout.effectScale,
        coreWidth: (m.type === "stack3" ? 2.2 : m.type === "stack2" ? 1.9 : 1.3) * layout.effectScale,
        headRadius: (m.type === "stack3" ? 2.2 : m.type === "stack2" ? 2 : 1.5) * layout.effectScale,
      });
      const kind = getThreatSpriteKind(m);
      if (renderMode === "live")
        drawLiveThreatSprite(ctx, m.x, m.y, angle, kind, { t, scale: layout.enemyScale, alpha: 0.98 });
      else drawBakedProjectileSprite(ctx, m.x, m.y, angle, spriteAssets![kind], { t, alpha: 0.98, sharpFrames: true });
    } else {
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
      if (renderMode === "live") drawLiveThreatSprite(ctx, m.x, m.y, angle, "missile", { t, scale: layout.enemyScale });
      else drawBakedProjectileSprite(ctx, m.x, m.y, angle, spriteAssets!.missile, { t, sharpFrames: true });
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

function drawDrones(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  layout: LayoutProfile,
  renderMode: SceneRenderMode,
  t: number,
) {
  const spriteAssets = renderMode === "live" ? null : getThreatSpriteAssets(layout.enemyScale);
  game.drones.forEach((d: Drone) => {
    const facing = d.vx > 0 ? 1 : -1;
    const trail = d.trail ?? [];
    const trailAngle = trail.length
      ? Math.atan2(d.y - trail[trail.length - 1].y, d.x - trail[trail.length - 1].x)
      : Math.atan2(d.vy || 0, d.vx || 1);
    const dirX = Math.cos(trailAngle);
    const dirY = Math.sin(trailAngle);
    const spriteAngle = d.subtype === "shahed238" || d.diving ? Math.atan2(d.vy, d.vx) : facing > 0 ? 0 : Math.PI;

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

    if (d.subtype === "shahed136") {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(spriteAngle);
      ctx.scale(layout.enemyScale, layout.enemyScale);
      drawShahed136Exhaust(ctx, { trailLength: trail.length, effectScale: layout.effectScale });
      ctx.restore();
    }

    const kind = getThreatSpriteKind(d);
    if (renderMode === "live") drawLiveThreatSprite(ctx, d.x, d.y, spriteAngle, kind, { t, scale: layout.enemyScale });
    else drawBakedProjectileSprite(ctx, d.x, d.y, spriteAngle, spriteAssets![kind], { t, sharpFrames: true });

    if (d.diving) {
      ctx.strokeStyle = "#ff2200";
      ctx.globalAlpha = 0.5 + Math.sin(game.time * 0.3) * 0.3;
      ctx.lineWidth = layout.effectScale;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 20 * layout.enemyScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (Math.sin(game.time * 0.15) > 0) {
      ctx.fillStyle = d.subtype === "shahed238" ? "#ff2200" : "#ff4400";
      glow(ctx, ctx.fillStyle, 2 * layout.effectScale);
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.75 * layout.effectScale * layout.enemyScale, 0, Math.PI * 2);
      ctx.fill();
      glowOff(ctx);
    }
  });
}

function drawInterceptors(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  layout: LayoutProfile,
  renderMode: SceneRenderMode,
  t: number,
) {
  const spriteAssets = renderMode === "live" ? null : getInterceptorSpriteAssets(layout.projectileScale);
  game.interceptors.forEach((ic: Interceptor) => {
    const heading =
      typeof ic.heading === "number"
        ? ic.heading
        : ic.trail.length >= 1
          ? Math.atan2(ic.y - ic.trail[ic.trail.length - 1].y, ic.x - ic.trail[ic.trail.length - 1].x)
          : Math.atan2(ic.vy || -1, ic.vx || 0);

    if (ic.fromF15) {
      ctx.beginPath();
      ic.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(150,200,255,${(i / Math.max(1, ic.trail.length)) * 0.6})`;
        ctx.lineWidth = 1.5 * layout.effectScale;
        if (i === 0) ctx.moveTo(t.x, t.y);
        else ctx.lineTo(t.x, t.y);
      });
      if (ic.trail.length > 1) ctx.stroke();
      const kind = getInterceptorSpriteKind(ic);
      if (renderMode === "live")
        drawLiveInterceptorSprite(ctx, ic.x, ic.y, heading, kind, { t, scale: layout.projectileScale });
      else drawBakedProjectileSprite(ctx, ic.x, ic.y, heading, spriteAssets![kind], { t, sharpFrames: true });
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

    if (renderMode === "live") {
      drawLiveInterceptorSprite(ctx, ic.x, ic.y, heading, "playerInterceptor", { t, scale: layout.projectileScale });
    } else {
      drawBakedProjectileSprite(ctx, ic.x, ic.y, heading, spriteAssets!.playerInterceptor, {
        t,
        sharpFrames: true,
      });
    }
  });
}

function drawUpgradeProjectiles(ctx: CanvasRenderingContext2D, game: GameState, layout: LayoutProfile) {
  const upgradeSprites = getUpgradeProjectileSpriteAssets(layout.projectileScale);
  const t = game.time / 60;

  // Wild Hornets
  game.hornets.forEach((h: Hornet) => {
    const heading =
      h.trail.length >= 1 ? Math.atan2(h.y - h.trail[h.trail.length - 1].y, h.x - h.trail[h.trail.length - 1].x) : 0;
    drawGradientTrail(ctx, h.trail, h.x, h.y, {
      outerRgb: "255,204,0",
      coreRgb: "255,248,176",
      headRgb: "255,220,92",
      width: 3 * layout.effectScale,
      coreWidth: 1.2 * layout.effectScale,
      headRadius: 1.7 * layout.effectScale,
    });
    glow(ctx, COL.hornet, 8 * layout.effectScale);
    drawBakedProjectileSprite(ctx, h.x, h.y, heading + Math.PI / 2, upgradeSprites.wildHornet, {
      t,
      sharpFrames: true,
    });
    glowOff(ctx);
  });

  // Roadrunners
  game.roadrunners.forEach((r: Roadrunner) => {
    drawGradientTrail(ctx, r.trail, r.x, r.y, {
      outerRgb: "68,170,255",
      coreRgb: "196,236,255",
      headRgb: "124,214,255",
      width: 3.8 * layout.effectScale,
      coreWidth: 1.5 * layout.effectScale,
      headRadius: 1.9 * layout.effectScale,
    });
    // Rotate to face direction of travel (default: pointing up during launch)
    let angle = 0;
    if (r.trail.length >= 2) {
      const prev = r.trail[r.trail.length - 1];
      angle = Math.atan2(r.y - prev.y, r.x - prev.x) + Math.PI / 2;
    }
    glow(ctx, COL.roadrunner, 10 * layout.effectScale);
    drawBakedProjectileSprite(ctx, r.x, r.y, angle, upgradeSprites.roadrunner, {
      t,
      sharpFrames: true,
    });
    glowOff(ctx);
  });

  // Patriot missiles
  game.patriotMissiles.forEach((p: PatriotMissile) => {
    ctx.beginPath();
    p.trail.forEach((tp, i) => {
      ctx.strokeStyle = `rgba(136,255,68,${(i / p.trail.length) * 0.7})`;
      ctx.lineWidth = 2.5 * layout.effectScale;
      if (i === 0) ctx.moveTo(tp.x, tp.y);
      else ctx.lineTo(tp.x, tp.y);
    });
    if (p.trail.length > 1) ctx.stroke();
    let pAngle = 0;
    if (p.trail.length >= 2) {
      const prev = p.trail[p.trail.length - 1];
      pAngle = Math.atan2(p.y - prev.y, p.x - prev.x) + Math.PI / 2;
    }
    glow(ctx, COL.patriot, 12 * layout.effectScale);
    drawBakedProjectileSprite(ctx, p.x, p.y, pAngle, upgradeSprites.patriotSam, {
      t,
      sharpFrames: true,
    });
    glowOff(ctx);
    // Live exhaust flame — pulses per missile, so stays out of the bake.
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pAngle);
    ctx.scale(layout.projectileScale, layout.projectileScale);
    const flameLen = 5 + 4 * pulse(game.time, 0.5, p.x * 0.02 + p.y * 0.015);
    ctx.fillStyle = "#ffaa22";
    ctx.beginPath();
    ctx.moveTo(-2, 8);
    ctx.lineTo(0, 8 + flameLen);
    ctx.lineTo(2, 8);
    ctx.fill();
    ctx.restore();
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

function drawGroundStructures(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  layout: LayoutProfile,
  renderMode: SceneRenderMode,
) {
  const scenicLauncherY = GAMEPLAY_SCENIC_LAUNCHER_Y;
  // Launchers
  LAUNCHERS.forEach((l, i) => {
    const launcherMaxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
    const damaged = launcherMaxHP === 2 && game.launcherHP[i] === 1;
    const launcherScale = 0.8 + layout.launcherScale * 0.06;
    const angle = Math.atan2(game.crosshairY - l.y, game.crosshairX - l.x);
    const barrelAngle = Math.min(-0.2, Math.max(angle, -Math.PI + 0.2));
    const fireTick = game.launcherFireTick ? game.launcherFireTick[i] : 0;
    const tickNow = game._replayTick || 0;
    const fireAge = tickNow - fireTick;
    const muzzleFlash = fireAge < 6 ? 1 - fireAge / 6 : 0;

    if (game.launcherHP[i] > 0) {
      if (renderMode === "live") {
        drawSharedLauncher(ctx, l.x, scenicLauncherY, barrelAngle, {
          t: game.time / 60,
          scale: launcherScale,
          damaged,
          active: true,
          muzzleFlash,
        });
      } else {
        drawBakedLauncher(ctx, l.x, scenicLauncherY, barrelAngle, getLauncherAssets(launcherScale, damaged), {
          t: game.time / 60,
          muzzleFlash,
          sharpFrames: true,
        });
      }
    } else {
      drawSharedLauncher(ctx, l.x, scenicLauncherY, barrelAngle, {
        t: game.time / 60,
        scale: launcherScale,
        active: false,
      });
    }

    if (game.launcherHP[i] <= 0) return;

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
    const siteAssets = getDefenseSiteAssets();
    turrets.forEach((t) => {
      drawBakedStaticSprite(ctx, t.x, t.y, siteAssets.phalanxBase);
      // Rotating barrel stays live.
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
    drawBakedStaticSprite(ctx, patX, patY, getDefenseSiteAssets().patriotTEL);
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
    const lvl = Math.max(1, Math.min(3, game.upgrades.wildHornets));
    drawBakedStaticSprite(ctx, hx, hy, getDefenseSiteAssets().wildHornetsHive[lvl - 1]);
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
    const lvl = Math.max(1, Math.min(3, game.upgrades.roadrunner));
    drawBakedStaticSprite(ctx, rrX, rrY, getDefenseSiteAssets().roadrunnerContainer[lvl - 1]);
    if (layout.showSystemLabels) {
      ctx.fillStyle = "rgba(68,170,255,0.6)";
      ctx.font = `10px ${ARCADE_FONT_FAMILY}`;
      ctx.fillText("ROADRUNNER", rrX - 25, rrY + 12);
    }
  }

  // Flare launcher — integrated dispensers near top of Burj
  if (game.upgrades.flare > 0) {
    const flareY = GROUND_Y - BURJ_H * 0.97;
    const lvl = Math.max(1, Math.min(3, game.upgrades.flare));
    drawBakedStaticSprite(ctx, BURJ_X, flareY, getDefenseSiteAssets().flareDispenser[lvl - 1]);
    // Warm glow when flares are launching stays live.
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
    const lvl = Math.max(1, Math.min(3, game.upgrades.emp));
    const nodeCount = lvl + 1;
    drawBakedStaticSprite(ctx, BURJ_X, empY, getDefenseSiteAssets().empEmitter[lvl - 1]);
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
      const def = UPGRADE_FAMILIES[site.key as keyof typeof UPGRADE_FAMILIES];
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
  vignette.addColorStop(0.68, "rgba(0,0,0,0.04)");
  vignette.addColorStop(1, `rgba(2,4,12,${ov("sky.vignetteAlpha", 0)})`);
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
    // Combo HUD box
    {
      const comboX = 430;
      const comboBoxW = 114;
      const comboBoxH = 36;
      const comboBoxY = 5;
      const active = game.combo >= 2;
      const comboColor = active
        ? game.combo >= 8
          ? "#ff3a18"
          : game.combo >= 5
            ? "#ff8800"
            : "#ffdd00"
        : "rgba(0,255,180,0.18)";
      const borderAlpha = active ? (game.combo >= 5 ? 0.9 : 0.55) : 0.22;
      // Box background
      ctx.fillStyle = active
        ? game.combo >= 8
          ? "rgba(80,12,4,0.72)"
          : game.combo >= 5
            ? "rgba(60,24,0,0.72)"
            : "rgba(40,36,0,0.72)"
        : "rgba(0,10,20,0.4)";
      ctx.beginPath();
      ctx.roundRect(comboX, comboBoxY, comboBoxW, comboBoxH, 4);
      ctx.fill();
      // Box border
      if (active && game.combo >= 5) glow(ctx, comboColor, 6 + (game.combo - 5) * 3);
      ctx.strokeStyle = active ? comboColor : "rgba(0,255,180,0.22)";
      ctx.globalAlpha = borderAlpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(comboX, comboBoxY, comboBoxW, comboBoxH, 4);
      ctx.stroke();
      if (active && game.combo >= 5) glowOff(ctx);
      ctx.globalAlpha = 1;
      // Label
      ctx.font = `bold 9px ${ARCADE_FONT_FAMILY}`;
      ctx.fillStyle = active ? comboColor : "rgba(0,255,180,0.3)";
      ctx.textAlign = "center";
      ctx.fillText("COMBO", comboX + comboBoxW / 2, comboBoxY + 11);
      // Value
      const valStr = active ? `${game.combo}\u00d7` : "1\u00d7";
      ctx.font = `bold ${active && game.combo >= 10 ? 18 : 16}px ${ARCADE_FONT_FAMILY}`;
      ctx.fillStyle = active ? comboColor : "rgba(0,255,180,0.28)";
      if (active && game.combo >= 5) glow(ctx, comboColor, 8 + (game.combo - 5) * 4);
      ctx.fillText(valStr, comboX + comboBoxW / 2, comboBoxY + 27);
      if (active && game.combo >= 5) glowOff(ctx);
      ctx.textAlign = "left";
      ctx.font = `bold 16px ${ARCADE_FONT_FAMILY}`;
    }
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
        const def = UPGRADE_FAMILIES[key as keyof typeof UPGRADE_FAMILIES];
        if (!def) return;
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.9;
        ctx.font = `14px ${ARCADE_FONT_FAMILY}`;
        ctx.fillText(`${def.icon}${level}`, ux, 23);
        ux += 44;
      });
      ctx.globalAlpha = 1;
    }
  }

  // Burn vignette at combo 5+
  if (game.combo >= 5) {
    const burnT = (game.combo - 5) / 5;
    const t = game.time / 60;
    const burnAlpha = 0.05 + burnT * 0.12 + Math.sin(t * 0.22) * 0.015;
    const burnVig = ctx.createRadialGradient(
      CANVAS_W / 2,
      CANVAS_H / 2,
      CANVAS_H * 0.3,
      CANVAS_W / 2,
      CANVAS_H / 2,
      CANVAS_H * 0.88,
    );
    burnVig.addColorStop(0, "rgba(0,0,0,0)");
    burnVig.addColorStop(0.6, `rgba(180, 40, 0, ${burnAlpha * 0.5})`);
    burnVig.addColorStop(1, `rgba(220, 60, 10, ${burnAlpha})`);
    ctx.fillStyle = burnVig;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  {
    showShop = false,
    layoutProfile = {} as Partial<LayoutProfile>,
    buildingAssets = null,
    renderMode = "bakedSharp",
  }: {
    showShop?: boolean;
    layoutProfile?: Partial<LayoutProfile>;
    buildingAssets?: BuildingAssets | null;
    renderMode?: SceneRenderMode;
  } = {},
) {
  const layout = resolveLayoutProfile(layoutProfile);
  const sceneTime = game.time / 60;
  const scenicGroundY = GAMEPLAY_SCENIC_GROUND_Y;
  const gameplayWaterlineY = GAMEPLAY_WATERLINE_Y;
  const resolvedBuildingAssets = renderMode === "live" ? null : (buildingAssets ?? getGameplayBuildingAssets());
  const burjAssets = renderMode === "live" ? null : getBurjAssets(scenicGroundY, 2);
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
    burjAssets,
    sharpFrames: renderMode === "bakedSharp",
  });
  drawGameplayForegroundBuildings(ctx, game, sceneTime, scenicGroundY, renderMode, resolvedBuildingAssets);
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
  ctx.rect(0, 0, CANVAS_W, gameplayWaterlineY);
  ctx.clip();
  drawMissiles(ctx, game, layout, renderMode, sceneTime);
  drawDrones(ctx, game, layout, renderMode, sceneTime);
  drawInterceptors(ctx, game, layout, renderMode, sceneTime);
  drawUpgradeProjectiles(ctx, game, layout);
  ctx.restore();
  drawExplosionsAndParticles(ctx, game, layout);
  drawGroundStructures(ctx, game, layout, renderMode);
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

  // Waterline fallback collider
  ctx.strokeStyle = "#66ccff";
  ctx.beginPath();
  ctx.moveTo(0, GAMEPLAY_WATERLINE_Y);
  ctx.lineTo(CANVAS_W, GAMEPLAY_WATERLINE_Y);
  ctx.stroke();

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
    ctx.arc(d.x, d.y, d.collisionRadius, 0, Math.PI * 2);
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

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  {
    layoutProfile = {} as Partial<LayoutProfile>,
    skylineRenderMode = "bakedSharp",
  }: {
    layoutProfile?: Partial<LayoutProfile>;
    skylineRenderMode?: TitleSkylineRenderMode;
  } = {},
) {
  const layout = resolveLayoutProfile(layoutProfile);
  const t = performance.now() / 1000;
  const cx = CANVAS_W / 2;
  const titleGroundY = GROUND_Y - 100;
  const titleTowerBaseY = titleGroundY - 6;
  const burjAssets = skylineRenderMode === "live" ? null : getBurjAssets(titleGroundY, 2);
  drawSharedSky(ctx, { mode: "title", renderHeight: CANVAS_H, groundY: titleGroundY }, t);
  ctx.textAlign = "center";

  const titleFlicker = 0.95 + 0.03 * Math.sin(t * 2.875) + 0.015 * Math.sin(t * 7.925 + 0.5);
  const titleFlickerSoft = 0.96 + 0.02 * Math.sin(t * 2.425 + 1.4) + 0.01 * Math.sin(t * 6.775);

  if (skylineRenderMode === "live") {
    TITLE_SKYLINE_TOWERS.forEach((tower, i) =>
      drawSharedTower(ctx, tower, titleTowerBaseY, t, Math.sin(t * 0.05 + i * 0.8) * 1.35, 1),
    );
  } else {
    const titleBuildingAssets = getTitleBuildingAssets(titleTowerBaseY);
    const sharpFrames = skylineRenderMode === "bakedSharp";

    TITLE_SKYLINE_TOWERS.forEach((tower, i) => {
      const playbackSeed = hash01(tower.x, tower.w, tower.h, i + 1);
      const playbackRate =
        1 - TITLE_BUILDING_PLAYBACK_RATE_JITTER * 0.5 + playbackSeed * TITLE_BUILDING_PLAYBACK_RATE_JITTER;
      const phaseOffset = playbackSeed * TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const phase =
        (((t * playbackRate + phaseOffset) % TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS) +
          TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS) /
        TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const frameIndex = Math.floor(phase * titleBuildingAssets.frameCount) % titleBuildingAssets.frameCount;
      const slotProgress = (phase * titleBuildingAssets.frameCount) % 1;
      const blendStart = 1 - TITLE_BUILDING_BLEND_WINDOW;
      const blend =
        slotProgress <= blendStart ? 0 : Math.min(1, (slotProgress - blendStart) / TITLE_BUILDING_BLEND_WINDOW);
      const driftX = Math.round(Math.sin(t * 0.05 + i * 0.8) * 1.35);
      const staticSprite = titleBuildingAssets.staticSprites[i];
      const anim = titleBuildingAssets.animFrames[i];
      const staticOffset = titleBuildingAssets.staticOffsets[i];
      const animOffset = titleBuildingAssets.animOffsets[i];

      ctx.drawImage(staticSprite, staticOffset.x + driftX, staticOffset.y);
      if (sharpFrames) {
        ctx.globalAlpha = TITLE_BUILDING_ANIM_ALPHA;
        ctx.drawImage(anim[frameIndex], animOffset.x + driftX, animOffset.y);
      } else {
        ctx.globalAlpha = TITLE_BUILDING_ANIM_ALPHA * (1 - blend);
        ctx.drawImage(anim[frameIndex], animOffset.x + driftX, animOffset.y);
        ctx.globalAlpha = TITLE_BUILDING_ANIM_ALPHA * blend;
        ctx.drawImage(anim[(frameIndex + 1) % titleBuildingAssets.frameCount], animOffset.x + driftX, animOffset.y);
      }
      ctx.globalAlpha = 1;
    });
  }

  drawSharedBurj(ctx, {
    mode: "title",
    groundY: titleGroundY,
    alive: true,
    artScale: 2,
    t,
    burjAssets,
    sharpFrames: skylineRenderMode === "bakedSharp",
  });

  // Waterfront strip and reflections
  const waterTop = titleGroundY + WATER_SURFACE_OFFSET;
  const waterBottom = CANVAS_H;
  ctx.save();
  const titleWaterImg = getTitleWaterImage();
  if (titleWaterImg) {
    drawDistortedWaterSprite(ctx, titleWaterImg, 0, waterTop, CANVAS_W + 10, waterBottom - waterTop, t);

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
      { x: BURJ_X, w: 34, alpha: 0.36, color: "250,248,240" },
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
    ctx.fillRect(BURJ_X - 18, waterTop + 2, 36, 3);
  }
  ctx.restore();

  // Launcher silhouettes — delegate to shared renderer
  function drawTitleLauncher(lx: number, ly: number, barrelAngle: number, alpha = 1) {
    if (skylineRenderMode === "live") {
      drawSharedLauncher(ctx, lx, ly, barrelAngle, {
        t,
        scale: 1,
        alpha,
        damaged: false,
        active: true,
        muzzleFlash: 0,
      });
      return;
    }
    drawBakedLauncher(ctx, lx, ly, barrelAngle, getLauncherAssets(1, false), {
      t,
      alpha,
      muzzleFlash: 0,
      sharpFrames: skylineRenderMode === "bakedSharp",
    });
  }

  // Barrel base angles: left launcher points up-right, center straight up, right up-left
  const titleLauncherAngles = [-1.1, -1.57, -2.05];
  LAUNCHERS.forEach((l, i) => {
    const sweep = Math.sin(t * 0.45 + i * 1.2) * 0.18;
    const angle = Math.min(-0.25, Math.max(titleLauncherAngles[i] + sweep, -Math.PI + 0.25));
    drawTitleLauncher(l.x, l.y - 105, angle, 0.92);
  });

  const titleAircraft: Array<{ kind: "shahed" | "missile"; x: number; y: number; scale: number }> = [
    { kind: "shahed", x: 125, y: 520, scale: layout.enemyScale },
    { kind: "shahed", x: 100, y: 620, scale: layout.enemyScale },
    { kind: "shahed", x: 150, y: 800, scale: layout.enemyScale },
    { kind: "missile", x: 775, y: 520, scale: layout.enemyScale },
    { kind: "missile", x: 800, y: 620, scale: layout.enemyScale },
    { kind: "missile", x: 750, y: 800, scale: layout.enemyScale },
  ];
  const titleTargetX = BURJ_X;
  const titleTargetY = titleGroundY - 6 - BURJ_H + 18;
  const titleThreatSprites = skylineRenderMode === "live" ? null : getThreatSpriteAssets(layout.enemyScale);
  titleAircraft.forEach((obj, index) => {
    const x = obj.x;
    const y = obj.y;
    const aimAngle = Math.atan2(titleTargetY - y, titleTargetX - x);
    ctx.save();
    ctx.strokeStyle = obj.kind === "shahed" ? "rgba(255, 210, 150, 0.1)" : "rgba(210, 220, 230, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(titleTargetX, titleTargetY);
    ctx.stroke();
    ctx.restore();
    const titleTime = getTitleThreatAnimationTime(t, obj.kind, index);
    if (obj.kind === "shahed") {
      const shahedAngle = aimAngle + 0.08;
      const trailPulse = pulse(t, 7.2, index * 1.6, 0.82, 1.16);
      const titleDroneTrail = Array.from({ length: 10 }, (_, trailIndex) => ({
        x: x - Math.cos(shahedAngle) * (trailIndex + 1) * 9 * trailPulse,
        y: y - Math.sin(shahedAngle) * (trailIndex + 1) * 9 * trailPulse,
      }));
      drawGradientTrail(ctx, titleDroneTrail, x, y, {
        outerRgb: "136,144,152",
        coreRgb: "196,204,212",
        headRgb: "196,170,118",
        width: (2.2 + trailPulse * 0.5) * layout.effectScale,
        coreWidth: (0.82 + trailPulse * 0.28) * layout.effectScale,
        headRadius: (1 + trailPulse * 0.22) * layout.effectScale,
      });
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(shahedAngle);
      ctx.scale(obj.scale, obj.scale);
      drawShahed136Exhaust(ctx, { trailLength: 8 + trailPulse * 4, effectScale: layout.effectScale });
      ctx.restore();
      if (skylineRenderMode === "live") {
        drawLiveThreatSprite(ctx, x, y, shahedAngle, "shahed136", { t: titleTime, scale: obj.scale });
      } else {
        drawBakedProjectileSprite(ctx, x, y, shahedAngle, titleThreatSprites!.shahed136, {
          t: titleTime,
          sharpFrames: skylineRenderMode === "bakedSharp",
        });
      }
      drawTitleShahedBeacon(ctx, x, y, obj.scale, t, index);
    } else {
      const missileAngle = aimAngle + 0.04;
      const titleMissileTrail = Array.from({ length: 10 }, (_, trailIndex) => ({
        x: x - Math.cos(missileAngle) * (trailIndex + 1) * 7,
        y: y - Math.sin(missileAngle) * (trailIndex + 1) * 7,
      }));
      drawGradientTrail(ctx, titleMissileTrail, x, y, {
        outerRgb: "112,126,148",
        coreRgb: "208,220,232",
        headRgb: "255,188,92",
        width: 2.4 * layout.effectScale,
        coreWidth: 1 * layout.effectScale,
        headRadius: 1.2 * layout.effectScale,
      });
      if (skylineRenderMode === "live") {
        drawLiveThreatSprite(ctx, x, y, missileAngle, "missile", { t: titleTime, scale: obj.scale });
      } else {
        drawBakedProjectileSprite(ctx, x, y, missileAngle, titleThreatSprites!.missile, {
          t: titleTime,
          sharpFrames: skylineRenderMode === "bakedSharp",
        });
      }
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

interface CanvasGameRendererOptions {
  canvas: HTMLCanvasElement;
  layoutProfile?: Partial<LayoutProfile>;
}

export class CanvasGameRenderer implements GameRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layoutProfile: Partial<LayoutProfile>;
  private titleRenderMode: TitleSkylineRenderMode = "bakedSharp";
  private gameplayRenderMode: SceneRenderMode = "bakedSharp";

  constructor({ canvas, layoutProfile = {} }: CanvasGameRendererOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to acquire a 2D rendering context for the main game canvas");
    }
    this.ctx = ctx;
    this.layoutProfile = layoutProfile;
  }

  renderTitle(): void {
    drawTitle(this.ctx, { layoutProfile: this.layoutProfile, skylineRenderMode: this.titleRenderMode });
  }

  renderGameplay(game: GameState, { showShop = false } = {}): void {
    drawGame(this.ctx, game, {
      showShop,
      layoutProfile: this.layoutProfile,
      renderMode: this.gameplayRenderMode,
    });
  }

  renderGameOver(snapshot: GameOverSnapshot): void {
    drawGameOver(this.ctx, snapshot.score, snapshot.wave, snapshot.stats, {
      layoutProfile: this.layoutProfile,
    });
  }

  resize(): void {
    // Fixed-resolution canvas for now; the composition root owns future resize policy.
  }

  destroy(): void {
    // Canvas2D path does not own disposable renderer resources yet.
  }

  toggleTitleRenderMode(): void {
    this.titleRenderMode = this.titleRenderMode === "live" ? "bakedSharp" : "live";
  }

  toggleGameplayRenderMode(): void {
    this.gameplayRenderMode = this.gameplayRenderMode === "live" ? "bakedSharp" : "live";
  }

  isTitleRenderLive(): boolean {
    return this.titleRenderMode === "live";
  }

  isGameplayRenderLive(): boolean {
    return this.gameplayRenderMode === "live";
  }
}
