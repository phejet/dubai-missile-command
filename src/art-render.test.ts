import { afterEach, describe, expect, it } from "vitest";
import {
  buildDefenseSiteAssets,
  buildInterceptorSpriteAssets,
  buildBuildingAssets,
  buildBurjAssets,
  buildLauncherAssets,
  buildPlaneAssets,
  buildThreatSpriteAssets,
  buildTitleBuildingAssets,
  buildUpgradeProjectileSpriteAssets,
  createSpriteCanvas,
} from "./art-render.js";
import { GAMEPLAY_SCENIC_BASE_Y, GROUND_Y } from "./game-logic.js";

const originalDocument = globalThis.document;

afterEach(() => {
  if (originalDocument === undefined) {
    Reflect.deleteProperty(globalThis, "document");
    return;
  }
  globalThis.document = originalDocument;
});

describe("buildBurjAssets", () => {
  it("builds Burj sprites in headless mode without a DOM", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildBurjAssets(470, 2);

    expect(assets.resolutionScale).toBe(2);
    expect(assets.staticSprite.width).toBeGreaterThan(0);
    expect(assets.staticSprite.height).toBeGreaterThan(0);
    expect(assets.animFrames).toHaveLength(8);
    expect(assets.frameCount).toBe(8);
    expect(assets.period).toBe(20);
    expect(Number.isFinite(assets.offset.x)).toBe(true);
    expect(Number.isFinite(assets.offset.y)).toBe(true);

    for (const frame of assets.animFrames) {
      expect(frame.width).toBe(assets.staticSprite.width);
      expect(frame.height).toBe(assets.staticSprite.height);
    }
  });

  it("supports higher-resolution sprite canvases for prebaked assets", () => {
    Reflect.deleteProperty(globalThis, "document");

    const canvas = createSpriteCanvas(32, 24, 2);

    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(48);
  });

  it("provides the expanded stub canvas APIs used by Burj baking", () => {
    Reflect.deleteProperty(globalThis, "document");

    const canvas = createSpriteCanvas(32, 24);
    const ctx = canvas.getContext("2d");

    expect(ctx).not.toBeNull();
    expect(typeof ctx?.clip).toBe("function");
    expect(typeof ctx?.stroke).toBe("function");
    expect(typeof ctx?.scale).toBe("function");
    expect(typeof ctx?.rotate).toBe("function");
    expect(typeof ctx?.ellipse).toBe("function");
    expect(typeof ctx?.quadraticCurveTo).toBe("function");
    expect(typeof ctx?.setTransform).toBe("function");
    expect(ctx?.globalCompositeOperation).toBe("source-over");
  });
});

describe("tower asset baking", () => {
  it("builds gameplay building sprites in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildBuildingAssets(GAMEPLAY_SCENIC_BASE_Y);

    expect(assets.staticSprites.length).toBeGreaterThan(0);
    expect(assets.animFrames.length).toBe(assets.staticSprites.length);
    expect(assets.frameCount).toBe(8);
    expect(assets.period).toBe(20);
    expect(assets.staticOffsets.length).toBe(assets.staticSprites.length);
    expect(assets.animOffsets.length).toBe(assets.staticSprites.length);
  });

  it("builds title skyline sprites in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildTitleBuildingAssets(GROUND_Y - 106);

    expect(assets.staticSprites.length).toBeGreaterThan(0);
    expect(assets.animFrames.length).toBe(assets.staticSprites.length);
    expect(assets.frameCount).toBe(8);
    expect(assets.period).toBe(40);
  });
});

describe("launcher asset baking", () => {
  it("builds gameplay launcher sprites in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildLauncherAssets(0.98, false);

    expect(assets.scale).toBe(0.98);
    expect(assets.damaged).toBe(false);
    expect(assets.chassisStaticSprite.width).toBeGreaterThan(0);
    expect(assets.turretSprite.width).toBeGreaterThan(0);
    expect(assets.chassisAnimFrames).toHaveLength(8);
    expect(assets.frameCount).toBe(8);
    expect(assets.period).toBe(10);
    expect(Number.isFinite(assets.chassisOffset.x)).toBe(true);
    expect(Number.isFinite(assets.turretPivot.y)).toBe(true);
  });

  it("builds damaged launcher variants in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildLauncherAssets(0.98, true);

    expect(assets.damaged).toBe(true);
    expect(assets.chassisAnimFrames).toHaveLength(8);
    for (const frame of assets.chassisAnimFrames) {
      expect(frame.width).toBe(assets.chassisStaticSprite.width);
      expect(frame.height).toBe(assets.chassisStaticSprite.height);
    }
  });
});

describe("projectile sprite asset baking", () => {
  it("builds threat sprite variants in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildThreatSpriteAssets(3);

    expect(Object.keys(assets).sort()).toEqual([
      "bomb",
      "mirv",
      "mirv_warhead",
      "missile",
      "shahed136",
      "shahed238",
      "stack_carrier_2",
      "stack_carrier_3",
      "stack_child",
    ]);
    expect(assets.missile.scale).toBe(3);
    expect(assets.missile.animFrames).toHaveLength(8);
    expect(assets.shahed136.staticSprite.width).toBeGreaterThan(0);
    expect(assets.stack_carrier_3.staticSprite.height).toBeGreaterThan(0);
  });

  it("builds interceptor sprite variants in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildInterceptorSpriteAssets(2);

    expect(Object.keys(assets).sort()).toEqual(["f15Interceptor", "playerInterceptor"]);
    expect(assets.playerInterceptor.scale).toBe(2);
    expect(assets.playerInterceptor.animFrames).toHaveLength(8);
    expect(assets.f15Interceptor.staticSprite.width).toBeGreaterThan(0);
  });

  it("builds upgrade projectile sprite variants in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildUpgradeProjectileSpriteAssets(2);

    expect(Object.keys(assets).sort()).toEqual(["patriotSam", "roadrunner", "wildHornet"]);
    expect(assets.wildHornet.scale).toBe(2);
    expect(assets.wildHornet.animFrames).toHaveLength(8);
    expect(assets.roadrunner.staticSprite.width).toBeGreaterThan(0);
    expect(assets.patriotSam.staticSprite.height).toBeGreaterThan(0);
  });

  it("builds plane airframe sprite in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildPlaneAssets();

    expect(assets.f15Airframe.sprite.width).toBeGreaterThan(0);
    expect(assets.f15Airframe.sprite.height).toBeGreaterThan(0);
    expect(Number.isFinite(assets.f15Airframe.offset.x)).toBe(true);
    expect(Number.isFinite(assets.f15Airframe.offset.y)).toBe(true);
  });

  it("builds defense site sprite variants in headless mode", () => {
    Reflect.deleteProperty(globalThis, "document");

    const assets = buildDefenseSiteAssets();

    expect(assets.patriotTEL.sprite.width).toBeGreaterThan(0);
    expect(assets.phalanxBase.sprite.width).toBeGreaterThan(0);
    expect(assets.wildHornetsHive).toHaveLength(3);
    expect(assets.roadrunnerContainer).toHaveLength(3);
    expect(assets.flareDispenser).toHaveLength(3);
    expect(assets.empEmitter).toHaveLength(3);
    for (const level of assets.wildHornetsHive) {
      expect(level.sprite.width).toBeGreaterThan(0);
    }
    for (const level of assets.empEmitter) {
      expect(Number.isFinite(level.offset.x)).toBe(true);
    }
  });
});
