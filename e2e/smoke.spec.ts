import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __gameRef?: import("react").MutableRefObject<import("../src/types").GameState | null>;
    __loadReplay?: (replayData: import("../src/types").ReplayData) => void;
    __createReplayRunner?: typeof import("../src/replay.js").createReplayRunner;
    __openShopPreview?: () => boolean;
  }
}

async function clickCanvasAt(page: import("@playwright/test").Page, xRatio = 0.5, yRatio = 0.5) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await canvas.click({
    position: {
      x: Math.max(1, Math.min(box!.width - 1, box!.width * xRatio)),
      y: Math.max(1, Math.min(box!.height - 1, box!.height * yRatio)),
    },
  });
}

async function startGameFromScreen(page: import("@playwright/test").Page) {
  const shell = page.locator('[data-ui-mode="phonePortrait"]');
  const box = await shell.boundingBox();
  expect(box).toBeTruthy();
  await shell.click({
    position: {
      x: Math.max(1, Math.min(box!.width - 1, box!.width * 0.5)),
      y: Math.max(1, Math.min(box!.height - 1, box!.height * 0.5)),
    },
  });
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
    await startGameFromScreen(page);

    // Game should initialize and expose __gameRef
    const hasGameRef = await page.evaluate(() => {
      return window.__gameRef && window.__gameRef!.current! !== null;
    });
    expect(hasGameRef).toBe(true);
  });

  test("game state has expected shape after start", async ({ page }) => {
    await startGameFromScreen(page);

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
    // Start game
    await startGameFromScreen(page);

    // Click above ground to fire interceptor
    await clickCanvasAt(page, 0.5, 0.3);

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
    await startGameFromScreen(page);

    await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      g.state = "shop";
    });

    await clickCanvasAt(page, 0.5, 0.3);

    const stats = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      return { shotsFired: g.stats.shotsFired, interceptors: g.interceptors.length };
    });

    expect(stats.shotsFired).toBe(0);
    expect(stats.interceptors).toBe(0);
  });

  test("replay tick does not advance while sim is in shop state", async ({ page }) => {
    await startGameFromScreen(page);

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
    await startGameFromScreen(page);

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

  test("shows portrait title screen inside the phone shell", async ({ page }) => {
    await expect(page.locator('[data-ui-mode="phonePortrait"]')).toBeVisible();
    await expect(page.locator('[data-screen="title"]')).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
  });

  test("renders a readable portrait HUD and fitted battlefield during play", async ({ page }) => {
    await startGameFromScreen(page);
    await expect(page.locator('[data-screen="playing"]')).toBeVisible();
    await expect(page.getByTestId("portrait-hud")).toBeVisible();

    const canvasBox = await page.locator("canvas").boundingBox();
    expect(canvasBox).toBeTruthy();
    expect(canvasBox!.width).toBeLessThanOrEqual(390);
  });

  test("opens the responsive portrait shop modal", async ({ page }) => {
    await startGameFromScreen(page);
    await page.evaluate(() => window.__openShopPreview!());
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await expect(page.locator('[data-shop-mode="phonePortrait"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /confirm.*deploy/i })).toBeVisible();
  });
});
