import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const out = "operator-results/target-pressure-stage-c";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:5173/dubai-missile-command/");
  await page.waitForFunction(() => !!window.__loadReplay);
  await page.evaluate(() =>
    window.__loadReplay({
      version: 16,
      seed: 42,
      actions: [],
      initialState: {
        metaProgression: { version: 1, completedObjectives: [] },
        forcedUpgradeFamilies: [],
        burjHealth: 7,
      },
    }),
  );
  await page.getByRole("button", { name: /pause replay/i }).click();
  const tells = await page.evaluate(async () => {
    const { spawnDroneOfType } = await import("/dubai-missile-command/src/game-sim.ts");
    const { prepareDroneCommitment } = await import("/dubai-missile-command/src/pressure-drones.ts");
    const { setRng } = await import("/dubai-missile-command/src/game-logic.ts");
    const g = window.__gameRef.current;
    g.wave = 5;
    g.missiles = [];
    g.drones = [];
    g.targetPressure = undefined;
    setRng(() => 0.72);
    spawnDroneOfType(g, "shahed136", { side: "left", yRange: [250, 250] }, "shahed-136");
    spawnDroneOfType(g, "shahed238", { side: "right", yRange: [410, 410] });
    for (const d of g.drones) {
      const route = d.pressure.route;
      d.pathIndex = route.tellIndex;
      d.x = route.waypoints[d.pathIndex].x;
      d.y = route.waypoints[d.pathIndex].y;
      prepareDroneCommitment(g, d, 0);
      d.diveTelegraphing = true;
    }
    return g.drones.map((d) => ({
      subtype: d.subtype,
      committed: d.pressure.committed,
      x: d.x,
      y: d.y,
      target: d.diveTarget,
    }));
  });
  assert(tells.every((d) => d.committed && d.target && d.x >= 40 && d.x <= 860));
  await page.screenshot({ path: `${out}/commitment-phone.png` });
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.screenshot({ path: `${out}/commitment-desktop.png` });
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/browser-check.json`, JSON.stringify({ tells, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ tells, errors }));
} finally {
  await browser.close();
}
