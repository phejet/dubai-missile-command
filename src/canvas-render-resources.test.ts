import { describe, expect, it } from "vitest";
import { createCanvasRenderResources } from "./canvas-render-resources";

describe("CanvasRenderResources prebake backing lifecycle", () => {
  it("releases only uploaded canvases and rebuilds an incomplete asset family", () => {
    const resources = createCanvasRenderResources();
    const burj = resources.getBurjAssets(1190, 2);
    const launcher = resources.getLauncherAssets(0.98, false);
    const releasedBytes = burj.staticSprite.width * burj.staticSprite.height * 4;
    const before = resources.getPrebakedCanvasBackingStats();

    resources.releasePrebakedCanvasBacking([burj.staticSprite]);

    expect(burj.staticSprite.width).toBe(0);
    expect(burj.staticSprite.height).toBe(0);
    expect(resources.getPrebakedCanvasBackingStats()).toEqual({
      canvasCount: before.canvasCount,
      logicalBytes: before.logicalBytes - releasedBytes,
    });
    expect(resources.getLauncherAssets(0.98, false)).toBe(launcher);

    const rebuiltBurj = resources.getBurjAssets(1190, 2);
    expect(rebuiltBurj).not.toBe(burj);
    expect(rebuiltBurj.staticSprite.width).toBeGreaterThan(0);
    expect(rebuiltBurj.animFrames.every((frame) => frame.width > 0 && frame.height > 0)).toBe(true);
  });

  it("rebuilds a released sky from the same star content without retaining another live backing generation", () => {
    const resources = createCanvasRenderResources();
    const stars = [{ x: 12, y: 34, size: 1.2, twinkle: 5.6 }];
    const sky = resources.getGameplaySkyAssets(stars, 1190);
    const canvasCount = resources.getPrebakedCanvasBackingStats().canvasCount;

    resources.releasePrebakedCanvasBacking(sky.frames);
    expect(resources.getPrebakedCanvasBackingStats()).toEqual({ canvasCount, logicalBytes: 0 });

    const rebuilt = resources.getGameplaySkyAssets([...stars], 1190);
    expect(rebuilt).not.toBe(sky);
    expect(rebuilt.frames.every((frame) => frame.width === 900 && frame.height === 1600)).toBe(true);
    expect(resources.getPrebakedCanvasBackingStats().canvasCount).toBe(canvasCount);
  });
});
