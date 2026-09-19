import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

// Browser check of the cash-out combo toast ("5× COMBO! +1000") next to a live multi-kill popup.
// Needs local Vite on port 5173. Measures real DOM boxes; writes screenshots.
const out = "operator-results/scoring-change-20260919/popup/";
mkdirSync(out, { recursive: true });
const URL = "http://127.0.0.1:5173/dubai-missile-command/";
const spots = [
  { name: "centre", x: 450, y: 700 },
  { name: "left-edge", x: 40, y: 700 },
  { name: "right-edge", x: 860, y: 700 },
  { name: "top", x: 450, y: 140 },
];
const results = [];
const browser = await chromium.launch();
try {
  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.routeWebSocket(/.*/, () => {});
    await page.goto(URL);
    const start = page.getByRole("button", { name: /start defense/i });
    if (await start.count()) await start.first().click();
    else await page.mouse.click(viewport.width / 2, viewport.height * 0.35);
    await page.waitForFunction(() => window.__gameRef?.current != null);
    for (const spot of spots) {
      const boxes = await page.evaluate(async ({ x, y }) => {
        const g = window.__gameRef.current;
        g.combo = 1;
        g.multiKillToast = { label: "TRIPLE KILL", bonus: 350, kills: 3, x, y, timer: 90, pulse: 1 };
        g.comboToast = { multiplier: 5, bonus: 1000, x, y: y - 20, timer: 70, pulse: 1 };
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const rect = (id) => {
          const el = document.getElementById(id);
          if (!el || el.hidden) return null;
          const b = el.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, text: el.textContent.trim() };
        };
        return {
          bonus: rect("overlay-combo-toast"),
          multi: rect("overlay-multi-kill"),
          hud: document.getElementById("hud-combo-value")?.textContent,
          canvas: document.getElementById("game-canvas").getBoundingClientRect().toJSON(),
        };
      }, spot);
      const { bonus, multi, canvas } = boxes;
      const overlap =
        bonus && multi
          ? Math.max(0, Math.min(bonus.right, multi.right) - Math.max(bonus.left, multi.left)) *
            Math.max(0, Math.min(bonus.bottom, multi.bottom) - Math.max(bonus.top, multi.top))
          : null;
      const inside = (b) =>
        b && b.left >= canvas.left - 0.5 && b.right <= canvas.right + 0.5 && b.top >= canvas.top - 0.5;
      results.push({
        viewport: viewport.name,
        spot: spot.name,
        bonusText: bonus?.text,
        multiText: multi?.text,
        overlapPx: overlap === null ? null : Math.round(overlap),
        gapPx: bonus && multi ? Math.round(Math.max(multi.top - bonus.bottom, bonus.top - multi.bottom)) : null,
        bonusInsideCanvas: inside(bonus),
        multiInsideCanvas: inside(multi),
        hud: boxes.hud,
      });
      await page.screenshot({ path: `${out}${viewport.name}-${spot.name}.png` });
    }
    results.push({ viewport: viewport.name, pageErrors: errors });
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(out + "popup-check.json", JSON.stringify(results, null, 2));
console.table(results.filter((r) => r.spot));
console.log(results.filter((r) => !r.spot));
