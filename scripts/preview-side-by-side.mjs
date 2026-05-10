// Stitches two PNGs side by side using a headless browser canvas.
// Usage: node scripts/preview-side-by-side.mjs <left.png> <right.png> <out.png>
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const [, , left, right, out] = process.argv;
const lb = readFileSync(left).toString("base64");
const rb = readFileSync(right).toString("base64");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 2000, height: 700 } })).newPage();
await page.setContent(`
<!doctype html><html><body style="margin:0;background:#0a0a14">
<canvas id="c" width="1600" height="500"></canvas>
<script>
const c = document.getElementById('c'); const ctx = c.getContext('2d');
ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, 1600, 500);
const l = new Image(), r = new Image();
let n = 0;
function draw() {
  if (++n < 2) return;
  // scale each to fit in 800x500
  const scale = (img) => Math.min(780/img.width, 480/img.height);
  const ls = scale(l), rs = scale(r);
  ctx.drawImage(l, 10, (500 - l.height*ls)/2, l.width*ls, l.height*ls);
  ctx.drawImage(r, 810, (500 - r.height*rs)/2, r.width*rs, r.height*rs);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif';
  ctx.fillText('BEFORE', 16, 28);
  ctx.fillText('AFTER', 816, 28);
  document.title = 'done';
}
l.onload = draw; r.onload = draw;
l.src = 'data:image/png;base64,${lb}';
r.src = 'data:image/png;base64,${rb}';
</script></body></html>`);
await page.waitForFunction(() => document.title === "done");
const buf = await page.locator("#c").screenshot();
writeFileSync(out, buf);
await browser.close();
console.log("wrote", out);
