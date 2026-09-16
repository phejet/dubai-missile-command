import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
const out = "operator-results/scoring-study-20260915/attribution/";
process.env.TMPDIR = new URL("../../" + out + "browser-temp/", import.meta.url).pathname;
mkdirSync(process.env.TMPDIR, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(
    "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-attribution-results.html",
  );
  assert.equal(response.status(), 200);
  assert.match(await page.title(), /Where the points come from/);
  assert.equal(await page.locator("#run option").count(), 27);
  await page.screenshot({ path: out + "report-desktop.png", fullPage: true });
  const initial = await page.locator("#totals").textContent();
  for (let n = 1; n <= 26; n++) {
    await page.locator("#run").selectOption("run-" + String(n).padStart(3, "0"));
    assert.notEqual(await page.locator("#totals").textContent(), initial);
    assert((await page.locator(".wave-row").count()) >= 2);
  }
  await page.locator("#run").selectOption("all");
  const before = await page.locator("#waves").innerHTML();
  await page.locator("#normalize").check();
  assert.notEqual(await page.locator("#waves").innerHTML(), before);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone overflow");
  await page.screenshot({ path: out + "report-phone.png", fullPage: true });
  await page.locator("summary").click();
  assert(await page.locator("details").evaluate((e) => e.open));
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "report-verification.json",
    JSON.stringify(
      {
        http: 200,
        options: 27,
        recordingsExercised: 26,
        normalizationChangesBars: true,
        phoneWidth: 390,
        noPageOverflow: true,
        detailsOpened: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Report verified: 26 selectors, normalization, 390px layout, details, no page errors.");
} finally {
  await browser.close();
}
