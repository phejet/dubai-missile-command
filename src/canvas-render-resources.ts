import { CANVAS_H, CANVAS_W, GAMEPLAY_SCENIC_BASE_Y, GAMEPLAY_SCENIC_GROUND_Y, GROUND_Y } from "./game-logic";
import {
  TITLE_SKYLINE_TOWERS,
  buildBuildingAssets,
  buildBurjAssets,
  buildDefenseSiteAssets,
  buildEffectSpriteAssets,
  buildInterceptorSpriteAssets,
  buildLauncherAssets,
  buildPlaneAssets,
  buildSkyAssets,
  buildThreatSpriteAssets,
  buildTitleBuildingAssets,
  buildUpgradeProjectileSpriteAssets,
  burjPath as traceBurjPath,
  drawBakedLauncher,
  drawBakedProjectileSprite,
  drawBakedStaticSprite,
  drawFlickerWindows,
  drawLiveInterceptorSprite,
  drawLiveThreatSprite,
  drawSharedLauncher,
  drawSharedTower,
  getLightFlicker,
  halfWidthsAt as getBurjHalfWidths,
  mapGameplayBuildingTower,
  type BuildingAssets,
  type BurjAssets,
  type DefenseSiteAssets,
  type EffectSpriteAssets,
  type InterceptorSpriteAssets,
  type InterceptorSpriteKind,
  type LauncherAssets,
  type PlaneAssets,
  type SkyAssets,
  type ThreatSpriteAssets,
  type ThreatSpriteKind,
  type UpgradeProjectileSpriteAssets,
} from "./art-render";
import type { Star } from "./types";

export type {
  BuildingAssets,
  BurjAssets,
  DefenseSiteAssets,
  EffectSpriteAssets,
  InterceptorSpriteAssets,
  InterceptorSpriteKind,
  LauncherAssets,
  PlaneAssets,
  SkyAssets,
  ThreatSpriteAssets,
  ThreatSpriteKind,
  UpgradeProjectileSpriteAssets,
} from "./art-render";

export {
  TITLE_SKYLINE_TOWERS,
  traceBurjPath,
  drawBakedLauncher,
  drawBakedProjectileSprite,
  drawBakedStaticSprite,
  drawFlickerWindows,
  drawLiveInterceptorSprite,
  drawLiveThreatSprite,
  drawSharedLauncher,
  drawSharedTower,
  getBurjHalfWidths,
  getLightFlicker,
  mapGameplayBuildingTower,
};

const DEFAULT_TITLE_GROUND_Y = GROUND_Y - 100;
const DEFAULT_BURJ_ART_SCALE = 2;
export const DEFAULT_GAMEPLAY_LAUNCHER_SCALE = 0.8 + 3 * 0.06;
const DEFAULT_ENEMY_SCALE = 3;
const DEFAULT_PROJECTILE_SCALE = 2;

interface CachedImageEntry {
  href: string;
  image: HTMLImageElement | null;
  loading: boolean;
}

interface CanvasRenderPreloadOptions {
  gameplayBuildingBaseY: number;
  gameplayGroundY: number;
  titleGroundY: number;
  burjArtScale: number;
  gameplayLauncherScale: number;
  enemyScale: number;
  projectileScale: number;
}

export interface CanvasRenderResources {
  preload(options?: Partial<CanvasRenderPreloadOptions>): void;
  resetForTest(): void;
  getSkyImage(): HTMLImageElement | null;
  getTitleWaterImage(): HTMLImageElement | null;
  getInterceptorHitFlashImage(): HTMLImageElement | null;
  getMissileKillFlashImage(): HTMLImageElement | null;
  getDroneKillFlashImage(): HTMLImageElement | null;
  getBuildingDestroyBurstImage(): HTMLImageElement | null;
  getTitleBurjGlowImage(): HTMLImageElement | null;
  getBurjMissileDecalImage(): HTMLImageElement | null;
  getBurjDroneDecalImage(): HTMLImageElement | null;
  getGameplaySkyAssets(stars: Star[], groundY: number): SkyAssets;
  getTitleSkyAssets(): SkyAssets;
  getGameplayBuildingAssets(baseY?: number): BuildingAssets;
  getTitleBuildingAssets(baseY: number): BuildingAssets;
  getBurjAssets(groundY: number, artScale: number): BurjAssets;
  getLauncherAssets(scale: number, damaged: boolean): LauncherAssets;
  getThreatSpriteAssets(scale: number): ThreatSpriteAssets;
  getInterceptorSpriteAssets(scale: number): InterceptorSpriteAssets;
  getUpgradeProjectileSpriteAssets(scale: number): UpgradeProjectileSpriteAssets;
  getDefenseSiteAssets(): DefenseSiteAssets;
  getPlaneAssets(): PlaneAssets;
  getEffectSpriteAssets(): EffectSpriteAssets;
  getBurjAssetCacheKeys(): string[];
  getLauncherAssetCacheKeys(): string[];
  getThreatSpriteCacheKeys(): string[];
  getInterceptorSpriteCacheKeys(): string[];
  getUpgradeProjectileSpriteCacheKeys(): string[];
}

function hash01(a: number, b = 0, c = 0, d = 0) {
  const value = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + d * 19.173) * 43758.5453123;
  return value - Math.floor(value);
}

function createCachedImageEntry(href: string): CachedImageEntry {
  return { href, image: null, loading: false };
}

function readCachedImage(entry: CachedImageEntry): HTMLImageElement | null {
  if (entry.image) return entry.image;
  if (entry.loading || typeof Image === "undefined") return null;
  entry.loading = true;
  const img = new Image();
  img.src = entry.href;
  img.onload = () => {
    entry.image = img;
  };
  img.onerror = () => {
    entry.loading = false;
  };
  return null;
}

function resetCachedImage(entry: CachedImageEntry): void {
  entry.image = null;
  entry.loading = false;
}

function createCanvasRenderResources(): CanvasRenderResources {
  let gameplaySkyAssets: SkyAssets | null = null;
  let gameplaySkyStarsRef: Star[] | null = null;
  let gameplaySkyGroundY: number | null = null;
  let titleSkyAssets: SkyAssets | null = null;
  let gameplayBuildingAssets: BuildingAssets | null = null;
  let gameplayBuildingBaseY: number | null = null;
  let titleBuildingAssets: BuildingAssets | null = null;
  let titleBuildingBaseY: number | null = null;
  const burjAssetsCache = new Map<string, BurjAssets>();
  const launcherAssetsCache = new Map<string, LauncherAssets>();
  const threatSpriteAssetsCache = new Map<string, ThreatSpriteAssets>();
  const interceptorSpriteAssetsCache = new Map<string, InterceptorSpriteAssets>();
  const upgradeProjectileSpriteAssetsCache = new Map<string, UpgradeProjectileSpriteAssets>();
  let defenseSiteAssets: DefenseSiteAssets | null = null;
  let planeAssets: PlaneAssets | null = null;
  let effectSpriteAssets: EffectSpriteAssets | null = null;

  const skyImage = createCachedImageEntry(new URL("../public/sky-nebula.png", import.meta.url).href);
  const titleWaterImage = createCachedImageEntry(new URL("./assets/title-water-reflection.png", import.meta.url).href);
  const interceptorHitFlashImage = createCachedImageEntry(
    new URL("./assets/explosion-hit-flash-b.png", import.meta.url).href,
  );
  const missileKillFlashImage = createCachedImageEntry(
    new URL("./assets/explosion-missile-kill.png", import.meta.url).href,
  );
  const droneKillFlashImage = createCachedImageEntry(
    new URL("./assets/explosion-drone-kill.png", import.meta.url).href,
  );
  const buildingDestroyBurstImage = createCachedImageEntry(
    new URL("./assets/building-destroy-burst.png", import.meta.url).href,
  );
  const titleBurjGlowImage = createCachedImageEntry(new URL("./assets/title-burj-glow.png", import.meta.url).href);
  const burjMissileDecalImage = createCachedImageEntry(
    new URL("./assets/burj-hit-decal-missile.png", import.meta.url).href,
  );
  const burjDroneDecalImage = createCachedImageEntry(
    new URL("./assets/burj-hit-decal-drone.png", import.meta.url).href,
  );

  const getGameplaySkyAssets = (stars: Star[], groundY: number): SkyAssets => {
    if (!gameplaySkyAssets || gameplaySkyStarsRef !== stars || gameplaySkyGroundY !== groundY) {
      gameplaySkyAssets = buildSkyAssets(stars, CANVAS_H, groundY);
      gameplaySkyStarsRef = stars;
      gameplaySkyGroundY = groundY;
    }
    return gameplaySkyAssets;
  };

  const getTitleSkyAssets = (): SkyAssets => {
    if (!titleSkyAssets) {
      const titleStars: Star[] = Array.from({ length: 120 }, (_, i) => ({
        x: hash01(i, 2, 7) * CANVAS_W,
        y: hash01(i, 5, 11) * CANVAS_H * 0.6,
        size: 0.5 + hash01(i, 3, 1) * 1.5,
        twinkle: hash01(i, 7, 3) * 20,
      }));
      titleSkyAssets = buildSkyAssets(titleStars, CANVAS_H, DEFAULT_TITLE_GROUND_Y);
    }
    return titleSkyAssets;
  };

  const getGameplayBuildingAssets = (baseY = GAMEPLAY_SCENIC_BASE_Y): BuildingAssets => {
    if (!gameplayBuildingAssets || gameplayBuildingBaseY !== baseY) {
      gameplayBuildingAssets = buildBuildingAssets(baseY);
      gameplayBuildingBaseY = baseY;
    }
    return gameplayBuildingAssets;
  };

  const getTitleBuildingAssets = (baseY: number): BuildingAssets => {
    if (!titleBuildingAssets || titleBuildingBaseY !== baseY) {
      titleBuildingAssets = buildTitleBuildingAssets(baseY);
      titleBuildingBaseY = baseY;
    }
    return titleBuildingAssets;
  };

  const getBurjAssets = (groundY: number, artScale: number): BurjAssets => {
    const key = `${groundY}:${artScale}`;
    const cached = burjAssetsCache.get(key);
    if (cached) return cached;
    const assets = buildBurjAssets(groundY, artScale);
    burjAssetsCache.set(key, assets);
    return assets;
  };

  const getLauncherAssets = (scale: number, damaged: boolean): LauncherAssets => {
    const key = `${scale.toFixed(3)}:${damaged ? 1 : 0}`;
    const cached = launcherAssetsCache.get(key);
    if (cached) return cached;
    const assets = buildLauncherAssets(scale, damaged);
    launcherAssetsCache.set(key, assets);
    return assets;
  };

  const getThreatSpriteAssets = (scale: number): ThreatSpriteAssets => {
    const key = scale.toFixed(3);
    const cached = threatSpriteAssetsCache.get(key);
    if (cached) return cached;
    const assets = buildThreatSpriteAssets(scale);
    threatSpriteAssetsCache.set(key, assets);
    return assets;
  };

  const getInterceptorSpriteAssets = (scale: number): InterceptorSpriteAssets => {
    const key = scale.toFixed(3);
    const cached = interceptorSpriteAssetsCache.get(key);
    if (cached) return cached;
    const assets = buildInterceptorSpriteAssets(scale);
    interceptorSpriteAssetsCache.set(key, assets);
    return assets;
  };

  const getUpgradeProjectileSpriteAssets = (scale: number): UpgradeProjectileSpriteAssets => {
    const key = scale.toFixed(3);
    const cached = upgradeProjectileSpriteAssetsCache.get(key);
    if (cached) return cached;
    const assets = buildUpgradeProjectileSpriteAssets(scale);
    upgradeProjectileSpriteAssetsCache.set(key, assets);
    return assets;
  };

  const getDefenseSiteAssets = (): DefenseSiteAssets => {
    if (!defenseSiteAssets) defenseSiteAssets = buildDefenseSiteAssets();
    return defenseSiteAssets;
  };

  const getPlaneAssets = (): PlaneAssets => {
    if (!planeAssets) planeAssets = buildPlaneAssets();
    return planeAssets;
  };

  const getEffectSpriteAssets = (): EffectSpriteAssets => {
    if (!effectSpriteAssets) effectSpriteAssets = buildEffectSpriteAssets();
    return effectSpriteAssets;
  };

  const preload = (options: Partial<CanvasRenderPreloadOptions> = {}): void => {
    const resolved: CanvasRenderPreloadOptions = {
      gameplayBuildingBaseY: GAMEPLAY_SCENIC_BASE_Y,
      gameplayGroundY: GAMEPLAY_SCENIC_GROUND_Y,
      titleGroundY: DEFAULT_TITLE_GROUND_Y,
      burjArtScale: DEFAULT_BURJ_ART_SCALE,
      gameplayLauncherScale: DEFAULT_GAMEPLAY_LAUNCHER_SCALE,
      enemyScale: DEFAULT_ENEMY_SCALE,
      projectileScale: DEFAULT_PROJECTILE_SCALE,
      ...options,
    };

    readCachedImage(skyImage);
    readCachedImage(titleWaterImage);
    readCachedImage(interceptorHitFlashImage);
    readCachedImage(missileKillFlashImage);
    readCachedImage(droneKillFlashImage);
    readCachedImage(buildingDestroyBurstImage);
    readCachedImage(titleBurjGlowImage);
    readCachedImage(burjMissileDecalImage);
    readCachedImage(burjDroneDecalImage);
    getGameplayBuildingAssets(resolved.gameplayBuildingBaseY);
    getBurjAssets(resolved.titleGroundY, resolved.burjArtScale);
    getBurjAssets(resolved.gameplayGroundY, resolved.burjArtScale);
    getLauncherAssets(1, false);
    getLauncherAssets(resolved.gameplayLauncherScale, false);
    getLauncherAssets(resolved.gameplayLauncherScale, true);
    getThreatSpriteAssets(resolved.enemyScale);
    getInterceptorSpriteAssets(resolved.projectileScale);
    getUpgradeProjectileSpriteAssets(resolved.projectileScale);
    getDefenseSiteAssets();
    getPlaneAssets();
    getEffectSpriteAssets();
  };

  const resetForTest = (): void => {
    gameplaySkyAssets = null;
    gameplaySkyStarsRef = null;
    gameplaySkyGroundY = null;
    titleSkyAssets = null;
    gameplayBuildingAssets = null;
    gameplayBuildingBaseY = null;
    titleBuildingAssets = null;
    titleBuildingBaseY = null;
    burjAssetsCache.clear();
    launcherAssetsCache.clear();
    threatSpriteAssetsCache.clear();
    interceptorSpriteAssetsCache.clear();
    upgradeProjectileSpriteAssetsCache.clear();
    defenseSiteAssets = null;
    planeAssets = null;
    effectSpriteAssets = null;

    resetCachedImage(skyImage);
    resetCachedImage(titleWaterImage);
    resetCachedImage(interceptorHitFlashImage);
    resetCachedImage(missileKillFlashImage);
    resetCachedImage(droneKillFlashImage);
    resetCachedImage(buildingDestroyBurstImage);
    resetCachedImage(titleBurjGlowImage);
    resetCachedImage(burjMissileDecalImage);
    resetCachedImage(burjDroneDecalImage);
  };

  return {
    preload,
    resetForTest,
    getSkyImage: () => readCachedImage(skyImage),
    getTitleWaterImage: () => readCachedImage(titleWaterImage),
    getInterceptorHitFlashImage: () => readCachedImage(interceptorHitFlashImage),
    getMissileKillFlashImage: () => readCachedImage(missileKillFlashImage),
    getDroneKillFlashImage: () => readCachedImage(droneKillFlashImage),
    getBuildingDestroyBurstImage: () => readCachedImage(buildingDestroyBurstImage),
    getTitleBurjGlowImage: () => readCachedImage(titleBurjGlowImage),
    getBurjMissileDecalImage: () => readCachedImage(burjMissileDecalImage),
    getBurjDroneDecalImage: () => readCachedImage(burjDroneDecalImage),
    getGameplaySkyAssets,
    getTitleSkyAssets,
    getGameplayBuildingAssets,
    getTitleBuildingAssets,
    getBurjAssets,
    getLauncherAssets,
    getThreatSpriteAssets,
    getInterceptorSpriteAssets,
    getUpgradeProjectileSpriteAssets,
    getDefenseSiteAssets,
    getPlaneAssets,
    getEffectSpriteAssets,
    getBurjAssetCacheKeys: () => [...burjAssetsCache.keys()].sort(),
    getLauncherAssetCacheKeys: () => [...launcherAssetsCache.keys()].sort(),
    getThreatSpriteCacheKeys: () => [...threatSpriteAssetsCache.keys()].sort(),
    getInterceptorSpriteCacheKeys: () => [...interceptorSpriteAssetsCache.keys()].sort(),
    getUpgradeProjectileSpriteCacheKeys: () => [...upgradeProjectileSpriteAssetsCache.keys()].sort(),
  };
}

const defaultCanvasRenderResources = createCanvasRenderResources();

export function getCanvasRenderResources(): CanvasRenderResources {
  return defaultCanvasRenderResources;
}

export function preloadCanvasRenderResources(): void {
  defaultCanvasRenderResources.preload();
}
