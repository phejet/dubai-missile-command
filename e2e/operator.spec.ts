import { expect, test } from "@playwright/test";
import { runGame } from "../src/headless/sim-runner";
import { createReplayRunner } from "../src/replay";
import { buildRunRecapData } from "../src/run-recap";
import type { ReplayData } from "../src/types";
import type { OperatorSessionDetail } from "../src/operator-contract";

const APP_PATH = "/dubai-missile-command/";
const WORKER = "https://dmc-captures-staging.phejet.workers.dev";
function fixture() {
  const result = runGame(null, {
    seed: 1481412993,
    record: true,
    draftMode: true,
    isHuman: true,
    stopCondition: { type: "waveComplete", wave: 3 },
    checkpoints: true,
  });
  const replay: ReplayData = {
    version: result.version!,
    seed: result.seed,
    actions: result.actions!,
    initialState: result.initialState!,
    draftMode: true,
    isHuman: true,
    stopCondition: { type: "waveComplete", wave: 3 },
    checkpoints: result.checkpoints,
  };
  const runner = createReplayRunner(replay);
  runner.init();
  while (!runner.isFinished()) {
    if (runner.isBonusPaused()) {
      runner.getState()!._bonusScreenDone = true;
      runner.resumeFromBonusScreen();
    }
    if (runner.isShopPaused()) runner.resumeFromShop();
    runner.step();
  }
  replay.finalTick = runner.getTick();
  const recap = buildRunRecapData(runner.getState()!, replay);
  runner.cleanup();
  const detail: OperatorSessionDetail = {
    runId: "older-run",
    build: "build+dirty",
    receivedAt: 1000,
    createdAt: 1000,
    score: recap.score,
    wave: recap.wave,
    outcome: recap.outcome,
    feedbackEmoji: "👍",
    replayStatus: "available",
    appFlavor: "staging",
    appleEnvironment: "production",
    platform: "web",
    inputClass: "mouse",
    source: "gameover",
    deathCause: null,
    timePlayedMs: recap.timePlayedMs,
    burjHealth: recap.burjHealth,
    shotsFired: recap.totalStats.shotsFired,
    totalKills: recap.totalStats.missileKills + recap.totalStats.droneKills,
    hitRatio: recap.hitRatio,
    multiShots: recap.totalStats.multiShots,
    maxCombo: recap.totalStats.maxCombo,
    destroyedByType: recap.totalStats.destroyedByType,
    upgrades: recap.upgrades,
    replayCompleteClaimed: true,
    canRequestReplay: true,
  };
  return { replay, detail, recap };
}

test("operator finds, inspects, and launches wave and exact-tick evidence", async ({ page }, testInfo) => {
  const { replay, detail, recap } = fixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests: string[] = [];
  await page.route(`${WORKER}/**`, async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    requests.push(target.pathname + target.search);
    const cors = {
      "access-control-allow-origin": "http://127.0.0.1:4173",
      "access-control-allow-headers": "Authorization",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    expect(request.headers().authorization).toBe("Bearer operator-secret");
    let payload: unknown;
    if (target.pathname === "/api/operator/sessions") {
      const next = target.searchParams.has("cursor");
      payload = {
        ok: true,
        sessions: [
          { ...detail, runId: next ? "unavailable-run" : "page-one-run", replayStatus: next ? "omitted" : "available" },
        ],
        nextCursor: next
          ? null
          : Buffer.from(JSON.stringify({ receivedAt: 1000, runId: "page-one-run" })).toString("base64"),
      };
    } else if (target.pathname.endsWith("/replay"))
      payload = {
        ok: true,
        replay: target.pathname.includes("incompatible") ? { ...replay, version: 1 } : replay,
        replayStatus: "available",
      };
    else {
      const runId = target.pathname.split("/").pop()!;
      payload = {
        ok: true,
        session: {
          ...detail,
          runId,
          ...(runId === "unavailable-run" ? { replayStatus: "omitted", canRequestReplay: false } : {}),
        },
      };
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  });
  await page.goto(`${APP_PATH}operator.html#environment=staging&run=older-run`);
  expect(requests).toHaveLength(0);
  await page.getByLabel("Operator bearer token").fill("operator-secret");
  await page.getByRole("button", { name: "Load runs", exact: true }).click();
  const inspector = page.getByRole("region", { name: "Run inspector" });
  await expect(inspector).toContainText("older-run");
  expect(requests.some((path) => path === "/api/operator/sessions/older-run")).toBe(true);
  await page.getByRole("button", { name: "Inspect replay", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Local consistency check: matches summary" })).toBeVisible();
  await expect(inspector).toContainText("Stored upgrades");
  await page.screenshot({ path: testInfo.outputPath("operator-desktop.png"), fullPage: true });
  const waveTwo = recap.waveCards.find((wave) => wave.wave === 2)!;
  const wavePopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Play wave 2", exact: true }).click();
  const wavePopup = await wavePopupPromise;
  wavePopup.on("pageerror", (error) => errors.push(error.message));
  await wavePopup.waitForFunction(() => window.__gameRef?.current?._replay && window.__gameRef.current.wave === 2);
  await wavePopup.close();
  const tick = waveTwo.startTick + 10;
  await page.getByLabel("Exact tick").fill(String(tick));
  const tickPopupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Play from here", exact: true }).click();
  const tickPopup = await tickPopupPromise;
  tickPopup.on("pageerror", (error) => errors.push(error.message));
  await tickPopup.waitForFunction(
    (target) => window.__gameRef?.current?._replay && window.__gameRef.current._replayTick === target,
    tick,
  );
  await expect(tickPopup.locator("#replay-play-pause")).toHaveAttribute("aria-label", "Play replay");
  await tickPopup.close();
  await page.getByLabel("Build", { exact: true }).fill("build+dirty");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("button", { name: "Load more" }).click();
  await page.getByRole("button", { name: "Inspect run unavailable-run" }).click();
  await expect(page.getByRole("button", { name: "Inspect replay", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Build", { exact: true })).toHaveValue("build+dirty");
  expect(requests.some((path) => path.includes("build=build%2Bdirty") && path.includes("cursor="))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Back to results" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("operator-mobile.png"), fullPage: true });
  await page.goto(`${APP_PATH}operator.html#environment=staging&run=incompatible-run`);
  await page.getByLabel("Operator bearer token").fill("operator-secret");
  await page.getByRole("button", { name: "Load runs", exact: true }).click();
  await page.getByRole("button", { name: "Inspect replay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("incompatible");
  expect(errors).toEqual([]);
});
