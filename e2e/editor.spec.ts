import { expect, test } from "@playwright/test";

test.describe("Graphics editor", () => {
  test("boots the effects preview with the Pixi renderer", async ({ page }) => {
    await page.goto("/dubai-missile-command/editor.html");

    const canvas = page.locator("canvas.editor-canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(async () =>
        canvas.evaluate((node) => {
          const canvasNode = node as HTMLCanvasElement;
          return {
            editorPreview: canvasNode.dataset.editorPreview ?? null,
            pixiGameplayStatic: canvasNode.dataset.pixiGameplayStatic ?? null,
            pixiScreen: canvasNode.dataset.pixiScreen ?? null,
            pixiTitle: canvasNode.dataset.pixiTitle ?? null,
            renderer: canvasNode.dataset.renderer ?? null,
          };
        }),
      )
      .toEqual({
        editorPreview: "ready",
        pixiGameplayStatic: "ready",
        pixiScreen: "playing",
        pixiTitle: "ready",
        renderer: "pixi",
      });

    const sampledPixels = await canvas.evaluate((node) => {
      const source = node as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext("2d");
      if (!context) return [];
      context.drawImage(source, 0, 0);
      return [
        [350, 350],
        [700, 550],
        [460, 1530],
      ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    });

    expect(sampledPixels.some(([r, g, b, a]) => a > 0 && r + g + b > 80)).toBe(true);
  });
});
