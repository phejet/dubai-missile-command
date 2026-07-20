import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __pixiApp?: {
      renderer: {
        context: { extensions: { loseContext?: WEBGL_lose_context } };
        name: string;
        texture: { managedTextures: Array<{ resource: unknown } | null> };
      };
    };
  }
}

test.use({
  launchOptions: {
    ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
    args: ["--enable-unsafe-swiftshader"],
  },
});

test("releases uploaded canvas backing and rebuilds it after WebGL context loss", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toHaveAttribute("data-pixi-title", "ready");
  expect(await page.evaluate(() => window.__pixiApp?.renderer.name)).toBe("webgl");

  const uploadedCanvasBacking = async () =>
    page.evaluate(() => {
      const sources = window.__pixiApp?.renderer.texture.managedTextures ?? [];
      const canvases = sources
        .filter((source): source is { resource: unknown } => source !== null)
        .map((source) => source.resource)
        .filter(
          (resource): resource is HTMLCanvasElement =>
            resource instanceof HTMLCanvasElement && resource.id !== "game-canvas",
        );
      return {
        count: canvases.length,
        logicalBytes: canvases.reduce((bytes, source) => bytes + source.width * source.height * 4, 0),
      };
    });

  await expect.poll(uploadedCanvasBacking).toMatchObject({ count: expect.any(Number), logicalBytes: 0 });
  expect((await uploadedCanvasBacking()).count).toBeGreaterThan(0);
  const generationBefore = Number(await canvas.getAttribute("data-pixi-gameplay-generation"));
  expect(await page.evaluate(() => !!window.__pixiApp?.renderer.context.extensions.loseContext)).toBe(true);

  await page.evaluate(() => window.__pixiApp!.renderer.context.extensions.loseContext!.loseContext());
  await expect(canvas).toHaveAttribute("data-pixi-context", "lost");
  await page.evaluate(() => window.__pixiApp!.renderer.context.extensions.loseContext!.restoreContext());
  await expect(canvas).toHaveAttribute("data-pixi-context", "active");
  await expect(canvas).toHaveAttribute("data-pixi-title", "ready");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-pixi-gameplay-generation")))
    .toBeGreaterThan(generationBefore);
  await expect.poll(uploadedCanvasBacking).toMatchObject({ count: expect.any(Number), logicalBytes: 0 });
  expect((await uploadedCanvasBacking()).count).toBeGreaterThan(0);
  expect((await canvas.screenshot()).byteLength).toBeGreaterThan(10_000);
  expect(pageErrors).toEqual([]);
});
