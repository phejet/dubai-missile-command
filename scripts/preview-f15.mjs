// Renders the F-15 airframe bake at high zoom to a PNG for visual review.
// Usage: node scripts/preview-f15.mjs <variant> <outPath>
//   variant: "before" | "after"
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const variant = process.argv[2] ?? "before";
const out = process.argv[3] ?? `f15-${variant}.png`;

const drawBefore = `
function drawF15(ctx) {
  // Fuselage
  ctx.fillStyle = "#7888a0";
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(10, -3);
  ctx.lineTo(-18, -3.5);
  ctx.lineTo(-22, -2);
  ctx.lineTo(-22, 2);
  ctx.lineTo(-18, 3.5);
  ctx.lineTo(10, 3);
  ctx.closePath();
  ctx.fill();
  // Nose cone
  ctx.fillStyle = "#5a6a80";
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(30, 0); ctx.lineTo(22, -1.5); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22, 0); ctx.lineTo(30, 0); ctx.lineTo(22, 1.5); ctx.closePath(); ctx.fill();
  // Swept wings
  ctx.fillStyle = "#687890";
  ctx.beginPath();
  ctx.moveTo(2, -3); ctx.lineTo(-8, -16); ctx.lineTo(-14, -14); ctx.lineTo(-6, -3); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2, 3); ctx.lineTo(-8, 16); ctx.lineTo(-14, 14); ctx.lineTo(-6, 3); ctx.closePath(); ctx.fill();
  // Twin vertical stabilizers
  ctx.fillStyle = "#5a6878";
  ctx.beginPath();
  ctx.moveTo(-16, -3.5); ctx.lineTo(-20, -10); ctx.lineTo(-22, -9); ctx.lineTo(-20, -3.5); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-16, 3.5); ctx.lineTo(-20, 10); ctx.lineTo(-22, 9); ctx.lineTo(-20, 3.5); ctx.closePath(); ctx.fill();
  // Engine nozzles
  ctx.fillStyle = "#4a5060";
  ctx.beginPath(); ctx.ellipse(-22, -2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-22, 2, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
  // Cockpit
  ctx.fillStyle = "rgba(100,200,255,0.4)";
  ctx.beginPath(); ctx.ellipse(14, 0, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
}
`;

const drawAfter = `
function drawF15(ctx) {
  // ---------- Wings (back-to-front: shadow plate, then topface, then leading-edge highlight) ----------
  // Wing shadow underplate
  ctx.fillStyle = "#39424f";
  ctx.beginPath();
  ctx.moveTo(4, -3); ctx.lineTo(-10, -18); ctx.lineTo(-17, -16); ctx.lineTo(-6, -3); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(4, 3); ctx.lineTo(-10, 18); ctx.lineTo(-17, 16); ctx.lineTo(-6, 3); ctx.closePath(); ctx.fill();
  // Wing topface, inset
  ctx.fillStyle = "#5a6b80";
  ctx.beginPath();
  ctx.moveTo(3, -3.5); ctx.lineTo(-10, -17); ctx.lineTo(-15, -15.5); ctx.lineTo(-7, -3.5); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(3, 3.5); ctx.lineTo(-10, 17); ctx.lineTo(-15, 15.5); ctx.lineTo(-7, 3.5); ctx.closePath(); ctx.fill();
  // Leading-edge highlight strip
  ctx.strokeStyle = "#90a0b8";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(3.5, -4); ctx.lineTo(-9, -17); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3.5, 4);  ctx.lineTo(-9,  17); ctx.stroke();

  // ---------- Underwing AAM stores (peek out from under wing edges) ----------
  ctx.fillStyle = "#3a4252";
  for (const sy of [-10, 10]) {
    ctx.fillRect(-8, sy - 0.8, 9, 1.6);
    // pointy nose
    ctx.beginPath();
    ctx.moveTo(1, sy - 0.8); ctx.lineTo(3.5, sy); ctx.lineTo(1, sy + 0.8); ctx.closePath(); ctx.fill();
  }

  // ---------- Fuselage (shadow base, then top highlight) ----------
  // Fuselage shadow silhouette
  ctx.fillStyle = "#3d4756";
  ctx.beginPath();
  ctx.moveTo(24, 0);
  ctx.lineTo(12, -3.4);
  ctx.lineTo(-19, -4);
  ctx.lineTo(-24, -2.2);
  ctx.lineTo(-24,  2.2);
  ctx.lineTo(-19,  4);
  ctx.lineTo(12,   3.4);
  ctx.closePath();
  ctx.fill();
  // Fuselage top highlight (centerline strip)
  ctx.fillStyle = "#8090a8";
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(11, -1.6);
  ctx.lineTo(-18, -2);
  ctx.lineTo(-22, -1);
  ctx.lineTo(-22,  1);
  ctx.lineTo(-18,  2);
  ctx.lineTo(11,   1.6);
  ctx.closePath();
  ctx.fill();

  // ---------- Intake shoulders ----------
  ctx.fillStyle = "#52607a";
  ctx.fillRect(-4, -3.8, 12, 1.0);
  ctx.fillRect(-4,  2.8, 12, 1.0);

  // ---------- Nose ----------
  // Nose cone (long, pointed)
  ctx.fillStyle = "#5a6a80";
  ctx.beginPath();
  ctx.moveTo(24, -1.6); ctx.lineTo(33, 0); ctx.lineTo(24, 1.6); ctx.closePath(); ctx.fill();
  // Tip accent (darker pitot/tip)
  ctx.fillStyle = "#2a3140";
  ctx.beginPath();
  ctx.moveTo(31, -0.6); ctx.lineTo(34, 0); ctx.lineTo(31, 0.6); ctx.closePath(); ctx.fill();

  // ---------- Twin vertical stabilizers (slightly canted outward) ----------
  ctx.fillStyle = "#4a5668";
  // upper tail
  ctx.beginPath();
  ctx.moveTo(-15, -3.5); ctx.lineTo(-20, -11); ctx.lineTo(-23, -10.5); ctx.lineTo(-21, -3.5); ctx.closePath(); ctx.fill();
  // lower tail
  ctx.beginPath();
  ctx.moveTo(-15,  3.5); ctx.lineTo(-20,  11); ctx.lineTo(-23,  10.5); ctx.lineTo(-21,  3.5); ctx.closePath(); ctx.fill();
  // Tail tip caps (subtle red — reads as nav beacon at rest)
  ctx.fillStyle = "#c43a3a";
  ctx.fillRect(-21, -11.4, 2, 1.2);
  ctx.fillRect(-21,  10.2, 2, 1.2);

  // ---------- Engine nozzles + hot inner ring ----------
  ctx.fillStyle = "#1a1d22";
  ctx.beginPath(); ctx.ellipse(-23, -2.1, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-23,  2.1, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd9a0";
  ctx.beginPath(); ctx.ellipse(-23, -2.1, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-23,  2.1, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();

  // ---------- Cockpit canopy ----------
  // Dark base
  ctx.fillStyle = "#0d1a2c";
  ctx.beginPath();
  ctx.ellipse(14, 0, 5.5, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Highlight band
  ctx.fillStyle = "rgba(180,220,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(15.5, -0.5, 3.2, 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
}
`;

const draw = variant === "after" ? drawAfter : drawBefore;

const browser = await chromium.launch();
const ctxBrowser = await browser.newContext({ viewport: { width: 800, height: 400 } });
const page = await ctxBrowser.newPage();

const html = `
<!doctype html>
<html><body style="margin:0;background:#10131c;">
<canvas id="c" width="800" height="400"></canvas>
<script>
${draw}
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
ctx.fillStyle = '#10131c'; ctx.fillRect(0, 0, 800, 400);
// 8x zoom
ctx.save();
ctx.translate(400, 200);
ctx.scale(8, 8);
drawF15(ctx);
ctx.restore();
// Caption
ctx.fillStyle = '#aab';
ctx.font = '14px sans-serif';
ctx.fillText(${JSON.stringify(variant.toUpperCase())}, 10, 24);
</script>
</body></html>
`;

await page.setContent(html);
const buf = await page.locator("#c").screenshot();
writeFileSync(out, buf);
await browser.close();
console.log("wrote", out);
