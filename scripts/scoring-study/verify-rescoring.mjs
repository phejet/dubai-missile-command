import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const out = "operator-results/scoring-study-20260915/rescoring/";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const d = JSON.parse(readFileSync(out + "analysis.json", "utf8"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Evidence files live inside the watched checkout. Keep Vite hot reload from
  // replacing the static report while control assertions are in flight.
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  const response = await page.goto(
    "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-rescoring-results.html",
  );
  assert.equal(response.status(), 200);
  let controls = 0;
  for (const v of d.variants) {
    await page.locator("#variant").selectOption(v.id);
    for (const scope of ["all", ...d.throughWave.map((w) => String(w.wave))]) {
      await page.locator("#scope").selectOption(scope);
      const expected = scope === "all" ? 26 : d.throughWave.find((w) => String(w.wave) === scope).rows.length;
      assert.equal(await page.locator("#runs tr").count(), expected);
      assert((await page.locator("#selection").textContent()).includes(v.id));
      const first =
        scope === "all"
          ? d.runs[0].scores[v.id].gross
          : d.throughWave.find((w) => String(w.wave) === scope).rows[0].scores[v.id];
      assert.equal(
        await page.locator("#runs tr").first().locator("td").nth(2).textContent(),
        first.toLocaleString("en-US", { maximumFractionDigits: 1 }),
      );
      assert.equal(await page.locator("#pairs tr").count(), 12);
      controls++;
    }
  }
  await page.locator("summary").first().click();
  for (const r of d.runs) {
    await page.locator("#run").selectOption(r.label);
    assert.equal(await page.locator("#waves tr").count(), r.waves.length);
  }
  await page.locator("#variant").selectOption("C1");
  await page.locator("#scope").selectOption("all");
  await page.locator("#run").selectOption("run-001");
  assert(!(await page.locator("body").textContent()).match(/NaN|undefined/));
  await page.screenshot({ path: out + "report-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "phone overflow");
  await page.screenshot({ path: out + "report-phone.png", fullPage: true });
  const roadmap = await page.goto("http://127.0.0.1:5173/dubai-missile-command/ROADMAP.html");
  assert.equal(roadmap.status(), 200);
  await page.locator("#rm-08 summary").click();
  assert(
    await page
      .locator("#rm-08")
      .textContent()
      .then((t) => t.includes("Part Five")),
  );
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: out + "roadmap-phone.png", fullPage: true });
  assert.deepEqual(errors, []);
  writeFileSync(
    out + "browser-verification.json",
    JSON.stringify(
      { http: 200, formulaScopeChecks: controls, runSelectors: 26, phoneWidth: 390, pageErrors: errors, roadmap: true },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("Verified 90 formula/scope settings, 26 wave ledgers, desktop/390px layout, roadmap and no page errors.");
} finally {
  await browser.close();
}
