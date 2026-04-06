import { chromium } from "playwright";
import { readFileSync } from "fs";

const file = process.argv[2] || "replay.json";
const replayData = JSON.parse(readFileSync(file, "utf-8"));

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto("http://localhost:5173/dubai-missile-command/");
await page.waitForTimeout(1000);

await page.evaluate((data) => {
  window.__loadReplay(data);
}, replayData);

console.log(`Replay started (seed ${replayData.seed}, ${replayData.actions.length} actions)`);
console.log("Close the browser window when done.");

page.on("close", () => process.exit(0));
browser.on("disconnected", () => process.exit(0));
