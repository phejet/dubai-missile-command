import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import type { ProblemReport, SessionUpload } from "../src/capture";
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
  expect(result).toMatchObject({ ok: true, id: expect.any(String), file: expect.any(String) });
  return result as Extract<UploadCaptureResult, { ok: true }>;
}

type CaptureArtifact = SessionUpload | ProblemReport;

function readPrettyCapture(file: string): CaptureArtifact {
  return JSON.parse(readFileSync(join(process.cwd(), "captures", file), "utf8")) as CaptureArtifact;
}

function expectReplayHash(envelope: CaptureArtifact): void {
  expect(envelope.replay).not.toBeNull();
  expect(createHash("sha256").update(JSON.stringify(envelope.replay)).digest("hex")).toBe(envelope.meta.replaySha256);
  if (envelope.kind === "report") {
    expect(envelope.events.some((event) => event.channel === "replay-archive")).toBe(false);
  }
}

/**
 * A real browser mints and persists this, and the middleware rejects a capture
 * whose `x-dmc-install` header disagrees with the body — so a written file is
 * proof that both sides carried the same id.
 */
function expectPersistedInstallId(envelope: CaptureArtifact): void {
  expect(envelope.meta.installId).toMatch(/^[a-z0-9-]{8,64}$/);
  expect(envelope.meta.installId!.startsWith("eph-")).toBe(false);
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
  expectPersistedInstallId(envelope);
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
  expectPersistedInstallId(envelope);
});

test("the install id survives a reload and is not a per-boot identity", async ({ page }) => {
  await page.goto(APP_PATH);
  await startGame(page);
  const first = readPrettyCapture((await capture(page, "manual")).file!);
  expectPersistedInstallId(first);

  await page.reload();
  await startGame(page);
  const second = readPrettyCapture((await capture(page, "manual")).file!);
  expectPersistedInstallId(second);

  expect(second.meta.installId).toBe(first.meta.installId);
  // The distinction step 5 depends on: one install, several boots, several runs.
  expect(second.meta.bootId).not.toBe(first.meta.bootId);
  expect(second.meta.runId).not.toBe(first.meta.runId);
});
