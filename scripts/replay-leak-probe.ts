/**
 * Full-replay memory leak probe.
 *
 * Watches a replay in the real game (__loadReplay -> main renderer + SFX +
 * sim at 30tps) and samples live WebGL resources, 2d-canvas allocations, and
 * JS heap. Two axes:
 *  - per watch: the same replay is watched N times back to back; between-watch
 *    baselines must stay flat
 *  - per wave: during each watch, a sample is taken at every wave transition;
 *    a steady upward slope in canvases/texture bytes is the per-wave leak
 *
 * This covers the code path the death-clip probe does not: the primary
 * renderer, the audio pipeline (handleSimEvent -> SFX), HUD updates, and
 * replay-anchor capture.
 *
 * Usage:
 *   npm run dev                                              # terminal 1
 *   npx tsx scripts/replay-leak-probe.ts <replay.json> [watches]
 *
 * Env: GAME_URL, PW_EXECUTABLE_PATH as in death-clip-leak-probe.
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { GL_WRAP } from "./death-clip-leak-probe";

const BASE = process.env.GAME_URL ?? "http://localhost:5173/dubai-missile-command/";
const REPO = resolve(import.meta.dirname, "..");
const replayPath = process.argv[2] ?? resolve(REPO, "public/replays/perf-wave4-upgrades.json");
const WATCHES = parseInt(process.argv[3] ?? "3", 10);

async function main() {
  const replay = JSON.parse(readFileSync(replayPath, "utf-8"));

  const browser = await chromium.launch({
    ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
    args: ["--enable-precise-memory-info", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
  await page.addInitScript(GL_WRAP);
  page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");

  const results: Record<string, unknown>[] = [];
  async function sample(label: string) {
    await cdp.send("HeapProfiler.enable").catch(() => {});
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const { metrics } = await cdp.send("Performance.getMetrics");
    const get = (n: string) => metrics.find((m) => m.name === n)?.value ?? 0;
    const gl = await page.evaluate(() => (window as any).__glStats());
    const liveTextures = await page.evaluate(() => (window as any).__liveTextures());
    const liveCanvases = await page.evaluate(() => (window as any).__liveCanvases());
    let canvasCount = 0;
    let canvasBytes = 0;
    for (const info of Object.values<any>(liveCanvases)) {
      canvasCount += info.count;
      canvasBytes += info.bytes;
    }
    const row = {
      label,
      heapUsedMB: +(get("JSHeapUsedSize") / 1048576).toFixed(1),
      nodes: get("Nodes"),
      listeners: get("JSEventListeners"),
      ...gl,
      canvasCount,
      canvasBytes,
      liveTextures,
      liveCanvases,
    };
    results.push(row);
    console.log(
      `${label.padEnd(20)} heap=${row.heapUsedMB}MB nodes=${row.nodes} ` +
        `glTex=${gl.textures}(${(gl.textureBytes / 1048576).toFixed(1)}MB) glBuf=${gl.buffers}(${(gl.bufferBytes / 1048576).toFixed(1)}MB) ` +
        `canvases=${canvasCount}(${(canvasBytes / 1048576).toFixed(1)}MB)`,
    );
  }

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameRef && !!window.__loadReplay, undefined, { timeout: 30000 });
  await sample("boot");

  for (let watch = 1; watch <= WATCHES; watch++) {
    await page.evaluate(({ replayData }) => {
      (window as any).__replayDone = false;
      (window as any).__onReplayFinished = () => {
        (window as any).__replayDone = true;
      };
      window.__loadReplay!(replayData);
    }, { replayData: replay });

    await page.waitForFunction(() => window.__gameRef?.current?._replay === true, undefined, { timeout: 30000 });

    // Sample on every wave transition until the replay finishes.
    let lastWave = -1;
    for (;;) {
      const state = await page.evaluate(() => ({
        done: (window as any).__replayDone === true,
        wave: window.__gameRef?.current?.wave ?? null,
        gameState: window.__gameRef?.current?.state ?? null,
      }));
      if (state.done || state.gameState === "gameover") break;
      if (typeof state.wave === "number" && state.wave !== lastWave) {
        lastWave = state.wave;
        await sample(`watch${watch}-wave${state.wave}`);
      }
      await page.waitForTimeout(1000);
    }
    await sample(`watch${watch}-finished`);
  }

  const out = resolve(REPO, "replay-leak-probe-results.json");
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log("\nresults written to", out);

  // Growth report across the run: compare first wave sample to last finished sample.
  const canvasFirst = results.find((r) => String(r.label).includes("wave"));
  const last = results[results.length - 1];
  if (canvasFirst && last) {
    const dTex = (last.textureBytes as number) - (canvasFirst.textureBytes as number);
    const dCanvas = (last.canvasBytes as number) - (canvasFirst.canvasBytes as number);
    const dHeap = (last.heapUsedMB as number) - (canvasFirst.heapUsedMB as number);
    console.log(
      `\ndelta ${canvasFirst.label} -> ${last.label}: ` +
        `glTex ${(dTex / 1048576).toFixed(1)}MB, canvases ${(dCanvas / 1048576).toFixed(1)}MB, heap ${dHeap.toFixed(1)}MB`,
    );
  }

  // Per-stack canvas growth between the two watches' finished samples, if present.
  const finished = results.filter((r) => String(r.label).endsWith("-finished"));
  if (finished.length >= 2) {
    const first = finished[0].liveCanvases as Record<string, any>;
    const lastC = finished[finished.length - 1].liveCanvases as Record<string, any>;
    console.log("\n=== canvas stacks that grew between first and last watch ===");
    let any = false;
    for (const [stack, info] of Object.entries<any>(lastC)) {
      const before = first[stack] ?? { count: 0, bytes: 0 };
      if (info.count > before.count) {
        any = true;
        console.log(
          `+${info.count - before.count} canvases, +${((info.bytes - before.bytes) / 1048576).toFixed(1)}MB  dims=${JSON.stringify(info.dims)}\n   ${stack}\n`,
        );
      }
    }
    if (!any) console.log("(none)");
    const firstT = finished[0].liveTextures as Record<string, any>;
    const lastT = finished[finished.length - 1].liveTextures as Record<string, any>;
    console.log("\n=== texture stacks that grew between first and last watch ===");
    any = false;
    for (const [stack, info] of Object.entries<any>(lastT)) {
      const before = firstT[stack] ?? { count: 0, bytes: 0 };
      if (info.count > before.count) {
        any = true;
        console.log(
          `+${info.count - before.count} textures, +${((info.bytes - before.bytes) / 1048576).toFixed(1)}MB\n   ${stack}\n`,
        );
      }
    }
    if (!any) console.log("(none)");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
