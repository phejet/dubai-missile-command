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
  getBurjDamageFireLayout,
} from "./art-render.js";
import { BURJ_X, GAMEPLAY_SCENIC_BASE_Y, GROUND_Y } from "./game-logic.js";

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
    expect(assets.damagedBandSprites).toHaveLength(7);
    expect(assets.damagedBandOffsets).toHaveLength(7);
    expect(assets.frameCount).toBe(8);
    expect(assets.period).toBe(20);
    expect(Number.isFinite(assets.offset.x)).toBe(true);
    expect(Number.isFinite(assets.offset.y)).toBe(true);

    for (const frame of assets.animFrames) {
      expect(frame.width).toBe(assets.staticSprite.width);
      expect(frame.height).toBe(assets.staticSprite.height);
    }
    for (const sprite of assets.damagedBandSprites) {
      expect(sprite.width).toBeGreaterThan(0);
      expect(sprite.height).toBeGreaterThan(40);
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

describe("getBurjDamageFireLayout", () => {
  it("returns no live fire anchors for pristine health", () => {
    const layout = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 7, { gameSeed: 123 });

    expect(layout.tier).toBe("pristine");
    expect(layout.topBand).toBeNull();
    expect(layout.fireSites).toHaveLength(0);
    expect(layout.flameAnchors).toHaveLength(0);
    expect(layout.smokeAnchor).toBeNull();
  });

  it("creates one fire site per damaged band with extra anchors on wide bands", () => {
    const wounded = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 5, { gameSeed: 123, anchorHeightMin: 0.82 });
    const critical = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 1, { gameSeed: 123, anchorHeightMin: 0.82 });

    expect(wounded.tier).toBe("wounded");
    expect(critical.tier).toBe("critical");
    expect(wounded.topBand?.index).toBe(6);
    expect(critical.topBand?.index).toBe(6);
    expect(wounded.fireSites.map((site) => site.band.index)).toEqual([5, 6]);
    expect(critical.fireSites.map((site) => site.band.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(critical.fireSites).toHaveLength(7);
    expect(critical.fireSites.filter((site) => site.flameAnchors.length === 2).map((site) => site.band.index)).toEqual([
      0, 1, 2,
    ]);
    expect(critical.fireSites.filter((site) => site.flameAnchors.length === 1).map((site) => site.band.index)).toEqual([
      3, 4, 5, 6,
    ]);
    expect(critical.flameAnchors.length).toBeGreaterThan(wounded.flameAnchors.length);
    expect(
      critical.fireSites.every((site) => site.flameAnchors.every((anchor) => Math.abs(anchor.x - BURJ_X) > 1)),
    ).toBe(true);
    expect(
      critical.fireSites.every((site) =>
        site.flameAnchors.every((anchor) => anchor.y >= site.sectionTopY && anchor.y <= site.sectionBottomY),
      ),
    ).toBe(true);
    const anchorsNearOldLevel = critical.fireSites.flatMap((site) =>
      site.flameAnchors.filter((anchor) => Math.abs(anchor.y - (site.band.y + site.band.h * 0.42)) <= site.band.h),
    );
    expect(anchorsNearOldLevel.length).toBeLessThan(critical.flameAnchors.length / 2);
    const uniqueAnchorRows = new Set(
      critical.fireSites.flatMap((site) => site.flameAnchors.map((anchor) => Math.round(anchor.y))),
    );
    expect(uniqueAnchorRows.size).toBeGreaterThan(critical.fireSites.length);
    const roundedAnchorColumns = new Set(critical.flameAnchors.map((anchor) => Math.round(anchor.x - BURJ_X)));
    expect(roundedAnchorColumns.size).toBe(critical.flameAnchors.length);
    const pairedSites = critical.fireSites.filter((site) => site.flameAnchors.length === 2);
    const leftColumnSpread =
      Math.max(...pairedSites.map((site) => BURJ_X - site.flameAnchors[0].x)) -
      Math.min(...pairedSites.map((site) => BURJ_X - site.flameAnchors[0].x));
    const rightColumnSpread =
      Math.max(...pairedSites.map((site) => site.flameAnchors[1].x - BURJ_X)) -
      Math.min(...pairedSites.map((site) => site.flameAnchors[1].x - BURJ_X));
    expect(leftColumnSpread).toBeGreaterThan(2.5);
    expect(rightColumnSpread).toBeGreaterThan(2.5);
  });

  it("is deterministic for the same band and seed", () => {
    const a = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 3, { gameSeed: 4242 });
    const b = getBurjDamageFireLayout(GAMEPLAY_SCENIC_BASE_Y, 3, { gameSeed: 4242 });

    expect(b.fireSites).toEqual(a.fireSites);
    expect(b.flameAnchors).toEqual(a.flameAnchors);
    expect(b.smokeAnchor).toEqual(a.smokeAnchor);
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
      "missile_fast",
      "shahed136",
      "shahed136_dive",
      "shahed238",
      "stack_carrier_2",
      "stack_carrier_3",
      "stack_child",
    ]);
    expect(assets.missile.scale).toBe(3);
    expect(assets.missile.animFrames).toHaveLength(8);
    expect(assets.missile_fast.staticSprite.width).toBeGreaterThan(0);
    expect(assets.missile_fast.staticSprite.height).toBeGreaterThan(0);
    expect(assets.missile_fast.animFrames).toHaveLength(8);
    expect(assets.shahed136.staticSprite.width).toBeGreaterThan(0);
    expect(assets.shahed136_dive.staticSprite.width).toBeGreaterThan(0);
    expect(assets.shahed136_dive.staticSprite.height).toBeGreaterThan(0);
    expect(assets.shahed136_dive.animFrames).toHaveLength(8);
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

    for (const variant of [assets.f15AirframeRight, assets.f15AirframeLeft]) {
      expect(variant.sprite.width).toBeGreaterThan(0);
      expect(variant.sprite.height).toBeGreaterThan(0);
      expect(Number.isFinite(variant.offset.x)).toBe(true);
      expect(Number.isFinite(variant.offset.y)).toBe(true);
    }
    expect(assets.f15AirframeLeft.offset.x).toBe(-(assets.f15AirframeRight.offset.x + assets.f15AirframeRight.width));
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
