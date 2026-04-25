import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { DEFAULT_GAMEPLAY_LAUNCHER_SCALE, TITLE_SKYLINE_TOWERS } from "./canvas-render-resources";
import {
  BURJ_H,
  BURJ_X,
  CANVAS_H,
  CANVAS_W,
  COL,
  GAMEPLAY_SCENIC_GROUND_Y,
  GAMEPLAY_SCENIC_LAUNCHER_Y,
  GROUND_Y,
  LAUNCHERS,
  WATER_SURFACE_OFFSET,
  getDefenseSitePlacement,
  getPhalanxTurrets,
} from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameplayRenderRequest } from "./game-renderer";
import { PIXI_PNG_ASSET_KEYS, loadPixiPngBundles, type PixiPngAssetMap } from "./pixi-assets";
import { UPGRADE_FAMILIES } from "./game-sim-upgrades";
import {
  createPixiTextureResources,
  type PixiBuildingAssets,
  type PixiBurjAssets,
  type PixiDefenseSiteAssets,
  type PixiLauncherAssets,
  type PixiSkyAssets,
  type PixiStaticSpriteAsset,
  type PixiTextureResources,
  type PixiThreatSpriteAssets,
} from "./pixi-textures";
import type { DefenseSite, GameState } from "./types";

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
}

interface TitleThreatNode {
  container: Container;
  trail: Graphics;
  anim: BlendSprites;
  kind: TitleThreatKind;
  x: number;
  y: number;
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
  water: TilingSprite | null;
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
  hpPips: Graphics;
  wreckage: Graphics;
  damaged: boolean;
}

interface GameplayDefenseSiteNode {
  container: Container;
  sprite: Sprite;
  overlay: Graphics;
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
  water: TilingSprite | null;
  waterShade: Graphics;
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
const GAMEPLAY_FLARE_VISUAL_Y = GROUND_Y - BURJ_H * 0.97;
const GAMEPLAY_EMP_VISUAL_Y = GROUND_Y - BURJ_H * 0.67;
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

function createRect(fill: number, alpha: number, x: number, y: number, width: number, height: number): Graphics {
  const graphic = new Graphics();
  graphic.rect(x, y, width, height).fill(fill);
  graphic.alpha = alpha;
  return graphic;
}

function createCircle(fill: number, alpha: number, x: number, y: number, radius: number): Graphics {
  const graphic = new Graphics();
  graphic.circle(x, y, radius).fill(fill);
  graphic.alpha = alpha;
  return graphic;
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
} as const;

const UPGRADE_FAMILY_COLOR_HEX = new Map(
  Object.entries(UPGRADE_FAMILIES).map(([key, upgrade]) => [key, cssHexToNumber(upgrade.color, 0x44ffaa)]),
);

function createStaticAssetSprite(asset: PixiStaticSpriteAsset): Sprite {
  const sprite = new Sprite(asset.sprite);
  sprite.position.set(asset.offset.x, asset.offset.y);
  return sprite;
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

function drawBurjWreckage(graphic: Graphics): void {
  for (let i = 0; i < 8; i++) {
    const h1 = ((i * 7 + 3) % 13) / 13;
    const h2 = ((i * 11 + 5) % 13) / 13;
    graphic.rect(BURJ_X - 18 + i * 5, GAMEPLAY_TOWER_BASE_Y - 12 - h1 * 24, 6, 12 + h2 * 18).fill(0x1f2432);
  }
}

function getDefenseSiteColor(site: DefenseSite): number {
  return UPGRADE_FAMILY_COLOR_HEX.get(site.key) ?? 0x44ffaa;
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
  private readonly gameplayGroundStructuresLayer = new Container();
  private readonly gameplayOverlayLayer = new Container();
  private readonly gameOverScene = new Container();
  private readonly textures: PixiTextureResources;
  private readonly ready: Promise<void>;
  private readonly pngsPromise: Promise<PixiPngAssetMap>;
  private pngs: PixiPngAssetMap = {};
  private titleState: TitleSceneState | null = null;
  private gameplayState: GameplaySceneState | null = null;
  private latestGame: GameState | null = null;
  private initialized = false;
  private destroyed = false;
  private initError: Error | null = null;
  private screen: PixiScreen = "title";

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
    this.gameplayGroundStructuresLayer.label = "gameplay-ground-structures-layer";
    this.gameplayOverlayLayer.label = "gameplay-overlay-layer";
    this.gameOverScene.label = "gameover-scene";

    this.titleScene.addChild(
      this.titleSkyLayer,
      this.titleSkylineLayer,
      this.titleBurjLayer,
      this.titleWaterLayer,
      this.titleLauncherLayer,
      this.titleThreatLayer,
      this.titleAccentLayer,
    );
    this.gameplayScene.addChild(
      this.gameplaySkyLayer,
      this.gameplayBurjLayer,
      this.gameplayCityLayer,
      this.gameplayWaterLayer,
      this.gameplayGroundStructuresLayer,
      this.gameplayOverlayLayer,
    );
    this.root.addChild(this.titleScene, this.gameplayScene, this.gameOverScene);
    this.app.stage.addChild(this.root);

    this.canvas.dataset.renderer = "pixi";
    this.canvas.dataset.pixiTitle = "booting";
    this.canvas.dataset.pixiGameplayStatic = "booting";
    this.pngsPromise = loadPixiPngBundles(["title", "gameplay"]);
    this.ready = this.initialize();
  }

  renderTitle(): void {
    this.screen = "title";
    this.latestGame = null;
    this.renderIfReady();
  }

  renderGameplay(game: GameState, request: GameplayRenderRequest = {}): void {
    void request;
    this.screen = "playing";
    this.latestGame = game;
    this.renderIfReady();
  }

  renderGameOver(snapshot: GameOverSnapshot): void {
    void snapshot;
    this.screen = "gameover";
    this.latestGame = null;
    this.renderIfReady();
  }

  resize(): void {
    if (!this.initialized || this.destroyed) return;
    this.app.renderer.resize(CANVAS_W, CANVAS_H);
    this.renderIfReady();
  }

  destroy(): void {
    this.destroyed = true;
    this.latestGame = null;
    this.canvas.dataset.pixiTitle = "destroyed";
    this.canvas.dataset.pixiGameplayStatic = "destroyed";
    this.app.destroy(false, { children: true, texture: false, textureSource: false });
  }

  get readyPromise(): Promise<void> {
    return this.ready;
  }

  get textureResources(): PixiTextureResources {
    return this.textures;
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
      if (this.destroyed) return;

      this.pngs = pngs;
      this.buildTitleScene();
      this.buildGameplayScene();
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

    const beaconStem = createRect(0x803c28, 0.5, BURJ_X - 0.7, TITLE_TOWER_BASE_Y - BURJ_H * 2 - 50, 1.4, 10);
    const beaconGlow = createCircle(0xff5c40, 0, BURJ_X, TITLE_TOWER_BASE_Y - BURJ_H * 2 - 46, 8);
    this.titleBurjLayer.addChild(beaconStem, beaconGlow);

    this.titleBurjLayer.addChild(this.createTitleGroundDecor());

    const waterTexture = this.pngs[PIXI_PNG_ASSET_KEYS.titleWaterReflection];
    const water = waterTexture
      ? new TilingSprite({
          texture: waterTexture,
          width: CANVAS_W + 10,
          height: CANVAS_H - TITLE_WATER_TOP,
        })
      : null;
    if (water) {
      water.position.set(0, TITLE_WATER_TOP);
      water.alpha = 0.94;
      this.titleWaterLayer.addChild(water);
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
      turretRoot.addChild(turret);

      container.addChild(chassisStatic, chassis.primary, chassis.secondary, turretRoot);
      this.titleLauncherLayer.addChild(container);
      return { container, chassis, turretRoot };
    });

    const threats = TITLE_AIRCRAFT.map((aircraft) => {
      const asset = aircraft.kind === "shahed" ? threatAssets.shahed136 : threatAssets.missile;
      const container = new Container();
      container.position.set(aircraft.x, aircraft.y);

      const trail = new Graphics();
      const anim = createBlendSprites(asset.animFrames[0] ?? Texture.EMPTY);
      positionBlendSprites(anim, asset.offset.x, asset.offset.y);

      const guideLine = new Graphics();
      guideLine
        .moveTo(aircraft.x, aircraft.y)
        .lineTo(TITLE_TARGET_X, TITLE_TARGET_Y)
        .stroke({
          width: 1,
          color: aircraft.kind === "shahed" ? 0xffd296 : 0xd2dce6,
          alpha: 0.1,
        });

      container.addChild(trail, anim.primary, anim.secondary);
      this.titleThreatLayer.addChild(guideLine, container);
      return {
        container,
        trail,
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
    const hitFlash = new Graphics();
    burjContainer.addChild(
      burjStatic,
      damageUnderlay,
      burjAnim.primary,
      burjAnim.secondary,
      decalLayer,
      damageFxLayer,
      hitFlash,
    );

    const wreckage = new Graphics();
    drawBurjWreckage(wreckage);
    wreckage.visible = false;

    const beaconStem = createRect(0x803c28, 0.5, BURJ_X - 0.7, GAMEPLAY_TOWER_BASE_Y - BURJ_H * 2 - 50, 1.4, 10);
    const beaconGlow = createCircle(0xff5c40, 0, BURJ_X, GAMEPLAY_TOWER_BASE_Y - BURJ_H * 2 - 46, 8);
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
      ? new TilingSprite({
          texture: waterTexture,
          width: CANVAS_W + 10,
          height: CANVAS_H - GAMEPLAY_WATER_TOP,
        })
      : null;
    if (water) {
      water.position.set(0, GAMEPLAY_WATER_TOP);
      water.alpha = 0.9;
      this.gameplayWaterLayer.addChild(water);
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
      const muzzleFlash = new Graphics();
      turretRoot.addChild(turret, muzzleFlash);

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
    this.gameplayOverlayLayer.addChild(defenseStatusOverlay);

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
      water,
      waterShade,
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
    if (!this.initialized || this.destroyed || this.initError || !this.titleState || !this.gameplayState) return;

    const timeSeconds = performance.now() / 1000;
    this.canvas.dataset.pixiScreen = this.screen;
    this.titleScene.visible = this.screen === "title";
    this.gameplayScene.visible = this.screen !== "title";
    this.gameOverScene.visible = false;

    this.updateTitleScene(this.titleState, timeSeconds);
    if (this.latestGame) {
      this.updateGameplayScene(this.gameplayState, this.latestGame, this.latestGame.time / 60);
    }
    this.app.render();
  }

  private updateGameplayScene(state: GameplaySceneState, game: GameState, sceneTime: number): void {
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
    this.updateGameplayLaunchers(state, game, sceneTime);
    this.updateGameplayDefenseSites(state, game, sceneTime);

    this.canvas.dataset.pixiGameplayStatic = "ready";
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
      burj.damageUnderlay
        .rect(-34, -BURJ_H - 54, 68, BURJ_H + 72)
        .fill({ color: 0x2c1010, alpha: 0.08 + damageLevel * 0.2 });
      burj.damageUnderlay
        .circle(0, -BURJ_H * 0.3, 34 + damageLevel * 10)
        .fill({ color: 0xff7040, alpha: damageLevel * 0.08 });
      if (critical) {
        burj.damageUnderlay.rect(-22, -BURJ_H - 48, 44, BURJ_H + 66).fill({ color: 0xff4840, alpha: 0.12 });
      }
    }

    this.updateBurjDecals(burj, game);
    this.updateBurjDamageFx(burj, game, sceneTime, damageLevel, critical);
    this.updateBurjHitFlash(burj, game);

    const beaconBlink = Math.max(0, Math.sin(sceneTime * 3));
    const beaconIntensity = Math.pow(beaconBlink, 0.3);
    burj.beaconStem.alpha = 0.25 + 0.75 * beaconIntensity;
    burj.beaconGlow.alpha = 0.36 * beaconIntensity;
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
      graphic.circle(localX + Math.sin(fx.seed) * 2, localY - 3, 8).fill({ color: 0x1c1412, alpha: 0.72 });
      graphic.circle(localX, localY, 20 + flicker * 3.2 + damageLevel * 3).fill({
        color: 0xff6e2f,
        alpha: Math.min(0.72, (0.22 + flicker * 0.28) * emberBoost),
      });
      graphic.circle(localX, localY, 7 + flicker * 2).fill({ color: 0xfff0c8, alpha: 0.62 });
      if (damageLevel >= 0.5) {
        graphic.ellipse(localX + Math.sin(fx.seed * 1.7 + sceneTime * 0.03) * 4, localY - 15, 9, 16).fill({
          color: 0x221a1c,
          alpha: 0.12 + damageLevel * 0.14 + (critical ? 0.08 : 0),
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
    if (hitFlashT <= 0) return;

    const localX = (game.burjHitFlashX - BURJ_X) / 2;
    const localY = (game.burjHitFlashY - GAMEPLAY_TOWER_BASE_Y) / 2;
    const flashPop = Math.pow(hitFlashT, 0.45);
    const orangeTail = Math.pow(hitFlashT, 0.78);
    const flashFade = 1 - hitFlashT;
    burj.hitFlash.circle(localX, localY, 36 + 32 * flashPop).fill({ color: 0xff7034, alpha: 0.18 * orangeTail });
    burj.hitFlash.circle(localX, localY, 8 + 10 * flashPop).fill({ color: 0xfff6dc, alpha: 0.98 * flashPop });
    burj.hitFlash
      .circle(localX, localY, 20 + 34 * flashFade)
      .stroke({ width: 1.4, color: 0xff9c58, alpha: 0.38 * orangeTail });
  }

  private updateGameplayWater(state: GameplaySceneState, sceneTime: number): void {
    if (state.water) {
      state.water.tilePosition.x = Math.sin(sceneTime * 0.28) * 18;
      state.water.tilePosition.y = sceneTime * 10;
      state.water.alpha = 0.88 + 0.04 * Math.sin(sceneTime * 0.4 + 0.6);
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

      if (!alive) return;

      syncBlendSprites(launcher.chassis, assets.chassisAnimFrames, frameProgress, 1, true);
      const rawLauncher = LAUNCHERS[index];
      const angle = Math.atan2(game.crosshairY - rawLauncher.y, game.crosshairX - rawLauncher.x);
      launcher.turretRoot.rotation = Math.min(-0.2, Math.max(angle, -Math.PI + 0.2));

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
    state.beaconGlow.alpha = 0.36 * beaconIntensity;
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
    });

    state.threats.forEach((threat, index) => {
      const aimAngle = Math.atan2(TITLE_TARGET_Y - threat.y, TITLE_TARGET_X - threat.x);
      const rotation = threat.kind === "shahed" ? aimAngle + 0.08 : aimAngle + 0.04;
      const titleTime = getTitleThreatAnimationTime(timeSeconds, threat.kind, index);
      const asset = threat.kind === "shahed" ? state.threatAssets.shahed136 : state.threatAssets.missile;
      const frameProgress = getFrameProgress(titleTime, asset.period, asset.frameCount);

      threat.container.rotation = rotation;
      syncBlendSprites(threat.anim, asset.animFrames, frameProgress);
      this.updateThreatTrail(threat);
    });

    if (state.water) {
      state.water.tilePosition.x = Math.sin(timeSeconds * 0.28) * 18;
      state.water.tilePosition.y = timeSeconds * 10;
      state.water.alpha = 0.9 + 0.04 * Math.sin(timeSeconds * 0.4 + 0.6);
    }
    state.waterShade.alpha = 0.22 + 0.04 * Math.sin(timeSeconds * 0.24);

    const skylineDrift = Math.sin(timeSeconds * 0.05) * 1.8;
    state.ambientMarkers.forEach((marker, index) => {
      marker.position.x = skylineDrift;
      marker.alpha = 0.12;
      marker.y = TITLE_GROUND_Y - 82 - (index % 2) * 6;
    });
  }

  private updateThreatTrail(threat: TitleThreatNode): void {
    threat.trail.clear();
    if (threat.kind === "shahed") {
      threat.trail
        .moveTo(-86, 0)
        .lineTo(0, 0)
        .stroke({ width: 7.8, color: 0x889098, alpha: 0.14, cap: "round" })
        .moveTo(-86, 0)
        .lineTo(0, 0)
        .stroke({ width: 3, color: 0xc4ccd4, alpha: 0.5, cap: "round" })
        .circle(0, 0, 3.6)
        .fill(0xc4aa76);
      return;
    }

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
