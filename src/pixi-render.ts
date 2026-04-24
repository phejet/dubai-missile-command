import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { TITLE_SKYLINE_TOWERS } from "./canvas-render-resources";
import { BURJ_H, BURJ_X, CANVAS_H, CANVAS_W, GROUND_Y, LAUNCHERS, WATER_SURFACE_OFFSET } from "./game-logic";
import type { GameOverSnapshot, GameRenderer, GameplayRenderRequest } from "./game-renderer";
import { PIXI_PNG_ASSET_KEYS, loadPixiPngBundle, type PixiPngAssetMap } from "./pixi-assets";
import {
  createPixiTextureResources,
  type PixiBuildingAssets,
  type PixiBurjAssets,
  type PixiLauncherAssets,
  type PixiSkyAssets,
  type PixiTextureResources,
  type PixiThreatSpriteAssets,
} from "./pixi-textures";
import type { GameState } from "./types";

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

const TITLE_GROUND_Y = GROUND_Y - 100;
const TITLE_TOWER_BASE_Y = TITLE_GROUND_Y - 6;
const TITLE_WATER_TOP = TITLE_GROUND_Y + WATER_SURFACE_OFFSET;
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
  private readonly gameOverScene = new Container();
  private readonly textures: PixiTextureResources;
  private readonly ready: Promise<void>;
  private readonly titlePngsPromise: Promise<PixiPngAssetMap>;
  private titlePngs: PixiPngAssetMap = {};
  private titleState: TitleSceneState | null = null;
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
    this.root.addChild(this.titleScene, this.gameplayScene, this.gameOverScene);
    this.app.stage.addChild(this.root);

    this.canvas.dataset.renderer = "pixi";
    this.canvas.dataset.pixiTitle = "booting";
    this.titlePngsPromise = loadPixiPngBundle("title");
    this.ready = this.initialize();
  }

  renderTitle(): void {
    this.screen = "title";
    this.renderIfReady();
  }

  renderGameplay(_game: GameState, request: GameplayRenderRequest = {}): void {
    void request;
    this.screen = "playing";
    this.renderIfReady();
  }

  renderGameOver(snapshot: GameOverSnapshot): void {
    void snapshot;
    this.screen = "gameover";
    this.renderIfReady();
  }

  resize(): void {
    if (!this.initialized || this.destroyed) return;
    this.app.renderer.resize(CANVAS_W, CANVAS_H);
    this.renderIfReady();
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas.dataset.pixiTitle = "destroyed";
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
        this.titlePngsPromise,
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

      this.titlePngs = pngs;
      this.buildTitleScene();
      this.initialized = true;
      this.canvas.dataset.pixiTitle = "ready";
      this.renderIfReady();
    } catch (error: unknown) {
      this.initError = error instanceof Error ? error : new Error(String(error));
      this.canvas.dataset.pixiTitle = "error";
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

    const nebulaTexture = this.titlePngs[PIXI_PNG_ASSET_KEYS.skyNebula];
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

    const burjGlowTexture = this.titlePngs[PIXI_PNG_ASSET_KEYS.titleBurjGlow];
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
    const burjStatic = new Sprite(burjAssets.staticSprite);
    burjStatic.position.set(burjAssets.offset.x, burjAssets.offset.y);
    const burjAnim = createBlendSprites(burjAssets.animFrames[0] ?? Texture.EMPTY);
    positionBlendSprites(burjAnim, burjAssets.offset.x, burjAssets.offset.y);
    burjContainer.addChild(burjStatic, burjAnim.primary, burjAnim.secondary);
    this.titleBurjLayer.addChild(burjContainer);

    const beaconStem = createRect(0x803c28, 0.5, BURJ_X - 0.7, TITLE_TOWER_BASE_Y - BURJ_H - 50, 1.4, 10);
    const beaconGlow = createCircle(0xff5c40, 0, BURJ_X, TITLE_TOWER_BASE_Y - BURJ_H - 46, 8);
    this.titleBurjLayer.addChild(beaconStem, beaconGlow);

    this.titleBurjLayer.addChild(this.createTitleGroundDecor());

    const waterTexture = this.titlePngs[PIXI_PNG_ASSET_KEYS.titleWaterReflection];
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

  private renderIfReady(): void {
    if (!this.initialized || this.destroyed || this.initError || !this.titleState) return;

    const timeSeconds = performance.now() / 1000;
    this.canvas.dataset.pixiScreen = this.screen;
    this.titleScene.visible = true;
    this.gameplayScene.visible = false;
    this.gameOverScene.visible = false;

    // Phase 2 Step 3 only ports the title composition, so non-title screens keep the title scene alive.
    this.updateTitleScene(this.titleState, timeSeconds);
    this.app.render();
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
