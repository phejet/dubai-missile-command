// Screenshots a cropped region around the F-15s in the live /editor preview.
// Usage: node scripts/preview-editor-f15.mjs <out.png>
import { chromium } from "playwright";

const out = process.argv[2] ?? "f15-editor.png";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/editor.html", { waitUntil: "networkidle" });
// Wait for the canvas to be marked ready
await page.waitForFunction(() => document.querySelector("canvas")?.dataset.editorPreview === "ready", null, {
  timeout: 15000,
});
// Give Pixi a couple of frames after ready
await page.waitForTimeout(400);

const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas box");

// The editor renders the full 900x1600 game canvas scaled to fit the viewport.
// We want a tight crop around the two F-15s placed at game coords (320,240) and (620,380).
// Read the on-screen bounds from the page so we map game-space → screen-space.
const mapping = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const rect = c.getBoundingClientRect();
  // game world is 900 wide × 1600 tall; canvas is letterboxed to fit
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
});
const sx = mapping.w / 900;
const sy = mapping.h / 1600;
const clip = {
  x: mapping.x + 220 * sx,
  y: mapping.y + 180 * sy,
  width: 520 * sx,
  height: 280 * sy,
};

await page.screenshot({ path: out, clip });
await browser.close();
console.log("wrote", out, "clip=", clip);
