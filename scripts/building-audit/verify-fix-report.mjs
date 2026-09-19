import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const out = "operator-results/building-audit-20260919/fix";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const base = "http://127.0.0.1:5173/dubai-missile-command/";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(base + "docs/gameplay%20analysis%20Sep%202026/building-impact-fix.html");
  assert.equal(response.status(), 200);
  assert.equal(await page.title(), "Bomb targeting fix — verification");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/report-${width}.png`, fullPage: true });
  }
  for (const href of await page.locator("a").evaluateAll((as) => as.map((a) => a.href))) {
    assert.equal((await page.request.get(href)).status(), 200);
  }
  const version = await page.request.get(base + "src/replay-version.ts");
  assert.equal(version.status(), 200);
  assert.match(await version.text(), /CURRENT_REPLAY_VERSION = 12/);
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "/browser-verification.json",
    JSON.stringify({ http: 200, desktop: true, mobile: true, currentReplayVersion: 12, links: true, errors }, null, 2),
  );
  console.log("Fix report and links verified at desktop/390px; running Vite serves replay v12.");
} finally {
  await browser.close();
}
