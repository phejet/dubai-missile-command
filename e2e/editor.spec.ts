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
    const burjFireGroup = page.locator(".editor-group").filter({ hasText: "Burj Fire" });
    const burjFireHp = burjFireGroup.getByLabel("Current Burj HP");
    const burjFireHpValue = burjFireGroup.locator(".editor-burj-fire-hp .editor-value");
    const burjDamageValue = page.locator(".editor-burj-damage-value");
    await expect(burjFireGroup.getByText("Current Burj HP")).toBeVisible();
    await expect(burjFireHpValue).toHaveText("7/7");

    await page.locator(".editor-burj-damage input[type='range']").fill("2");
    await expect(burjFireHpValue).toHaveText("5/7");

    await burjFireHp.fill("6");
    await expect(burjFireHpValue).toHaveText("6/7");
    await expect(burjDamageValue).toHaveText("1/7");

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

  test("shows the generated startup sprite atlas beside the live editor preview", async ({ page }) => {
    await page.goto("/dubai-missile-command/editor.html");

    await expect(page.locator("canvas.editor-canvas").first()).toBeVisible();
    await expect(page.locator(".editor-panel")).toBeVisible();

    await page.getByRole("button", { name: "Sprites" }).click();
    const atlas = page.getByTestId("sprite-atlas");
    await expect(atlas).toBeVisible();
    await expect(page.locator("canvas.editor-canvas").first()).toBeVisible();
    await expect(page.locator(".editor-panel")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sprites" })).toHaveClass(/play-btn--active/);

    for (const group of ["Burj", "Threats", "Interceptors", "Upgrades", "Defense", "Effects", "Buildings"]) {
      await expect(atlas.getByRole("tab", { name: new RegExp(group) })).toBeVisible();
    }

    await expect(atlas.locator("[data-sprite-id='burj:gameplay:static']")).toBeVisible();
    const visibleCanvasCount = await atlas.locator(".sprite-card canvas").evaluateAll(
      (canvases) =>
        canvases.filter((canvas) => {
          const c = canvas as HTMLCanvasElement;
          return c.width > 0 && c.height > 0 && c.getBoundingClientRect().width > 0;
        }).length,
    );
    expect(visibleCanvasCount).toBeGreaterThan(0);

    const firstBurjCanvasHasPaint = await atlas
      .locator(".sprite-card canvas")
      .first()
      .evaluate((canvas) => {
        const c = canvas as HTMLCanvasElement;
        const ctx = c.getContext("2d");
        if (!ctx) return false;
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < pixels.length; i += 16) {
          if (pixels[i] > 0) return true;
        }
        return false;
      });
    expect(firstBurjCanvasHasPaint).toBe(true);

    await atlas.getByRole("tab", { name: /Effects/ }).click();
    await expect(atlas).toHaveAttribute("data-sprite-group", "effects");
    await expect(atlas.locator("[data-sprite-id='effect:burj-fire:flame-00']")).toBeVisible();
    await expect(atlas.locator("[data-sprite-id^='effect:burj-fire:flame-']")).toHaveCount(6);
    await expect(atlas.locator("[data-sprite-id^='effect:burj-fire:core-']")).toHaveCount(4);
    await expect(atlas.locator("[data-sprite-id^='effect:burj-fire:ember-']")).toHaveCount(6);
    await expect(atlas.locator("[data-sprite-id='effect:burj-fire:smoke']")).toBeVisible();
    await expect(atlas.locator("[data-sprite-id='effect:burj-smoke:blackSmoke00']")).toBeVisible();
    await expect(atlas.locator("[data-sprite-id^='effect:burj-smoke:blackSmoke']")).toHaveCount(25);
    const smokeCanvasHasPaint = await atlas
      .locator("[data-sprite-id='effect:burj-fire:smoke'] canvas")
      .evaluate((canvas) => {
        const c = canvas as HTMLCanvasElement;
        const ctx = c.getContext("2d");
        if (!ctx) return false;
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < pixels.length; i += 16) {
          if (pixels[i] > 0) return true;
        }
        return false;
      });
    expect(smokeCanvasHasPaint).toBe(true);
    await expect
      .poll(async () =>
        atlas.locator("[data-sprite-id='effect:burj-smoke:blackSmoke00'] canvas").evaluate((canvas) => {
          const c = canvas as HTMLCanvasElement;
          const ctx = c.getContext("2d");
          if (!ctx) return false;
          const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < pixels.length; i += 16) {
            if (pixels[i] > 0) return true;
          }
          return false;
        }),
      )
      .toBe(true);

    await atlas.getByRole("tab", { name: /Threats/ }).click();
    await expect(atlas).toHaveAttribute("data-sprite-group", "threats");
    await expect(atlas.locator("[data-sprite-id*='missile']").first()).toBeVisible();

    await page.getByRole("button", { name: "Upgrade Graph" }).click();
    await expect(page.getByRole("button", { name: "Sprites" })).toHaveCount(0);
    await expect(page.getByTestId("sprite-atlas")).toHaveCount(0);
  });
});
