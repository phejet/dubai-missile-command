import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __gameRef?: import("react").MutableRefObject<import("../src/types").GameState | null>;
    __loadReplay?: (replayData: import("../src/types").ReplayData) => void;
    __createReplayRunner?: typeof import("../src/replay.js").createReplayRunner;
    __openShopPreview?: () => boolean;
  }
}

test.describe("Smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads with canvas", async ({ page }) => {
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
  });

  test("clicking canvas starts the game", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 450, y: 320 } });

    // Game should initialize and expose __gameRef
    const hasGameRef = await page.evaluate(() => {
      return window.__gameRef && window.__gameRef!.current! !== null;
    });
    expect(hasGameRef).toBe(true);
  });

  test("game state has expected shape after start", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 450, y: 320 } });

    const state = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return {
        score: g.score,
        wave: g.wave,
        burjAlive: g.burjAlive,
        launcherCount: g.launcherHP.length,
        hasAmmo: g.ammo.every((a) => a > 0),
        hasMissileArray: Array.isArray(g.missiles),
        hasDroneArray: Array.isArray(g.drones),
      };
    });

    expect(state.score).toBe(0);
    expect(state.wave).toBe(1);
    expect(state.burjAlive).toBe(true);
    expect(state.launcherCount).toBe(3);
    expect(state.hasAmmo).toBe(true);
    expect(state.hasMissileArray).toBe(true);
    expect(state.hasDroneArray).toBe(true);
  });

  test("clicking during gameplay fires an interceptor", async ({ page }) => {
    const canvas = page.locator("canvas");
    // Start game
    await canvas.click({ position: { x: 450, y: 320 } });

    // Click above ground to fire interceptor
    await canvas.click({ position: { x: 450, y: 200 } });

    // Wait briefly for the interceptor to be created
    await page.waitForFunction(
      () => {
        const g = window.__gameRef!.current!;
        return g.interceptors.length > 0 || g.stats.shotsFired > 0;
      },
      { timeout: 3000 },
    );

    const stats = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return { shotsFired: g.stats.shotsFired };
    });
    expect(stats.shotsFired).toBeGreaterThanOrEqual(1);
  });

  test("clicking canvas does not fire while sim is in shop state", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 450, y: 320 } });

    await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      g.state = "shop";
    });

    await canvas.click({ position: { x: 450, y: 200 } });

    const stats = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return { shotsFired: g.stats.shotsFired, interceptors: g.interceptors.length };
    });

    expect(stats.shotsFired).toBe(0);
    expect(stats.interceptors).toBe(0);
  });

  test("replay tick does not advance while sim is in shop state", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 450, y: 320 } });

    const tickBefore = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      g.state = "shop";
      return g._replayTick;
    });

    await page.waitForTimeout(250);

    const tickAfter = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return g._replayTick;
    });

    expect(tickAfter).toBe(tickBefore);
  });

  test("game spawns threats after a few seconds", async ({ page }) => {
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 450, y: 320 } });

    // Wait for missiles or drones to spawn
    await page.waitForFunction(
      () => {
        const g = window.__gameRef!.current!;
        return g.missiles.length > 0 || g.drones.length > 0;
      },
      { timeout: 10000 },
    );

    const threats = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return { missiles: g.missiles.length, drones: g.drones.length };
    });
    expect(threats.missiles + threats.drones).toBeGreaterThan(0);
  });
});

test.describe("Portrait iPhone layout", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows portrait title chrome outside the canvas", async ({ page }) => {
    await expect(page.locator('[data-ui-mode="phonePortrait"]')).toBeVisible();
    await expect(page.getByTestId("portrait-title")).toBeVisible();
    await expect(page.getByRole("button", { name: /start defense/i })).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("renders a readable portrait HUD and fitted battlefield during play", async ({ page }) => {
    await page.getByRole("button", { name: /start defense/i }).click();
    await expect(page.getByTestId("portrait-hud")).toBeVisible();

    const canvasBox = await page.locator("canvas").boundingBox();
    expect(canvasBox).toBeTruthy();
    expect(canvasBox!.width).toBeLessThanOrEqual(390);

    await expect(page.getByRole("button", { name: /mute audio/i })).toBeVisible();
  });

  test("opens the responsive portrait shop modal", async ({ page }) => {
    await page.getByRole("button", { name: /start defense/i }).click();
    await page.evaluate(() => window.__openShopPreview!());
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('[data-shop-mode="phonePortrait"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /deploy wave/i })).toBeVisible();
  });
});
