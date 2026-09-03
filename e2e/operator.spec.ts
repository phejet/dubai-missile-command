import { expect, test } from "@playwright/test";
import { replayFixture } from "../test-fixtures/capture";

const APP_PATH = "/dubai-missile-command/";
const WORKER = "https://dmc-captures-staging.phejet.workers.dev";

test("operator browses an uploaded run and launches its replay", async ({ page }) => {
  test.setTimeout(90_000);
  const replay = replayFixture();
  delete replay._env;
  await page.route(`${WORKER}/**`, async (route) => {
    const request = route.request();
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
    if (new URL(request.url()).pathname === "/api/operator/sessions") {
      await route.fulfill({
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
        body: JSON.stringify({
          ok: true,
          sessions: [
            {
              runId: "operator-run",
              receivedAt: Date.now(),
              build: "build+dirty",
              score: 12345,
              wave: 7,
              outcome: "burj_destroyed",
              replayStatus: "available",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ ok: true, replay }),
    });
  });

  await page.goto(`${APP_PATH}operator.html`);
  await page.getByLabel("Operator bearer token").fill("operator-secret");
  await page.getByRole("button", { name: "Load runs" }).click();
  await expect(page.getByRole("cell", { name: "12,345" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "available" })).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Play replay for operator-run" }).click();
  const replayPage = await popupPromise;
  const replayLogs: string[] = [];
  replayPage.on("console", (message) => replayLogs.push(`${message.type()}: ${message.text()}`));
  replayPage.on("pageerror", (error) => replayLogs.push(`pageerror: ${error.message}`));
  try {
    await replayPage.waitForFunction(
      () => window.__gameRef?.current?._replay === true && (window.__gameRef.current._replayTick ?? 0) > 2,
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    const state = await replayPage.evaluate(() => ({
      href: window.location.href,
      game: window.__gameRef?.current
        ? {
            replay: window.__gameRef.current._replay,
            tick: window.__gameRef.current._replayTick,
            state: window.__gameRef.current.state,
          }
        : null,
      body: document.body.innerText.slice(0, 500),
    }));
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ state, replayLogs })}`,
    );
  }
  await expect(page.getByRole("status")).toContainText("Replay launched");
});
