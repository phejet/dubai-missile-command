import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Browser check of the Part Six report. Needs local Vite on port 5173.
const out = "operator-results/scoring-study-20260915/player-only/";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const d = JSON.parse(readFileSync(out + "analysis.json", "utf8"));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  const response = await page.goto(
    "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-player-only-results.html",
  );
  assert.equal(response.status(), 200);
  let settings = 0;
  for (const own of ["P", "today"])
    for (const c of d.combos) {
      await page.locator("#own").selectOption(own);
      await page.locator("#combo").selectOption(c.id);
      const id = `${own}|${c.id}`;
      assert.equal(await page.locator("#runs tr").count(), 26);
      const total = d.summaries.find((s) => s.id === id).total;
      assert((await page.locator("#selection").textContent()).includes(fmt(total)), id);
      const worst = [...d.runs].sort(
        (a, b) => (a.scores[id] - a.original) / a.original - (b.scores[id] - b.original) / b.original,
      )[0];
      assert.equal(await page.locator("#runs tr").first().locator("td").first().textContent(), worst.label);
      settings++;
    }
  for (const id of ["waveChart", "comboChart", "shareChart"]) {
    const chart = page.locator("#" + id + " svg rect");
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    assert(await page.locator("#" + id + " .tip").isVisible(), id + " tooltip");
    assert((await page.locator("#" + id + " .tip").textContent()).includes("Wave"));
  }
  assert.equal(await page.locator("#waveChart circle").count(), 20);
  // Survival section: tables complete, wave-10 gap left open, per-bar tooltip.
  assert.equal(await page.locator("#survivalRuns tr").count(), 26);
  assert.equal(await page.locator("#survivalWaves tr").count(), d.byWave.length);
  assert.equal(
    await page.locator("#shareChart circle").count(),
    2 * d.byWave.filter((w) => w.survival.completed).length,
  );
  const lossBar = page.locator("#lossChart svg rect[tabindex]").nth(4);
  await lossBar.scrollIntoViewIfNeeded();
  await lossBar.hover();
  assert((await page.locator("#lossChart .tip").textContent()).includes("Wave 5"));
  const firstRun = [...d.runs].sort((a, b) => b.finalWave - a.finalWave || a.label.localeCompare(b.label))[0];
  assert.equal(
    await page.locator("#survivalRuns tr").first().locator("td").nth(3).textContent(),
    String(firstRun.buildingsAtEnd),
  );
  assert(!(await page.locator("body").textContent()).match(/NaN|undefined|Infinity/));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out + "report-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone overflow");
  await page.screenshot({ path: out + "report-phone.png", fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "browser-verification.json",
    JSON.stringify(
      { http: 200, scenarioSettings: settings, tooltips: 4, phoneWidth: 390, pageErrors: errors },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Verified ${settings} scenario settings, chart tooltips, desktop/390px layout and no page errors.`);
} finally {
  await browser.close();
}
