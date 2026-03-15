import { chromium } from "playwright";

const GAME_URL = "http://localhost:5174";
const TICK_MS = 200;
const GROUND_Y = 570;
const INTERCEPTOR_SPEED = 5;
const LAUNCHERS = [{ x: 100, y: 565 }, { x: 450, y: 565 }, { x: 800, y: 565 }];

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto(GAME_URL);
  await page.waitForSelector("canvas");
  const canvas = page.locator("canvas");

  // Start the game
  await sleep(1500);
  console.log("Clicking to start...");
  await canvas.click({ position: { x: 450, y: 320 } });
  await sleep(1000);

  // Verify game started
  const started = await page.evaluate(() => {
    return window.__gameRef && window.__gameRef.current !== null;
  });
  console.log("Game ref exists:", started);

  let lastFireTime = 0;
  let tick = 0;

  while (true) {
    tick++;
    try {
      // Check for shop buttons first (DOM level)
      const buttonCount = await page.locator("button").count();

      if (buttonCount > 0) {
        console.log(`Shop detected (${buttonCount} buttons)`);
        // Buy all affordable upgrades
        let bought = true;
        while (bought) {
          bought = false;
          const upgradeBtns = page.locator('button:not([disabled])');
          const count = await upgradeBtns.count();
          for (let i = 0; i < count; i++) {
            const btn = upgradeBtns.nth(i);
            const text = await btn.textContent().catch(() => "");
            if (text.includes("UPGRADE")) {
              await btn.click();
              console.log(`  Bought: ${text.trim()}`);
              bought = true;
              await sleep(150);
              break;
            }
          }
        }
        // Click deploy
        await sleep(200);
        const deployBtn = page.locator('button:not([disabled])');
        const dcount = await deployBtn.count();
        for (let i = 0; i < dcount; i++) {
          const btn = deployBtn.nth(i);
          const text = await btn.textContent().catch(() => "");
          if (text.includes("DEPLOY")) {
            await btn.click();
            console.log(`Deployed next wave!`);
            break;
          }
        }
        await sleep(500);
        continue;
      }

      // Get game state
      const state = await page.evaluate(() => {
        const ref = window.__gameRef;
        if (!ref || !ref.current) return null;
        const g = ref.current;
        return {
          missiles: g.missiles.filter(m => m.alive).map(m => ({
            x: m.x, y: m.y, vx: m.vx, vy: m.vy, type: m.type,
          })),
          drones: g.drones.filter(d => d.alive).map(d => ({
            x: d.x, y: d.y, vx: d.vx, vy: d.vy,
            subtype: d.subtype, diving: d.diving,
          })),
          planes: g.planes.filter(p => p.alive && !p.landed).map(p => ({
            x: p.x, y: p.y,
          })),
          ammo: g.ammo,
          score: g.score,
          wave: g.wave,
          burjAlive: g.burjAlive,
          interceptors: g.interceptors.filter(i => i.alive).length,
        };
      });

      if (!state) {
        if (tick % 10 === 0) console.log("No game state — clicking to start");
        await canvas.click({ position: { x: 450, y: 320 } });
        await sleep(1000);
        continue;
      }

      // Periodic status
      if (tick % 20 === 0) {
        const ammo = state.ammo.reduce((s, a) => s + a, 0);
        console.log(`W${state.wave} | $${state.score} | Ammo:${ammo} | Threats:${state.missiles.length}m+${state.drones.length}d | Burj:${state.burjAlive}`);
      }

      // Game over — click to restart
      if (!state.burjAlive) {
        console.log(`GAME OVER! Wave ${state.wave}, Score: ${state.score}`);
        await sleep(2000);
        await canvas.click({ position: { x: 450, y: 320 } });
        await sleep(1000);
        continue;
      }

      // ── TARGETING ──
      const now = Date.now();
      const inFlight = state.interceptors;
      const allThreats = [];

      // Diving shaheds
      for (const d of state.drones) {
        if (d.diving) {
          const led = leadTarget(d.x, d.y, d.vx, d.vy);
          allThreats.push({ ...led, priority: 0 });
        }
      }
      // All missiles on screen
      for (const m of state.missiles) {
        if (m.y < 0) continue;
        const led = leadTarget(m.x, m.y, m.vx, m.vy);
        const priority = m.y > 400 ? 1 : m.y > 200 ? 2 : 3;
        allThreats.push({ ...led, priority });
      }
      // Shoot ALL on-screen drones/shaheds — they drop bombs and dive
      for (const d of state.drones) {
        if (!d.diving && d.x > 50 && d.x < 850) {
          const led = leadTarget(d.x, d.y, d.vx, d.vy);
          allThreats.push({ ...led, priority: 2 });
        }
      }

      if (allThreats.length === 0 || inFlight >= 1 || now - lastFireTime < 300) {
        await sleep(TICK_MS);
        continue;
      }

      allThreats.sort((a, b) => a.priority - b.priority);

      // Find best cluster shot
      let bestPoint = null;
      let bestScore = 0;
      for (const t of allThreats) {
        let score = 0;
        for (const o of allThreats) {
          const d = Math.sqrt((t.x - o.x) ** 2 + (t.y - o.y) ** 2);
          if (d < 70) score += 1;
        }
        score += (4 - t.priority);
        if (score > bestScore) { bestScore = score; bestPoint = t; }
      }

      // Avoid hitting planes
      if (bestPoint && state.planes) {
        const tooClose = state.planes.some(p =>
          Math.sqrt((bestPoint.x - p.x) ** 2 + (bestPoint.y - p.y) ** 2) < 80
        );
        if (tooClose) { await sleep(TICK_MS); continue; }
      }

      if (bestPoint) {
        const clickX = Math.max(20, Math.min(880, bestPoint.x));
        const clickY = Math.max(20, Math.min(545, bestPoint.y));
        const box = await canvas.boundingBox();
        await canvas.click({
          position: { x: clickX * (box.width / 900), y: clickY * (box.height / 640) },
        });
        lastFireTime = now;
      }

      await sleep(TICK_MS);
    } catch (err) {
      console.error("Error:", err.message);
      await sleep(1000);
    }
  }
}

function leadTarget(tx, ty, tvx, tvy) {
  let aimX = tx, aimY = ty;
  for (let iter = 0; iter < 3; iter++) {
    let best = Infinity;
    for (const l of LAUNCHERS) {
      const d = Math.sqrt((aimX - l.x) ** 2 + (aimY - l.y) ** 2);
      if (d < best) best = d;
    }
    const frames = (best / INTERCEPTOR_SPEED) * 0.75;
    aimX = tx + tvx * frames;
    aimY = Math.min(ty + tvy * frames, GROUND_Y - 25);
  }
  return { x: aimX, y: aimY };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(console.error);
