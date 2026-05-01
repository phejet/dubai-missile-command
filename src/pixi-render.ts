import { Application, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { TrailBatch } from "./pixi-trails";
import { DEFAULT_GAMEPLAY_LAUNCHER_SCALE, TITLE_SKYLINE_TOWERS } from "./canvas-render-resources";
import {
  BURJ_H,
  BURJ_X,
  CANVAS_H,
  CANVAS_W,
  COL,
  GAMEPLAY_SCENIC_GROUND_Y,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  GAMEPLAY_WATERLINE_Y,
  GROUND_Y,
  LAUNCHERS,
  WATER_SURFACE_OFFSET,
  getDefenseSitePlacement,
  getGameplayBuildingBounds,
  getGameplayBurjCollisionTop,
  getGameplayBurjHalfW,
  getGameplayLauncherPosition,
  getPhalanxTurrets,
  ov,
} from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameplayRenderRequest } from "./game-renderer";
import { PIXI_PNG_ASSET_KEYS, loadPixiPngBundles, type PixiPngAssetMap } from "./pixi-assets";
import { UPGRADE_FAMILIES } from "./game-sim-upgrades";
import {
  createPixiTextureResources,
  type PixiBuildingAssets,
  type PixiBurjAssets,
  type PixiDefenseSiteAssets,
  type PixiEffectSpriteAssets,
  type PixiInterceptorSpriteAssets,
  type PixiLauncherAssets,
  type PixiPlaneAssets,
  type PixiProjectileSpriteAsset,
  type PixiSkyAssets,
  type PixiStaticSpriteAsset,
  type PixiTextureResources,
  type PixiThreatSpriteAssets,
  type PixiUpgradeProjectileSpriteAssets,
} from "./pixi-textures";
import type {
  DefenseSite,
  Drone,
  Explosion,
  Flare,
  GameState,
  Hornet,
  Interceptor,
  Missile,
  PatriotMissile,
  Plane,
  Roadrunner,
  TrailPoint,
} from "./types";

type PixiScreen = "title" | "playing" | "gameover";
type TitleThreatKind = "shahed" | "missile";

interface PixiRendererOptions {
  textures?: PixiTextureResources;
}

interface BlendSprites {
  primary: Sprite;
  secondary: Sprite;
}

interface TitleBuildingNode {
  container: Container;
  anim: BlendSprites;
  playbackSeed: number;
}

interface TitleLauncherNode {
  container: Container;
  chassis: BlendSprites;
  turretRoot: Container;
  muzzleLight: Graphics;
}

interface TitleThreatNode {
  container: Container;
  trail: Graphics;
  beacon: Graphics;
  anim: BlendSprites;
  kind: TitleThreatKind;
  x: number;
  y: number;
}

export interface PixiWaterBand {
  sprite: Sprite;
  index: number;
  baseY: number;
  baseWidth: number;
  baseHeight: number;
}

export interface PixiWaterSurface {
  container: Container;
  bands: PixiWaterBand[];
}

export interface PixiBurjBeaconLayout {
  stemX: number;
  stemY: number;
  stemWidth: number;
  stemHeight: number;
  glowX: number;
  glowY: number;
}

interface TitleSceneState {
  skyAssets: PixiSkyAssets;
  skyBlend: BlendSprites;
  nebula: Sprite | null;
  buildingAssets: PixiBuildingAssets;
  buildings: TitleBuildingNode[];
  burjAssets: PixiBurjAssets;
  burjGlow: Sprite | null;
  burjAnim: BlendSprites;
  beaconStem: Graphics;
  beaconGlow: Graphics;
  launchers: TitleLauncherNode[];
  launcherAssets: PixiLauncherAssets;
  threats: TitleThreatNode[];
  threatAssets: PixiThreatSpriteAssets;
  water: PixiWaterSurface | null;
  waterShade: Graphics;
  ambientMarkers: Graphics[];
}

interface GameplayBuildingNode {
  container: Container;
  staticSprite: Sprite;
  anim: BlendSprites;
  rubble: Graphics;
  playbackSeed: number;
}

interface GameplayBurjNode {
  container: Container;
  staticSprite: Sprite;
  anim: BlendSprites;
  damageUnderlay: Graphics;
  decalLayer: Container;
  damageFxLayer: Container;
  hitFlashGlow: Sprite;
  hitFlash: Graphics;
  wreckage: Graphics;
  beaconStem: Graphics;
  beaconGlow: Graphics;
  groundDecor: Container;
  decals: Map<number, Sprite>;
  damageFx: Map<number, Graphics>;
}

interface GameplayLauncherNode {
  container: Container;
  chassisStatic: Sprite;
  chassis: BlendSprites;
  turretRoot: Container;
  turret: Sprite;
  muzzleFlash: Graphics;
  muzzleLight: Graphics;
  hpPips: Graphics;
  wreckage: Graphics;
  damaged: boolean;
}

interface GameplayDefenseSiteNode {
  container: Container;
  sprite: Sprite;
  overlay: Graphics;
}

interface GameplayProjectileNode {
  container: Container;
  trail: Graphics;
  spriteRoot: Container;
  anim: BlendSprites;
  overlay: Graphics;
}

interface GameplayPlaneNode {
  container: Container;
  airframe: Sprite;
  liveFx: Graphics;
}

interface GameplayFlareNode {
  container: Container;
  trail: Graphics;
  glow: Graphics;
}

interface GameplayExplosionNode {
  container: Container;
  light: Sprite;
  splash: Sprite;
  fireball: Sprite;
  core: Sprite;
  ring: Sprite;
  link: Graphics;
}

interface GameplayEmpRingNode {
  container: Container;
  flash: Graphics;
  wash: Sprite;
  ring: Sprite;
}

// Step 5 pooling audit:
// - missiles, drones, interceptors, hornets, roadrunners, patriotMissiles, planes, flares, explosions:
//   object-identity pooled because sim references survive across ticks and Pixi nodes carry mutable render state.
// - particles, phalanxBullets, laserBeams: rebuild each frame through local Graphics pools because they are
//   dense, short-lived, and identity-free.
// - trail polylines: rebuilt inside the owning pooled node; segment identity would be render bookkeeping theatre.
// ParticleContainer remains deferred until particle/bullet textures are baked, otherwise we'd merely batch wishful thinking.
interface GameplayDynamicState {
  threatAssets: PixiThreatSpriteAssets;
  interceptorAssets: PixiInterceptorSpriteAssets;
  upgradeProjectileAssets: PixiUpgradeProjectileSpriteAssets;
  planeAssets: PixiPlaneAssets;
  effectAssets: PixiEffectSpriteAssets;
  missiles: Map<Missile, GameplayProjectileNode>;
  drones: Map<Drone, GameplayProjectileNode>;
  interceptors: Map<Interceptor, GameplayProjectileNode>;
  hornets: Map<Hornet, GameplayProjectileNode>;
  roadrunners: Map<Roadrunner, GameplayProjectileNode>;
  patriotMissiles: Map<PatriotMissile, GameplayProjectileNode>;
  planes: Map<Plane, GameplayPlaneNode>;
  flares: Map<Flare, GameplayFlareNode>;
  explosions: Map<Explosion, GameplayExplosionNode>;
  empRingPool: GameplayEmpRingNode[];
  laserPool: Sprite[];
  phalanxPool: Sprite[];
  particlePool: Graphics[];
  trailBatch: TrailBatch;
}

interface GameplaySceneState {
  skyAssets: PixiSkyAssets | null;
  skyBlend: BlendSprites;
  nebula: Sprite | null;
  buildingAssets: PixiBuildingAssets;
  buildings: GameplayBuildingNode[];
  burjAssets: PixiBurjAssets;
  burj: GameplayBurjNode;
  launcherAssets: {
    intact: PixiLauncherAssets;
    damaged: PixiLauncherAssets;
  };
  launchers: GameplayLauncherNode[];
  defenseSiteAssets: PixiDefenseSiteAssets;
  defenseSiteNodes: Map<string, GameplayDefenseSiteNode>;
  defenseStatusOverlay: Graphics;
  burjWarningPlate: Graphics;
  crosshairOverlay: Graphics;
  upgradeRangeOverlay: Graphics;
  collisionOverlay: Graphics;
  water: PixiWaterSurface | null;
  waterShade: Graphics;
  dynamic: GameplayDynamicState;
}

interface GameOverSceneState {
  sky: Sprite;
  nebula: Sprite | null;
  buildings: Container[];
  burj: Container;
  water: PixiWaterSurface | null;
  waterShade: Graphics;
  launchers: Container[];
  defenseSites: Container[];
  damageWash: Graphics;
  embers: Graphics[];
}

function isMobileDevice(): boolean {
  if (typeof navigator !== "undefined" && /\bCapacitor\b/i.test(navigator.userAgent)) return true;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(pointer: coarse)").matches;
  }
  return false;
}

const TITLE_GROUND_Y = GROUND_Y - 100;
const TITLE_TOWER_BASE_Y = TITLE_GROUND_Y - 6;
const TITLE_WATER_TOP = TITLE_GROUND_Y + WATER_SURFACE_OFFSET;
const GAMEPLAY_TOWER_BASE_Y = GAMEPLAY_SCENIC_GROUND_Y - 6;
const GAMEPLAY_WATER_TOP = GAMEPLAY_SCENIC_GROUND_Y + WATER_SURFACE_OFFSET;
const GAMEPLAY_BUILDING_BLEND_WINDOW = 0.18;
const GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS = 20;
const GAMEPLAY_BUILDING_ANIM_ALPHA = 0.58;
const GAMEPLAY_LAUNCHER_SCALE = DEFAULT_GAMEPLAY_LAUNCHER_SCALE;
const GAMEPLAY_ENEMY_SCALE = 3;
const GAMEPLAY_PROJECTILE_SCALE = 2;
const GAMEPLAY_EFFECT_SCALE = 2;
const GAMEPLAY_PLANE_SCALE = 3;
const GAMEPLAY_FLARE_VISUAL_Y = GROUND_Y - BURJ_H * 0.97;
const GAMEPLAY_EMP_VISUAL_Y = GROUND_Y - BURJ_H * 0.67;
const GAMEOVER_GROUND_Y = 560;
const GAMEOVER_TOWER_BASE_Y = GAMEOVER_GROUND_Y - 6;
const GAMEOVER_WATER_TOP = GAMEOVER_GROUND_Y + 18;
const TITLE_TARGET_X = BURJ_X;
const TITLE_TARGET_Y = TITLE_TOWER_BASE_Y - BURJ_H + 18;
const TITLE_BUILDING_BLEND_WINDOW = 0.18;
const TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS = 4;
const TITLE_BUILDING_ANIM_ALPHA = 0.58;
const TITLE_BUILDING_PLAYBACK_RATE_JITTER = 0.24;
const TITLE_SHAHED_TIME_STAGGER_SECONDS = 7 / 60;
const TITLE_MISSILE_TIME_STAGGER_SECONDS = 5 / 60;
const TITLE_SHAHED_TIME_RATE = 1.8;
const TITLE_MISSILE_TIME_RATE = 2.4;
const WATER_BAND_HEIGHT = 12;
const WATER_HORIZONTAL_BLEED = 8;
const WATER_DISTORTION_AMPLITUDE = 3.1;
const TITLE_LAUNCHER_ANGLES = [-1.1, -1.57, -2.05] as const;
const TITLE_AIRCRAFT: ReadonlyArray<{ kind: TitleThreatKind; x: number; y: number; scale: number }> = [
  { kind: "shahed", x: 125, y: 520, scale: 3 },
  { kind: "shahed", x: 100, y: 620, scale: 3 },
  { kind: "shahed", x: 150, y: 800, scale: 3 },
  { kind: "missile", x: 775, y: 520, scale: 3 },
  { kind: "missile", x: 800, y: 620, scale: 3 },
  { kind: "missile", x: 750, y: 800, scale: 3 },
];

function hash01(a: number, b = 0, c = 0, d = 0): number {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

function createBlendSprites(initialTexture: Texture): BlendSprites {
  const primary = new Sprite(initialTexture);
  const secondary = new Sprite(initialTexture);
  secondary.alpha = 0;
  return { primary, secondary };
}

export function getPixiWaterBandTransform(timeSeconds: number, index: number) {
  const seedA = 0.5 + 0.5 * Math.sin(index * 17.231 + 0.8);
  const seedB = 0.5 + 0.5 * Math.sin(index * 9.173 + 2.4);
  const seedC = 0.5 + 0.5 * Math.sin(index * 23.417 + 4.1);
  const swell = 0.68 + 0.32 * Math.sin(timeSeconds * (0.42 + seedC * 0.18) + index * 0.11 + seedB * 5.2);
  const drift = Math.sin(timeSeconds * (0.72 + seedA * 0.42) + index * (0.18 + seedB * 0.16) + seedC * 6.28);
  const chop = Math.sin(timeSeconds * (1.65 + seedB * 0.95) + index * (0.43 + seedC * 0.31) + seedA * 6.28);
  const micro = Math.sin(timeSeconds * (3.4 + seedC * 1.4) + index * (0.94 + seedA * 0.42) + seedB * 6.28);
  const wave = (drift * 0.74 + chop * 0.28 * swell + micro * 0.09) * WATER_DISTORTION_AMPLITUDE;
  const stretch = 1 + (drift * 0.0055 + chop * 0.004 + micro * 0.002);
  return { wave, stretch };
}

function createPixiWaterSurface(texture: Texture, width: number, height: number): PixiWaterSurface {
  const container = new Container();
  const bands: PixiWaterBand[] = [];
  const bandTextures: Texture[] = [];
  const srcW = Math.max(1, Math.round(texture.width));
  const srcH = Math.max(1, Math.round(texture.height));
  const bandsCount = Math.max(1, Math.ceil(height / WATER_BAND_HEIGHT));

  for (let i = 0; i < bandsCount; i++) {
    const destY = i * WATER_BAND_HEIGHT;
    const destH = Math.min(WATER_BAND_HEIGHT + 1, height - destY);
    if (destH <= 0.5) continue;

    const srcY = Math.min(srcH - 1, Math.round((i / bandsCount) * srcH));
    const nextSrcY = Math.min(srcH, Math.max(srcY + 1, Math.round(((i + 1) / bandsCount) * srcH)));
    const bandTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(0, srcY, srcW, nextSrcY - srcY),
    });
    bandTextures.push(bandTexture);
    const sprite = new Sprite(bandTexture);
    sprite.position.set(-WATER_HORIZONTAL_BLEED, destY);
    sprite.width = width + WATER_HORIZONTAL_BLEED * 2;
    sprite.height = destH;
    sprite.alpha = 0.97 - (i / bandsCount) * 0.04;
    container.addChild(sprite);
    bands.push({
      sprite,
      index: i,
      baseY: destY,
      baseWidth: width + WATER_HORIZONTAL_BLEED * 2,
      baseHeight: destH,
    });
  }

  container.once("destroyed", () => {
    bandTextures.forEach((bandTexture) => {
      if (!bandTexture.destroyed) bandTexture.destroy(false);
    });
  });

  return { container, bands };
}

function updatePixiWaterSurface(surface: PixiWaterSurface, timeSeconds: number, alpha: number): void {
  surface.bands.forEach((band) => {
    const { wave, stretch } = getPixiWaterBandTransform(timeSeconds, band.index);
    band.sprite.position.set(-WATER_HORIZONTAL_BLEED + wave - (band.baseWidth * (stretch - 1)) / 2, band.baseY);
    band.sprite.width = band.baseWidth * stretch;
    band.sprite.height = band.baseHeight;
    band.sprite.alpha = alpha * (0.97 - (band.index / surface.bands.length) * 0.04);
  });
}

export function __createPixiWaterSurfaceForTest(texture: Texture, width: number, height: number): PixiWaterSurface {
  return createPixiWaterSurface(texture, width, height);
}

export function __updatePixiWaterSurfaceForTest(surface: PixiWaterSurface, timeSeconds: number, alpha: number): void {
  updatePixiWaterSurface(surface, timeSeconds, alpha);
}

function positionBlendSprites(blend: BlendSprites, x: number, y: number): void {
  blend.primary.position.set(x, y);
  blend.secondary.position.set(x, y);
}

function syncBlendSprites(
  blend: BlendSprites,
  frames: Texture[],
  frameProgress: number,
  alpha = 1,
  sharpFrames = false,
): void {
  const frameCount = Math.max(1, frames.length);
  const frameIndex = Math.floor(frameProgress) % frameCount;
  const nextIndex = (frameIndex + 1) % frameCount;
  const blendAmount = frameProgress % 1;

  blend.primary.texture = frames[frameIndex] ?? Texture.EMPTY;
  blend.primary.alpha = alpha * (sharpFrames ? 1 : 1 - blendAmount);
  blend.secondary.texture = frames[nextIndex] ?? Texture.EMPTY;
  blend.secondary.alpha = sharpFrames ? 0 : alpha * blendAmount;
}

function getFrameProgress(timeSeconds: number, period: number, frameCount: number): number {
  const normalizedTime = (((timeSeconds % period) + period) % period) / period;
  return normalizedTime * Math.max(1, frameCount);
}

function getTitleThreatAnimationTime(timeSeconds: number, kind: TitleThreatKind, index: number): number {
  if (kind === "shahed") {
    return timeSeconds * TITLE_SHAHED_TIME_RATE + index * TITLE_SHAHED_TIME_STAGGER_SECONDS;
  }
  return timeSeconds * TITLE_MISSILE_TIME_RATE + index * TITLE_MISSILE_TIME_STAGGER_SECONDS;
}

function getTitleShahedBeaconAlpha(timeSeconds: number, index: number): number {
  const wave = Math.sin(timeSeconds * 9 + index * 1.35);
  return wave > 0 ? 0.42 + wave * 0.48 : 0;
}

function getTitleShahedTrailPulse(timeSeconds: number, index: number): number {
  return 0.82 + (0.5 + 0.5 * Math.sin(timeSeconds * 7.2 + index * 1.6)) * 0.34;
}

function createRect(fill: number, alpha: number, x: number, y: number, width: number, height: number): Graphics {
  const graphic = new Graphics();
  graphic.rect(x, y, width, height).fill(fill);
  graphic.alpha = alpha;
  return graphic;
}

export function getPixiBurjBeaconLayout(towerBaseY: number, artScale = 2): PixiBurjBeaconLayout {
  const scaleFromBurjAnchor = (value: number) => towerBaseY + (value - towerBaseY) * artScale;
  return {
    stemX: BURJ_X - 0.7 * artScale,
    stemY: scaleFromBurjAnchor(towerBaseY - BURJ_H - 50),
    stemWidth: 1.4 * artScale,
    stemHeight: 10 * artScale,
    glowX: BURJ_X,
    glowY: scaleFromBurjAnchor(towerBaseY - BURJ_H - 46),
  };
}

export function createBurjBeaconGlow(x: number, y: number): Graphics {
  const graphic = new Graphics();
  graphic
    .circle(0, 0, 13)
    .fill({ color: 0xff3b22, alpha: 0.2 })
    .circle(0, 0, 7)
    .fill({ color: 0xff5c40, alpha: 0.55 })
    .circle(0, 0, 2.8)
    .fill({ color: 0xfff0dc, alpha: 0.95 });
  graphic.position.set(x, y);
  graphic.alpha = 0;
  return graphic;
}

let burjHitFlashTexture: Texture | null = null;

function getBurjHitFlashTexture(): Texture {
  if (burjHitFlashTexture) return burjHitFlashTexture;
  if (typeof document === "undefined") return Texture.WHITE;

  const size = 192;
  const center = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;

  const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, "rgba(255,252,244,1)");
  glow.addColorStop(0.24, "rgba(255,214,142,0.96)");
  glow.addColorStop(0.56, "rgba(255,112,52,0.74)");
  glow.addColorStop(0.82, "rgba(255,76,34,0.22)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  burjHitFlashTexture = Texture.from(canvas);
  return burjHitFlashTexture;
}

function createGameplayBurjDamageMask(): Graphics {
  const mask = new Graphics();
  const topY = getGameplayBurjCollisionTop(2);
  const baseY = GAMEPLAY_SCENIC_GROUND_Y - 6;
  mask.moveTo(0, (topY - GAMEPLAY_TOWER_BASE_Y) / 2);
  for (let y = topY + 8; y <= baseY; y += 14) {
    mask.lineTo(getGameplayBurjHalfW(y, 2) / 2, (y - GAMEPLAY_TOWER_BASE_Y) / 2);
  }
  for (let y = baseY; y >= topY + 8; y -= 14) {
    mask.lineTo(-getGameplayBurjHalfW(y, 2) / 2, (y - GAMEPLAY_TOWER_BASE_Y) / 2);
  }
  mask.closePath().fill(0xffffff);
  return mask;
}

function cssHexToNumber(color: string | undefined, fallback: number): number {
  if (!color) return fallback;
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return Number.parseInt(trimmed.slice(1), 16);
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split("");
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
  }
  return fallback;
}

function cssColorToNumber(color: string | undefined, fallback: number): number {
  if (!color) return fallback;
  const hex = cssHexToNumber(color, Number.NaN);
  if (Number.isFinite(hex)) return hex;
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return fallback;
  return ((Number(rgb[1]) & 255) << 16) | ((Number(rgb[2]) & 255) << 8) | (Number(rgb[3]) & 255);
}

const COLOR_HEX_CACHE = new Map<string, number>();

function memoCssColorToNumber(color: string | undefined, fallback: number): number {
  if (!color) return fallback;
  const cached = COLOR_HEX_CACHE.get(color);
  if (cached !== undefined) return cached;
  const parsed = cssColorToNumber(color, fallback);
  COLOR_HEX_CACHE.set(color, parsed);
  return parsed;
}

function pulse(time: number, speed: number, phase = 0, min = 0, max = 1): number {
  const t = 0.5 + 0.5 * Math.sin(time * speed + phase);
  return min + (max - min) * t;
}

function requireDefenseSitePlacement(key: string): { x: number; y: number; hw: number; hh: number } {
  const placement = getDefenseSitePlacement(key);
  if (!placement) throw new Error(`Missing defense-site placement for ${key}`);
  return placement;
}

const GAMEPLAY_DEFENSE_SITE_PLACEMENTS = {
  patriot: requireDefenseSitePlacement("patriot"),
  wildHornets: requireDefenseSitePlacement("wildHornets"),
  roadrunner: requireDefenseSitePlacement("roadrunner"),
} as const;

const COL_HEX = {
  patriot: cssHexToNumber(COL.patriot, 0x88ff44),
  hornet: cssHexToNumber(COL.hornet, 0xffcc00),
  roadrunner: cssHexToNumber(COL.roadrunner, 0x44aaff),
  flare: cssHexToNumber(COL.flare, 0xff8833),
  emp: cssHexToNumber(COL.emp, 0xcc44ff),
  phalanx: cssHexToNumber(COL.phalanx, 0xff8844),
  laser: cssColorToNumber(COL.laser, 0x66ddff),
} as const;

const UPGRADE_FAMILY_COLOR_HEX = new Map(
  Object.entries(UPGRADE_FAMILIES).map(([key, upgrade]) => [key, cssHexToNumber(upgrade.color, 0x44ffaa)]),
);

function createStaticAssetSprite(asset: PixiStaticSpriteAsset): Sprite {
  const sprite = new Sprite(asset.sprite);
  sprite.position.set(asset.offset.x, asset.offset.y);
  return sprite;
}

function createEffectSprite(asset: PixiStaticSpriteAsset): Sprite {
  const sprite = new Sprite(asset.sprite);
  sprite.anchor.set(0.5);
  sprite.visible = false;
  sprite.blendMode = "add";
  return sprite;
}

function syncCenteredSprite(
  sprite: Sprite,
  x: number,
  y: number,
  size: number,
  alpha: number,
  tint: number,
  stretchY = 1,
): void {
  sprite.visible = alpha > 0.001 && size > 0.001;
  if (!sprite.visible) return;
  sprite.position.set(x, y);
  sprite.width = size;
  sprite.height = size * stretchY;
  sprite.alpha = Math.max(0, Math.min(1, alpha));
  sprite.tint = tint;
}

function getThreatSpriteAsset(
  threatAssets: PixiThreatSpriteAssets,
  entity: Missile | Drone,
): PixiProjectileSpriteAsset {
  if (entity.type === "drone") {
    return entity.subtype === "shahed238" ? threatAssets.shahed238 : threatAssets.shahed136;
  }

  switch (entity.type) {
    case "mirv":
      return threatAssets.mirv;
    case "mirv_warhead":
      return threatAssets.mirv_warhead;
    case "bomb":
      return threatAssets.bomb;
    case "stack2":
      return threatAssets.stack_carrier_2;
    case "stack3":
      return threatAssets.stack_carrier_3;
    case "stack_child":
      return threatAssets.stack_child;
    case "missile":
    default:
      return threatAssets.missile;
  }
}

function createProjectileNode(asset: PixiProjectileSpriteAsset): GameplayProjectileNode {
  const container = new Container();
  const trail = new Graphics();
  const spriteRoot = new Container();
  const anim = createBlendSprites(asset.staticSprite);
  const overlay = new Graphics();
  positionBlendSprites(anim, asset.offset.x, asset.offset.y);
  spriteRoot.addChild(anim.primary, anim.secondary);
  container.addChild(trail, spriteRoot, overlay);
  return { container, trail, spriteRoot, anim, overlay };
}

function syncProjectileNode(
  node: GameplayProjectileNode,
  asset: PixiProjectileSpriteAsset,
  x: number,
  y: number,
  rotation: number,
  sceneTime: number,
  alpha = 1,
  sharpFrames = true,
): void {
  const frames = asset.animFrames.length > 0 ? asset.animFrames : [asset.staticSprite];
  positionBlendSprites(node.anim, asset.offset.x, asset.offset.y);
  syncBlendSprites(
    node.anim,
    frames,
    getFrameProgress(sceneTime, asset.period || 1, asset.frameCount),
    alpha,
    sharpFrames,
  );
  node.spriteRoot.position.set(x, y);
  node.spriteRoot.rotation = rotation;
  node.spriteRoot.alpha = alpha;
}

function cleanupEntityMap<T extends object, N>(
  pool: Map<T, N>,
  liveEntities: readonly T[],
  isLive: (entity: T) => boolean,
  destroyNode: (node: N) => void,
): void {
  for (const [entity, node] of pool) {
    if (liveEntities.includes(entity) && isLive(entity)) continue;
    pool.delete(entity);
    destroyNode(node);
  }
}

function drawSimpleTrailDots(
  graphic: Graphics,
  trail: readonly TrailPoint[] | undefined,
  color: number,
  radius: number,
  alpha: number,
): void {
  graphic.clear();
  const points = trail ?? [];
  points.forEach((point, index) => {
    const ratio = points.length <= 1 ? 1 : index / (points.length - 1);
    graphic.circle(point.x, point.y, radius * (0.55 + ratio * 0.75)).fill({ color, alpha: alpha * ratio * 0.32 });
  });
}

function getPooledGraphic(pool: Graphics[], container: Container, index: number): Graphics {
  let graphic = pool[index];
  if (!graphic) {
    graphic = new Graphics();
    pool[index] = graphic;
    container.addChild(graphic);
  }
  graphic.visible = true;
  graphic.clear();
  return graphic;
}

function getPooledSprite(
  pool: Sprite[],
  container: Container,
  index: number,
  texture: Texture,
  anchorX = 0.5,
  anchorY = 0.5,
): Sprite {
  let sprite = pool[index];
  if (!sprite) {
    sprite = new Sprite(texture);
    sprite.anchor.set(anchorX, anchorY);
    sprite.blendMode = "add";
    pool[index] = sprite;
    container.addChild(sprite);
  }
  sprite.texture = texture;
  sprite.anchor.set(anchorX, anchorY);
  sprite.visible = true;
  return sprite;
}

function hideUnusedGraphics(pool: Graphics[], usedCount: number): void {
  for (let index = usedCount; index < pool.length; index++) {
    pool[index].visible = false;
    pool[index].clear();
  }
}

function hideUnusedSprites(pool: Sprite[], usedCount: number): void {
  for (let index = usedCount; index < pool.length; index++) {
    pool[index].visible = false;
  }
}

function createEmpRingNode(assets: PixiEffectSpriteAssets): GameplayEmpRingNode {
  const container = new Container();
  const flash = new Graphics();
  const wash = createEffectSprite(assets.emp.wash);
  const ring = createEffectSprite(assets.emp.ring);
  container.addChild(flash, wash, ring);
  return { container, flash, wash, ring };
}

function getPooledEmpRingNode(
  pool: GameplayEmpRingNode[],
  container: Container,
  index: number,
  assets: PixiEffectSpriteAssets,
): GameplayEmpRingNode {
  let node = pool[index];
  if (!node) {
    node = createEmpRingNode(assets);
    pool[index] = node;
    container.addChild(node.container);
  }
  node.container.visible = true;
  node.flash.clear();
  return node;
}

function hideUnusedEmpRingNodes(pool: GameplayEmpRingNode[], usedCount: number): void {
  for (let index = usedCount; index < pool.length; index++) {
    const node = pool[index];
    node.container.visible = false;
    node.flash.clear();
    node.wash.visible = false;
    node.ring.visible = false;
  }
}

function countWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  let count = 0;
  for (const item of items) {
    if (predicate(item)) count++;
  }
  return count;
}

export function summarizePixiDynamicEntities(game: GameState): {
  counts: Record<string, number>;
  summary: string;
  firstPositions: Record<string, { x: number; y: number } | null>;
} {
  const livePlane = game.planes.find((plane) => plane.alive) ?? null;
  const liveFlare = game.flares.find((flare) => flare.alive) ?? null;
  const counts = {
    missiles: game.missiles.length,
    drones: game.drones.length,
    interceptors: game.interceptors.length,
    hornets: game.hornets.length,
    roadrunners: game.roadrunners.length,
    patriotMissiles: game.patriotMissiles.length,
    planes: countWhere(game.planes, (plane) => plane.alive),
    flares: countWhere(game.flares, (flare) => flare.alive),
    explosions: game.explosions.length,
    empRings: countWhere(game.empRings, (ring) => ring.alive !== false),
    particles: game.particles.length,
    phalanxBullets: countWhere(game.phalanxBullets, (bullet) => bullet.cx !== undefined && bullet.cy !== undefined),
    laserBeams: countWhere(
      game.laserBeams,
      (beam) => beam.x1 != null && beam.y1 != null && beam.x2 != null && beam.y2 != null,
    ),
  };

  return {
    counts,
    summary: Object.entries(counts)
      .map(([key, value]) => `${key}:${value}`)
      .join(","),
    firstPositions: {
      missile: game.missiles[0] ? { x: game.missiles[0].x, y: game.missiles[0].y } : null,
      drone: game.drones[0] ? { x: game.drones[0].x, y: game.drones[0].y } : null,
      interceptor: game.interceptors[0] ? { x: game.interceptors[0].x, y: game.interceptors[0].y } : null,
      hornet: game.hornets[0] ? { x: game.hornets[0].x, y: game.hornets[0].y } : null,
      roadrunner: game.roadrunners[0] ? { x: game.roadrunners[0].x, y: game.roadrunners[0].y } : null,
      patriotMissile: game.patriotMissiles[0] ? { x: game.patriotMissiles[0].x, y: game.patriotMissiles[0].y } : null,
      plane: livePlane ? { x: livePlane.x, y: livePlane.y } : null,
      flare: liveFlare ? { x: liveFlare.x, y: liveFlare.y } : null,
    },
  };
}

function drawLauncherWreckage(graphic: Graphics): void {
  graphic
    .moveTo(-30, 4)
    .lineTo(-18, -8)
    .lineTo(14, -7)
    .lineTo(28, 4)
    .lineTo(24, 13)
    .lineTo(-25, 13)
    .closePath()
    .fill({ color: 0x1a1210, alpha: 0.72 })
    .stroke({ width: 1, color: 0xb4321e, alpha: 0.35 });
}

function drawLauncherMuzzleLight(graphic: Graphics, scale: number, timeSeconds: number, seed: number): void {
  const lightBreathe = 0.45 + 0.25 * Math.sin(timeSeconds * 7 + seed);
  const lightFlutter = 0.35 + 0.2 * Math.sin(timeSeconds * 17 + seed * 3.1);
  const lightIntensity = Math.max(0.34, Math.min(0.72, 0.6 * lightBreathe + 0.4 * lightFlutter));
  const muzzleX = 38 * scale;
  graphic
    .circle(muzzleX, 0, 7.25 * scale)
    .fill({ color: 0xff1a08, alpha: 0.26 * lightIntensity })
    .circle(muzzleX, 0, 3.35 * scale)
    .fill({ color: 0xff3a22, alpha: 0.58 * lightIntensity })
    .circle(muzzleX, 0, 1.35 * scale)
    .fill({ color: 0xffc6a0, alpha: 0.78 * lightIntensity });
}

function drawBurjWreckage(graphic: Graphics, baseY = GAMEPLAY_TOWER_BASE_Y, centerX = BURJ_X): void {
  for (let i = 0; i < 8; i++) {
    const h1 = ((i * 7 + 3) % 13) / 13;
    const h2 = ((i * 11 + 5) % 13) / 13;
    graphic.rect(centerX - 18 + i * 5, baseY - 12 - h1 * 24, 6, 12 + h2 * 18).fill(0x1f2432);
  }
}

function getDefenseSiteColor(site: DefenseSite): number {
  return UPGRADE_FAMILY_COLOR_HEX.get(site.key) ?? 0x44ffaa;
}

interface InterpolatedXY {
  x: number;
  y: number;
  _px?: number;
  _py?: number;
}

interface InterpolatedBullet {
  x: number;
  y: number;
  cx?: number;
  cy?: number;
  _pcx?: number;
  _pcy?: number;
}

function clampInterpolationAlpha(alpha: number | undefined): number {
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) return 1;
  return Math.max(0, Math.min(1, alpha));
}

function lerpValue(previous: number | undefined, current: number, alpha: number): number {
  return previous === undefined ? current : previous + (current - previous) * alpha;
}

function getRenderPosition(entity: InterpolatedXY, alpha: number): { x: number; y: number } {
  return {
    x: lerpValue(entity._px, entity.x, alpha),
    y: lerpValue(entity._py, entity.y, alpha),
  };
}

function getRenderBulletEndpoint(bullet: InterpolatedBullet, alpha: number): { x: number; y: number } | null {
  if (bullet.cx === undefined || bullet.cy === undefined) return null;
  return {
    x: lerpValue(bullet._pcx, bullet.cx, alpha),
    y: lerpValue(bullet._pcy, bullet.cy, alpha),
  };
}

export class PixiRenderer implements GameRenderer {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly titleScene = new Container();
  private readonly titleSkyLayer = new Container();
  private readonly titleSkylineLayer = new Container();
  private readonly titleBurjLayer = new Container();
  private readonly titleWaterLayer = new Container();
  private readonly titleLauncherLayer = new Container();
  private readonly titleThreatLayer = new Container();
  private readonly titleAccentLayer = new Container();
  private readonly gameplayScene = new Container();
  private readonly gameplaySkyLayer = new Container();
  private readonly gameplayBurjLayer = new Container();
  private readonly gameplayCityLayer = new Container();
  private readonly gameplayWaterLayer = new Container();
  private readonly gameplayTrailLayer = new Container();
  private readonly gameplayEffectsLayer = new Container();
  private readonly gameplayProjectileLayer = new Container();
  private readonly gameplayParticleLayer = new Container();
  private readonly gameplayGroundStructuresLayer = new Container();
  private readonly gameplayOverlayLayer = new Container();
  private readonly gameOverScene = new Container();
  private readonly titleLayers = [
    this.titleSkyLayer,
    this.titleSkylineLayer,
    this.titleBurjLayer,
    this.titleWaterLayer,
    this.titleLauncherLayer,
    this.titleThreatLayer,
    this.titleAccentLayer,
  ];
  private readonly gameplayLayers = [
    this.gameplaySkyLayer,
    this.gameplayBurjLayer,
    this.gameplayCityLayer,
    this.gameplayWaterLayer,
    this.gameplayTrailLayer,
    this.gameplayEffectsLayer,
    this.gameplayProjectileLayer,
    this.gameplayParticleLayer,
    this.gameplayGroundStructuresLayer,
    this.gameplayOverlayLayer,
  ];
  private readonly textures: PixiTextureResources;
  private readonly ready: Promise<void>;
  private readonly pngsPromise: Promise<PixiPngAssetMap>;
  private pngs: PixiPngAssetMap = {};
  private titleState: TitleSceneState | null = null;
  private gameplayState: GameplaySceneState | null = null;
  private gameOverState: GameOverSceneState | null = null;
  private latestGame: GameState | null = null;
  private latestShowShop = false;
  private latestInterpolationAlpha = 1;
  private initialized = false;
  private destroyed = false;
  private appDestroyed = false;
  private contextLost = false;
  private initError: Error | null = null;
  private screen: PixiScreen = "title";
  private readonly onWebGlContextLost = (event: Event) => this.handleWebGlContextLost(event);
  private readonly onWebGlContextRestored = () => this.handleWebGlContextRestored();
  private readonly hideCrosshair = isMobileDevice();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    { textures = createPixiTextureResources() }: PixiRendererOptions = {},
  ) {
    this.textures = textures;
    this.root.label = "pixi-root";
    this.titleScene.label = "title-scene";
    this.titleSkyLayer.label = "title-sky-layer";
    this.titleSkylineLayer.label = "title-skyline-layer";
    this.titleBurjLayer.label = "title-burj-layer";
    this.titleWaterLayer.label = "title-water-layer";
    this.titleLauncherLayer.label = "title-launcher-layer";
    this.titleThreatLayer.label = "title-threat-layer";
    this.titleAccentLayer.label = "title-accent-layer";
    this.gameplayScene.label = "gameplay-scene";
    this.gameplaySkyLayer.label = "gameplay-sky-layer";
    this.gameplayBurjLayer.label = "gameplay-burj-layer";
    this.gameplayCityLayer.label = "gameplay-city-layer";
    this.gameplayWaterLayer.label = "gameplay-water-layer";
    this.gameplayTrailLayer.label = "gameplay-trail-layer";
    this.gameplayEffectsLayer.label = "gameplay-effects-layer";
    this.gameplayProjectileLayer.label = "gameplay-projectile-layer";
    this.gameplayParticleLayer.label = "gameplay-particle-layer";
    this.gameplayGroundStructuresLayer.label = "gameplay-ground-structures-layer";
    this.gameplayOverlayLayer.label = "gameplay-overlay-layer";
    this.gameOverScene.label = "gameover-scene";

    this.titleScene.addChild(...this.titleLayers);
    this.gameplayScene.addChild(...this.gameplayLayers);
    this.root.addChild(this.titleScene, this.gameplayScene, this.gameOverScene);
    this.app.stage.addChild(this.root);

    this.canvas.dataset.renderer = "pixi";
    this.canvas.dataset.pixiContext = "active";
    this.canvas.dataset.pixiTitle = "booting";
    this.canvas.dataset.pixiGameplayStatic = "booting";
    this.canvas.addEventListener("webglcontextlost", this.onWebGlContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onWebGlContextRestored);
    this.pngsPromise = loadPixiPngBundles(["title", "gameplay"]);
    this.ready = this.initialize();
  }

  renderTitle(): void {
    this.screen = "title";
    this.latestGame = null;
    this.latestShowShop = false;
    this.latestInterpolationAlpha = 1;
    this.renderIfReady();
  }

  renderGameplay(game: GameState, request: GameplayRenderRequest = {}): void {
    this.screen = "playing";
    this.latestGame = game;
    this.latestShowShop = !!request.showShop;
    this.latestInterpolationAlpha = clampInterpolationAlpha(request.interpolationAlpha);
    this.renderIfReady();
  }

  renderGameOver(snapshot: GameOverSnapshot): void {
    void snapshot;
    this.screen = "gameover";
    this.latestGame = null;
    this.latestShowShop = false;
    this.latestInterpolationAlpha = 1;
    this.renderIfReady();
  }

  resize(): void {
    if (!this.initialized || this.destroyed || this.contextLost) return;
    this.app.renderer.resize(CANVAS_W, CANVAS_H);
    this.renderIfReady();
  }

  isRenderPaused(): boolean {
    return this.contextLost;
  }

  destroy(): void {
    this.destroyed = true;
    this.latestGame = null;
    this.latestInterpolationAlpha = 1;
    this.canvas.removeEventListener("webglcontextlost", this.onWebGlContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onWebGlContextRestored);
    this.canvas.dataset.pixiTitle = "destroyed";
    this.canvas.dataset.pixiGameplayStatic = "destroyed";
    this.canvas.dataset.pixiContext = "destroyed";
    if (this.initialized) this.destroyApp();
  }

  get readyPromise(): Promise<void> {
    return this.ready;
  }

  get textureResources(): PixiTextureResources {
    return this.textures;
  }

  private destroyApp(): void {
    if (this.appDestroyed) return;
    this.appDestroyed = true;
    this.app.destroy(false, { children: true, texture: false, textureSource: false });
  }

  private handleWebGlContextLost(event: Event): void {
    event.preventDefault();
    if (this.destroyed) return;
    this.contextLost = true;
    this.canvas.dataset.pixiContext = "lost";
  }

  private handleWebGlContextRestored(): void {
    if (this.destroyed) return;
    this.contextLost = false;
    this.canvas.dataset.pixiContext = "restoring";
    if (this.initialized && !this.initError) {
      this.textures.reupload();
      this.rebuildScenesAfterContextRestore();
    }
    this.canvas.dataset.pixiContext = "active";
    this.renderIfReady();
  }

  private rebuildScenesAfterContextRestore(): void {
    this.clearRebuildableScenes();
    this.buildTitleScene();
    this.buildGameplayScene();
    this.buildGameOverScene();
    this.canvas.dataset.pixiTitle = "ready";
    this.canvas.dataset.pixiGameplayStatic = "ready";
  }

  private clearRebuildableScenes(): void {
    for (const layer of this.titleLayers) this.destroyChildren(layer);
    for (const layer of this.gameplayLayers) this.destroyChildren(layer);
    for (const child of [...this.gameplayScene.children]) {
      if (this.gameplayLayers.includes(child as Container)) continue;
      this.gameplayScene.removeChild(child);
      child.destroy({ children: true });
    }
    this.gameplayProjectileLayer.mask = null;
    this.gameplayTrailLayer.mask = null;
    this.destroyChildren(this.gameOverScene);
    this.titleState = null;
    this.gameplayState = null;
    this.gameOverState = null;
  }

  private destroyChildren(container: Container): void {
    for (const child of container.removeChildren()) {
      child.destroy({ children: true });
    }
  }

  private async initialize(): Promise<void> {
    try {
      const [pngs] = await Promise.all([
        this.pngsPromise,
        this.app.init({
          canvas: this.canvas,
          width: CANVAS_W,
          height: CANVAS_H,
          backgroundAlpha: 0,
          antialias: false,
          autoStart: false,
          preference: "webgl",
        }),
      ]);
      if (this.destroyed) {
        this.destroyApp();
        return;
      }

      this.pngs = pngs;
      (window as unknown as { __pixiApp?: unknown }).__pixiApp = this.app;
      this.buildTitleScene();
      this.buildGameplayScene();
      this.buildGameOverScene();
      this.initialized = true;
      this.canvas.dataset.pixiTitle = "ready";
      this.canvas.dataset.pixiGameplayStatic = "ready";
      this.renderIfReady();
    } catch (error: unknown) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      this.canvas.dataset.pixiTitle = "error";
      this.canvas.dataset.pixiGameplayStatic = "error";
      console.error("[pixi] renderer initialization failed", this.initError);
    }
  }

  private buildTitleScene(): void {
    const skyAssets = this.textures.getTitleSkyAssets();
    const buildingAssets = this.textures.getTitleBuildingAssets(TITLE_TOWER_BASE_Y);
    const burjAssets = this.textures.getBurjAssets(TITLE_GROUND_Y, 2);
    const launcherAssets = this.textures.getLauncherAssets(1, false);
    const threatAssets = this.textures.getThreatSpriteAssets(3);

    const skyBlend = createBlendSprites(skyAssets.frames[0] ?? Texture.EMPTY);
    skyBlend.primary.width = CANVAS_W;
    skyBlend.primary.height = CANVAS_H;
    skyBlend.secondary.width = CANVAS_W;
    skyBlend.secondary.height = CANVAS_H;
    this.titleSkyLayer.addChild(skyBlend.primary, skyBlend.secondary);

    const nebulaTexture = this.pngs[PIXI_PNG_ASSET_KEYS.skyNebula];
    const nebula = nebulaTexture ? new Sprite(nebulaTexture) : null;
    if (nebula) {
      nebula.position.set(-40, -20);
      nebula.width = CANVAS_W + 120;
      nebula.height = CANVAS_H * 0.8;
      nebula.alpha = 0.2;
      this.titleSkyLayer.addChild(nebula);
    }

    const buildings = TITLE_SKYLINE_TOWERS.map((tower, index) => {
      const container = new Container();
      const staticSprite = new Sprite(buildingAssets.staticSprites[index] ?? Texture.EMPTY);
      staticSprite.position.set(
        buildingAssets.staticOffsets[index]?.x ?? 0,
        buildingAssets.staticOffsets[index]?.y ?? 0,
      );
      const anim = createBlendSprites(buildingAssets.animFrames[index]?.[0] ?? Texture.EMPTY);
      positionBlendSprites(anim, buildingAssets.animOffsets[index]?.x ?? 0, buildingAssets.animOffsets[index]?.y ?? 0);
      container.addChild(staticSprite, anim.primary, anim.secondary);
      this.titleSkylineLayer.addChild(container);
      return {
        container,
        anim,
        playbackSeed: hash01(tower.x, tower.w, tower.h, index + 1),
      };
    });

    const burjGlowTexture = this.pngs[PIXI_PNG_ASSET_KEYS.titleBurjGlow];
    const burjGlow = burjGlowTexture ? new Sprite(burjGlowTexture) : null;
    if (burjGlow) {
      const glowW = 420;
      const glowH = 820;
      burjGlow.position.set(BURJ_X - glowW / 2, TITLE_TOWER_BASE_Y - BURJ_H - 190);
      burjGlow.width = glowW;
      burjGlow.height = glowH;
      burjGlow.alpha = 1;
      this.titleBurjLayer.addChild(burjGlow);
    }

    const burjContainer = new Container();
    burjContainer.position.set(BURJ_X, TITLE_TOWER_BASE_Y);
    burjContainer.scale.set(2);
    const burjStatic = new Sprite(burjAssets.staticSprite);
    burjStatic.position.set(burjAssets.offset.x - BURJ_X, burjAssets.offset.y - TITLE_TOWER_BASE_Y);
    const burjAnim = createBlendSprites(burjAssets.animFrames[0] ?? Texture.EMPTY);
    positionBlendSprites(burjAnim, burjAssets.offset.x - BURJ_X, burjAssets.offset.y - TITLE_TOWER_BASE_Y);
    burjContainer.addChild(burjStatic, burjAnim.primary, burjAnim.secondary);
    this.titleBurjLayer.addChild(burjContainer);

    const titleBeacon = getPixiBurjBeaconLayout(TITLE_TOWER_BASE_Y);
    const beaconStem = createRect(
      0x803c28,
      0.5,
      titleBeacon.stemX,
      titleBeacon.stemY,
      titleBeacon.stemWidth,
      titleBeacon.stemHeight,
    );
    const beaconGlow = createBurjBeaconGlow(titleBeacon.glowX, titleBeacon.glowY);
    this.titleBurjLayer.addChild(beaconStem, beaconGlow);

    this.titleBurjLayer.addChild(this.createTitleGroundDecor());

    const waterTexture = this.pngs[PIXI_PNG_ASSET_KEYS.titleWaterReflection];
    const water = waterTexture ? createPixiWaterSurface(waterTexture, CANVAS_W + 10, CANVAS_H - TITLE_WATER_TOP) : null;
    if (water) {
      water.container.position.set(0, TITLE_WATER_TOP);
      this.titleWaterLayer.addChild(water.container);
    }

    const waterShade = createRect(0x0a1426, 0.24, 0, TITLE_WATER_TOP, CANVAS_W, CANVAS_H - TITLE_WATER_TOP);
    this.titleWaterLayer.addChild(waterShade);

    const launchers = LAUNCHERS.map((launcher) => {
      const container = new Container();
      container.position.set(launcher.x, launcher.y - 105);
      container.alpha = 0.92;

      const chassisStatic = new Sprite(launcherAssets.chassisStaticSprite);
      chassisStatic.position.set(launcherAssets.chassisOffset.x, launcherAssets.chassisOffset.y);

      const chassis = createBlendSprites(launcherAssets.chassisAnimFrames[0] ?? Texture.EMPTY);
      positionBlendSprites(chassis, launcherAssets.chassisOffset.x, launcherAssets.chassisOffset.y);

      const turretRoot = new Container();
      turretRoot.position.set(launcherAssets.turretPivot.x, launcherAssets.turretPivot.y);
      const turret = new Sprite(launcherAssets.turretSprite);
      turret.position.set(launcherAssets.turretOffset.x, launcherAssets.turretOffset.y);
      const muzzleLight = new Graphics();
      turretRoot.addChild(turret, muzzleLight);

      container.addChild(chassisStatic, chassis.primary, chassis.secondary, turretRoot);
      this.titleLauncherLayer.addChild(container);
      return { container, chassis, turretRoot, muzzleLight };
    });

    const threats = TITLE_AIRCRAFT.map((aircraft) => {
      const asset = aircraft.kind === "shahed" ? threatAssets.shahed136 : threatAssets.missile;
      const container = new Container();
      container.position.set(aircraft.x, aircraft.y);

      const trail = new Graphics();
      const anim = createBlendSprites(asset.animFrames[0] ?? Texture.EMPTY);
      positionBlendSprites(anim, asset.offset.x, asset.offset.y);
      const beacon = new Graphics();

      const guideLine = new Graphics();
      guideLine
        .moveTo(aircraft.x, aircraft.y)
        .lineTo(TITLE_TARGET_X, TITLE_TARGET_Y)
        .stroke({
          width: 1,
          color: aircraft.kind === "shahed" ? 0xffd296 : 0xd2dce6,
          alpha: 0.1,
        });

      container.addChild(trail, anim.primary, anim.secondary, beacon);
      this.titleThreatLayer.addChild(guideLine, container);
      return {
        container,
        trail,
        beacon,
        anim,
        kind: aircraft.kind,
        x: aircraft.x,
        y: aircraft.y,
      };
    });

    const ambientMarkers = Array.from({ length: 9 }, (_, index) => {
      const marker = createRect(0xffffff, 0.12, 40 + index * 100, TITLE_GROUND_Y - 82 - (index % 2) * 6, 2, 10);
      this.titleAccentLayer.addChild(marker);
      return marker;
    });

    this.titleState = {
      skyAssets,
      skyBlend,
      nebula,
      buildingAssets,
      buildings,
      burjAssets,
      burjGlow,
      burjAnim,
      beaconStem,
      beaconGlow,
      launchers,
      launcherAssets,
      threats,
      threatAssets,
      water,
      waterShade,
      ambientMarkers,
    };
  }

  private buildGameplayScene(): void {
    const buildingAssets = this.textures.getGameplayBuildingAssets(GAMEPLAY_TOWER_BASE_Y);
    const burjAssets = this.textures.getBurjAssets(GAMEPLAY_SCENIC_GROUND_Y, 2);
    const launcherAssets = {
      intact: this.textures.getLauncherAssets(GAMEPLAY_LAUNCHER_SCALE, false),
      damaged: this.textures.getLauncherAssets(GAMEPLAY_LAUNCHER_SCALE, true),
    };
    const defenseSiteAssets = this.textures.getDefenseSiteAssets();
    const dynamic: GameplayDynamicState = {
      threatAssets: this.textures.getThreatSpriteAssets(GAMEPLAY_ENEMY_SCALE),
      interceptorAssets: this.textures.getInterceptorSpriteAssets(GAMEPLAY_PROJECTILE_SCALE),
      upgradeProjectileAssets: this.textures.getUpgradeProjectileSpriteAssets(GAMEPLAY_PROJECTILE_SCALE),
      planeAssets: this.textures.getPlaneAssets(),
      effectAssets: this.textures.getEffectSpriteAssets(),
      missiles: new Map(),
      drones: new Map(),
      interceptors: new Map(),
      hornets: new Map(),
      roadrunners: new Map(),
      patriotMissiles: new Map(),
      planes: new Map(),
      flares: new Map(),
      explosions: new Map(),
      empRingPool: [],
      laserPool: [],
      phalanxPool: [],
      particlePool: [],
      trailBatch: new TrailBatch(),
    };
    this.gameplayTrailLayer.addChild(dynamic.trailBatch.displayObject);

    const projectileMask = new Graphics();
    projectileMask.rect(0, 0, CANVAS_W, GAMEPLAY_WATERLINE_Y).fill(0xffffff);
    this.gameplayProjectileLayer.mask = projectileMask;
    this.gameplayTrailLayer.mask = projectileMask;
    this.gameplayScene.addChild(projectileMask);

    const nebulaTexture = this.pngs[PIXI_PNG_ASSET_KEYS.skyNebula];
    const nebula = nebulaTexture ? new Sprite(nebulaTexture) : null;
    if (nebula) {
      nebula.position.set(-80, -40);
      nebula.width = CANVAS_W + 160;
      nebula.height = CANVAS_H * 0.78;
      nebula.alpha = 0.12;
      this.gameplaySkyLayer.addChild(nebula);
    }

    const skyBlend = createBlendSprites(Texture.EMPTY);
    skyBlend.primary.width = CANVAS_W;
    skyBlend.primary.height = CANVAS_H;
    skyBlend.secondary.width = CANVAS_W;
    skyBlend.secondary.height = CANVAS_H;
    this.gameplaySkyLayer.addChild(skyBlend.primary, skyBlend.secondary);

    const burjContainer = new Container();
    burjContainer.position.set(BURJ_X, GAMEPLAY_TOWER_BASE_Y);
    burjContainer.scale.set(2);
    const burjStatic = new Sprite(burjAssets.staticSprite);
    burjStatic.position.set(burjAssets.offset.x - BURJ_X, burjAssets.offset.y - GAMEPLAY_TOWER_BASE_Y);
    const burjAnim = createBlendSprites(burjAssets.animFrames[0] ?? Texture.EMPTY);
    positionBlendSprites(burjAnim, burjAssets.offset.x - BURJ_X, burjAssets.offset.y - GAMEPLAY_TOWER_BASE_Y);
    const damageUnderlay = new Graphics();
    const decalLayer = new Container();
    const damageFxLayer = new Container();
    const hitFlashGlow = new Sprite(getBurjHitFlashTexture());
    hitFlashGlow.anchor.set(0.5);
    hitFlashGlow.visible = false;
    const hitFlash = new Graphics();
    const damageMask = createGameplayBurjDamageMask();
    damageUnderlay.mask = damageMask;
    decalLayer.mask = damageMask;
    damageFxLayer.mask = damageMask;
    hitFlashGlow.mask = damageMask;
    hitFlash.mask = damageMask;
    burjContainer.addChild(
      burjStatic,
      damageMask,
      damageUnderlay,
      burjAnim.primary,
      burjAnim.secondary,
      decalLayer,
      damageFxLayer,
      hitFlashGlow,
      hitFlash,
    );

    const wreckage = new Graphics();
    drawBurjWreckage(wreckage);
    wreckage.visible = false;

    const gameplayBeacon = getPixiBurjBeaconLayout(GAMEPLAY_TOWER_BASE_Y);
    const beaconStem = createRect(
      0x803c28,
      0.5,
      gameplayBeacon.stemX,
      gameplayBeacon.stemY,
      gameplayBeacon.stemWidth,
      gameplayBeacon.stemHeight,
    );
    const beaconGlow = createBurjBeaconGlow(gameplayBeacon.glowX, gameplayBeacon.glowY);
    const groundDecor = this.createGameplayGroundDecor();
    this.gameplayBurjLayer.addChild(burjContainer, wreckage, beaconStem, beaconGlow, groundDecor);

    const buildings = TITLE_SKYLINE_TOWERS.map((tower, index) => {
      const container = new Container();
      const staticSprite = new Sprite(buildingAssets.staticSprites[index] ?? Texture.EMPTY);
      staticSprite.position.set(
        buildingAssets.staticOffsets[index]?.x ?? 0,
        buildingAssets.staticOffsets[index]?.y ?? 0,
      );
      const anim = createBlendSprites(buildingAssets.animFrames[index]?.[0] ?? Texture.EMPTY);
      positionBlendSprites(anim, buildingAssets.animOffsets[index]?.x ?? 0, buildingAssets.animOffsets[index]?.y ?? 0);
      const rubble = new Graphics();
      container.addChild(staticSprite, anim.primary, anim.secondary, rubble);
      this.gameplayCityLayer.addChild(container);
      return {
        container,
        staticSprite,
        anim,
        rubble,
        playbackSeed: hash01(tower.x, tower.w, tower.h, index + 17),
      };
    });

    const waterTexture = this.pngs[PIXI_PNG_ASSET_KEYS.titleWaterReflection];
    const water = waterTexture
      ? createPixiWaterSurface(waterTexture, CANVAS_W + 10, CANVAS_H - GAMEPLAY_WATER_TOP)
      : null;
    if (water) {
      water.container.position.set(0, GAMEPLAY_WATER_TOP);
      this.gameplayWaterLayer.addChild(water.container);
    }
    const waterShade = createRect(0x000000, 0.18, 0, GAMEPLAY_WATER_TOP, CANVAS_W, CANVAS_H - GAMEPLAY_WATER_TOP);
    this.gameplayWaterLayer.addChild(waterShade);

    const launchers = LAUNCHERS.map((launcher) => {
      const container = new Container();
      container.position.set(launcher.x, GAMEPLAY_SCENIC_LAUNCHER_Y);

      const chassisStatic = new Sprite(launcherAssets.intact.chassisStaticSprite);
      chassisStatic.position.set(launcherAssets.intact.chassisOffset.x, launcherAssets.intact.chassisOffset.y);
      const chassis = createBlendSprites(launcherAssets.intact.chassisAnimFrames[0] ?? Texture.EMPTY);
      positionBlendSprites(chassis, launcherAssets.intact.chassisOffset.x, launcherAssets.intact.chassisOffset.y);

      const turretRoot = new Container();
      turretRoot.position.set(launcherAssets.intact.turretPivot.x, launcherAssets.intact.turretPivot.y);
      const turret = new Sprite(launcherAssets.intact.turretSprite);
      turret.position.set(launcherAssets.intact.turretOffset.x, launcherAssets.intact.turretOffset.y);
      const muzzleLight = new Graphics();
      const muzzleFlash = new Graphics();
      turretRoot.addChild(turret, muzzleLight, muzzleFlash);

      const hpPips = new Graphics();
      const wreckage = new Graphics();
      drawLauncherWreckage(wreckage);
      wreckage.visible = false;

      container.addChild(chassisStatic, chassis.primary, chassis.secondary, turretRoot, hpPips, wreckage);
      this.gameplayGroundStructuresLayer.addChild(container);
      return {
        container,
        chassisStatic,
        chassis,
        turretRoot,
        turret,
        muzzleFlash,
        muzzleLight,
        hpPips,
        wreckage,
        damaged: false,
      };
    });

    const defenseSiteNodes = new Map<string, GameplayDefenseSiteNode>();
    const addDefenseSiteNode = (key: string, asset: PixiStaticSpriteAsset, x: number, y: number) => {
      const container = new Container();
      container.position.set(x, y);
      const sprite = createStaticAssetSprite(asset);
      const overlay = new Graphics();
      container.addChild(sprite, overlay);
      this.gameplayGroundStructuresLayer.addChild(container);
      const node = { container, sprite, overlay };
      defenseSiteNodes.set(key, node);
      return node;
    };

    addDefenseSiteNode(
      "patriot",
      defenseSiteAssets.patriotTEL,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.patriot.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.patriot.y,
    );
    addDefenseSiteNode(
      "wildHornets",
      defenseSiteAssets.wildHornetsHive[0],
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.wildHornets.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.wildHornets.y,
    );
    addDefenseSiteNode(
      "roadrunner",
      defenseSiteAssets.roadrunnerContainer[0],
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.roadrunner.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.roadrunner.y,
    );
    addDefenseSiteNode("flare", defenseSiteAssets.flareDispenser[0], BURJ_X, GAMEPLAY_FLARE_VISUAL_Y);
    addDefenseSiteNode("emp", defenseSiteAssets.empEmitter[0], BURJ_X, GAMEPLAY_EMP_VISUAL_Y);

    Array.from({ length: 3 }, (_, index) => {
      const container = new Container();
      const sprite = createStaticAssetSprite(defenseSiteAssets.phalanxBase);
      const overlay = new Graphics();
      container.addChild(sprite, overlay);
      container.visible = false;
      this.gameplayGroundStructuresLayer.addChild(container);
      defenseSiteNodes.set(`phalanx:${index}`, { container, sprite, overlay });
    });

    const defenseStatusOverlay = new Graphics();
    const burjWarningPlate = new Graphics();
    const crosshairOverlay = new Graphics();
    const upgradeRangeOverlay = new Graphics();
    const collisionOverlay = new Graphics();
    this.gameplayOverlayLayer.addChild(
      defenseStatusOverlay,
      burjWarningPlate,
      upgradeRangeOverlay,
      collisionOverlay,
      crosshairOverlay,
    );

    this.gameplayState = {
      skyAssets: null,
      skyBlend,
      nebula,
      buildingAssets,
      buildings,
      burjAssets,
      burj: {
        container: burjContainer,
        staticSprite: burjStatic,
        anim: burjAnim,
        damageUnderlay,
        decalLayer,
        damageFxLayer,
        hitFlashGlow,
        hitFlash,
        wreckage,
        beaconStem,
        beaconGlow,
        groundDecor,
        decals: new Map(),
        damageFx: new Map(),
      },
      launcherAssets,
      launchers,
      defenseSiteAssets,
      defenseSiteNodes,
      defenseStatusOverlay,
      burjWarningPlate,
      crosshairOverlay,
      upgradeRangeOverlay,
      collisionOverlay,
      water,
      waterShade,
      dynamic,
    };
  }

  private buildGameOverScene(): void {
    const skyAssets = this.textures.getGameplaySkyAssets([], GAMEOVER_GROUND_Y);
    const buildingAssets = this.textures.getTitleBuildingAssets(GAMEOVER_TOWER_BASE_Y);
    const burjAssets = this.textures.getBurjAssets(GAMEOVER_GROUND_Y, 1);
    const launcherAssets = this.textures.getLauncherAssets(GAMEPLAY_LAUNCHER_SCALE, true);
    const defenseSiteAssets = this.textures.getDefenseSiteAssets();

    const sky = new Sprite(skyAssets.frames[0] ?? Texture.EMPTY);
    sky.width = CANVAS_W;
    sky.height = CANVAS_H;
    sky.tint = 0x56424a;
    sky.alpha = 0.96;
    this.gameOverScene.addChild(sky);

    const nebulaTexture = this.pngs[PIXI_PNG_ASSET_KEYS.skyNebula];
    const nebula = nebulaTexture ? new Sprite(nebulaTexture) : null;
    if (nebula) {
      nebula.position.set(-80, -40);
      nebula.width = CANVAS_W + 160;
      nebula.height = CANVAS_H * 0.78;
      nebula.tint = 0x7d3a32;
      nebula.alpha = 0.16;
      this.gameOverScene.addChild(nebula);
    }

    const buildings = TITLE_SKYLINE_TOWERS.map((_, index) => {
      const container = new Container();
      const staticSprite = new Sprite(buildingAssets.staticSprites[index] ?? Texture.EMPTY);
      staticSprite.position.set(
        buildingAssets.staticOffsets[index]?.x ?? 0,
        buildingAssets.staticOffsets[index]?.y ?? 0,
      );
      staticSprite.tint = 0x6e4b44;
      staticSprite.alpha = 0.8;
      const damage = new Graphics();
      damage
        .rect(80 + index * 70, GAMEOVER_TOWER_BASE_Y - 34 - (index % 4) * 10, 42 + (index % 3) * 18, 44)
        .fill({ color: 0x14090a, alpha: 0.32 });
      container.addChild(staticSprite, damage);
      this.gameOverScene.addChild(container);
      return container;
    });

    const burj = new Container();
    burj.position.set(BURJ_X, GAMEOVER_TOWER_BASE_Y);
    const burjStatic = new Sprite(burjAssets.staticSprite);
    burjStatic.position.set(burjAssets.offset.x - BURJ_X, burjAssets.offset.y - GAMEOVER_TOWER_BASE_Y);
    burjStatic.tint = 0xffb7a5;
    burjStatic.alpha = 0.72;
    const burn = new Graphics();
    burn
      .rect(-40, -BURJ_H - 58, 80, BURJ_H + 82)
      .fill({ color: 0x2d0c09, alpha: 0.28 })
      .circle(-12, -BURJ_H * 0.55, 30)
      .fill({ color: 0xff4b24, alpha: 0.12 })
      .circle(14, -BURJ_H * 0.3, 24)
      .fill({ color: 0xff8a34, alpha: 0.1 });
    burj.addChild(burjStatic, burn);

    const wreckage = new Graphics();
    drawBurjWreckage(wreckage, GAMEOVER_TOWER_BASE_Y);
    wreckage.alpha = 0.85;
    const groundDecor = new Container();
    groundDecor.addChild(
      createRect(0xffb8a0, 0.45, 0, GAMEOVER_GROUND_Y - 1, CANVAS_W, 2),
      createRect(0x1c1219, 0.98, 0, GAMEOVER_GROUND_Y, CANVAS_W, WATER_SURFACE_OFFSET),
      createRect(0xff7b42, 0.18, BURJ_X - 58, GAMEOVER_TOWER_BASE_Y - 14, 116, 2.5),
      createRect(0xdac0b8, 0.26, BURJ_X - 28, GAMEOVER_GROUND_Y - 8, 56, 7),
    );
    this.gameOverScene.addChild(burj, wreckage, groundDecor);

    const waterTexture = this.pngs[PIXI_PNG_ASSET_KEYS.titleWaterReflection];
    const water = waterTexture
      ? createPixiWaterSurface(waterTexture, CANVAS_W + 10, CANVAS_H - GAMEOVER_WATER_TOP)
      : null;
    if (water) {
      water.container.position.set(0, GAMEOVER_WATER_TOP);
      water.bands.forEach((band) => {
        band.sprite.tint = 0x5a2730;
      });
      updatePixiWaterSurface(water, 0, 0.48);
      this.gameOverScene.addChild(water.container);
    }
    const waterShade = createRect(0x050305, 0.5, 0, GAMEOVER_WATER_TOP, CANVAS_W, CANVAS_H - GAMEOVER_WATER_TOP);
    this.gameOverScene.addChild(waterShade);

    const launchers = LAUNCHERS.map((launcher) => {
      const container = new Container();
      container.position.set(launcher.x, GAMEOVER_GROUND_Y - 18);
      container.alpha = 0.62;
      const chassis = new Sprite(launcherAssets.chassisStaticSprite);
      chassis.position.set(launcherAssets.chassisOffset.x, launcherAssets.chassisOffset.y);
      chassis.tint = 0x8f675e;
      const wreck = new Graphics();
      drawLauncherWreckage(wreck);
      container.addChild(chassis, wreck);
      this.gameOverScene.addChild(container);
      return container;
    });

    const siteSpecs: ReadonlyArray<{
      key: keyof Pick<PixiDefenseSiteAssets, "patriotTEL" | "phalanxBase">;
      x: number;
      y: number;
    }> = [
      { key: "patriotTEL", x: 334, y: GAMEOVER_GROUND_Y - 20 },
      { key: "phalanxBase", x: 553, y: GAMEOVER_GROUND_Y - 32 },
      { key: "phalanxBase", x: 860, y: GAMEOVER_GROUND_Y - 26 },
      { key: "phalanxBase", x: 59, y: GAMEOVER_GROUND_Y - 30 },
    ];
    const defenseSites = siteSpecs.map((site) => {
      const asset = defenseSiteAssets[site.key];
      const container = new Container();
      container.position.set(site.x, site.y);
      container.alpha = 0.5;
      const sprite = createStaticAssetSprite(asset);
      sprite.tint = 0x8f675e;
      const damage = new Graphics();
      damage.rect(-22, -6, 44, 10).fill({ color: 0x1e1414, alpha: 0.72 });
      container.addChild(sprite, damage);
      this.gameOverScene.addChild(container);
      return container;
    });

    const damageWash = new Graphics();
    damageWash
      .rect(0, 0, CANVAS_W, CANVAS_H)
      .fill({ color: 0x110407, alpha: 0.42 })
      .rect(0, 0, CANVAS_W, CANVAS_H * 0.42)
      .fill({ color: 0x2a090b, alpha: 0.18 });
    this.gameOverScene.addChild(damageWash);

    const embers = Array.from({ length: 54 }, (_, index) => {
      const ember = new Graphics();
      const x = (hash01(index, 11) * CANVAS_W) | 0;
      const y = (hash01(index, 23) * CANVAS_H) | 0;
      const size = 1 + hash01(index, 37) * 2.5;
      ember.rect(x, y, size, size).fill({
        color: index % 4 === 0 ? 0xffbc5f : 0xff4b24,
        alpha: 0.08 + hash01(index, 41) * 0.1,
      });
      this.gameOverScene.addChild(ember);
      return ember;
    });

    this.gameOverState = {
      sky,
      nebula,
      buildings,
      burj,
      water,
      waterShade,
      launchers,
      defenseSites,
      damageWash,
      embers,
    };
  }

  private createTitleGroundDecor(): Container {
    const decor = new Container();
    decor.addChild(
      createRect(0xd2e6ff, 0.55, 0, TITLE_GROUND_Y - 1, CANVAS_W, 2),
      createRect(0x162230, 0.96, 0, TITLE_GROUND_Y, CANVAS_W, WATER_SURFACE_OFFSET),
      createRect(0xffd696, 0.28, BURJ_X - 58, TITLE_TOWER_BASE_Y - 14, 116, 2.5),
      createRect(0xecf6ff, 0.46, BURJ_X - 28, TITLE_GROUND_Y - 8, 56, 7),
      createRect(0xb4dcff, 0.34, BURJ_X - 12, TITLE_GROUND_Y - 13, 24, 4),
    );

    const horizonGlow = new Graphics();
    horizonGlow.rect(0, TITLE_GROUND_Y - 6, CANVAS_W, 14).fill(0x7e9eca);
    horizonGlow.alpha = 0.2;
    decor.addChild(horizonGlow);

    const podium = new Graphics();
    podium
      .moveTo(BURJ_X - 104, TITLE_TOWER_BASE_Y + 2)
      .lineTo(BURJ_X - 88, TITLE_TOWER_BASE_Y - 12)
      .lineTo(BURJ_X - 58, TITLE_TOWER_BASE_Y - 15)
      .lineTo(BURJ_X - 36, TITLE_TOWER_BASE_Y - 8)
      .lineTo(BURJ_X - 16, TITLE_TOWER_BASE_Y - 3)
      .lineTo(BURJ_X + 16, TITLE_TOWER_BASE_Y - 3)
      .lineTo(BURJ_X + 36, TITLE_TOWER_BASE_Y - 8)
      .lineTo(BURJ_X + 58, TITLE_TOWER_BASE_Y - 15)
      .lineTo(BURJ_X + 88, TITLE_TOWER_BASE_Y - 12)
      .lineTo(BURJ_X + 104, TITLE_TOWER_BASE_Y + 2)
      .fill(0x161c28);
    podium.alpha = 0.9;
    decor.addChild(podium);

    return decor;
  }

  private createGameplayGroundDecor(): Container {
    const decor = new Container();
    const groundY = GAMEPLAY_SCENIC_GROUND_Y;
    const towerBaseY = GAMEPLAY_TOWER_BASE_Y;

    decor.addChild(
      createRect(0xd2e6ff, 0.55, 0, groundY - 1, CANVAS_W, 2),
      createRect(0x161e2c, 0.96, 0, groundY, CANVAS_W, WATER_SURFACE_OFFSET),
      createRect(0xffd696, 0.28, BURJ_X - 58, towerBaseY - 14, 116, 2.5),
      createRect(0xecf6ff, 0.46, BURJ_X - 28, groundY - 8, 56, 7),
      createRect(0xb4dcff, 0.34, BURJ_X - 12, groundY - 13, 24, 4),
    );

    const horizonGlow = new Graphics();
    horizonGlow.rect(0, groundY - 6, CANVAS_W, 14).fill(0x7e9eca);
    horizonGlow.alpha = 0.2;
    decor.addChild(horizonGlow);

    const podium = new Graphics();
    podium
      .moveTo(BURJ_X - 104, towerBaseY + 2)
      .lineTo(BURJ_X - 88, towerBaseY - 12)
      .lineTo(BURJ_X - 58, towerBaseY - 15)
      .lineTo(BURJ_X - 36, towerBaseY - 8)
      .lineTo(BURJ_X - 16, towerBaseY - 3)
      .lineTo(BURJ_X + 16, towerBaseY - 3)
      .lineTo(BURJ_X + 36, towerBaseY - 8)
      .lineTo(BURJ_X + 58, towerBaseY - 15)
      .lineTo(BURJ_X + 88, towerBaseY - 12)
      .lineTo(BURJ_X + 104, towerBaseY + 2)
      .fill(0x161c28);
    podium.alpha = 0.9;
    decor.addChild(podium);

    return decor;
  }

  private renderIfReady(): void {
    if (
      !this.initialized ||
      this.destroyed ||
      this.contextLost ||
      this.initError ||
      !this.titleState ||
      !this.gameplayState ||
      !this.gameOverState
    ) {
      return;
    }

    const timeSeconds = performance.now() / 1000;
    this.canvas.dataset.pixiScreen = this.screen;
    this.titleScene.visible = this.screen === "title";
    this.gameplayScene.visible = this.screen === "playing";
    this.gameOverScene.visible = this.screen === "gameover";

    this.updateTitleScene(this.titleState, timeSeconds);
    if (this.latestGame) {
      this.updateGameplayScene(
        this.gameplayState,
        this.latestGame,
        this.latestGame.time / 60,
        this.latestShowShop,
        this.latestInterpolationAlpha,
      );
    }
    this.app.render();
  }

  private updateGameplayScene(
    state: GameplaySceneState,
    game: GameState,
    sceneTime: number,
    showShop: boolean,
    interpolationAlpha: number,
  ): void {
    const skyAssets = this.textures.getGameplaySkyAssets(game.stars, GAMEPLAY_SCENIC_GROUND_Y);
    state.skyAssets = skyAssets;
    const skyFrameProgress = getFrameProgress(sceneTime, skyAssets.period, skyAssets.frameCount);
    state.skyBlend.primary.width = CANVAS_W;
    state.skyBlend.primary.height = CANVAS_H;
    state.skyBlend.secondary.width = CANVAS_W;
    state.skyBlend.secondary.height = CANVAS_H;
    syncBlendSprites(state.skyBlend, skyAssets.frames, skyFrameProgress);

    if (state.nebula) {
      state.nebula.alpha = 0.11 + 0.035 * Math.sin(sceneTime * 0.18 + 0.8);
      state.nebula.position.set(-80 + Math.sin(sceneTime * 0.1) * 12, -40 + Math.cos(sceneTime * 0.07) * 7);
    }

    this.updateGameplayBuildings(state, game, sceneTime);
    this.updateGameplayBurj(state, game, sceneTime);
    this.updateGameplayWater(state, sceneTime);
    this.updateGameplayDynamicEntities(state.dynamic, game, sceneTime, interpolationAlpha);
    this.updateGameplayLaunchers(state, game, sceneTime);
    this.updateGameplayDefenseSites(state, game, sceneTime);
    this.updateGameplayOverlays(state, game, sceneTime, showShop, interpolationAlpha);

    this.canvas.dataset.pixiGameplayStatic = "ready";
    this.canvas.dataset.pixiDynamicCounts = summarizePixiDynamicEntities(game).summary;
    this.canvas.dataset.pixiStaticCounts = [
      `buildings:${state.buildings.filter((_, index) => game.buildings[index]?.alive !== false).length}`,
      `launchers:${game.launcherHP.filter((hp) => hp > 0).length}`,
      `sites:${game.defenseSites.filter((site) => site.alive).length}`,
    ].join(",");
  }

  private updateGameplayBuildings(state: GameplaySceneState, game: GameState, sceneTime: number): void {
    state.buildings.forEach((node, index) => {
      const building = game.buildings[index];
      const alive = building?.alive !== false;
      node.staticSprite.visible = alive;
      node.anim.primary.visible = alive;
      node.anim.secondary.visible = alive;
      node.rubble.visible = !alive;

      if (!alive && building) {
        node.rubble.clear();
        const baseY = GAMEPLAY_TOWER_BASE_Y;
        node.rubble.rect(building.x - 2, baseY - 8, building.w + 4, 10).fill(0x1b2230);
        node.rubble.rect(building.x, baseY - 10, building.w, 4).fill({ color: 0xff7c50, alpha: 0.12 });
        return;
      }

      node.rubble.clear();
      const playbackRate =
        1 - TITLE_BUILDING_PLAYBACK_RATE_JITTER * 0.5 + node.playbackSeed * TITLE_BUILDING_PLAYBACK_RATE_JITTER;
      const phaseOffset = node.playbackSeed * GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const phase =
        (((sceneTime * playbackRate + phaseOffset) % GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS) +
          GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS) /
        GAMEPLAY_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const frameProgress = phase * state.buildingAssets.frameCount;
      const slotProgress = frameProgress % 1;
      const blendStart = 1 - GAMEPLAY_BUILDING_BLEND_WINDOW;
      const blendAmount =
        slotProgress <= blendStart ? 0 : Math.min(1, (slotProgress - blendStart) / GAMEPLAY_BUILDING_BLEND_WINDOW);
      syncBlendSprites(
        node.anim,
        state.buildingAssets.animFrames[index] ?? [],
        Math.floor(frameProgress) + blendAmount,
        GAMEPLAY_BUILDING_ANIM_ALPHA,
      );
    });
  }

  private updateGameplayBurj(state: GameplaySceneState, game: GameState, sceneTime: number): void {
    const burj = state.burj;
    const alive = game.burjAlive;
    burj.container.visible = alive;
    burj.beaconStem.visible = alive;
    burj.beaconGlow.visible = alive;
    burj.wreckage.visible = !alive;

    if (!alive) return;

    const burjFrameProgress = getFrameProgress(sceneTime, state.burjAssets.period, state.burjAssets.frameCount);
    syncBlendSprites(burj.anim, state.burjAssets.animFrames, burjFrameProgress, 1, true);

    const damageLevel = Math.max(0, Math.min(1, (5 - game.burjHealth) / 4));
    const critical = game.burjHealth <= 1;
    burj.staticSprite.tint = critical ? 0xffd7d0 : damageLevel > 0.45 ? 0xffece4 : 0xffffff;
    burj.damageUnderlay.clear();
    if (damageLevel > 0) {
      for (let i = 0; i < 7; i++) {
        const ht = 0.16 + i * 0.11;
        const y = -BURJ_H * ht;
        const width = 8 + i * 2.4 + damageLevel * 8;
        const flicker = 0.58 + 0.42 * Math.sin(sceneTime * 0.9 + i * 1.7);
        burj.damageUnderlay
          .rect(-width * 0.5, y, width, 1.4 + damageLevel * 1.2)
          .fill({ color: 0x2c1010, alpha: (0.12 + damageLevel * 0.16) * flicker });
        if (i % 2 === 0) {
          burj.damageUnderlay
            .rect(-width * 0.32, y - 1.4, width * 0.64, 0.8)
            .fill({ color: 0xff7040, alpha: damageLevel * 0.08 * flicker });
        }
      }
      if (critical) {
        burj.damageUnderlay
          .rect(-4, -BURJ_H - 36, 8, BURJ_H + 48)
          .fill({ color: 0xff4840, alpha: 0.08 + 0.04 * Math.sin(sceneTime * 3.2) });
      }
    }

    this.updateBurjDecals(burj, game);
    this.updateBurjDamageFx(burj, game, sceneTime, damageLevel, critical);
    this.updateBurjHitFlash(burj, game);

    const beaconBlink = Math.max(0, Math.sin(sceneTime * 3));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    burj.beaconStem.alpha = 0.25 + 0.75 * beaconIntensity;
    burj.beaconGlow.alpha = 0.6 * beaconIntensity;
    burj.beaconGlow.scale.set(1 + beaconIntensity * 0.3);
    burj.groundDecor.alpha = 0.96 + 0.04 * Math.sin(sceneTime * 0.32);
  }

  private updateBurjDecals(burj: GameplayBurjNode, game: GameState): void {
    const seen = new Set<number>();
    for (const decal of game.burjDecals) {
      const texture =
        decal.kind === "drone"
          ? this.pngs[PIXI_PNG_ASSET_KEYS.burjDroneDecal]
          : this.pngs[PIXI_PNG_ASSET_KEYS.burjMissileDecal];
      if (!texture) continue;
      seen.add(decal.id);
      let sprite = burj.decals.get(decal.id);
      if (!sprite) {
        sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        burj.decals.set(decal.id, sprite);
        burj.decalLayer.addChild(sprite);
      }
      sprite.texture = texture;
      sprite.position.set((decal.x - BURJ_X) / 2, (decal.y - GAMEPLAY_TOWER_BASE_Y) / 2);
      sprite.rotation = decal.rotation;
      sprite.alpha = decal.kind === "drone" ? 1 : 0.98;
      sprite.width = 48 * decal.scale;
      sprite.height = 48 * decal.scale;
    }

    for (const [id, sprite] of burj.decals) {
      if (seen.has(id)) continue;
      burj.decals.delete(id);
      sprite.destroy();
    }
  }

  private updateBurjDamageFx(
    burj: GameplayBurjNode,
    game: GameState,
    sceneTime: number,
    damageLevel: number,
    critical: boolean,
  ): void {
    const seen = new Set<number>();

    for (const fx of game.burjDamageFx) {
      seen.add(fx.id);
      const localX = (fx.x - BURJ_X) / 2;
      const localY = (fx.y - GAMEPLAY_TOWER_BASE_Y) / 2;
      const flicker = 0.55 + 0.45 * Math.sin(sceneTime * 6 + fx.seed);
      const emberBoost = 1 + damageLevel * 0.9 + (critical ? 0.45 : 0);
      let graphic = burj.damageFx.get(fx.id);
      if (!graphic) {
        graphic = new Graphics();
        burj.damageFx.set(fx.id, graphic);
        burj.damageFxLayer.addChild(graphic);
      }
      graphic.clear();
      const charX = localX + Math.sin(fx.seed) * 2;
      graphic.ellipse(charX, localY - 2.5, 8.5, 5.5).fill({ color: 0x1c1412, alpha: 0.78 });
      graphic.ellipse(charX - 1.5, localY - 4, 5.5, 2.4).fill({ color: 0x5a2418, alpha: 0.34 + flicker * 0.18 });

      const glowAlpha = Math.min(0.34, (0.08 + flicker * 0.12) * emberBoost);
      graphic.ellipse(localX, localY - 2, 12 + damageLevel * 2, 8 + flicker * 1.5).fill({
        color: 0xff6e2f,
        alpha: glowAlpha,
      });
      graphic.circle(localX, localY - 1, 3.2 + flicker).fill({ color: 0xfff0c8, alpha: 0.58 });
      for (let i = 0; i < 3; i++) {
        const phase = fx.seed + i * 0.9;
        const flameH = (9 + i * 3.4) * (0.82 + 0.28 * Math.sin(sceneTime * 7 + phase) + damageLevel * 0.14);
        const flameW = 3.4 + i * 1.15;
        const baseX = localX + Math.sin(phase) * 1.8;
        const baseY = localY + 1.5;
        graphic
          .moveTo(baseX, baseY)
          .quadraticCurveTo(
            localX - flameW * 0.65 + Math.cos(phase) * 1.2,
            localY - flameH * 0.45,
            localX + Math.sin(phase + 0.25) * 0.8,
            localY - flameH,
          )
          .quadraticCurveTo(localX + flameW * 0.65 + Math.sin(phase) * 1.1, localY - flameH * 0.35, baseX, baseY)
          .fill({
            color: i === 0 ? 0xfff0c8 : i === 1 ? 0xffb458 : 0xff6e2f,
            alpha: 0.82 - i * 0.13,
          });
      }
      if (damageLevel >= 0.5) {
        graphic.ellipse(localX + Math.sin(fx.seed * 1.7 + sceneTime * 0.03) * 4, localY - 15, 8, 14).fill({
          color: 0x221a1c,
          alpha: (0.1 + damageLevel * 0.11 + (critical ? 0.06 : 0)) * (0.72 + 0.28 * flicker),
        });
      }
    }

    for (const [id, graphic] of burj.damageFx) {
      if (seen.has(id)) continue;
      burj.damageFx.delete(id);
      graphic.destroy();
    }
  }

  private updateBurjHitFlash(burj: GameplayBurjNode, game: GameState): void {
    burj.hitFlash.clear();
    const hitFlashT =
      game.burjHitFlashMax > 0 ? Math.max(0, Math.min(1, game.burjHitFlashTimer / game.burjHitFlashMax)) : 0;
    if (hitFlashT <= 0) {
      burj.hitFlashGlow.visible = false;
      return;
    }

    const localX = (game.burjHitFlashX - BURJ_X) / 2;
    const localY = (game.burjHitFlashY - GAMEPLAY_TOWER_BASE_Y) / 2;
    const flashPop = Math.pow(hitFlashT, 0.45);
    const orangeTail = Math.pow(hitFlashT, 0.78);
    const flashFade = 1 - hitFlashT;
    const glowSize = 92 + 84 * flashPop;
    burj.hitFlashGlow.visible = true;
    burj.hitFlashGlow.position.set(localX, localY);
    burj.hitFlashGlow.width = glowSize;
    burj.hitFlashGlow.height = glowSize;
    burj.hitFlashGlow.alpha = 0.94 * orangeTail;

    burj.hitFlash.circle(localX, localY, 8 + 10 * flashPop).fill({ color: 0xfff6dc, alpha: 0.98 * flashPop });
    burj.hitFlash.circle(localX, localY, 14 + 16 * flashPop).fill({ color: 0xffbc68, alpha: 0.46 * orangeTail });
    burj.hitFlash.circle(localX, localY, 12 + 18 * flashPop).stroke({
      width: 1.8,
      color: 0xffeec4,
      alpha: 0.7 * flashPop,
    });
    burj.hitFlash.circle(localX, localY, 20 + 34 * flashFade).stroke({
      width: 1.4,
      color: 0xff9c58,
      alpha: 0.38 * orangeTail,
    });
    burj.hitFlash.circle(localX, localY, 30 + 46 * flashFade).stroke({
      width: 1,
      color: 0xffd2aa,
      alpha: 0.34 * flashPop,
    });
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + flashFade * 0.4;
      const inner = 10 + flashPop * 8;
      const outer = 28 + flashFade * 24;
      burj.hitFlash
        .moveTo(localX + Math.cos(angle) * inner, localY + Math.sin(angle) * inner)
        .lineTo(localX + Math.cos(angle) * outer, localY + Math.sin(angle) * outer)
        .stroke({ width: 1, color: 0xffc082, alpha: 0.18 * orangeTail });
    }
  }

  private updateGameplayWater(state: GameplaySceneState, sceneTime: number): void {
    if (state.water) {
      updatePixiWaterSurface(state.water, sceneTime, 0.88 + 0.04 * Math.sin(sceneTime * 0.4 + 0.6));
    }
    state.waterShade.alpha = 0.16 + 0.04 * Math.sin(sceneTime * 0.24);
  }

  private updateGameplayLaunchers(state: GameplaySceneState, game: GameState, sceneTime: number): void {
    const launcherMaxHP = game.upgrades.launcherKit >= 2 ? 2 : 1;
    const tickNow = game._replayTick || 0;
    const frameProgress = getFrameProgress(
      sceneTime,
      state.launcherAssets.intact.period,
      state.launcherAssets.intact.frameCount,
    );

    state.launchers.forEach((launcher, index) => {
      const hp = game.launcherHP[index] ?? 0;
      const damaged = launcherMaxHP === 2 && hp === 1;
      const assets = damaged ? state.launcherAssets.damaged : state.launcherAssets.intact;
      const alive = hp > 0;

      if (launcher.damaged !== damaged) {
        launcher.chassisStatic.texture = assets.chassisStaticSprite;
        launcher.chassisStatic.position.set(assets.chassisOffset.x, assets.chassisOffset.y);
        positionBlendSprites(launcher.chassis, assets.chassisOffset.x, assets.chassisOffset.y);
        launcher.turret.texture = assets.turretSprite;
        launcher.turret.position.set(assets.turretOffset.x, assets.turretOffset.y);
        launcher.turretRoot.position.set(assets.turretPivot.x, assets.turretPivot.y);
        launcher.damaged = damaged;
      }

      launcher.chassisStatic.visible = alive;
      launcher.chassis.primary.visible = alive;
      launcher.chassis.secondary.visible = alive;
      launcher.turretRoot.visible = alive;
      launcher.wreckage.visible = !alive;
      launcher.hpPips.clear();
      launcher.muzzleFlash.clear();
      launcher.muzzleLight.clear();

      if (!alive) return;

      syncBlendSprites(launcher.chassis, assets.chassisAnimFrames, frameProgress, 1, true);
      const rawLauncher = LAUNCHERS[index];
      const angle = Math.atan2(game.crosshairY - rawLauncher.y, game.crosshairX - rawLauncher.x);
      launcher.turretRoot.rotation = Math.min(-0.2, Math.max(angle, -Math.PI + 0.2));

      drawLauncherMuzzleLight(launcher.muzzleLight, assets.scale, sceneTime, index * 1.7 + 0.3);

      const fireTick = game.launcherFireTick ? game.launcherFireTick[index] : 0;
      const fireAge = tickNow - fireTick;
      const muzzleFlash = fireAge < 6 ? 1 - fireAge / 6 : 0;
      if (muzzleFlash > 0) {
        launcher.muzzleFlash
          .circle(40 * assets.scale, 0, (7 + muzzleFlash * 6) * assets.scale)
          .fill({ color: 0xff341c, alpha: 0.38 + muzzleFlash * 0.28 });
        launcher.muzzleFlash.rect(38 * assets.scale, -1.5 * assets.scale, 3 * assets.scale, 3 * assets.scale).fill({
          color: 0xffffc8,
          alpha: 0.66 + muzzleFlash * 0.24,
        });
      }

      for (let h = 0; h < launcherMaxHP; h++) {
        launcher.hpPips.circle(-4 + h * 8, 39, 2.4).fill(h < hp ? 0x44ff88 : 0x333333);
      }
    });
  }

  private updateGameplayDefenseSites(state: GameplaySceneState, game: GameState, sceneTime: number): void {
    const updateNode = (
      key: string,
      visible: boolean,
      asset: PixiStaticSpriteAsset,
      x: number,
      y: number,
      pulseColor = 0xffffff,
    ) => {
      const node = state.defenseSiteNodes.get(key);
      if (!node) return;
      node.container.visible = visible;
      node.container.position.set(x, y);
      node.sprite.texture = asset.sprite;
      node.sprite.position.set(asset.offset.x, asset.offset.y);
      node.overlay.clear();
      if (!visible) return;
      const pulse = 0.28 + 0.22 * Math.sin(sceneTime * 2 + x * 0.01);
      node.overlay.circle(0, 0, 7).fill({ color: pulseColor, alpha: Math.max(0, pulse) * 0.16 });
    };

    updateNode(
      "patriot",
      game.upgrades.patriot > 0,
      state.defenseSiteAssets.patriotTEL,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.patriot.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.patriot.y,
      COL_HEX.patriot,
    );

    const hornetLevel = Math.max(1, Math.min(3, game.upgrades.wildHornets));
    updateNode(
      "wildHornets",
      game.upgrades.wildHornets > 0,
      state.defenseSiteAssets.wildHornetsHive[hornetLevel - 1],
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.wildHornets.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.wildHornets.y,
      COL_HEX.hornet,
    );

    const roadrunnerLevel = Math.max(1, Math.min(3, game.upgrades.roadrunner));
    updateNode(
      "roadrunner",
      game.upgrades.roadrunner > 0,
      state.defenseSiteAssets.roadrunnerContainer[roadrunnerLevel - 1],
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.roadrunner.x,
      GAMEPLAY_DEFENSE_SITE_PLACEMENTS.roadrunner.y,
      COL_HEX.roadrunner,
    );

    const flareLevel = Math.max(1, Math.min(3, game.upgrades.flare));
    updateNode(
      "flare",
      game.upgrades.flare > 0,
      state.defenseSiteAssets.flareDispenser[flareLevel - 1],
      BURJ_X,
      GAMEPLAY_FLARE_VISUAL_Y,
      COL_HEX.flare,
    );

    const empLevel = Math.max(1, Math.min(3, game.upgrades.emp));
    updateNode(
      "emp",
      game.upgrades.emp > 0,
      state.defenseSiteAssets.empEmitter[empLevel - 1],
      BURJ_X,
      GAMEPLAY_EMP_VISUAL_Y,
      COL_HEX.emp,
    );

    const turrets = game.upgrades.phalanx > 0 ? getPhalanxTurrets(game.upgrades.phalanx) : [];
    for (let index = 0; index < 3; index++) {
      const node = state.defenseSiteNodes.get(`phalanx:${index}`);
      if (!node) continue;
      const turret = turrets[index];
      node.container.visible = Boolean(turret);
      node.overlay.clear();
      if (!turret) continue;
      node.container.position.set(turret.x, turret.y);
      node.overlay.rect(-1, -12, 2, 8).fill(0x99aabb);
      node.overlay.rotation = sceneTime * 18;
      node.overlay.circle(0, -4, 7).fill({ color: COL_HEX.phalanx, alpha: 0.08 });
    }

    state.defenseStatusOverlay.clear();
    for (const site of game.defenseSites) {
      const hw = site.hw ?? 0;
      const hh = site.hh ?? 0;
      if (!site.alive) {
        state.defenseStatusOverlay.rect(site.x - hw * 0.6, site.y - 3, hw * 1.2, 6).fill(0x333333);
        state.defenseStatusOverlay.rect(site.x - hw * 0.3, site.y - 5, hw * 0.4, 4).fill(0x2a2a2a);
        state.defenseStatusOverlay.rect(site.x + 2, site.y - 4, hw * 0.3, 3).fill(0x2a2a2a);
        state.defenseStatusOverlay
          .rect(site.x - hw * 0.6, site.y - 5, hw * 1.2, 8)
          .fill({ color: 0xff3c00, alpha: 0.15 });
        continue;
      }

      const pulse = 0.2 + 0.15 * Math.sin(sceneTime * 3.6);
      state.defenseStatusOverlay
        .rect(site.x - hw, site.y - hh, hw * 2, hh * 2)
        .stroke({ width: 1, color: getDefenseSiteColor(site), alpha: pulse });
    }
  }

  private updateGameplayOverlays(
    state: GameplaySceneState,
    game: GameState,
    sceneTime: number,
    showShop: boolean,
    interpolationAlpha: number,
  ): void {
    this.updateBurjWarningPlate(state.burjWarningPlate, game, sceneTime);
    this.updateCrosshairOverlay(state.crosshairOverlay, game, showShop);
    this.updateUpgradeRangeOverlay(state.upgradeRangeOverlay, game);
    this.updateCollisionOverlay(state.collisionOverlay, game, interpolationAlpha);
  }

  private updateBurjWarningPlate(graphic: Graphics, game: GameState, sceneTime: number): void {
    graphic.clear();
    if (!game.burjAlive) return;

    const artScale = 2;
    const healthRatio = Math.max(0, Math.min(1, game.burjHealth / 5));
    const critical = game.burjHealth <= 1;
    const flashT =
      game.burjHitFlashMax > 0 ? Math.max(0, Math.min(1, game.burjHitFlashTimer / game.burjHitFlashMax)) : 0;
    const warningY = GAMEPLAY_SCENIC_GROUND_Y + 24 * artScale;
    const warningW = 102 * artScale;
    const warningH = critical ? 24 * artScale : 18 * artScale;
    const plateX = BURJ_X - warningW / 2;
    const plateY = warningY - warningH + 2;
    const plateInset = 13 * artScale;
    const barW = warningW - plateInset * 2;
    const barH = 4 * artScale;
    const pulseAlpha = critical ? 0.22 + 0.18 * Math.sin(sceneTime * 7) : 0.12;

    graphic
      .moveTo(plateX + 10 * artScale, plateY)
      .lineTo(plateX + warningW - 10 * artScale, plateY)
      .lineTo(plateX + warningW, plateY + warningH * 0.48)
      .lineTo(plateX + warningW - 8 * artScale, plateY + warningH)
      .lineTo(plateX + 8 * artScale, plateY + warningH)
      .lineTo(plateX, plateY + warningH * 0.48)
      .closePath()
      .fill({ color: critical ? 0x3a0d08 : 0x071621, alpha: 0.72 })
      .stroke({ width: 1.3 * artScale, color: critical ? 0xff4433 : 0x54f0d4, alpha: critical ? 0.75 : 0.42 });

    graphic.rect(plateX + plateInset, plateY + warningH - 8 * artScale, barW, barH).fill({
      color: 0x102332,
      alpha: 0.9,
    });
    graphic
      .rect(plateX + plateInset, plateY + warningH - 8 * artScale, barW * healthRatio, barH)
      .fill(critical ? 0xff4433 : healthRatio > 0.45 ? 0xffcc66 : 0x44ff88);
    graphic
      .rect(plateX + 18 * artScale, plateY + 4 * artScale, warningW - 36 * artScale, 1.5 * artScale)
      .fill({ color: 0xd8fff8, alpha: 0.32 });
    if (pulseAlpha > 0 || flashT > 0) {
      graphic
        .rect(plateX, plateY, warningW, warningH)
        .fill({ color: critical ? 0xff4433 : 0xffffff, alpha: Math.max(pulseAlpha, flashT * 0.18) });
    }
  }

  private updateCrosshairOverlay(graphic: Graphics, game: GameState, showShop: boolean): void {
    graphic.clear();
    if (showShop || this.hideCrosshair) return;
    const cx = game.crosshairX;
    const cy = game.crosshairY;
    const arm = 24;
    const gap = 9;
    graphic
      .circle(cx, cy, 22)
      .fill({ color: 0x00ffc8, alpha: 0.055 })
      .circle(cx, cy, 16)
      .stroke({ width: 1, color: 0x00ffc8, alpha: 0.28 })
      .circle(cx, cy, 2.4)
      .fill({ color: 0xd8fff8, alpha: 0.72 });
    graphic
      .moveTo(cx - arm, cy)
      .lineTo(cx - gap, cy)
      .moveTo(cx + gap, cy)
      .lineTo(cx + arm, cy)
      .moveTo(cx, cy - arm)
      .lineTo(cx, cy - gap)
      .moveTo(cx, cy + gap)
      .lineTo(cx, cy + arm)
      .stroke({ width: 1.25, color: 0x00ffc8, alpha: 0.74, cap: "round" });
  }

  private updateUpgradeRangeOverlay(graphic: Graphics, game: GameState): void {
    graphic.clear();
    if (!game._showUpgradeRanges) return;

    const phalanxRange = ov("upgrade.phalanxRange", 160);
    const systems: ReadonlyArray<{ x: number; y: number; color: number; range?: number }> = [
      {
        x: ov("upgrade.ironBeam.x", BURJ_X),
        y: ov("upgrade.ironBeam.y", 959),
        color: 0xff2200,
        range: ov("upgrade.ironBeamRange", 368),
      },
      {
        x: ov("upgrade.phalanx1.x", 553),
        y: ov("upgrade.phalanx1.y", 1498),
        color: COL_HEX.phalanx,
        range: phalanxRange,
      },
      {
        x: ov("upgrade.phalanx2.x", 860),
        y: ov("upgrade.phalanx2.y", 1504),
        color: COL_HEX.phalanx,
        range: phalanxRange,
      },
      {
        x: ov("upgrade.phalanx3.x", 59),
        y: ov("upgrade.phalanx3.y", GROUND_Y - 30),
        color: COL_HEX.phalanx,
        range: phalanxRange,
      },
      { x: ov("upgrade.patriot.x", 334), y: ov("upgrade.patriot.y", 1511), color: COL_HEX.patriot },
      {
        x: ov("upgrade.emp.x", 462),
        y: ov("upgrade.emp.y", 1047),
        color: COL_HEX.emp,
        range: ov("upgrade.empRange", 1100),
      },
      {
        x: ov("upgrade.flares.x", BURJ_X),
        y: ov("upgrade.flares.y", 837),
        color: COL_HEX.flare,
        range: ov("upgrade.flareActivationRange", 320),
      },
      { x: ov("upgrade.hornets.x", 206), y: ov("upgrade.hornets.y", 1511), color: COL_HEX.hornet },
      {
        x: ov("upgrade.roadrunner.x", 678),
        y: ov("upgrade.roadrunner.y", GROUND_Y - 15),
        color: COL_HEX.roadrunner,
      },
      { x: ov("upgrade.launcherKit.x", 772), y: ov("upgrade.launcherKit.y", 1513), color: 0x66aaff },
    ];

    for (const system of systems) {
      if (system.range) {
        graphic.circle(system.x, system.y, system.range).fill({ color: system.color, alpha: 0.055 });
        graphic.circle(system.x, system.y, system.range).stroke({ width: 2, color: system.color, alpha: 0.38 });
      }
      graphic.circle(system.x, system.y, 20).stroke({ width: 3, color: system.color, alpha: 0.9 });
      graphic.circle(system.x, system.y, 5).fill({ color: system.color, alpha: 0.8 });
    }

    LAUNCHERS.forEach((_, index) => {
      const launcher = getGameplayLauncherPosition(index);
      graphic.circle(launcher.x, launcher.y, 20).stroke({ width: 3, color: 0x00ffcc, alpha: 0.92 });
      graphic
        .moveTo(launcher.x - 8, launcher.y)
        .lineTo(launcher.x + 8, launcher.y)
        .moveTo(launcher.x, launcher.y - 8)
        .lineTo(launcher.x, launcher.y + 8)
        .stroke({ width: 2, color: 0x00ffcc, alpha: 0.92 });
    });
  }

  private updateCollisionOverlay(graphic: Graphics, game: GameState, interpolationAlpha = 1): void {
    graphic.clear();
    if (!game._showColliders) return;

    if (game.burjAlive) {
      const burjTop = getGameplayBurjCollisionTop(2);
      graphic.moveTo(BURJ_X, burjTop);
      for (let y = burjTop + 8; y <= GAMEPLAY_SCENIC_GROUND_Y - 6; y += 18) {
        graphic.lineTo(BURJ_X + getGameplayBurjHalfW(y, 2), y);
      }
      for (let y = GAMEPLAY_SCENIC_GROUND_Y - 6; y >= burjTop + 8; y -= 18) {
        graphic.lineTo(BURJ_X - getGameplayBurjHalfW(y, 2), y);
      }
      graphic.closePath().stroke({ width: 1.5, color: 0x00ffff, alpha: 0.72 });
    }

    for (let index = 0; index < LAUNCHERS.length; index++) {
      if ((game.launcherHP[index] ?? 0) <= 0) continue;
      const launcher = getGameplayLauncherPosition(index);
      graphic.rect(launcher.x - 45, launcher.y - 36, 90, 36).stroke({ width: 1.5, color: 0x00ff00, alpha: 0.7 });
    }

    for (const building of game.buildings) {
      if (!building.alive) continue;
      const bounds = getGameplayBuildingBounds(building);
      graphic
        .rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top)
        .stroke({ width: 1.5, color: 0xffff00, alpha: 0.7 });
    }

    for (const site of game.defenseSites) {
      if (!site.alive) continue;
      const hw = site.hw ?? 0;
      const hh = site.hh ?? 0;
      graphic.rect(site.x - hw, site.y - hh, hw * 2, hh * 2).stroke({ width: 1.5, color: 0xff00ff, alpha: 0.7 });
    }

    graphic
      .moveTo(0, GAMEPLAY_WATERLINE_Y)
      .lineTo(CANVAS_W, GAMEPLAY_WATERLINE_Y)
      .stroke({ width: 1.5, color: 0x66ccff, alpha: 0.7 });

    for (const missile of game.missiles) {
      if (!missile.alive) continue;
      const pos = getRenderPosition(missile, interpolationAlpha);
      graphic.circle(pos.x, pos.y, 4).stroke({ width: 1.5, color: 0xff0000, alpha: 0.7 });
    }
    for (const drone of game.drones) {
      if (!drone.alive) continue;
      const pos = getRenderPosition(drone, interpolationAlpha);
      graphic.circle(pos.x, pos.y, drone.collisionRadius).stroke({ width: 1.5, color: 0xffa500, alpha: 0.7 });
    }
    for (const interceptor of game.interceptors) {
      if (!interceptor.alive) continue;
      const pos = getRenderPosition(interceptor, interpolationAlpha);
      graphic.circle(pos.x, pos.y, 18).stroke({ width: 1.5, color: 0x44ffaa, alpha: 0.7 });
    }
    for (const explosion of game.explosions) {
      if (explosion.alpha < 0.05) continue;
      const pos = getRenderPosition(explosion, interpolationAlpha);
      graphic.circle(pos.x, pos.y, explosion.radius).stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
    }
  }

  private updateGameplayDynamicEntities(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    this.updateGameplayFlares(state, game, sceneTime, interpolationAlpha);
    this.updateGameplayPlanes(state, game, sceneTime, interpolationAlpha);
    this.updateGameplayLasers(state, game);
    this.updateGameplayEmpRings(state, game);
    this.updateGameplayPhalanxBullets(state, game, interpolationAlpha);
    state.trailBatch.beginFrame();
    this.updateGameplayMissiles(state, game, sceneTime, interpolationAlpha);
    this.updateGameplayDrones(state, game, sceneTime, interpolationAlpha);
    this.updateGameplayInterceptors(state, game, sceneTime, interpolationAlpha);
    this.updateGameplayUpgradeProjectiles(state, game, sceneTime, interpolationAlpha);
    state.trailBatch.endFrame();
    this.updateGameplayExplosions(state, game, interpolationAlpha);
    this.updateGameplayParticles(state, game, interpolationAlpha);
  }

  private updateGameplayMissiles(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.missiles,
      game.missiles,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );

    for (const missile of game.missiles) {
      const asset = getThreatSpriteAsset(state.threatAssets, missile);
      let node = state.missiles.get(missile);
      if (!node) {
        node = createProjectileNode(asset);
        state.missiles.set(missile, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }

      const angle = Math.atan2(missile.vy, missile.vx);
      const pos = getRenderPosition(missile, interpolationAlpha);
      syncProjectileNode(node, asset, pos.x, pos.y, angle, sceneTime, 1, true);
      const isFastMissile = missile.variant === "fast";
      node.anim.primary.tint = isFastMissile ? 0xfff0c0 : 0xffffff;
      node.anim.secondary.tint = isFastMissile ? 0xfff0c0 : 0xffffff;
      node.overlay.clear();

      if (
        missile.type === "bomb" ||
        missile.type === "stack2" ||
        missile.type === "stack3" ||
        missile.type === "stack_child"
      ) {
        const wide = missile.type === "stack3" ? 5.4 : missile.type === "stack2" ? 4.8 : 3.2;
        node.trail.clear();
        state.trailBatch.addTrail(missile.trail, pos.x, pos.y, {
          outerColor: isFastMissile ? 0xff3a1f : 0xff8c3a,
          coreColor: isFastMissile ? 0xfff4aa : missile.type === "stack_child" ? 0xffe7b8 : 0xeee4d8,
          headColor: isFastMissile ? 0xffff88 : missile.type === "stack_child" ? 0xffb45c : 0xffd694,
          width: wide * (isFastMissile ? 1.24 : 1) * GAMEPLAY_EFFECT_SCALE,
          coreWidth: wide * 0.42 * GAMEPLAY_EFFECT_SCALE,
          headRadius: (isFastMissile ? 2.2 : 1.7) * GAMEPLAY_EFFECT_SCALE,
        });
      } else if (missile.type === "mirv" || missile.type === "mirv_warhead") {
        drawSimpleTrailDots(
          node.trail,
          missile.trail,
          isFastMissile ? 0xffd040 : missile.type === "mirv" ? 0xc8a078 : 0xdc6432,
          (missile.type === "mirv" ? 3.2 : 1.7) * (isFastMissile ? 1.25 : 1) * GAMEPLAY_EFFECT_SCALE,
          missile.type === "mirv" ? 0.5 : 0.4,
        );
      } else {
        drawSimpleTrailDots(
          node.trail,
          missile.trail,
          isFastMissile ? 0xffcc44 : 0x707e94,
          1.8 * (isFastMissile ? 1.35 : 1) * GAMEPLAY_EFFECT_SCALE,
          isFastMissile ? 0.36 : 0.24,
        );
      }

      if (isFastMissile) {
        const pulse = 1 + Math.sin(game.time * 0.38 + pos.x * 0.02) * 0.18;
        node.overlay
          .circle(pos.x, pos.y, 7 * pulse * GAMEPLAY_EFFECT_SCALE)
          .stroke({ width: 1.3 * GAMEPLAY_EFFECT_SCALE, color: 0xffe45a, alpha: 0.72 });
      }

      if (
        missile.type === "mirv" &&
        missile.health != null &&
        missile.maxHealth != null &&
        missile.health < missile.maxHealth
      ) {
        const barW = 24 * GAMEPLAY_ENEMY_SCALE;
        const barH = 3 * GAMEPLAY_ENEMY_SCALE;
        const ratio = Math.max(0, Math.min(1, missile.health / missile.maxHealth));
        node.overlay.rect(pos.x - barW / 2, pos.y - 16 * GAMEPLAY_ENEMY_SCALE, barW, barH).fill({
          color: 0x000000,
          alpha: 0.6,
        });
        node.overlay
          .rect(pos.x - barW / 2, pos.y - 16 * GAMEPLAY_ENEMY_SCALE, barW * ratio, barH)
          .fill(ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffaa00 : 0xff2222);
      }

      if (missile.luredByFlare) {
        node.overlay
          .circle(pos.x, pos.y, (8 + Math.sin(game.time * 0.22 + pos.x * 0.01) * 1.5) * GAMEPLAY_EFFECT_SCALE)
          .stroke({ width: 1.5 * GAMEPLAY_EFFECT_SCALE, color: 0xffb45a, alpha: 0.75 });
      }
    }
  }

  private updateGameplayDrones(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.drones,
      game.drones,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );

    for (const drone of game.drones) {
      const asset = getThreatSpriteAsset(state.threatAssets, drone);
      let node = state.drones.get(drone);
      if (!node) {
        node = createProjectileNode(asset);
        state.drones.set(drone, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }

      const trail = drone.trail ?? [];
      const facing = drone.vx > 0 ? 1 : -1;
      const spriteAngle =
        drone.subtype === "shahed238" || drone.diving ? Math.atan2(drone.vy, drone.vx) : facing > 0 ? 0 : Math.PI;
      const pos = getRenderPosition(drone, interpolationAlpha);
      syncProjectileNode(node, asset, pos.x, pos.y, spriteAngle, sceneTime, 1, true);
      const isFastDrone = drone.variant === "fast";
      node.anim.primary.tint = isFastDrone ? 0xffe0a8 : 0xffffff;
      node.anim.secondary.tint = isFastDrone ? 0xffe0a8 : 0xffffff;
      node.overlay.clear();

      if (drone.subtype === "shahed238") {
        node.trail.clear();
        state.trailBatch.addTrail(trail, pos.x, pos.y, {
          outerColor: isFastDrone ? 0xff341a : 0xff823c,
          coreColor: isFastDrone ? 0xfff0ba : 0xd2dce6,
          headColor: isFastDrone ? 0xffff66 : 0xffcd78,
          width: 3.8 * (isFastDrone ? 1.22 : 1) * GAMEPLAY_EFFECT_SCALE,
          coreWidth: 1.4 * GAMEPLAY_EFFECT_SCALE,
          headRadius: (isFastDrone ? 2.1 : 1.6) * GAMEPLAY_EFFECT_SCALE,
        });
      } else {
        drawSimpleTrailDots(
          node.trail,
          trail,
          isFastDrone ? 0xffc14a : 0x889098,
          1.2 * (isFastDrone ? 1.35 : 1) * GAMEPLAY_EFFECT_SCALE,
          isFastDrone ? 0.44 : 0.32,
        );
      }

      if (isFastDrone) {
        const pulse = 1 + Math.sin(game.time * 0.34 + pos.y * 0.015) * 0.16;
        node.overlay
          .circle(pos.x, pos.y, (drone.subtype === "shahed238" ? 9 : 12) * pulse * GAMEPLAY_EFFECT_SCALE)
          .stroke({ width: 1.2 * GAMEPLAY_EFFECT_SCALE, color: 0xffd24a, alpha: 0.7 });
      }

      if (drone.diving) {
        node.overlay
          .circle(pos.x, pos.y, 20 * GAMEPLAY_ENEMY_SCALE)
          .stroke({ width: GAMEPLAY_EFFECT_SCALE, color: 0xff2200, alpha: 0.5 + Math.sin(game.time * 0.3) * 0.3 });
      }

      if (Math.sin(game.time * 0.15) > 0) {
        node.overlay
          .circle(pos.x, pos.y, 0.75 * GAMEPLAY_EFFECT_SCALE * GAMEPLAY_ENEMY_SCALE)
          .fill(drone.subtype === "shahed238" ? 0xff2200 : 0xff4400);
      }
    }
  }

  private updateGameplayInterceptors(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.interceptors,
      game.interceptors,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );

    for (const interceptor of game.interceptors) {
      const asset = interceptor.fromF15
        ? state.interceptorAssets.f15Interceptor
        : state.interceptorAssets.playerInterceptor;
      let node = state.interceptors.get(interceptor);
      if (!node) {
        node = createProjectileNode(asset);
        state.interceptors.set(interceptor, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }

      const pos = getRenderPosition(interceptor, interpolationAlpha);
      const heading =
        typeof interceptor.heading === "number"
          ? interceptor.heading
          : interceptor.trail.length >= 1
            ? Math.atan2(
                pos.y - interceptor.trail[interceptor.trail.length - 1].y,
                pos.x - interceptor.trail[interceptor.trail.length - 1].x,
              )
            : Math.atan2(interceptor.vy || -1, interceptor.vx || 0);

      syncProjectileNode(node, asset, pos.x, pos.y, heading, sceneTime, 1, true);
      node.overlay.clear();
      node.trail.clear();
      state.trailBatch.addTrail(interceptor.trail, pos.x, pos.y, {
        outerColor: interceptor.fromF15 ? 0x96c8ff : 0x6edcff,
        coreColor: interceptor.fromF15 ? 0xd6ecff : 0x84e8ff,
        headColor: interceptor.fromF15 ? 0xc8eeff : 0x8ff6ff,
        width: (interceptor.fromF15 ? 1.5 : 2.2) * GAMEPLAY_EFFECT_SCALE,
        coreWidth: (interceptor.fromF15 ? 0.7 : 1.1) * GAMEPLAY_EFFECT_SCALE,
        headRadius: 1.6 * GAMEPLAY_EFFECT_SCALE,
        alpha: interceptor.fromF15 ? 0.85 : 1,
      });
    }
  }

  private updateGameplayUpgradeProjectiles(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.hornets,
      game.hornets,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );
    cleanupEntityMap(
      state.roadrunners,
      game.roadrunners,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );
    cleanupEntityMap(
      state.patriotMissiles,
      game.patriotMissiles,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );

    for (const hornet of game.hornets) {
      let node = state.hornets.get(hornet);
      if (!node) {
        node = createProjectileNode(state.upgradeProjectileAssets.wildHornet);
        state.hornets.set(hornet, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }
      const prev = hornet.trail[hornet.trail.length - 1];
      const pos = getRenderPosition(hornet, interpolationAlpha);
      const heading = prev ? Math.atan2(pos.y - prev.y, pos.x - prev.x) : 0;
      node.trail.clear();
      state.trailBatch.addTrail(hornet.trail, pos.x, pos.y, {
        outerColor: 0xffcc00,
        coreColor: 0xfff8b0,
        headColor: 0xffdc5c,
        width: 3 * GAMEPLAY_EFFECT_SCALE,
        coreWidth: 1.2 * GAMEPLAY_EFFECT_SCALE,
        headRadius: 1.7 * GAMEPLAY_EFFECT_SCALE,
      });
      node.overlay.clear();
      syncProjectileNode(
        node,
        state.upgradeProjectileAssets.wildHornet,
        pos.x,
        pos.y,
        heading + Math.PI / 2,
        sceneTime,
        1,
        true,
      );
    }

    for (const roadrunner of game.roadrunners) {
      let node = state.roadrunners.get(roadrunner);
      if (!node) {
        node = createProjectileNode(state.upgradeProjectileAssets.roadrunner);
        state.roadrunners.set(roadrunner, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }
      const prev = roadrunner.trail[roadrunner.trail.length - 1];
      const pos = getRenderPosition(roadrunner, interpolationAlpha);
      const heading = prev ? Math.atan2(pos.y - prev.y, pos.x - prev.x) + Math.PI / 2 : roadrunner.heading;
      node.trail.clear();
      state.trailBatch.addTrail(roadrunner.trail, pos.x, pos.y, {
        outerColor: 0x44aaff,
        coreColor: 0xc4ecff,
        headColor: 0x7cd6ff,
        width: 3.8 * GAMEPLAY_EFFECT_SCALE,
        coreWidth: 1.5 * GAMEPLAY_EFFECT_SCALE,
        headRadius: 1.9 * GAMEPLAY_EFFECT_SCALE,
      });
      node.overlay.clear();
      syncProjectileNode(node, state.upgradeProjectileAssets.roadrunner, pos.x, pos.y, heading, sceneTime, 1, true);
    }

    for (const patriot of game.patriotMissiles) {
      let node = state.patriotMissiles.get(patriot);
      if (!node) {
        node = createProjectileNode(state.upgradeProjectileAssets.patriotSam);
        state.patriotMissiles.set(patriot, node);
        this.gameplayProjectileLayer.addChild(node.container);
      }
      const prev = patriot.trail[patriot.trail.length - 1];
      const pos = getRenderPosition(patriot, interpolationAlpha);
      const heading = prev ? Math.atan2(pos.y - prev.y, pos.x - prev.x) + Math.PI / 2 : (patriot.heading ?? 0);
      node.trail.clear();
      state.trailBatch.addTrail(patriot.trail, pos.x, pos.y, {
        outerColor: 0x88ff44,
        coreColor: 0xeaffd0,
        headColor: 0xb6ff76,
        width: 2.5 * GAMEPLAY_EFFECT_SCALE,
        coreWidth: 1.2 * GAMEPLAY_EFFECT_SCALE,
        headRadius: 1.9 * GAMEPLAY_EFFECT_SCALE,
      });
      node.overlay.clear();
      const flameLen = 5 + 4 * pulse(game.time, 0.5, pos.x * 0.02 + pos.y * 0.015);
      const flameY = pos.y + Math.cos(heading) * 8 * GAMEPLAY_PROJECTILE_SCALE;
      const flameX = pos.x - Math.sin(heading) * 8 * GAMEPLAY_PROJECTILE_SCALE;
      node.overlay.circle(flameX, flameY, flameLen * 0.55).fill({ color: 0xffaa22, alpha: 0.72 });
      syncProjectileNode(node, state.upgradeProjectileAssets.patriotSam, pos.x, pos.y, heading, sceneTime, 1, true);
    }
  }

  private updateGameplayFlares(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.flares,
      game.flares,
      (flare) => flare.alive,
      (node) => node.container.destroy({ children: true }),
    );

    for (const flare of game.flares) {
      if (!flare.alive) continue;
      let node = state.flares.get(flare);
      if (!node) {
        const container = new Container();
        const trail = new Graphics();
        const glow = new Graphics();
        container.addChild(trail, glow);
        node = { container, trail, glow };
        state.flares.set(flare, node);
        this.gameplayEffectsLayer.addChild(container);
      }
      const pos = getRenderPosition(flare, interpolationAlpha);
      const alpha = Math.min(1, flare.life / 24);
      const flicker = 0.78 + 0.22 * Math.sin(game.time * 0.25 + pos.x * 0.03);
      drawSimpleTrailDots(node.trail, flare.trail, COL_HEX.flare, 2.4 * GAMEPLAY_EFFECT_SCALE, alpha);
      node.glow.clear();
      node.glow
        .circle(pos.x, pos.y, (13 + Math.sin(sceneTime * 10 + flare.id) * 1.8) * GAMEPLAY_PROJECTILE_SCALE)
        .fill({
          color: COL_HEX.flare,
          alpha: alpha * flicker * 0.18,
        });
      node.glow
        .circle(pos.x, pos.y, (5 + Math.sin(game.time * 0.18 + flare.id) * 0.8) * GAMEPLAY_PROJECTILE_SCALE)
        .fill({
          color: COL_HEX.flare,
          alpha: alpha * flicker,
        });
      node.glow.circle(pos.x, pos.y, 2.4 * GAMEPLAY_PROJECTILE_SCALE).fill({ color: 0xfff4d0, alpha });
      node.glow
        .circle(pos.x, pos.y, (8 + Math.sin(game.time * 0.16 + flare.id) * 1.2) * GAMEPLAY_PROJECTILE_SCALE)
        .stroke({ width: 1.2 * GAMEPLAY_PROJECTILE_SCALE, color: 0xffe6b4, alpha: alpha * 0.65 });
    }
  }

  private updateGameplayPlanes(
    state: GameplayDynamicState,
    game: GameState,
    sceneTime: number,
    interpolationAlpha = 1,
  ): void {
    cleanupEntityMap(
      state.planes,
      game.planes,
      (plane) => plane.alive,
      (node) => node.container.destroy({ children: true }),
    );

    for (const plane of game.planes) {
      if (!plane.alive) continue;
      let node = state.planes.get(plane);
      if (!node) {
        const container = new Container();
        const airframe = createStaticAssetSprite(state.planeAssets.f15Airframe);
        const liveFx = new Graphics();
        container.addChild(airframe, liveFx);
        node = { container, airframe, liveFx };
        state.planes.set(plane, node);
        this.gameplayEffectsLayer.addChild(container);
      }
      const pos = getRenderPosition(plane, interpolationAlpha);
      node.container.position.set(pos.x, pos.y);
      node.container.scale.set(plane.vx < 0 ? -GAMEPLAY_PLANE_SCALE : GAMEPLAY_PLANE_SCALE, GAMEPLAY_PLANE_SCALE);
      node.container.rotation = plane.evadeTimer > 0 ? (plane.vy > 0 ? 0.3 : -0.3) : 0;
      node.airframe.texture = state.planeAssets.f15Airframe.sprite;
      node.airframe.position.set(state.planeAssets.f15Airframe.offset.x, state.planeAssets.f15Airframe.offset.y);
      node.liveFx.clear();
      const abLen = 5 + 4 * pulse(sceneTime, 0.35, pos.x * 0.04 + pos.y * 0.02);
      node.liveFx
        .moveTo(-22, -3)
        .lineTo(-22 - abLen, -2)
        .lineTo(-22, -1)
        .closePath()
        .fill(0xff8844);
      node.liveFx
        .moveTo(-22, 1)
        .lineTo(-22 - abLen, 2)
        .lineTo(-22, 3)
        .closePath()
        .fill(0xff8844);
      if (Math.sin(plane.blinkTimer * 0.15) > 0) {
        node.liveFx.circle(-10, -14, 1.5).fill(0xff0000);
        node.liveFx.circle(-10, 14, 1.5).fill(0x00ff00);
      }
    }
  }

  private updateGameplayLasers(state: GameplayDynamicState, game: GameState): void {
    let used = 0;
    for (const beam of game.laserBeams) {
      if (beam.x1 == null || beam.y1 == null || beam.x2 == null || beam.y2 == null) continue;
      const alpha = beam.maxLife ? (beam.life ?? 0) / beam.maxLife : 1;
      const dx = beam.x2 - beam.x1;
      const dy = beam.y2 - beam.y1;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const sprite = getPooledSprite(
        state.laserPool,
        this.gameplayEffectsLayer,
        used++,
        state.effectAssets.laserBeam.sprite,
        0,
        0.5,
      );
      sprite.position.set(beam.x1, beam.y1);
      sprite.rotation = Math.atan2(dy, dx);
      sprite.width = length;
      sprite.height = 8 * GAMEPLAY_EFFECT_SCALE;
      sprite.alpha = Math.max(0, Math.min(1, alpha * 0.92));
      sprite.tint = COL_HEX.laser;
    }
    hideUnusedSprites(state.laserPool, used);
  }

  private updateGameplayEmpRings(state: GameplayDynamicState, game: GameState): void {
    let used = 0;
    for (const ring of game.empRings) {
      if (ring.alive === false) continue;
      const progress = ring.maxRadius > 0 ? Math.max(0, Math.min(1, ring.radius / ring.maxRadius)) : 1;
      const node = getPooledEmpRingNode(state.empRingPool, this.gameplayEffectsLayer, used++, state.effectAssets);
      if (progress < 0.15) {
        node.flash.rect(0, 0, CANVAS_W, CANVAS_H).fill({
          color: COL_HEX.emp,
          alpha: (1 - progress / 0.15) * 0.18,
        });
      }
      syncCenteredSprite(node.wash, ring.x, ring.y, ring.radius * 2, ring.alpha * 0.2, COL_HEX.emp);
      syncCenteredSprite(
        node.ring,
        ring.x,
        ring.y,
        ring.radius * 2.16,
        ring.alpha * (0.8 + (1 - progress) * 0.18),
        COL_HEX.emp,
      );
    }
    hideUnusedEmpRingNodes(state.empRingPool, used);
  }

  private updateGameplayPhalanxBullets(state: GameplayDynamicState, game: GameState, interpolationAlpha = 1): void {
    let used = 0;
    for (const bullet of game.phalanxBullets) {
      const endpoint = getRenderBulletEndpoint(bullet, interpolationAlpha);
      if (!endpoint) continue;
      const dx = endpoint.x - bullet.x;
      const dy = endpoint.y - bullet.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const sprite = getPooledSprite(
        state.phalanxPool,
        this.gameplayParticleLayer,
        used++,
        state.effectAssets.phalanxBullet.sprite,
        0,
        0.5,
      );
      sprite.position.set(bullet.x, bullet.y);
      sprite.rotation = Math.atan2(dy, dx);
      sprite.width = length + 8 * GAMEPLAY_PROJECTILE_SCALE;
      sprite.height = 3 * GAMEPLAY_PROJECTILE_SCALE;
      sprite.alpha = 0.84;
      sprite.tint = COL_HEX.phalanx;
    }
    hideUnusedSprites(state.phalanxPool, used);
  }

  private updateGameplayExplosions(state: GameplayDynamicState, game: GameState, interpolationAlpha = 1): void {
    cleanupEntityMap(
      state.explosions,
      game.explosions,
      () => true,
      (node) => node.container.destroy({ children: true }),
    );

    for (const explosion of game.explosions) {
      let node = state.explosions.get(explosion);
      if (!node) {
        const container = new Container();
        const light = createEffectSprite(state.effectAssets.explosion.light);
        const splash = createEffectSprite(state.effectAssets.explosion.splash);
        const fireball = createEffectSprite(state.effectAssets.explosion.fireball);
        const core = createEffectSprite(state.effectAssets.explosion.core);
        const ring = createEffectSprite(state.effectAssets.explosion.ring);
        const link = new Graphics();
        container.addChild(link, light, splash, fireball, core, ring);
        node = { container, light, splash, fireball, core, ring, link };
        state.explosions.set(explosion, node);
        this.gameplayParticleLayer.addChild(container);
      }
      node.link.clear();
      const color = memoCssColorToNumber(explosion.color, 0xffaa44);
      const radius = explosion.radius * GAMEPLAY_EFFECT_SCALE;
      const chainBoost = 1 + (explosion.chainLevel ?? 0) * 0.12 + (explosion.heroPulse ?? 0) * 0.08;
      const rootBoost =
        explosion.rootExplosionId == null && (explosion.kills ?? 0) >= 2
          ? 1 + Math.min(0.45, (explosion.kills ?? 0) * 0.08)
          : 1;
      const boostedRadius = radius * chainBoost * rootBoost;
      const visualBoost =
        explosion.visualType === "drone"
          ? 1.12
          : explosion.visualType === "missile"
            ? 1.02
            : explosion.playerCaused
              ? 0.72
              : 1;
      const pos = getRenderPosition(explosion, interpolationAlpha);

      syncCenteredSprite(
        node.light,
        pos.x,
        pos.y,
        boostedRadius * ov("explosion.lightRadiusMul", 7.2) * visualBoost,
        explosion.alpha * ov("explosion.lightIntensity", 0.13),
        color,
      );
      syncCenteredSprite(
        node.splash,
        pos.x,
        pos.y,
        boostedRadius * ov("explosion.splashRadiusMul", 4.4) * visualBoost,
        explosion.alpha * ov("explosion.splashIntensity", 0.34),
        color,
      );
      syncCenteredSprite(
        node.fireball,
        pos.x,
        pos.y,
        boostedRadius * ov("explosion.fireballRadiusMul", 2.25) * visualBoost,
        explosion.alpha * (explosion.playerCaused && !explosion.chain ? 0.72 : ov("explosion.fireballAlpha", 0.92)),
        color,
      );
      syncCenteredSprite(
        node.core,
        pos.x,
        pos.y,
        boostedRadius * ov("explosion.coreRadiusMul", 0.58) * visualBoost,
        explosion.alpha * ov("explosion.coreAlpha", 0.88),
        0xfff6dc,
      );
      syncCenteredSprite(
        node.ring,
        pos.x,
        pos.y,
        explosion.ringRadius * GAMEPLAY_EFFECT_SCALE * 2.25,
        explosion.ringAlpha * explosion.alpha * (1 + (explosion.heroPulse ?? 0) * 0.18),
        color,
      );
      if ((explosion.linkAlpha ?? 0) > 0 && explosion.linkFromX != null && explosion.linkFromY != null) {
        node.link
          .moveTo(explosion.linkFromX, explosion.linkFromY)
          .lineTo(pos.x, pos.y)
          .stroke({
            width: (8 + (explosion.chainLevel ?? 0) * 2.2) * GAMEPLAY_EFFECT_SCALE * 0.4,
            color,
            alpha: Math.min(1, (explosion.linkAlpha ?? 0) * explosion.alpha),
            cap: "round",
          });
      }
    }
  }

  private updateGameplayParticles(state: GameplayDynamicState, game: GameState, interpolationAlpha = 1): void {
    let used = 0;
    for (const particle of game.particles) {
      const pos = getRenderPosition(particle, interpolationAlpha);
      const alpha = particle.maxLife > 0 ? Math.max(0, Math.min(1, particle.life / particle.maxLife)) : 1;
      const color = memoCssColorToNumber(particle.color, 0xffaa44);
      const graphic = getPooledGraphic(state.particlePool, this.gameplayParticleLayer, used++);

      if (particle.type === "debris") {
        const w = (particle.w ?? particle.size) * GAMEPLAY_EFFECT_SCALE * 1.5;
        const h = (particle.h ?? particle.size) * GAMEPLAY_EFFECT_SCALE * 1.5;
        const angle = particle.angle ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const points = [
          { x: -w / 2, y: -h / 2 },
          { x: w / 2, y: 0 },
          { x: -w / 2, y: h / 2 },
        ].map((point) => ({
          x: pos.x + point.x * cos - point.y * sin,
          y: pos.y + point.x * sin + point.y * cos,
        }));
        graphic
          .moveTo(points[0].x, points[0].y)
          .lineTo(points[1].x, points[1].y)
          .lineTo(points[2].x, points[2].y)
          .closePath()
          .fill({
            color,
            alpha,
          });
      } else if (particle.type === "spark") {
        graphic
          .moveTo(pos.x - particle.vx * 5, pos.y - particle.vy * 5)
          .lineTo(pos.x, pos.y)
          .stroke({ width: particle.size * GAMEPLAY_EFFECT_SCALE * 1.2, color, alpha, cap: "round" });
        graphic.circle(pos.x, pos.y, particle.size * 0.7 * GAMEPLAY_EFFECT_SCALE).fill({ color: 0xffffff, alpha });
      } else {
        graphic.circle(pos.x, pos.y, particle.size * GAMEPLAY_EFFECT_SCALE).fill({ color, alpha });
      }
    }
    hideUnusedGraphics(state.particlePool, used);
  }

  private updateTitleScene(state: TitleSceneState, timeSeconds: number): void {
    const skyFrameProgress = getFrameProgress(timeSeconds, state.skyAssets.period, state.skyAssets.frameCount);
    syncBlendSprites(state.skyBlend, state.skyAssets.frames, skyFrameProgress);

    if (state.nebula) {
      state.nebula.alpha = 0.16 + 0.05 * Math.sin(timeSeconds * 0.18 + 0.8);
      state.nebula.position.set(-40 + Math.sin(timeSeconds * 0.12) * 10, -20 + Math.cos(timeSeconds * 0.09) * 6);
    }

    state.buildings.forEach((building, index) => {
      const playbackRate =
        1 - TITLE_BUILDING_PLAYBACK_RATE_JITTER * 0.5 + building.playbackSeed * TITLE_BUILDING_PLAYBACK_RATE_JITTER;
      const phaseOffset = building.playbackSeed * TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const phase =
        (((timeSeconds * playbackRate + phaseOffset) % TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS) +
          TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS) /
        TITLE_BUILDING_PLAYBACK_PERIOD_SECONDS;
      const frameProgress = phase * state.buildingAssets.frameCount;
      const slotProgress = frameProgress % 1;
      const blendStart = 1 - TITLE_BUILDING_BLEND_WINDOW;
      const blendAmount =
        slotProgress <= blendStart ? 0 : Math.min(1, (slotProgress - blendStart) / TITLE_BUILDING_BLEND_WINDOW);
      const driftX = Math.round(Math.sin(timeSeconds * 0.05 + index * 0.8) * 1.35);

      building.container.position.x = driftX;
      syncBlendSprites(
        building.anim,
        state.buildingAssets.animFrames[index] ?? [],
        Math.floor(frameProgress) + blendAmount,
        TITLE_BUILDING_ANIM_ALPHA,
      );
    });

    const burjFrameProgress = getFrameProgress(timeSeconds, state.burjAssets.period, state.burjAssets.frameCount);
    syncBlendSprites(state.burjAnim, state.burjAssets.animFrames, burjFrameProgress);

    const beaconBlink = Math.max(0, Math.sin(timeSeconds * 3));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    state.beaconStem.alpha = 0.25 + 0.75 * beaconIntensity;
    state.beaconGlow.alpha = 0.6 * beaconIntensity;
    state.beaconGlow.scale.set(1 + beaconIntensity * 0.3);
    if (state.burjGlow) {
      state.burjGlow.alpha = 0.94 + 0.06 * Math.sin(timeSeconds * 0.32);
    }

    const launcherFrameProgress = getFrameProgress(
      timeSeconds,
      state.launcherAssets.period,
      state.launcherAssets.frameCount,
    );
    state.launchers.forEach((launcher, index) => {
      const sweep = Math.sin(timeSeconds * 0.45 + index * 1.2) * 0.18;
      const angle = Math.min(-0.25, Math.max(TITLE_LAUNCHER_ANGLES[index] + sweep, -Math.PI + 0.25));
      syncBlendSprites(launcher.chassis, state.launcherAssets.chassisAnimFrames, launcherFrameProgress);
      launcher.turretRoot.rotation = angle;
      launcher.muzzleLight.clear();
      drawLauncherMuzzleLight(launcher.muzzleLight, state.launcherAssets.scale, timeSeconds, index * 1.7 + 0.3);
    });

    state.threats.forEach((threat, index) => {
      const aimAngle = Math.atan2(TITLE_TARGET_Y - threat.y, TITLE_TARGET_X - threat.x);
      const rotation = threat.kind === "shahed" ? aimAngle + 0.08 : aimAngle + 0.04;
      const titleTime = getTitleThreatAnimationTime(timeSeconds, threat.kind, index);
      const asset = threat.kind === "shahed" ? state.threatAssets.shahed136 : state.threatAssets.missile;
      const frameProgress = getFrameProgress(titleTime, asset.period, asset.frameCount);

      threat.container.rotation = rotation;
      syncBlendSprites(threat.anim, asset.animFrames, frameProgress);
      this.updateThreatTrail(threat, timeSeconds, index);
    });

    if (state.water) {
      updatePixiWaterSurface(state.water, timeSeconds, 0.9 + 0.04 * Math.sin(timeSeconds * 0.4 + 0.6));
    }
    state.waterShade.alpha = 0.22 + 0.04 * Math.sin(timeSeconds * 0.24);

    const skylineDrift = Math.sin(timeSeconds * 0.05) * 1.8;
    state.ambientMarkers.forEach((marker, index) => {
      marker.position.x = skylineDrift;
      marker.alpha = 0.12;
      marker.y = TITLE_GROUND_Y - 82 - (index % 2) * 6;
    });
  }

  private updateThreatTrail(threat: TitleThreatNode, timeSeconds: number, index: number): void {
    threat.trail.clear();
    if (threat.kind === "shahed") {
      const pulseAmount = getTitleShahedTrailPulse(timeSeconds, index);
      const trailLength = 74 + pulseAmount * 18;
      const beaconAlpha = getTitleShahedBeaconAlpha(timeSeconds, index);
      threat.beacon.clear();
      threat.beacon
        .circle(0, 0, 7)
        .fill({ color: 0xff3b22, alpha: beaconAlpha * 0.22 })
        .circle(0, 0, 2.8)
        .fill({ color: 0xff3b22, alpha: beaconAlpha });
      threat.trail
        .moveTo(-trailLength, 0)
        .lineTo(0, 0)
        .stroke({ width: 6.6 + pulseAmount * 1.7, color: 0x889098, alpha: 0.1 + pulseAmount * 0.08, cap: "round" })
        .moveTo(-trailLength * 0.78, 0)
        .lineTo(0, 0)
        .stroke({ width: 2.3 + pulseAmount * 0.8, color: 0xc4ccd4, alpha: 0.32 + pulseAmount * 0.2, cap: "round" })
        .moveTo(-10.8 - (9 + pulseAmount * 9), 0)
        .lineTo(-10.3, 0)
        .stroke({ width: 1.25, color: 0xc4ccd4, alpha: 0.2 + pulseAmount * 0.1, cap: "round" })
        .circle(-10.6, 0, 1.15 + pulseAmount * 0.3)
        .fill({ color: 0xc4aa76, alpha: 0.18 + pulseAmount * 0.08 });
      return;
    }

    threat.beacon.clear();
    threat.trail
      .moveTo(-70, 0)
      .lineTo(0, 0)
      .stroke({ width: 7.2, color: 0x707e94, alpha: 0.14, cap: "round" })
      .moveTo(-70, 0)
      .lineTo(0, 0)
      .stroke({ width: 3, color: 0xd0dce8, alpha: 0.46, cap: "round" })
      .circle(0, 0, 3.6)
      .fill(0xffbc5c);
  }
}
