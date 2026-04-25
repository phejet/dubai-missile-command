#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_URL = "http://127.0.0.1:5173/dubai-missile-command/";
const DEFAULT_OUT_DIR = "/tmp/dmc-pixi-phase6";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function readViewport() {
  const raw = readArg("viewport", "390x844");
  const match = /^(\d+)x(\d+)$/.exec(raw);
  if (!match) throw new Error(`Invalid --viewport=${raw}; expected WIDTHxHEIGHT`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function waitForPixiReady(page) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById("game-canvas");
    return (
      canvas instanceof HTMLCanvasElement &&
      canvas.dataset.renderer === "pixi" &&
      canvas.dataset.pixiTitle === "ready" &&
      canvas.dataset.pixiGameplayStatic === "ready"
    );
  });
}

async function injectEffectShowcase(page) {
  return page.evaluate(() => {
    const game = window.__gameRef?.current;
    if (!game) throw new Error("window.__gameRef.current is missing");

    game.explosions.length = 0;
    game.particles.length = 0;
    game.empRings.length = 0;
    game.laserBeams.length = 0;
    game.phalanxBullets.length = 0;

    game.explosions.push(
      {
        id: 9101,
        x: 450,
        y: 710,
        radius: 120,
        maxRadius: 140,
        growing: false,
        alpha: 1,
        color: "#ff8844",
        playerCaused: false,
        harmless: true,
        chain: false,
        visualType: "missile",
        rootExplosionId: null,
        ringRadius: 145,
        ringAlpha: 1,
        kills: 5,
        heroPulse: 1,
      },
      {
        id: 9102,
        x: 315,
        y: 620,
        radius: 54,
        maxRadius: 72,
        growing: false,
        alpha: 0.95,
        color: "#ffaa00",
        playerCaused: true,
        harmless: true,
        chain: false,
        rootExplosionId: null,
        ringRadius: 80,
        ringAlpha: 0.8,
      },
    );
    game.empRings.push({ x: 460, y: 1120, radius: 185, maxRadius: 715, alpha: 0.68, alive: true });
    game.laserBeams.push({ x1: 430, y1: 1160, x2: 260, y2: 580, life: 10, maxLife: 14, targetRef: null });
    game.phalanxBullets.push({ x: 600, y: 1290, cx: 520, cy: 700, alive: true, life: 6 });

    return {
      explosions: game.explosions.length,
      empRings: game.empRings.length,
      laserBeams: game.laserBeams.length,
      phalanxBullets: game.phalanxBullets.length,
    };
  });
}

async function main() {
  const url = readArg("url", DEFAULT_URL);
  const outDir = readArg("out-dir", DEFAULT_OUT_DIR);
  const viewport = readViewport();
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, isMobile: viewport.width < 640, hasTouch: viewport.width < 640 });
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForPixiReady(page);

    const titlePath = path.join(outDir, "title.png");
    await page.screenshot({ path: titlePath, fullPage: true });

    await page.getByRole("button", { name: /start defense/i }).click();
    await page.waitForTimeout(100);
    const injected = await injectEffectShowcase(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));

    const effectsPath = path.join(outDir, "effects.png");
    await page.screenshot({ path: effectsPath, fullPage: true });

    const canvasState = await page.locator("#game-canvas").evaluate((canvas) => ({
      renderer: canvas.dataset.renderer,
      pixiTitle: canvas.dataset.pixiTitle,
      pixiGameplayStatic: canvas.dataset.pixiGameplayStatic,
      width: canvas.width,
      height: canvas.height,
    }));

    console.log(
      JSON.stringify(
        {
          url,
          viewport,
          titlePath,
          effectsPath,
          canvasState,
          injected,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
