import { afterEach, describe, expect, it } from "vitest";
import { buildBurjAssets, createSpriteCanvas } from "./art-render.js";

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
