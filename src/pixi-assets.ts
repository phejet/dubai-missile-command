import { Assets, type Texture } from "pixi.js";

export const PIXI_PNG_ASSET_KEYS = {
  skyNebula: "skyNebula",
  titleWaterReflection: "titleWaterReflection",
  interceptorHitFlash: "interceptorHitFlash",
  missileKillFlash: "missileKillFlash",
  droneKillFlash: "droneKillFlash",
  buildingDestroyBurst: "buildingDestroyBurst",
  titleBurjGlow: "titleBurjGlow",
  burjMissileDecal: "burjMissileDecal",
  burjDroneDecal: "burjDroneDecal",
} as const;

export type PixiPngAssetKey = (typeof PIXI_PNG_ASSET_KEYS)[keyof typeof PIXI_PNG_ASSET_KEYS];
export type PixiPngBundleName = "title" | "gameplay";
export type PixiPngAssetMap = Partial<Record<PixiPngAssetKey, Texture>>;

const PIXI_PNG_ASSET_SOURCES: Record<PixiPngAssetKey, string> = {
  skyNebula: new URL("../public/sky-nebula.png", import.meta.url).href,
  titleWaterReflection: new URL("./assets/title-water-reflection.png", import.meta.url).href,
  interceptorHitFlash: new URL("./assets/explosion-hit-flash-b.png", import.meta.url).href,
  missileKillFlash: new URL("./assets/explosion-missile-kill.png", import.meta.url).href,
  droneKillFlash: new URL("./assets/explosion-drone-kill.png", import.meta.url).href,
  buildingDestroyBurst: new URL("./assets/building-destroy-burst.png", import.meta.url).href,
  titleBurjGlow: new URL("./assets/title-burj-glow.png", import.meta.url).href,
  burjMissileDecal: new URL("./assets/burj-hit-decal-missile.png", import.meta.url).href,
  burjDroneDecal: new URL("./assets/burj-hit-decal-drone.png", import.meta.url).href,
};

const PIXI_PNG_BUNDLES: Record<PixiPngBundleName, PixiPngAssetKey[]> = {
  title: ["skyNebula", "titleWaterReflection", "titleBurjGlow"],
  gameplay: [
    "skyNebula",
    "interceptorHitFlash",
    "missileKillFlash",
    "droneKillFlash",
    "buildingDestroyBurst",
    "burjMissileDecal",
    "burjDroneDecal",
  ],
};

const loadedAssets: PixiPngAssetMap = {};
let bundlesRegistered = false;

function bundleId(bundleName: PixiPngBundleName): string {
  return `dmc:${bundleName}:pngs`;
}

function bundleAlias(bundleName: PixiPngBundleName, key: PixiPngAssetKey): string {
  return `dmc:${bundleName}:${key}`;
}

export function registerPixiPngAssetBundles(): void {
  if (bundlesRegistered) return;

  for (const [name, keys] of Object.entries(PIXI_PNG_BUNDLES) as Array<[PixiPngBundleName, PixiPngAssetKey[]]>) {
    Assets.addBundle(
      bundleId(name),
      keys.map((key) => ({
        alias: bundleAlias(name, key),
        src: PIXI_PNG_ASSET_SOURCES[key],
      })),
    );
  }

  bundlesRegistered = true;
}

export async function loadPixiPngBundle(bundleName: PixiPngBundleName): Promise<PixiPngAssetMap> {
  registerPixiPngAssetBundles();
  const loaded = (await Assets.loadBundle(bundleId(bundleName))) as Record<string, Texture>;
  const bundleAssets: PixiPngAssetMap = {};

  for (const key of PIXI_PNG_BUNDLES[bundleName]) {
    const texture = loaded[bundleAlias(bundleName, key)];
    if (!texture) continue;
    loadedAssets[key] = texture;
    bundleAssets[key] = texture;
  }

  return bundleAssets;
}

export async function loadPixiPngBundles(bundleNames: PixiPngBundleName[]): Promise<PixiPngAssetMap> {
  const loaded: PixiPngAssetMap = {};
  for (const bundleName of bundleNames) {
    Object.assign(loaded, await loadPixiPngBundle(bundleName));
  }
  return loaded;
}

export function getPixiPngAsset(key: PixiPngAssetKey): Texture | undefined {
  return loadedAssets[key];
}

export function getPixiPngAssetSource(key: PixiPngAssetKey): string {
  return PIXI_PNG_ASSET_SOURCES[key];
}
