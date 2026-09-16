import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const out = "operator-results/scoring-study-20260915/quality/";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const browser = await chromium.launch();
const base = "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/";
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const name of ["gameplay-design-report", "scoring-attribution-results", "scoring-quality-results"]) {
    const res = await page.goto(base + name + ".html");
    assert.equal(res.status(), 200);
    assert((await page.title()).length > 10);
    if (name !== "gameplay-design-report") {
      assert.equal(await page.locator("#run option").count(), 27);
      await page.locator("#run").selectOption("run-026");
      await page.locator("#run").selectOption("all");
    }
    await page.screenshot({ path: out + name + "-final-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + " overflow");
    await page.screenshot({ path: out + name + "-final-phone.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
  await page.goto(base + "scoring-quality-review.html");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true" && window.qualityReview);
  await page.locator("#clip").selectOption("clip-05");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert((await page.locator("#battlefield").getAttribute("data-pixi-screen")) === "playing");
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "relocated-reports-verification.json",
    JSON.stringify(
      { reports: 3, http: 200, selectors: true, phoneOverflow: false, relocatedClipModule: true, pageErrors: errors },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("All three relocated reports and local clip player passed browser checks.");
} finally {
  await browser.close();
}
