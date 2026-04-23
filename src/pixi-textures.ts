import { Texture } from "pixi.js";
import {
  getCanvasRenderResources,
  type BuildingAssets,
  type BurjAssets,
  type CanvasRenderResources,
  type DefenseSiteAssets,
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

export interface PixiBurjAssets extends Omit<BurjAssets, "staticSprite" | "animFrames"> {
  staticSprite: Texture;
  animFrames: Texture[];
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

type CanvasStaticSpriteAsset = PlaneAssets["f15Airframe"];

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
  f15Airframe: PixiStaticSpriteAsset;
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
  reupload(): void;
}

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
  private titleSkyAssets: PixiSkyAssets | null = null;
  private gameplaySkyAssets: PixiSkyAssets | null = null;
  private gameplaySkySource: SkyAssets | null = null;
  private gameplayBuildingAssets: PixiBuildingAssets | null = null;
  private gameplayBuildingSource: BuildingAssets | null = null;
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

  constructor(private readonly canvasResources: CanvasRenderResources) {}

  getGameplaySkyAssets(stars: Star[], groundY: number): PixiSkyAssets {
    const source = this.canvasResources.getGameplaySkyAssets(stars, groundY);
    if (!this.gameplaySkyAssets || this.gameplaySkySource !== source) {
      this.gameplaySkyAssets = this.mapSkyAssets(source, "gameplay-sky");
      this.gameplaySkySource = source;
    }
    return this.gameplaySkyAssets;
  }

  getTitleSkyAssets(): PixiSkyAssets {
    if (!this.titleSkyAssets) {
      this.titleSkyAssets = this.mapSkyAssets(this.canvasResources.getTitleSkyAssets(), "title-sky");
    }
    return this.titleSkyAssets;
  }

  getGameplayBuildingAssets(baseY?: number): PixiBuildingAssets {
    const source = this.canvasResources.getGameplayBuildingAssets(baseY);
    if (!this.gameplayBuildingAssets || this.gameplayBuildingSource !== source) {
      this.gameplayBuildingAssets = this.mapBuildingAssets(source, "gameplay-buildings");
      this.gameplayBuildingSource = source;
    }
    return this.gameplayBuildingAssets;
  }

  getTitleBuildingAssets(baseY: number): PixiBuildingAssets {
    const source = this.canvasResources.getTitleBuildingAssets(baseY);
    const cached = this.titleBuildingAssets.get(baseY);
    if (cached?.source === source) return cached.assets;
    const assets = this.mapBuildingAssets(source, `title-buildings:${baseY}`);
    this.titleBuildingAssets.set(baseY, { source, assets });
    return assets;
  }

  getBurjAssets(groundY: number, artScale: number): PixiBurjAssets {
    const key = `${groundY}:${artScale}`;
    const source = this.canvasResources.getBurjAssets(groundY, artScale);
    const cached = this.burjAssets.get(key);
    if (cached?.source === source) return cached.assets;
    const assets = this.mapBurjAssets(source, `burj:${key}`);
    this.burjAssets.set(key, { source, assets });
    return assets;
  }

  getLauncherAssets(scale: number, damaged: boolean): PixiLauncherAssets {
    const key = `${scale.toFixed(3)}:${damaged ? 1 : 0}`;
    const source = this.canvasResources.getLauncherAssets(scale, damaged);
    const cached = this.launcherAssets.get(key);
    if (cached?.source === source) return cached.assets;
    const assets = this.mapLauncherAssets(source, `launcher:${key}`);
    this.launcherAssets.set(key, { source, assets });
    return assets;
  }

  getThreatSpriteAssets(scale: number): PixiThreatSpriteAssets {
    const key = scale.toFixed(3);
    const source = this.canvasResources.getThreatSpriteAssets(scale);
    const cached = this.threatSpriteAssets.get(key);
    if (cached?.source === source) return cached.assets;
    const assets = mapRecord(source, (asset, kind) => this.mapProjectileAsset(asset, `threat:${String(kind)}:${key}`));
    this.threatSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getInterceptorSpriteAssets(scale: number): PixiInterceptorSpriteAssets {
    const key = scale.toFixed(3);
    const source = this.canvasResources.getInterceptorSpriteAssets(scale);
    const cached = this.interceptorSpriteAssets.get(key);
    if (cached?.source === source) return cached.assets;
    const assets = mapRecord(source, (asset, kind) =>
      this.mapProjectileAsset(asset, `interceptor:${String(kind)}:${key}`),
    );
    this.interceptorSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getUpgradeProjectileSpriteAssets(scale: number): PixiUpgradeProjectileSpriteAssets {
    const key = scale.toFixed(3);
    const source = this.canvasResources.getUpgradeProjectileSpriteAssets(scale);
    const cached = this.upgradeProjectileSpriteAssets.get(key);
    if (cached?.source === source) return cached.assets;
    const assets = mapRecord(source, (asset, kind) =>
      this.mapProjectileAsset(asset, `upgrade-projectile:${String(kind)}:${key}`),
    );
    this.upgradeProjectileSpriteAssets.set(key, { source, assets });
    return assets;
  }

  getDefenseSiteAssets(): PixiDefenseSiteAssets {
    const source = this.canvasResources.getDefenseSiteAssets();
    if (this.defenseSiteAssets?.source === source) return this.defenseSiteAssets.assets;
    const assets = this.mapDefenseSiteAssets(source);
    this.defenseSiteAssets = { source, assets };
    return assets;
  }

  getPlaneAssets(): PixiPlaneAssets {
    const source = this.canvasResources.getPlaneAssets();
    if (this.planeAssets?.source === source) return this.planeAssets.assets;
    const assets = {
      f15Airframe: this.mapStaticSpriteAsset(source.f15Airframe, "plane:f15Airframe"),
    };
    this.planeAssets = { source, assets };
    return assets;
  }

  reupload(): void {
    this.textureCache = new WeakMap();
    this.titleSkyAssets = null;
    this.gameplaySkyAssets = null;
    this.gameplaySkySource = null;
    this.gameplayBuildingAssets = null;
    this.gameplayBuildingSource = null;
    this.titleBuildingAssets.clear();
    this.burjAssets.clear();
    this.launcherAssets.clear();
    this.threatSpriteAssets.clear();
    this.interceptorSpriteAssets.clear();
    this.upgradeProjectileSpriteAssets.clear();
    this.defenseSiteAssets = null;
    this.planeAssets = null;
  }

  private textureFromCanvas(canvas: HTMLCanvasElement, label: string): Texture {
    const cached = this.textureCache.get(canvas);
    if (cached) return cached;
    const texture = Texture.from({ resource: canvas }, true);
    texture.label = label;
    this.textureCache.set(canvas, texture);
    return texture;
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
      staticSprite: this.textureFromCanvas(source.staticSprite, `${label}:static`),
      animFrames: source.animFrames.map((frame, index) => this.textureFromCanvas(frame, `${label}:anim:${index}`)),
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
      chassisStaticSprite: this.textureFromCanvas(source.chassisStaticSprite, `${label}:chassis-static`),
      chassisAnimFrames: source.chassisAnimFrames.map((frame, index) =>
        this.textureFromCanvas(frame, `${label}:chassis-anim:${index}`),
      ),
      turretSprite: this.textureFromCanvas(source.turretSprite, `${label}:turret`),
    };
  }

  private mapProjectileAsset(source: CanvasProjectileSpriteAsset, label: string): PixiProjectileSpriteAsset {
    return {
      ...source,
      staticSprite: this.textureFromCanvas(source.staticSprite, `${label}:static`),
      animFrames: source.animFrames.map((frame, index) => this.textureFromCanvas(frame, `${label}:anim:${index}`)),
    };
  }

  private mapStaticSpriteAsset(source: CanvasStaticSpriteAsset, label: string): PixiStaticSpriteAsset {
    return {
      ...source,
      sprite: this.textureFromCanvas(source.sprite, label),
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
}

export function createPixiTextureResources(
  canvasResources: CanvasRenderResources = getCanvasRenderResources(),
): PixiTextureResources {
  return new DefaultPixiTextureResources(canvasResources);
}
