import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ReplayData } from "../src/types";

declare global {
  interface Window {
    __gameRef?: import("react").MutableRefObject<import("../src/types").GameState | null>;
    __lastReplay?: ReplayData | null;
    __loadReplay?: (replayData: ReplayData) => void;
  }
}

const GROUND_Y = 1530;
const CANVAS_H = 1600;
const INTERCEPTOR_SPEED = 5;
const LAUNCHERS = [
  { x: 60, y: 1525 },
  { x: 550, y: 1525 },
  { x: 860, y: 1525 },
];

type BotThreat = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  priority: number;
};

type GameResult = {
  score: number;
  wave: number;
  stats: {
    missileKills: number;
    droneKills: number;
    shotsFired: number;
  };
};

test.skip(
  process.env.BOT_REPLAY_CONVERGENCE !== "1" && process.env.BOT_REPLAY_FILE_CONVERGENCE !== "1",
  "manual headed bot/replay convergence check",
);
test.setTimeout(180_000);

function leadTarget(x: number, y: number, vx: number, vy: number): { x: number; y: number } {
  let bestLauncher = LAUNCHERS[0];
  let bestDist = Infinity;
  for (const launcher of LAUNCHERS) {
    const d = Math.hypot(x - launcher.x, y - launcher.y);
    if (d < bestDist) {
      bestDist = d;
      bestLauncher = launcher;
    }
  }
  const dist = Math.hypot(x - bestLauncher.x, y - bestLauncher.y);
  const t = Math.min(120, dist / INTERCEPTOR_SPEED);
  return { x: x + vx * t * 0.5, y: y + vy * t * 0.5 };
}

async function startGame(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector("canvas");
  const startButton = page.getByRole("button", { name: /start defense/i });
  if ((await startButton.count()) > 0) {
    await startButton.first().click();
  } else {
    await page.locator("canvas").click({ position: { x: 450, y: 320 } });
  }
  await page.waitForFunction(() => window.__gameRef?.current?.state === "playing", { timeout: 5000 });
}

async function clickWaveSummaryIfVisible(page: Page): Promise<void> {
  const summary = page.locator(".bonus-screen");
  if (
    (await summary.count()) > 0 &&
    (await summary
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await summary
      .first()
      .click({ force: true })
      .catch(() => {});
  }
}

async function handleShopIfVisible(page: Page): Promise<boolean> {
  const shopCards = page.locator("[data-shop-card]:not([data-disabled])");
  const shopCardCount = await shopCards.count();
  if (shopCardCount === 0) return false;

  const buyOrder = [
    "launcherKit",
    "phalanx",
    "wildHornets",
    "patriot",
    "ironBeam",
    "roadrunner",
    "flare",
    "emp",
    "f15",
    "burjRepair",
  ];
  for (const key of buyOrder) {
    const card = page.locator(`[data-shop-card="${key}"]:not([data-disabled])`);
    if ((await card.count()) > 0) {
      await card.first().click();
      break;
    }
  }

  const deployButton = page.getByRole("button", { name: /deploy/i });
  await deployButton.first().click();
  return true;
}

async function playBotToGameOver(page: Page): Promise<{ result: GameResult; replay: ReplayData }> {
  const canvas = page.locator("canvas");
  let lastFireTime = 0;

  for (let tick = 0; tick < 2400; tick++) {
    await clickWaveSummaryIfVisible(page);
    if (await handleShopIfVisible(page)) {
      await page.waitForTimeout(200);
      continue;
    }

    const state = await page.evaluate(() => {
      const g = window.__gameRef?.current;
      if (!g) return null;
      return {
        state: g.state,
        score: g.score,
        wave: g.wave,
        burjAlive: g.burjAlive,
        stats: {
          missileKills: g.stats.missileKills,
          droneKills: g.stats.droneKills,
          shotsFired: g.stats.shotsFired,
        },
        replay: window.__lastReplay ?? null,
        missiles: g.missiles.filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, vx: m.vx, vy: m.vy, type: m.type })),
        drones: g.drones.filter((d) => d.alive).map((d) => ({ x: d.x, y: d.y, vx: d.vx, vy: d.vy, diving: d.diving })),
        planes: g.planes.filter((p) => p.alive).map((p) => ({ x: p.x, y: p.y })),
        ammo: [...g.ammo],
        interceptors: g.interceptors.filter((i) => i.alive).length,
      };
    });

    if (!state) throw new Error("Game state disappeared during bot run");
    if (state.state === "gameover") {
      expect(state.replay).toBeTruthy();
      return {
        result: { score: state.score, wave: state.wave, stats: state.stats },
        replay: state.replay!,
      };
    }

    const threats: BotThreat[] = [];
    for (const drone of state.drones) {
      if (drone.diving && drone.y > 100) {
        threats.push({ ...leadTarget(drone.x, drone.y, drone.vx, drone.vy), vx: drone.vx, vy: drone.vy, priority: 0 });
      }
    }
    for (const missile of state.missiles) {
      if (missile.y < 80) continue;
      const led = leadTarget(missile.x, missile.y, missile.vx, missile.vy);
      threats.push({
        ...led,
        vx: missile.vx,
        vy: missile.vy,
        priority: missile.y > 1100 ? 0 : missile.y > 700 ? 1 : 2,
      });
    }

    const totalAmmo = state.ammo.reduce((sum, ammo) => sum + ammo, 0);
    const now = Date.now();
    const cooldown = totalAmmo < 10 ? 360 : threats.length > 3 ? 70 : 180;
    if (threats.length > 0 && state.interceptors < (threats.length > 4 ? 6 : 3) && now - lastFireTime >= cooldown) {
      threats.sort((a, b) => a.priority - b.priority);
      const target = threats[0];
      const tooCloseToPlane = state.planes.some((p) => Math.hypot(target.x - p.x, target.y - p.y) < 55);
      if (!tooCloseToPlane) {
        const box = await canvas.boundingBox();
        expect(box).toBeTruthy();
        const clickX = Math.max(20, Math.min(880, target.x));
        const clickY = Math.max(20, Math.min(GROUND_Y - 20, target.y));
        await canvas.click({
          position: {
            x: clickX * (box!.width / 900),
            y: clickY * (box!.height / CANVAS_H),
          },
        });
        lastFireTime = now;
      }
    }

    await page.waitForTimeout(60);
  }

  throw new Error("Bot game did not reach gameover before timeout");
}

async function replayToGameOver(page: Page, replay: ReplayData): Promise<GameResult> {
  await page.evaluate((data: ReplayData) => window.__loadReplay!(data), replay);
  await page.waitForFunction(() => window.__gameRef?.current?._replay === true, { timeout: 5000 });
  await page.waitForFunction(() => window.__gameRef?.current?.state === "gameover", { timeout: 120_000 });
  return page.evaluate(() => {
    const g = window.__gameRef!.current!;
    return {
      score: g.score,
      wave: g.wave,
      stats: {
        missileKills: g.stats.missileKills,
        droneKills: g.stats.droneKills,
        shotsFired: g.stats.shotsFired,
      },
    };
  });
}

test("headed bot game replay converges on the same result", async ({ page }) => {
  test.skip(process.env.BOT_REPLAY_CONVERGENCE !== "1", "manual headed bot/replay convergence check");
  await startGame(page);
  const original = await playBotToGameOver(page);
  const replayed = await replayToGameOver(page, original.replay);

  console.log("original", original.result);
  console.log("replayed", replayed);

  expect(replayed).toEqual(original.result);
});

test("saved replay file converges on its recorded result", async ({ page }) => {
  test.skip(process.env.BOT_REPLAY_FILE_CONVERGENCE !== "1", "manual saved replay convergence check");
  const replayFile = process.env.REPLAY_FILE;
  if (!replayFile) throw new Error("REPLAY_FILE is required");

  const replay = JSON.parse(readFileSync(replayFile, "utf8")) as ReplayData & Partial<GameResult>;
  const expected: GameResult = {
    score: replay.score ?? 0,
    wave: replay.wave ?? 0,
    stats: {
      missileKills: replay.stats?.missileKills ?? 0,
      droneKills: replay.stats?.droneKills ?? 0,
      shotsFired: replay.stats?.shotsFired ?? 0,
    },
  };

  await page.goto("/");
  await page.waitForFunction(() => window.__loadReplay != null, { timeout: 5000 });
  const replayed = await replayToGameOver(page, replay);

  console.log("replay file", replayFile);
  console.log("expected", expected);
  console.log("replayed", replayed);

  expect(replayed).toEqual(expected);
});
