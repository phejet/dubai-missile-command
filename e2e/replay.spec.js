import { test, expect } from "@playwright/test";

// Short replay fixture — a few fire actions, enough to exercise the replay runner.
// No hardcoded expected scores; tests compare two runs of the same replay.
const SHORT_REPLAY = {
  version: 2,
  seed: 12345,
  actions: [
    { tick: 10, type: "fire", x: 450, y: 200 },
    { tick: 30, type: "fire", x: 300, y: 180 },
    { tick: 50, type: "fire", x: 600, y: 220 },
    { tick: 80, type: "fire", x: 200, y: 160 },
    { tick: 120, type: "fire", x: 700, y: 190 },
  ],
};

/** Load a replay and wait for gameover, returning final score/wave/stats */
async function playReplayToEnd(page, replayData) {
  await page.goto("/");
  await page.waitForFunction(() => window.__loadReplay != null, { timeout: 5000 });

  await page.evaluate((data) => window.__loadReplay(data), replayData);

  // Wait for gameover
  await page.waitForFunction(
    () => {
      const g = window.__gameRef?.current;
      return g && g.state === "gameover";
    },
    { timeout: 60000 },
  );

  return page.evaluate(() => {
    const g = window.__gameRef.current;
    return {
      score: g.score,
      wave: g.wave,
      missileKills: g.stats.missileKills,
      droneKills: g.stats.droneKills,
      shotsFired: g.stats.shotsFired,
    };
  });
}

test.describe("Replay", () => {
  test("loading a replay via __loadReplay enters replay mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__loadReplay != null, { timeout: 5000 });

    await page.evaluate((data) => window.__loadReplay(data), SHORT_REPLAY);

    const state = await page.evaluate(() => {
      const g = window.__gameRef?.current;
      return { replay: g?._replay, state: g?.state };
    });

    expect(state.replay).toBe(true);
    expect(state.state).toBe("playing");
  });

  test("same replay produces identical results on two runs", async ({ page }) => {
    const result1 = await playReplayToEnd(page, SHORT_REPLAY);
    const result2 = await playReplayToEnd(page, SHORT_REPLAY);

    expect(result1.score).toBe(result2.score);
    expect(result1.wave).toBe(result2.wave);
    expect(result1.missileKills).toBe(result2.missileKills);
    expect(result1.droneKills).toBe(result2.droneKills);
    expect(result1.shotsFired).toBe(result2.shotsFired);
  });

  test("replay tick does not advance during shop phase", async ({ page }) => {
    await page.goto("/");
    const canvas = page.locator("canvas");

    // Start the game
    await canvas.click({ position: { x: 450, y: 320 } });
    await page.waitForFunction(() => {
      const g = window.__gameRef?.current;
      return g && g.state === "playing";
    });

    // Force shop state
    const tickBefore = await page.evaluate(() => {
      const g = window.__gameRef.current;
      g.state = "shop";
      return g._replayTick;
    });

    // Wait a bit - tick should NOT advance
    await page.waitForTimeout(500);

    const tickDuring = await page.evaluate(() => window.__gameRef.current._replayTick);
    expect(tickDuring).toBe(tickBefore);
  });
});
