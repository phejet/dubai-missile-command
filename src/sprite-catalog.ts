import {
  DEFAULT_GAMEPLAY_LAUNCHER_SCALE,
  getCanvasRenderResources,
  type CanvasRenderResources,
  type InterceptorSpriteAssets,
  type LauncherAssets,
  type ThreatSpriteAssets,
  type UpgradeProjectileSpriteAssets,
} from "./canvas-render-resources";
import { collectBurjFireTextureCanvases } from "./burj-fire-textures";
import { GAMEPLAY_SCENIC_GROUND_Y, GROUND_Y } from "./game-logic";
import { BURJ_SMOKE_PARTICLE_ASSETS, createSmokeParticleAssetCanvas } from "./smoke-particle-assets";
import type { StaticSpriteAsset } from "./art-render";

const STARTUP_TITLE_GROUND_Y = GROUND_Y - 100;
const STARTUP_BURJ_ART_SCALE = 2;
const STARTUP_ENEMY_SCALE = 3;
const STARTUP_PROJECTILE_SCALE = 2;

export type SpriteCatalogGroupId =
  | "burj"
  | "threats"
  | "interceptors"
  | "upgrades"
  | "defense"
  | "effects"
  | "buildings";

export const SPRITE_CATALOG_GROUPS: Array<{ id: SpriteCatalogGroupId; label: string }> = [
  { id: "burj", label: "Burj" },
  { id: "threats", label: "Threats" },
  { id: "interceptors", label: "Interceptors" },
  { id: "upgrades", label: "Upgrades" },
  { id: "defense", label: "Defense" },
  { id: "effects", label: "Effects" },
  { id: "buildings", label: "Buildings" },
];

export interface SpriteCatalogItem {
  id: string;
  group: SpriteCatalogGroupId;
  label: string;
  source: HTMLCanvasElement;
  kind: "static" | "frame";
  frameIndex?: number;
  frameCount?: number;
  width: number;
  height: number;
  note?: string;
}

export interface SpriteCatalogGroup {
  id: SpriteCatalogGroupId;
  label: string;
  items: SpriteCatalogItem[];
}

function addCanvas(
  items: SpriteCatalogItem[],
  group: SpriteCatalogGroupId,
  id: string,
  label: string,
  source: HTMLCanvasElement,
  note?: string,
  frame?: { index: number; count: number },
): void {
  items.push({
    id,
    group,
    label,
    source,
    kind: frame ? "frame" : "static",
    frameIndex: frame?.index,
    frameCount: frame?.count,
    width: source.width,
    height: source.height,
    note,
  });
}

function addFrames(
  items: SpriteCatalogItem[],
  group: SpriteCatalogGroupId,
  idPrefix: string,
  labelPrefix: string,
  frames: HTMLCanvasElement[],
  note?: string,
): void {
  frames.forEach((frame, index) => {
    addCanvas(items, group, `${idPrefix}:frame:${index}`, `${labelPrefix} ${index}`, frame, note, {
      index,
      count: frames.length,
    });
  });
}

function addLauncherAssets(
  items: SpriteCatalogItem[],
  group: SpriteCatalogGroupId,
  idPrefix: string,
  label: string,
  assets: LauncherAssets,
) {
  const note = `scale ${assets.scale.toFixed(2)}${assets.damaged ? ", damaged" : ""}`;
  addCanvas(items, group, `${idPrefix}:chassis-static`, `${label} chassis static`, assets.chassisStaticSprite, note);
  addFrames(items, group, `${idPrefix}:chassis-anim`, `${label} chassis anim`, assets.chassisAnimFrames, note);
  addCanvas(items, group, `${idPrefix}:turret`, `${label} turret`, assets.turretSprite, note);
}

function addProjectileAssets(
  items: SpriteCatalogItem[],
  group: SpriteCatalogGroupId,
  idPrefix: string,
  assets: ThreatSpriteAssets | InterceptorSpriteAssets | UpgradeProjectileSpriteAssets,
): void {
  for (const [kind, asset] of Object.entries(assets)) {
    const note = `scale ${asset.scale.toFixed(2)}`;
    addCanvas(items, group, `${idPrefix}:${kind}:static`, `${kind} static`, asset.staticSprite, note);
    addFrames(items, group, `${idPrefix}:${kind}:anim`, `${kind} anim`, asset.animFrames, note);
  }
}

function addStaticAsset(
  items: SpriteCatalogItem[],
  group: SpriteCatalogGroupId,
  id: string,
  label: string,
  asset: StaticSpriteAsset,
  note?: string,
): void {
  addCanvas(items, group, id, label, asset.sprite, note ?? `scale ${asset.scale.toFixed(2)}`);
}

export function collectStartupSpriteCatalog(
  resources: CanvasRenderResources = getCanvasRenderResources(),
): SpriteCatalogGroup[] {
  resources.preload();

  const items: SpriteCatalogItem[] = [];
  const gameplayBuildings = resources.getGameplayBuildingAssets();
  gameplayBuildings.staticSprites.forEach((sprite, index) => {
    addCanvas(items, "buildings", `gameplay-building:${index}:static`, `building ${index} static`, sprite);
  });
  gameplayBuildings.animFrames.forEach((frames, towerIndex) => {
    addFrames(items, "buildings", `gameplay-building:${towerIndex}:anim`, `building ${towerIndex} anim`, frames);
  });

  for (const [label, groundY] of [
    ["title", STARTUP_TITLE_GROUND_Y],
    ["gameplay", GAMEPLAY_SCENIC_GROUND_Y],
  ] as const) {
    const burj = resources.getBurjAssets(groundY, STARTUP_BURJ_ART_SCALE);
    const note = `groundY ${groundY}, art scale ${STARTUP_BURJ_ART_SCALE}`;
    addCanvas(items, "burj", `burj:${label}:static`, `${label} Burj static`, burj.staticSprite, note);
    addFrames(items, "burj", `burj:${label}:anim`, `${label} Burj anim`, burj.animFrames, note);
    addFrames(items, "burj", `burj:${label}:damage-overlay`, `${label} damage overlay`, burj.damageOverlayFrames, note);
  }

  addLauncherAssets(items, "defense", "launcher:title:intact", "title launcher", resources.getLauncherAssets(1, false));
  addLauncherAssets(
    items,
    "defense",
    "launcher:gameplay:intact",
    "gameplay launcher",
    resources.getLauncherAssets(DEFAULT_GAMEPLAY_LAUNCHER_SCALE, false),
  );
  addLauncherAssets(
    items,
    "defense",
    "launcher:gameplay:damaged",
    "damaged gameplay launcher",
    resources.getLauncherAssets(DEFAULT_GAMEPLAY_LAUNCHER_SCALE, true),
  );

  addProjectileAssets(
    items,
    "threats",
    `threat:${STARTUP_ENEMY_SCALE}`,
    resources.getThreatSpriteAssets(STARTUP_ENEMY_SCALE),
  );
  addProjectileAssets(
    items,
    "interceptors",
    `interceptor:${STARTUP_PROJECTILE_SCALE}`,
    resources.getInterceptorSpriteAssets(STARTUP_PROJECTILE_SCALE),
  );
  addProjectileAssets(
    items,
    "upgrades",
    `upgrade-projectile:${STARTUP_PROJECTILE_SCALE}`,
    resources.getUpgradeProjectileSpriteAssets(STARTUP_PROJECTILE_SCALE),
  );

  const defense = resources.getDefenseSiteAssets();
  addStaticAsset(items, "defense", "defense-site:patriotTEL", "patriot TEL", defense.patriotTEL);
  addStaticAsset(items, "defense", "defense-site:phalanxBase", "phalanx base", defense.phalanxBase);
  defense.wildHornetsHive.forEach((asset, index) =>
    addStaticAsset(items, "defense", `defense-site:wildHornetsHive:${index}`, `wild hornets hive L${index + 1}`, asset),
  );
  defense.roadrunnerContainer.forEach((asset, index) =>
    addStaticAsset(
      items,
      "defense",
      `defense-site:roadrunnerContainer:${index}`,
      `roadrunner container L${index + 1}`,
      asset,
    ),
  );
  defense.flareDispenser.forEach((asset, index) =>
    addStaticAsset(items, "defense", `defense-site:flareDispenser:${index}`, `flare dispenser L${index + 1}`, asset),
  );
  defense.empEmitter.forEach((asset, index) =>
    addStaticAsset(items, "defense", `defense-site:empEmitter:${index}`, `EMP emitter L${index + 1}`, asset),
  );

  const planes = resources.getPlaneAssets();
  addStaticAsset(items, "interceptors", "plane:f15:right", "F-15 right", planes.f15AirframeRight);
  addStaticAsset(items, "interceptors", "plane:f15:left", "F-15 left", planes.f15AirframeLeft);

  const effects = resources.getEffectSpriteAssets();
  addStaticAsset(items, "effects", "effect:explosion:light", "explosion light", effects.explosion.light);
  addStaticAsset(items, "effects", "effect:explosion:splash", "explosion splash", effects.explosion.splash);
  addStaticAsset(items, "effects", "effect:explosion:fireball", "explosion fireball", effects.explosion.fireball);
  addStaticAsset(items, "effects", "effect:explosion:core", "explosion core", effects.explosion.core);
  addStaticAsset(items, "effects", "effect:explosion:ring", "explosion ring", effects.explosion.ring);
  addStaticAsset(items, "effects", "effect:emp:wash", "EMP wash", effects.emp.wash);
  addStaticAsset(items, "effects", "effect:emp:ring", "EMP ring", effects.emp.ring);
  addStaticAsset(items, "effects", "effect:laserBeam", "laser beam", effects.laserBeam);
  addStaticAsset(items, "effects", "effect:phalanxBullet", "phalanx bullet", effects.phalanxBullet);
  for (const texture of collectBurjFireTextureCanvases()) {
    addCanvas(items, "effects", `effect:burj-fire:${texture.id}`, texture.label, texture.canvas, texture.note);
  }
  for (const asset of BURJ_SMOKE_PARTICLE_ASSETS) {
    const canvas = createSmokeParticleAssetCanvas(asset);
    if (!canvas) continue;
    addCanvas(items, "effects", `effect:burj-smoke:${asset.id}`, asset.label, canvas, "Kenney CC0 source PNG");
  }

  const groups = new Map<SpriteCatalogGroupId, SpriteCatalogItem[]>();
  for (const item of items) {
    const group = groups.get(item.group);
    if (group) group.push(item);
    else groups.set(item.group, [item]);
  }
  return SPRITE_CATALOG_GROUPS.map((group) => ({
    ...group,
    items: groups.get(group.id) ?? [],
  })).filter((group) => group.items.length > 0);
}
