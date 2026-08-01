import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import type { CaptureEnvelope } from "../src/capture";
import type { UploadCaptureResult } from "../src/capture-sink";
import { validateReplay } from "../src/headless/validate-replay";

const APP_PATH = "/dubai-missile-command/";

async function startGame(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.getByRole("button", { name: /start defense/i }).click();
  try {
    await page.waitForFunction(() => window.__gameRef?.current != null, undefined, { timeout: 5_000 });
  } catch {
    throw new Error(`game did not start; browser errors: ${errors.join(" | ") || "none"}`);
  }
}

async function capture(
  page: Page,
  trigger: "gameover" | "manual",
): Promise<Extract<UploadCaptureResult, { ok: true }>> {
  const result = await page.evaluate(async (captureTrigger) => window.__captureNow!(captureTrigger), trigger);
  expect(result).toMatchObject({ ok: true, captureId: expect.any(String), file: expect.any(String) });
  return result as Extract<UploadCaptureResult, { ok: true }>;
}

function readPrettyCapture(file: string): CaptureEnvelope {
  return JSON.parse(readFileSync(join(process.cwd(), "captures", file), "utf8")) as CaptureEnvelope;
}

function expectReplayHash(envelope: CaptureEnvelope): void {
  expect(envelope.replay).not.toBeNull();
  expect(createHash("sha256").update(JSON.stringify(envelope.replay)).digest("hex")).toBe(envelope.meta.replaySha256);
  expect(envelope.events.some((event) => event.channel === "replay-archive")).toBe(false);
}

test("window capture writes a plain live artifact without WebCrypto or CompressionStream", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "CompressionStream", { configurable: true, value: undefined });
    Object.defineProperty(Crypto.prototype, "subtle", { configurable: true, get: () => undefined });
  });
  await page.goto(APP_PATH);
  await startGame(page);
  await expect.poll(() => page.evaluate(() => typeof crypto.subtle)).toBe("undefined");

  const result = await capture(page, "manual");
  expect(result.encoding).toBe("none");
  const envelope = readPrettyCapture(result.file!);
  expect(envelope.meta).toMatchObject({
    appScreen: "playing",
    replaySource: "live",
    partial: true,
    replayComplete: false,
  });
  const wireFile = result.file!.replace(/\.json$/, ".json.raw");
  expect(JSON.parse(readFileSync(join(process.cwd(), "captures", wireFile), "utf8"))).toEqual(envelope);
  expectReplayHash(envelope);
  expect(validateReplay(envelope.replay!)).toEqual([]);
  await page.evaluate((replay) => window.__loadReplay!(replay), envelope.replay!);
  await page.waitForFunction(
    () => window.__gameRef?.current?._replay === true && window.__gameRef.current._replayTick! > 5,
  );
});

test("window capture writes a gzip gameover artifact from the completed run snapshot", async ({ page }) => {
  await page.goto(APP_PATH);
  await startGame(page);
  await page.evaluate(() => {
    const game = window.__gameRef!.current!;
    game.burjAlive = false;
    game.burjHealth = 0;
  });
  await expect(page.locator("#game-shell")).toHaveAttribute("data-screen", "gameover");

  const result = await capture(page, "gameover");
  expect(result.encoding).toBe("gzip");
  const envelope = readPrettyCapture(result.file!);
  expect(envelope.meta).toMatchObject({
    appScreen: "gameover",
    replaySource: "last-completed",
    partial: false,
    replayComplete: true,
  });
  expect(envelope.summary).not.toBeNull();
  const wireFile = result.file!.replace(/\.json$/, ".json.gz");
  expect(JSON.parse(gunzipSync(readFileSync(join(process.cwd(), "captures", wireFile))).toString("utf8"))).toEqual(
    envelope,
  );
  // The test forces death through state injection to reach the controller's
  // gameover path quickly; that injection is deliberately absent from actions.
  // Replay determinism is covered with recorded actions in replay-snapshot.test.ts.
  expectReplayHash(envelope);
});
