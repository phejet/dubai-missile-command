import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasRenderResources, SkyAssets } from "./canvas-render-resources";
import { createPixiTextureResources } from "./pixi-textures";

const OriginalHtmlCanvasElement = globalThis.HTMLCanvasElement;

class FakeCanvas {
  width = 32;
  height = 16;

  getContext(): null {
    return null;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  if (OriginalHtmlCanvasElement === undefined) {
    Reflect.deleteProperty(globalThis, "HTMLCanvasElement");
  } else {
    globalThis.HTMLCanvasElement = OriginalHtmlCanvasElement;
  }
});

describe("PixiTextureResources prebake backing lifecycle", () => {
  it("releases only GPU-resident sources and regenerates them after context loss", () => {
    globalThis.HTMLCanvasElement = FakeCanvas as unknown as typeof HTMLCanvasElement;
    let source: SkyAssets | null = null;
    const releasePrebakedCanvasBacking = vi.fn((canvases: Iterable<HTMLCanvasElement>) => {
      for (const canvas of canvases) {
        canvas.width = 0;
        canvas.height = 0;
      }
    });
    const canvasResources = {
      getTitleSkyAssets: () => {
        if (!source || source.frames.some((frame) => frame.width === 0 || frame.height === 0)) {
          source = {
            frames: [new FakeCanvas() as unknown as HTMLCanvasElement],
            frameCount: 1,
            period: 1,
          };
        }
        return source;
      },
      releasePrebakedCanvasBacking,
      getPrebakedCanvasBackingStats: () => ({
        canvasCount: source?.frames.length ?? 0,
        logicalBytes: source?.frames.reduce((bytes, frame) => bytes + frame.width * frame.height * 4, 0) ?? 0,
      }),
    } as unknown as CanvasRenderResources;
    const textures = createPixiTextureResources(canvasResources);
    const firstAssets = textures.getTitleSkyAssets();
    const firstTexture = firstAssets.frames[0];
    const firstCanvas = firstTexture.source.resource as HTMLCanvasElement;

    expect(textures.releaseUploadedCanvasBacking(() => false)).toBe(0);
    expect(firstCanvas.width).toBe(32);
    expect(textures.releaseUploadedCanvasBacking((texture) => texture === firstTexture)).toBe(1);
    expect(firstCanvas.width).toBe(0);
    expect(releasePrebakedCanvasBacking).toHaveBeenCalledOnce();
    expect(textures.getTitleSkyAssets()).toBe(firstAssets);

    textures.invalidateForContextLoss();
    const rebuiltAssets = textures.getTitleSkyAssets();
    expect(rebuiltAssets).not.toBe(firstAssets);
    expect(rebuiltAssets.frames[0]).not.toBe(firstTexture);
    expect((rebuiltAssets.frames[0].source.resource as HTMLCanvasElement).width).toBe(32);
  });
});
