import { expect, test } from "@playwright/test";

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

    const sampledPixels = await page.evaluate(() => {
      const fallback = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas-fallback");
      const source = document.querySelector<HTMLCanvasElement>("canvas.editor-canvas:not(.editor-canvas-fallback)");
      const sourceCanvas = fallback && getComputedStyle(fallback).display !== "none" ? fallback : source;
      if (!sourceCanvas) return [];
      const copy = document.createElement("canvas");
      copy.width = sourceCanvas.width;
      copy.height = sourceCanvas.height;
      const context = copy.getContext("2d");
      if (!context) return [];
      context.drawImage(sourceCanvas, 0, 0);
      return [
        [350, 350],
        [700, 550],
        [460, 1530],
      ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    });

    expect(sampledPixels.some(([r, g, b, a]) => a > 0 && r + g + b > 80)).toBe(true);
  });
});
