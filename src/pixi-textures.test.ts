import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasRenderResources, SkyAssets } from "./canvas-render-resources";
import { createPixiTextureResources } from "./pixi-textures";

const OriginalHtmlCanvasElement = globalThis.HTMLCanvasElement;

// Full-screen dimensions (CANVAS_W x CANVAS_H); a canvas this large is released,
// a small sprite-sized one is kept resident.
const LARGE_W = 900;
const LARGE_H = 1600;

class FakeCanvas {
  constructor(
    public width = 32,
    public height = 16,
  ) {}

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
  it("releases only large GPU-resident sources and regenerates them after context loss", () => {
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
            frames: [new FakeCanvas(LARGE_W, LARGE_H) as unknown as HTMLCanvasElement],
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
    expect(firstCanvas.width).toBe(LARGE_W);
    expect(textures.releaseUploadedCanvasBacking((texture) => texture === firstTexture)).toBe(1);
    expect(firstCanvas.width).toBe(0);
    expect(releasePrebakedCanvasBacking).toHaveBeenCalledOnce();
    expect(textures.getTitleSkyAssets()).toBe(firstAssets);

    textures.invalidateForContextLoss();
    const rebuiltAssets = textures.getTitleSkyAssets();
    expect(rebuiltAssets).not.toBe(firstAssets);
    expect(rebuiltAssets.frames[0]).not.toBe(firstTexture);
    expect((rebuiltAssets.frames[0].source.resource as HTMLCanvasElement).width).toBe(LARGE_W);
  });

  it("keeps small sprite-sized canvas backing resident so re-upload never yields a blank sprite", () => {
    globalThis.HTMLCanvasElement = FakeCanvas as unknown as typeof HTMLCanvasElement;
    // Sprite-sized backing (well under the full-screen release threshold). WebKit
    // can drop and re-upload a GPU texture without a context-loss event, and a
    // released (0x0) source would re-upload blank — the death-clip render bug.
    const source: SkyAssets = {
      frames: [new FakeCanvas(48, 48) as unknown as HTMLCanvasElement],
      frameCount: 1,
      period: 1,
    };
    const releasePrebakedCanvasBacking = vi.fn();
    const canvasResources = {
      getTitleSkyAssets: () => source,
      releasePrebakedCanvasBacking,
      getPrebakedCanvasBackingStats: () => ({ canvasCount: 1, logicalBytes: 48 * 48 * 4 }),
    } as unknown as CanvasRenderResources;
    const textures = createPixiTextureResources(canvasResources);
    const assets = textures.getTitleSkyAssets();
    const texture = assets.frames[0];
    const canvas = texture.source.resource as HTMLCanvasElement;

    expect(textures.releaseUploadedCanvasBacking(() => true)).toBe(0);
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(48);
    expect(releasePrebakedCanvasBacking).not.toHaveBeenCalled();
  });
});
