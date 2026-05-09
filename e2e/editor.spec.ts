import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";

function hasVisiblePngPixel(png: Buffer): boolean {
  const signatureBytes = 8;
  let offset = signatureBytes;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    }
    offset += length + 12;
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(height * stride);
  let input = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[input++];
    for (let x = 0; x < stride; x++) {
      const raw = inflated[input++];
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const pa = Math.abs(up - upperLeft);
        const pb = Math.abs(left - upperLeft);
        const pc = Math.abs(left + up - 2 * upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      }
      pixels[y * stride + x] = (raw + predictor) & 255;
    }
  }

  for (let i = 0; i < pixels.length; i += bytesPerPixel) {
    const alpha = colorType === 6 ? pixels[i + 3] : 255;
    if (alpha > 0 && pixels[i] + pixels[i + 1] + pixels[i + 2] > 80) return true;
  }
  return false;
}

test.describe("Graphics editor", () => {
  test("boots the effects preview with a visible game renderer", async ({ page }) => {
    await page.goto("/dubai-missile-command/editor.html");

    await expect(page.locator("canvas.editor-canvas").first()).toBeVisible();
    await page.waitForFunction(() => {
      const source = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas:not(.editor-canvas-fallback)");
      const fallback = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas-fallback");
      const fallbackVisible = !!fallback && getComputedStyle(fallback).display !== "none";
      return (
        source?.dataset.editorPreview === "ready" || (source?.dataset.editorPreview === "fallback" && fallbackVisible)
      );
    });
    await page.waitForTimeout(250);

    const previewState = await page.evaluate(() => {
      const source = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas:not(.editor-canvas-fallback)");
      const fallback = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas-fallback");
      const fallbackVisible = !!fallback && getComputedStyle(fallback).display !== "none";
      const visibleCanvas = fallbackVisible ? fallback : source;
      return {
        editorPreview: source?.dataset.editorPreview ?? null,
        pixiGameplayStatic: source?.dataset.pixiGameplayStatic ?? null,
        pixiScreen: source?.dataset.pixiScreen ?? null,
        pixiTitle: source?.dataset.pixiTitle ?? null,
        renderer: source?.dataset.renderer ?? null,
        visibleRenderer: visibleCanvas?.dataset.renderer ?? null,
      };
    });

    expect(["ready", "fallback"]).toContain(previewState.editorPreview);
    expect(previewState.renderer).toBe("pixi");
    if (previewState.editorPreview === "ready") {
      expect(previewState.pixiGameplayStatic).toBe("ready");
      expect(previewState.pixiScreen).toBe("playing");
      expect(previewState.pixiTitle).toBe("ready");
      expect(previewState.visibleRenderer).toBe("pixi");
    } else {
      expect(previewState.visibleRenderer).toBe("editor-fallback");
    }

    const previewCanvas =
      previewState.editorPreview === "fallback"
        ? page.locator("canvas.editor-canvas-fallback")
        : page.locator("canvas.editor-canvas:not(.editor-canvas-fallback)");
    expect(hasVisiblePngPixel(await previewCanvas.screenshot())).toBe(true);
  });
});
