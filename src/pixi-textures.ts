import { Texture } from "pixi.js";
import { CANVAS_H, CANVAS_W } from "./game-logic";
import {
  getCanvasRenderResources,
  getStarsContentKey,
  type BuildingAssets,
  type BurjAssets,
  type CanvasRenderResources,
  type DefenseSiteAssets,
  type EffectSpriteAssets,
  type InterceptorSpriteAssets,
  type LauncherAssets,
  type PlaneAssets,
  type SkyAssets,
  type ThreatSpriteAssets,
  type UpgradeProjectileSpriteAssets,
} from "./canvas-render-resources";
import type { Star } from "./types";

export interface PixiSkyAssets extends Omit<SkyAssets, "frames"> {
  frames: Texture[];
}

export interface PixiBurjAssets extends Omit<BurjAssets, "staticSprite" | "animFrames" | "damageOverlayFrames"> {
  staticSprite: Texture;
  animFrames: Texture[];
  damageOverlayFrames: Texture[];
}

export interface PixiBuildingAssets extends Omit<BuildingAssets, "staticSprites" | "animFrames"> {
  staticSprites: Texture[];
  animFrames: Texture[][];
}

export interface PixiLauncherAssets extends Omit<
  LauncherAssets,
  "chassisStaticSprite" | "chassisAnimFrames" | "turretSprite"
> {
  chassisStaticSprite: Texture;
  chassisAnimFrames: Texture[];
  turretSprite: Texture;
}

type CanvasProjectileSpriteAsset = ThreatSpriteAssets[keyof ThreatSpriteAssets];

export interface PixiProjectileSpriteAsset extends Omit<CanvasProjectileSpriteAsset, "staticSprite" | "animFrames"> {
  staticSprite: Texture;
  animFrames: Texture[];
}

type CanvasStaticSpriteAsset = PlaneAssets["f15AirframeRight"];

export interface PixiStaticSpriteAsset extends Omit<CanvasStaticSpriteAsset, "sprite"> {
  sprite: Texture;
}

export type PixiThreatSpriteAssets = Record<keyof ThreatSpriteAssets, PixiProjectileSpriteAsset>;
export type PixiInterceptorSpriteAssets = Record<keyof InterceptorSpriteAssets, PixiProjectileSpriteAsset>;
export type PixiUpgradeProjectileSpriteAssets = Record<keyof UpgradeProjectileSpriteAssets, PixiProjectileSpriteAsset>;

export interface PixiDefenseSiteAssets {
  patriotTEL: PixiStaticSpriteAsset;
  phalanxBase: PixiStaticSpriteAsset;
  wildHornetsHive: [PixiStaticSpriteAsset, PixiStaticSpriteAsset, PixiStaticSpriteAsset];
  roadrunnerContainer: [PixiStaticSpriteAsset, PixiStaticSpriteAsset, PixiStaticSpriteAsset];
  flareDispenser: [PixiStaticSpriteAsset, PixiStaticSpriteAsset, PixiStaticSpriteAsset];
  empEmitter: [PixiStaticSpriteAsset, PixiStaticSpriteAsset, PixiStaticSpriteAsset];
}

export interface PixiPlaneAssets {
  f15AirframeRight: PixiStaticSpriteAsset;
  f15AirframeLeft: PixiStaticSpriteAsset;
}

export interface PixiExplosionGlowAssets {
  light: PixiStaticSpriteAsset;
  splash: PixiStaticSpriteAsset;
  fireball: PixiStaticSpriteAsset;
  core: PixiStaticSpriteAsset;
  ring: PixiStaticSpriteAsset;
}

export interface PixiEmpRingAssets {
  wash: PixiStaticSpriteAsset;
  ring: PixiStaticSpriteAsset;
}

export interface PixiEffectSpriteAssets {
  explosion: PixiExplosionGlowAssets;
  emp: PixiEmpRingAssets;
  laserBeam: PixiStaticSpriteAsset;
  phalanxBullet: PixiStaticSpriteAsset;
}

export interface PixiTextureResources {
  getGameplaySkyAssets(stars: Star[], groundY: number): PixiSkyAssets;
  getTitleSkyAssets(): PixiSkyAssets;
  getGameplayBuildingAssets(baseY?: number): PixiBuildingAssets;
  getTitleBuildingAssets(baseY: number): PixiBuildingAssets;
  getBurjAssets(groundY: number, artScale: number): PixiBurjAssets;
  getLauncherAssets(scale: number, damaged: boolean): PixiLauncherAssets;
  getThreatSpriteAssets(scale: number): PixiThreatSpriteAssets;
  getInterceptorSpriteAssets(scale: number): PixiInterceptorSpriteAssets;
  getUpgradeProjectileSpriteAssets(scale: number): PixiUpgradeProjectileSpriteAssets;
  getDefenseSiteAssets(): PixiDefenseSiteAssets;
  getPlaneAssets(): PixiPlaneAssets;
  getEffectSpriteAssets(): PixiEffectSpriteAssets;
  releaseUploadedCanvasBacking(isUploaded: (texture: Texture) => boolean): number;
  invalidateForContextLoss(): void;
  getCanvasBackingStats(): ReturnType<CanvasRenderResources["getPrebakedCanvasBackingStats"]>;
}

// Half of a full-screen frame. The prebaked sky frames are CANVAS_W x CANVAS_H;
// the largest sprite canvas is well under this, so the threshold cleanly keeps
// every sprite backing resident while still releasing the memory-heavy sky frames.
const LARGE_CANVAS_BACKING_AREA = (CANVAS_W * CANVAS_H) / 2;

function mapRecord<T extends Record<string, unknown>, Mapped>(
  record: T,
  mapValue: (value: T[keyof T], key: keyof T) => Mapped,
): Record<keyof T, Mapped> {
  return Object.fromEntries(
    (Object.keys(record) as Array<keyof T>).map((key) => [key, mapValue(record[key], key)]),
  ) as Record<keyof T, Mapped>;
}

function cloneTuple<T, Mapped>(
  tuple: readonly [T, T, T],
  mapValue: (value: T, index: number) => Mapped,
): [Mapped, Mapped, Mapped] {
  return [mapValue(tuple[0], 0), mapValue(tuple[1], 1), mapValue(tuple[2], 2)];
}

class DefaultPixiTextureResources implements PixiTextureResources {
  private textureCache = new WeakMap<HTMLCanvasElement, Texture>();
  private readonly trackedCanvasTextures = new Map<HTMLCanvasElement, Texture>();
  private readonly textures = new Set<Texture>();
  private titleSkyAssets: PixiSkyAssets | null = null;
  private gameplaySkyCache = new Map<
    number,
    { starsKey: string; starsRef: Star[]; source: SkyAssets; assets: PixiSkyAssets }
  >();
  private gameplayBuildingAssets = new Map<number, { source: BuildingAssets; assets: PixiBuildingAssets }>();
  private titleBuildingAssets = new Map<number, { source: BuildingAssets; assets: PixiBuildingAssets }>();
  private burjAssets = new Map<string, { source: BurjAssets; assets: PixiBurjAssets }>();
  private launcherAssets = new Map<string, { source: LauncherAssets; assets: PixiLauncherAssets }>();
  private threatSpriteAssets = new Map<string, { source: ThreatSpriteAssets; assets: PixiThreatSpriteAssets }>();
  private interceptorSpriteAssets = new Map<
    string,
    { source: InterceptorSpriteAssets; assets: PixiInterceptorSpriteAssets }
  >();
  private upgradeProjectileSpriteAssets = new Map<
    string,
    { source: UpgradeProjectileSpriteAssets; assets: PixiUpgradeProjectileSpriteAssets }
  >();
  private defenseSiteAssets: { source: DefenseSiteAssets; assets: PixiDefenseSiteAssets } | null = null;
  private planeAssets: { source: PlaneAssets; assets: PixiPlaneAssets } | null = null;
  private effectSpriteAssets: { source: EffectSpriteAssets; assets: PixiEffectSpriteAssets } | null = null;

  constructor(private readonly canvasResources: CanvasRenderResources) {}

  getGameplaySkyAssets(stars: Star[], groundY: number): PixiSkyAssets {
    const cached = this.gameplaySkyCache.get(groundY);
    if (cached?.starsRef === stars) return cached.assets;
    const starsKey = getStarsContentKey(stars);
    if (cached?.starsKey === starsKey) {
      cached.starsRef = stars;
      return cached.assets;
    }
    const source = this.canvasResources.getGameplaySkyAssets(stars, groundY);
    // A replaced sky set means new full-screen frame canvases. Destroy the old
    // textures (and their sources) or the renderer retains every superseded
    // 900x1600 frame — the WebContent memory leak behind the death-clip kills.
    if (cached) {
      for (const frame of cached.assets.frames) this.destroyTexture(frame);
    }
    const assets = this.mapSkyAssets(source, `gameplay-sky:${groundY}`);
    this.gameplaySkyCache.set(groundY, { starsKey, starsRef: stars, source, assets });
    return assets;
  }

  getTitleSkyAssets(): PixiSkyAssets {
    if (!this.titleSkyAssets) {
      this.titleSkyAssets = this.mapSkyAssets(this.canvasResources.getTitleSkyAssets(), "title-sky");
    }
    return this.titleSkyAssets;
  }

  getGameplayBuildingAssets(baseY?: number): PixiBuildingAssets {
    const key = baseY ?? 0;
    const cached = this.gameplayBuildingAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getGameplayBuildingAssets(baseY);
    const assets = this.mapBuildingAssets(source, `gameplay-buildings:${key}`);
    this.gameplayBuildingAssets.set(key, { source, assets });
    return assets;
  }

  getTitleBuildingAssets(baseY: number): PixiBuildingAssets {
    const cached = this.titleBuildingAssets.get(baseY);
    if (cached) return cached.assets;
    const source = this.canvasResources.getTitleBuildingAssets(baseY);
    const assets = this.mapBuildingAssets(source, `title-buildings:${baseY}`);
    this.titleBuildingAssets.set(baseY, { source, assets });
    return assets;
  }

  getBurjAssets(groundY: number, artScale: number): PixiBurjAssets {
    const key = `${groundY}:${artScale}`;
    const cached = this.burjAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getBurjAssets(groundY, artScale);
    const assets = this.mapBurjAssets(source, `burj:${key}`);
    this.burjAssets.set(key, { source, assets });
    return assets;
  }

  getLauncherAssets(scale: number, damaged: boolean): PixiLauncherAssets {
    const key = `${scale.toFixed(3)}:${damaged ? 1 : 0}`;
    const cached = this.launcherAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getLauncherAssets(scale, damaged);
    const assets = this.mapLauncherAssets(source, `launcher:${key}`);
    this.launcherAssets.set(key, { source, assets });
    return assets;
  }

  getThreatSpriteAssets(scale: number): PixiThreatSpriteAssets {
    const key = scale.toFixed(3);
    const cached = this.threatSpriteAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getThreatSpriteAssets(scale);
    const assets = mapRecord(source, (asset, kind) => this.mapProjectileAsset(asset, `threat:${String(kind)}:${key}`));
    this.threatSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getInterceptorSpriteAssets(scale: number): PixiInterceptorSpriteAssets {
    const key = scale.toFixed(3);
    const cached = this.interceptorSpriteAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getInterceptorSpriteAssets(scale);
    const assets = mapRecord(source, (asset, kind) =>
      this.mapProjectileAsset(asset, `interceptor:${String(kind)}:${key}`),
    );
    this.interceptorSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getUpgradeProjectileSpriteAssets(scale: number): PixiUpgradeProjectileSpriteAssets {
    const key = scale.toFixed(3);
    const cached = this.upgradeProjectileSpriteAssets.get(key);
    if (cached) return cached.assets;
    const source = this.canvasResources.getUpgradeProjectileSpriteAssets(scale);
    const assets = mapRecord(source, (asset, kind) =>
      this.mapProjectileAsset(asset, `upgrade-projectile:${String(kind)}:${key}`),
    );
    this.upgradeProjectileSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getDefenseSiteAssets(): PixiDefenseSiteAssets {
    if (this.defenseSiteAssets) return this.defenseSiteAssets.assets;
    const source = this.canvasResources.getDefenseSiteAssets();
    const assets = this.mapDefenseSiteAssets(source);
    this.defenseSiteAssets = { source, assets };
    return assets;
  }

  getPlaneAssets(): PixiPlaneAssets {
    if (this.planeAssets) return this.planeAssets.assets;
    const source = this.canvasResources.getPlaneAssets();
    const assets = {
      f15AirframeRight: this.mapStaticSpriteAsset(source.f15AirframeRight, "plane:f15AirframeRight"),
      f15AirframeLeft: this.mapStaticSpriteAsset(source.f15AirframeLeft, "plane:f15AirframeLeft"),
    };
    this.planeAssets = { source, assets };
    return assets;
  }

  getEffectSpriteAssets(): PixiEffectSpriteAssets {
    if (this.effectSpriteAssets) return this.effectSpriteAssets.assets;
    const source = this.canvasResources.getEffectSpriteAssets();
    const assets = this.mapEffectSpriteAssets(source);
    this.effectSpriteAssets = { source, assets };
    return assets;
  }

  releaseUploadedCanvasBacking(isUploaded: (texture: Texture) => boolean): number {
    const released: HTMLCanvasElement[] = [];
    for (const [canvas, texture] of this.trackedCanvasTextures) {
      if (!isUploaded(texture)) continue;
      // Freeing a prebaked canvas' backing (setting it to 0x0) is only safe if the
      // GPU copy is never dropped: WebGL re-uploads a texture from its source
      // canvas, and a 0x0 source yields an invisible sprite. WebKit can drop and
      // re-upload GPU textures out from under us (memory pressure, GPU-process
      // recycling) without a webglcontextlost event, so the scene rebuild that
      // would re-bake the canvas never runs. That is the game-over death-clip
      // "everything plays but nothing renders" bug. Only the full-screen sky
      // frames are large enough to matter for the WebContent memory limit (~46 MB
      // vs. ~6 MB for every sprite canvas combined) and they carry their own
      // rebuild-on-demand safety net, so keep the small sprite backings resident
      // and only release the large ones.
      if (canvas.width * canvas.height < LARGE_CANVAS_BACKING_AREA) continue;
      this.trackedCanvasTextures.delete(canvas);
      released.push(canvas);
    }
    if (released.length > 0) this.canvasResources.releasePrebakedCanvasBacking(released);
    return released.length;
  }

  getCanvasBackingStats(): ReturnType<CanvasRenderResources["getPrebakedCanvasBackingStats"]> {
    return this.canvasResources.getPrebakedCanvasBackingStats();
  }

  invalidateForContextLoss(): void {
    for (const texture of [...this.textures]) this.destroyTexture(texture);
    this.textureCache = new WeakMap();
    this.trackedCanvasTextures.clear();
    this.titleSkyAssets = null;
    this.gameplaySkyCache.clear();
    this.gameplayBuildingAssets.clear();
    this.titleBuildingAssets.clear();
    this.burjAssets.clear();
    this.launcherAssets.clear();
    this.threatSpriteAssets.clear();
    this.interceptorSpriteAssets.clear();
    this.upgradeProjectileSpriteAssets.clear();
    this.defenseSiteAssets = null;
    this.planeAssets = null;
    this.effectSpriteAssets = null;
  }

  private textureFromCanvas(canvas: HTMLCanvasElement, label: string, resolution = 1): Texture {
    const cached = this.textureCache.get(canvas);
    if (cached) return cached;
    const texture = Texture.from({ resource: canvas, resolution }, true);
    texture.label = label;
    this.textureCache.set(canvas, texture);
    this.trackedCanvasTextures.set(canvas, texture);
    this.textures.add(texture);
    return texture;
  }

  private destroyTexture(texture: Texture): void {
    this.textures.delete(texture);
    const resource = texture.source.resource;
    if (resource && typeof resource === "object" && "getContext" in resource) {
      this.trackedCanvasTextures.delete(resource as HTMLCanvasElement);
    }
    texture.destroy(true);
  }

  private mapSkyAssets(source: SkyAssets, label: string): PixiSkyAssets {
    return {
      ...source,
      frames: source.frames.map((frame, index) => this.textureFromCanvas(frame, `${label}:frame:${index}`)),
    };
  }

  private mapBurjAssets(source: BurjAssets, label: string): PixiBurjAssets {
    return {
      ...source,
      staticSprite: this.textureFromCanvas(source.staticSprite, `${label}:static`, source.resolutionScale),
      animFrames: source.animFrames.map((frame, index) =>
        this.textureFromCanvas(frame, `${label}:anim:${index}`, source.resolutionScale),
      ),
      damageOverlayFrames: source.damageOverlayFrames.map((frame, index) =>
        this.textureFromCanvas(frame, `${label}:damage-overlay:${index}`, source.resolutionScale),
      ),
    };
  }

  private mapBuildingAssets(source: BuildingAssets, label: string): PixiBuildingAssets {
    return {
      ...source,
      staticSprites: source.staticSprites.map((sprite, index) =>
        this.textureFromCanvas(sprite, `${label}:static:${index}`),
      ),
      animFrames: source.animFrames.map((frames, towerIndex) =>
        frames.map((frame, frameIndex) => this.textureFromCanvas(frame, `${label}:anim:${towerIndex}:${frameIndex}`)),
      ),
    };
  }

  private mapLauncherAssets(source: LauncherAssets, label: string): PixiLauncherAssets {
    return {
      ...source,
      chassisStaticSprite: this.textureFromCanvas(
        source.chassisStaticSprite,
        `${label}:chassis-static`,
        source.resolutionScale,
      ),
      chassisAnimFrames: source.chassisAnimFrames.map((frame, index) =>
        this.textureFromCanvas(frame, `${label}:chassis-anim:${index}`, source.resolutionScale),
      ),
      turretSprite: this.textureFromCanvas(source.turretSprite, `${label}:turret`, source.resolutionScale),
    };
  }

  private mapProjectileAsset(source: CanvasProjectileSpriteAsset, label: string): PixiProjectileSpriteAsset {
    return {
      ...source,
      staticSprite: this.textureFromCanvas(source.staticSprite, `${label}:static`, source.resolutionScale),
      animFrames: source.animFrames.map((frame, index) =>
        this.textureFromCanvas(frame, `${label}:anim:${index}`, source.resolutionScale),
      ),
    };
  }

  private mapStaticSpriteAsset(source: CanvasStaticSpriteAsset, label: string): PixiStaticSpriteAsset {
    return {
      ...source,
      sprite: this.textureFromCanvas(source.sprite, label, source.resolutionScale),
    };
  }

  private mapDefenseSiteAssets(source: DefenseSiteAssets): PixiDefenseSiteAssets {
    return {
      patriotTEL: this.mapStaticSpriteAsset(source.patriotTEL, "defense-site:patriotTEL"),
      phalanxBase: this.mapStaticSpriteAsset(source.phalanxBase, "defense-site:phalanxBase"),
      wildHornetsHive: cloneTuple(source.wildHornetsHive, (asset, index) =>
        this.mapStaticSpriteAsset(asset, `defense-site:wildHornetsHive:${index}`),
      ),
      roadrunnerContainer: cloneTuple(source.roadrunnerContainer, (asset, index) =>
        this.mapStaticSpriteAsset(asset, `defense-site:roadrunnerContainer:${index}`),
      ),
      flareDispenser: cloneTuple(source.flareDispenser, (asset, index) =>
        this.mapStaticSpriteAsset(asset, `defense-site:flareDispenser:${index}`),
      ),
      empEmitter: cloneTuple(source.empEmitter, (asset, index) =>
        this.mapStaticSpriteAsset(asset, `defense-site:empEmitter:${index}`),
      ),
    };
  }

  private mapEffectSpriteAssets(source: EffectSpriteAssets): PixiEffectSpriteAssets {
    return {
      explosion: {
        light: this.mapStaticSpriteAsset(source.explosion.light, "effect:explosion:light"),
        splash: this.mapStaticSpriteAsset(source.explosion.splash, "effect:explosion:splash"),
        fireball: this.mapStaticSpriteAsset(source.explosion.fireball, "effect:explosion:fireball"),
        core: this.mapStaticSpriteAsset(source.explosion.core, "effect:explosion:core"),
        ring: this.mapStaticSpriteAsset(source.explosion.ring, "effect:explosion:ring"),
      },
      emp: {
        wash: this.mapStaticSpriteAsset(source.emp.wash, "effect:emp:wash"),
        ring: this.mapStaticSpriteAsset(source.emp.ring, "effect:emp:ring"),
      },
      laserBeam: this.mapStaticSpriteAsset(source.laserBeam, "effect:laser-beam"),
      phalanxBullet: this.mapStaticSpriteAsset(source.phalanxBullet, "effect:phalanx-bullet"),
    };
  }
}

export function createPixiTextureResources(
  canvasResources: CanvasRenderResources = getCanvasRenderResources(),
): PixiTextureResources {
  return new DefaultPixiTextureResources(canvasResources);
}
