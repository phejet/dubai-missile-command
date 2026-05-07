import { SCENIC_BUILDING_LAYOUT } from "../game-logic";

export const HERO_STAR_THRESHOLD = 0.72;

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
  | "missile_fast"
  | "mirv"
  | "mirv_warhead"
  | "bomb"
  | "stack_carrier_2"
  | "stack_carrier_3"
  | "stack_child"
  | "shahed136"
  | "shahed136_dive"
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

export interface SharedLauncherOptions {
  t: number;
  scale?: number;
  alpha?: number;
  damaged?: boolean;
  active?: boolean;
  muzzleFlash?: number;
  statusLabel?: string | null;
}

export const TITLE_SKYLINE_TOWERS: TitleTower[] = [...SCENIC_BUILDING_LAYOUT];

export function hash01(a: number, b = 0, c = 0, d = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

export function getStarTwinkleProfile(time: number, phase: number, seed: number) {
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

export function createStubCanvasContext(width: number, height: number): CanvasRenderingContext2D {
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
