import { chromium } from "playwright";
import { readFileSync } from "fs";
import type { GameStats } from "./src/types";

interface ReplayFinishedSample {
  score: number;
  stats: GameStats;
  tick: number;
  wave: number;
}

const file = process.argv[2] || "replay.json";
const replayData = JSON.parse(readFileSync(file, "utf-8"));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

let finishReplay!: (sample: ReplayFinishedSample) => void;
let failReplay!: (error: Error) => void;
const replayFinished = new Promise<ReplayFinishedSample>((resolve, reject) => {
  finishReplay = resolve;
  failReplay = reject;
});

await page.exposeFunction("__onReplayFinished", (sample: ReplayFinishedSample) => {
  finishReplay(sample);
});

page.on("close", () => failReplay(new Error("Browser page closed before replay finished")));
browser.on("disconnected", () => failReplay(new Error("Browser disconnected before replay finished")));

await page.goto("http://localhost:5173/dubai-missile-command/");
await page.waitForFunction(() => typeof window.__loadReplay === "function");

await page.evaluate((data) => {
  window.__loadReplay!(data);
}, replayData);

console.log(`Replay started (seed ${replayData.seed}, ${replayData.actions.length} actions)`);

try {
  const result = await replayFinished;
  const totalKills = result.stats.missileKills + result.stats.droneKills;
  const hitRatio = result.stats.shotsFired > 0 ? Math.round((totalKills / result.stats.shotsFired) * 100) : 0;

  console.log("Replay finished");
  console.log(`  Wave: ${result.wave}`);
  console.log(`  Score: ${result.score}`);
  console.log(`  Tick: ${result.tick}`);
  console.log(`  Kills: ${totalKills}`);
  console.log(`  Shots fired: ${result.stats.shotsFired}`);
  console.log(`  Hit ratio: ${hitRatio}%`);
  console.log(`  Missile kills: ${result.stats.missileKills}`);
  console.log(`  Drone kills: ${result.stats.droneKills}`);
  console.log(`  Multi shots: ${result.stats.multiShots}`);
  console.log(`  Max combo: ${result.stats.maxCombo}`);
} finally {
  await browser.close();
}
