import { Assets, type Texture } from "pixi.js";
import { TEXTURED_PARTICLE_ASSETS, type TexturedParticleVariantId } from "./smoke-particle-assets";

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
    "titleWaterReflection",
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
let smokeParticleBundleRegistered = false;
let smokeParticleTextures: Partial<Record<TexturedParticleVariantId, Texture>> = {};

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

function smokeParticleBundleAlias(id: TexturedParticleVariantId): string {
  return `dmc:gameplay:texturedParticle:${id}`;
}

export function registerPixiSmokeParticleBundle(): void {
  if (smokeParticleBundleRegistered) return;

  Assets.addBundle(
    "dmc:gameplay:textured-particles",
    TEXTURED_PARTICLE_ASSETS.map((asset) => ({
      alias: smokeParticleBundleAlias(asset.id),
      src: asset.src,
    })),
  );

  smokeParticleBundleRegistered = true;
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
  const bundles = await Promise.all(bundleNames.map((bundleName) => loadPixiPngBundle(bundleName)));
  for (const bundle of bundles) Object.assign(loaded, bundle);
  return loaded;
}

export async function loadPixiSmokeParticleTextures(): Promise<Partial<Record<TexturedParticleVariantId, Texture>>> {
  registerPixiSmokeParticleBundle();
  const loaded = (await Assets.loadBundle("dmc:gameplay:textured-particles")) as Record<string, Texture>;
  const textures: Partial<Record<TexturedParticleVariantId, Texture>> = {};

  for (const asset of TEXTURED_PARTICLE_ASSETS) {
    const texture = loaded[smokeParticleBundleAlias(asset.id)];
    if (!texture) continue;
    textures[asset.id] = texture;
  }

  smokeParticleTextures = { ...smokeParticleTextures, ...textures };
  return textures;
}

export function getPixiSmokeParticleTexture(id: TexturedParticleVariantId): Texture | undefined {
  return smokeParticleTextures[id];
}

export function getPixiPngAsset(key: PixiPngAssetKey): Texture | undefined {
  return loadedAssets[key];
}

export function getPixiPngAssetSource(key: PixiPngAssetKey): string {
  return PIXI_PNG_ASSET_SOURCES[key];
}
