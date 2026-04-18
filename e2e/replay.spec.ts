import { test, expect, type Page } from "@playwright/test";
import type { ReplayData } from "../src/types";

declare global {
  interface Window {
    __gameRef?: import("react").MutableRefObject<import("../src/types").GameState | null>;
    __loadReplay?: (replayData: ReplayData) => void;
    __createReplayRunner?: typeof import("../src/replay.js").createReplayRunner;
    __openShopPreview?: () => boolean;
  }
}

async function startGameFromScreen(page: Page) {
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

// Short replay fixture — a few fire actions, enough to exercise the replay runner.
// No hardcoded expected scores; tests compare two runs of the same replay.
const SHORT_REPLAY: ReplayData = {
  seed: 12345,
  actions: [
    { tick: 10, type: "fire" as const, x: 450, y: 200 },
    { tick: 30, type: "fire" as const, x: 300, y: 180 },
    { tick: 50, type: "fire" as const, x: 600, y: 220 },
    { tick: 80, type: "fire" as const, x: 200, y: 160 },
    { tick: 120, type: "fire" as const, x: 700, y: 190 },
  ],
};

/** Run a replay headlessly in-page (tight loop, no rendering) and return results */
async function runReplayHeadless(page: Page, replayData: ReplayData) {
  await page.waitForFunction(() => window.__createReplayRunner != null, { timeout: 5000 });
  return page.evaluate((data: ReplayData) => {
    const rr = window.__createReplayRunner!(data);
    const g = rr.init();
    const MAX_TICKS = 100000;
    for (let i = 0; i < MAX_TICKS; i++) {
      if (rr.isFinished()) break;
      if (rr.isShopPaused()) rr.resumeFromShop();
      rr.step();
    }
    const result = {
      score: g.score,
      wave: g.wave,
      missileKills: g.stats.missileKills,
      droneKills: g.stats.droneKills,
      shotsFired: g.stats.shotsFired,
    };
    rr.cleanup();
    return result;
  }, replayData);
}

test.describe("Replay", () => {
  test("loading a replay via __loadReplay enters replay mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__loadReplay != null, { timeout: 5000 });

    await page.evaluate((data: ReplayData) => window.__loadReplay!(data), SHORT_REPLAY);
    await page.waitForFunction(() => {
      const g = window.__gameRef?.current;
      return g?._replay === true && g.state === "playing";
    });

    const state = await page.evaluate(() => {
      const g = window.__gameRef?.current;
      return { replay: g?._replay, state: g?.state };
    });

    expect(state.replay).toBe(true);
    expect(state.state).toBe("playing");
  });

  test("same replay produces identical results on two runs", async ({ page }) => {
    await page.goto("/");
    const result1 = await runReplayHeadless(page, SHORT_REPLAY);
    const result2 = await runReplayHeadless(page, SHORT_REPLAY);

    expect(result1.score).toBe(result2.score);
    expect(result1.wave).toBe(result2.wave);
    expect(result1.missileKills).toBe(result2.missileKills);
    expect(result1.droneKills).toBe(result2.droneKills);
    expect(result1.shotsFired).toBe(result2.shotsFired);
  });

  test("replay tick does not advance during shop phase", async ({ page }) => {
    await page.goto("/");

    // Start the game
    await startGameFromScreen(page);
    await page.waitForFunction(() => {
      const g = window.__gameRef?.current;
      return g && g.state === "playing";
    });

    // Force shop state
    const tickBefore = await page.evaluate(() => {
      const g = window.__gameRef!.current!;
      g.state = "shop";
      return g._replayTick;
    });

    // Wait a bit - tick should NOT advance
    await page.waitForTimeout(500);

    const tickDuring = await page.evaluate(() => window.__gameRef!.current!._replayTick);
    expect(tickDuring).toBe(tickBefore);
  });
});
