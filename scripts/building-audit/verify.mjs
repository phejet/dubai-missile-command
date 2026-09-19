import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const out = "operator-results/building-audit-20260919";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  const base = "http://127.0.0.1:5173/dubai-missile-command/";
  const response = await page.goto(base + "docs/gameplay%20analysis%20Sep%202026/building-impact-audit-results.html");
  assert.equal(response.status(), 200);
  assert.equal(await page.title(), "City buildings: targeting and impact audit");
  const data = await page.locator("#auditData").textContent();
  assert.equal(JSON.parse(data).bombs, 1238);
  for (const index of [0, 1, 2]) {
    await page.locator("#example").selectOption(String(index));
    assert.equal(await page.locator("#trajectory rect").count(), 10);
    assert((await page.locator("#trajectory polyline").getAttribute("points")).length > 20);
    assert((await page.locator("#exampleText").textContent()).includes("run-"));
  }
  await page.locator("#example").selectOption("0");
  await page.screenshot({ path: out + "/report-desktop.png" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Report overflow");
    for (const d of await page.locator("details").all()) {
      await d.locator("summary").click();
      assert(await d.evaluate((e) => e.open));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: out + "/report-phone.png" });
    }
    for (const d of await page.locator("details").all()) await d.locator("summary").click();
  }
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.locator("#trajectory").screenshot({ path: out + "/trajectory.png" });
  for (const href of await page.locator("a").evaluateAll((as) => as.map((a) => a.href))) {
    assert.equal((await page.request.get(href)).status(), 200, "Report link");
  }
  await page.goto(base + "ROADMAP.html");
  assert(await page.locator("#rm-09").count());
  assert(
    await page
      .locator("#rm-09")
      .evaluate(
        (e) => !!(e.compareDocumentPosition(document.querySelector("#rm-06")) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Roadmap overflow");
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/browser-verification.json",
    JSON.stringify(
      {
        reportHTTP: 200,
        exampleSelectors: 3,
        desktop: true,
        phoneWidth: 390,
        links: true,
        roadmapOrder: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log("Report and roadmap verified at desktop/390px; three trajectory controls, disclosures and links pass.");
} finally {
  await browser.close();
}
