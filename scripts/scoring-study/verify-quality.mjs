import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const out = "operator-results/scoring-study-20260915/quality/";
process.env.TMPDIR = resolve(out, "browser-temp");
mkdirSync(process.env.TMPDIR, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.error(m.text());
  });
  const response = await page.goto(
    "http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-quality-review.html",
  );
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => window.qualityReview && document.documentElement.dataset.ready === "true");
  assert.equal(await page.locator("#clip option").count(), 10);
  const clips = await page.evaluate(() => window.qualityReview.clips);
  const checkpoints = JSON.parse(readFileSync(out + "clip-checkpoints.json", "utf8"));
  const frames = [0, 120, 135, 160, 210, 360];
  for (const c of clips) {
    for (const offset of frames) {
      await page.evaluate(async ({ id, offset }) => window.qualityReview.load(id, offset), { id: c.id, offset });
      assert.equal(await page.evaluate(() => window.qualityReview.getTick()), c.start + offset);
      assert.equal(
        await page.evaluate(() => window.qualityReview.getCheckpoint()),
        checkpoints.find((p) => p.id === c.id && p.offset === offset).hash,
        "rendered clip/headless state",
      );
      await page.locator(".stage").screenshot({ path: out + c.id + "-" + offset + ".png" });
    }
    await page.evaluate(async (id) => window.qualityReview.load(id, 480), c.id);
    assert.equal(
      await page.evaluate(() => window.qualityReview.getCheckpoint()),
      checkpoints.find((p) => p.id === c.id && p.offset === 480).hash,
    );
  }
  await page.evaluate(() => window.qualityReview.load("clip-01"));
  await page.locator("#play").click();
  await page.waitForFunction(() => window.qualityReview.getTick() > window.qualityReview.clips[0].start + 30);
  await page.locator("#play").click();
  assert(await page.evaluate(() => window.qualityReview.paused));
  await page.screenshot({ path: out + "review-desktop.png", fullPage: true });
  await page.locator("#judgment").selectOption("Ambiguous");
  await page.locator("#reason").fill("Automated UI check — not a human judgment.");
  await page.locator("#save").click();
  assert.match(await page.locator("#saved").textContent(), /Saved/);
  await page.locator("#clip").selectOption("clip-02");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  await page.locator("#clip").selectOption("clip-01");
  await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert.equal(await page.locator("#judgment").inputValue(), "Ambiguous");
  await page.evaluate(() => localStorage.removeItem("dmc-shooting-quality-labels-v1"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: out + "review-phone.png", fullPage: true });
  assert.deepEqual(errors, []);
  const sheet = await browser.newPage({ viewport: { width: 1350, height: 510 } });
  for (const c of clips) {
    const html =
      '<html><head><meta charset="utf-8"><base href="http://127.0.0.1:5173/dubai-missile-command/' +
      out +
      '"></head><body style="margin:0;background:#09111e;color:white;font:18px system-ui"><h2>' +
      c.id +
      ' · temporal frames; score hidden</h2><div style="display:flex">' +
      frames
        .map(
          (t) =>
            '<div style="width:225px;flex-shrink:0"><div>+' +
            (t / 60).toFixed(2) +
            ' s</div><img style="width:225px" src="' +
            c.id +
            "-" +
            t +
            '.png"></div>',
        )
        .join("") +
      "</div></body></html>";
    writeFileSync(out + c.id + "-sheet.html", html);
    await sheet.setContent(html);
    await sheet.screenshot({ path: out + c.id + "-sheet.png", fullPage: true });
  }
  const proof = {
    clips: 10,
    exactSeekFrames: 60,
    headlessCheckpointMatches: 70,
    playPause: true,
    labelsPersist: true,
    phoneWidth: 390,
    noPageOverflow: true,
    pageErrors: errors,
  };
  writeFileSync(out + "browser-verification.json", JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(proof);
} finally {
  await browser.close();
}
