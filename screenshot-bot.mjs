import { chromium } from "playwright";

const GAME_URL = "http://localhost:5173/dubai-missile-command/";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(GAME_URL);
  await page.waitForSelector("canvas");
  const canvas = page.locator("canvas");

  await sleep(2000);
  await page.evaluate(() => {
    const c = document.querySelector("canvas");
    c.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 196,
        clientY: 400,
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
    c.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 196,
        clientY: 400,
        bubbles: true,
        pointerId: 1,
        pointerType: "touch",
      }),
    );
  });
  await sleep(1000);

  // Wait for threats to arrive and let some hit targets (don't shoot for first 8 seconds)
  console.log("Waiting for threats to reach targets...");
  await sleep(8000);

  // Now fire a few shots to mix interceptor + threat explosions
  for (let i = 0; i < 5; i++) {
    const threats = await page.evaluate(() => {
      const g = window.__gameRef?.current;
      if (!g) return [];
      const targets = [];
      g.missiles.forEach((m) => {
        if (m.alive) targets.push({ x: m.x, y: m.y });
      });
      g.drones.forEach((d) => {
        if (d.alive) targets.push({ x: d.x, y: d.y });
      });
      return targets;
    });
    if (threats.length > 0) {
      const t = threats[0];
      const canvasRect = await canvas.boundingBox();
      const scaleX = canvasRect.width / 900;
      const scaleY = canvasRect.height / 640;
      const cx = canvasRect.x + Math.max(5, Math.min(canvasRect.width - 5, t.x * scaleX));
      const cy = canvasRect.y + Math.max(5, Math.min(canvasRect.height - 5, t.y * scaleY));
      await page.mouse.click(cx, cy);
    }
    await sleep(400);
  }

  // Wait a beat then take multiple screenshots, pick the one with most explosions
  let bestShot = null;
  let bestExplosions = 0;
  for (let i = 0; i < 20; i++) {
    const count = await page.evaluate(() => {
      const g = window.__gameRef?.current;
      return g ? g.explosions.length : 0;
    });
    if (count > bestExplosions) {
      bestExplosions = count;
      await page.screenshot({ path: "game-screenshot.png", fullPage: false });
      bestShot = i;
    }
    await sleep(200);
  }

  console.log(`Best screenshot at frame ${bestShot} with ${bestExplosions} explosions`);
  await browser.close();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);
