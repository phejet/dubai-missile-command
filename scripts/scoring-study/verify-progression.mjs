import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const out = "operator-results/scoring-study-20260915/progression/";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const data = JSON.parse(readFileSync(out + "analysis.json", "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(
    "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-progression-results.html",
  );
  assert.equal(response.status(), 200);
  assert.equal(await page.locator("#progressionPlot circle").count(), 26);
  assert.equal(await page.locator("#matchedPlot circle").count(), 41);
  let checks = 0;
  for (const tier of data.tiers)
    for (const association of tier.associations) {
      await page.locator("#tier").selectOption(String(tier.tier - 1));
      await page.locator("#outcome").selectOption(association.outcome);
      await page.locator("#reward").selectOption(association.reward);
      const expected = association.r === null ? "not estimable" : association.r.toFixed(3);
      assert((await page.locator("#association").textContent()).includes("r = " + expected));
      assert.equal(await page.locator("#matchedPlot circle").count(), association.rows);
      checks++;
    }
  for (const w of data.throughWave) {
    await page.locator("#through").selectOption(String(w.wave));
    assert.equal(await page.locator("#throughPlot circle").count(), w.runs);
  }
  await page.locator("#tier").selectOption("3");
  await page.locator("#outcome").selectOption("burjLoss");
  await page.locator("#reward").selectOption("score");
  await page.locator("#through").selectOption("4");
  assert(!(await page.locator("body").textContent()).includes("NaN"));
  await page.screenshot({ path: out + "report-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone page overflow");
  await page.screenshot({ path: out + "report-phone.png", fullPage: true });
  await page.locator("summary").first().click();
  assert(
    await page
      .locator("details")
      .first()
      .evaluate((e) => e.open),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "browser-verification.json",
    JSON.stringify(
      {
        http: 200,
        associationControlsChecked: checks,
        cumulativeWaveControls: 9,
        desktop: true,
        phoneWidth: 390,
        noPageOverflow: true,
        details: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Report verified: all 40 association settings, 9 cumulative waves, desktop/390px layout and no page errors.",
  );
} finally {
  await browser.close();
}
