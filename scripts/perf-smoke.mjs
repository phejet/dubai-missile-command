#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://localhost:5173/dubai-missile-command/";
const DEFAULT_REPLAY = "perf-wave1";
const DEFAULT_TIMEOUT_MS = 180000;

function resolveReplayPath(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return `/replays/${DEFAULT_REPLAY}.json`;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.endsWith(".json")) return `/replays/${trimmed}`;
  return `/replays/${trimmed}.json`;
}

function buildPerfUrl(baseUrl, replayPath, runId) {
  const url = new URL(baseUrl);
  url.searchParams.set("perf", "1");
  url.searchParams.set("replay", replayPath);
  url.searchParams.set("autoquit", "1");
  url.searchParams.set("runId", runId);
  return url.toString();
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

async function collectJsonFiles(dirPath, files) {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectJsonFiles(nextPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(nextPath);
    }
  }
}

async function findReportForRun(runId, timeoutMs) {
  const startedAt = Date.now();
  const perfRunsDir = path.resolve(process.cwd(), "perf-results", "runs");
  while (Date.now() - startedAt < timeoutMs) {
    const files = [];
    await collectJsonFiles(perfRunsDir, files);
    const match = files.find((file) => file.endsWith(`-${runId}.json`));
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function main() {
  const replayArg = process.argv[2];
  const baseUrlArg = process.argv[3];
  const timeoutArg = process.argv[4];
  const replayPath = resolveReplayPath(replayArg);
  const runId = `smoke-${Date.now().toString(36)}`;
  const baseUrl = baseUrlArg || process.env.PERF_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = Number(timeoutArg || process.env.PERF_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const perfUrl = buildPerfUrl(baseUrl, replayPath, runId);

  const requests = [];
  const perfResponses = [];
  const pageErrors = [];
  const consoleMessages = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on("console", (message) => {
      consoleMessages.push({ text: message.text(), type: message.type() });
    });
    page.on("pageerror", (error) => {
      pageErrors.push(String(error));
    });
    page.on("request", (request) => {
      if (!request.url().includes("/api/save-perf")) return;
      requests.push({ method: request.method(), url: request.url() });
    });
    page.on("response", async (response) => {
      if (!response.url().includes("/api/save-perf")) return;
      const body = await response.text().catch(() => "");
      perfResponses.push({
        body,
        status: response.status(),
        url: response.url(),
      });
    });

    await page.goto(perfUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const banner = document.getElementById("perf-status-banner");
        return banner && /DONE|PERF ERROR/.test(banner.textContent || "");
      },
      null,
      { timeout: timeoutMs },
    );

    const bannerText = await page.locator("#perf-status-banner").innerText();
    const perfResponse = perfResponses.at(-1);
    let perfPayload = null;
    if (perfResponse?.body) {
      try {
        perfPayload = JSON.parse(perfResponse.body);
      } catch {
        perfPayload = null;
      }
    }
    const relativeFile = typeof perfPayload?.file === "string" ? perfPayload.file : null;
    const latestFile = typeof perfPayload?.latestFile === "string" ? perfPayload.latestFile : null;

    const reportPath = relativeFile ? path.resolve(process.cwd(), relativeFile) : await findReportForRun(runId, 5000);
    if (!reportPath) {
      throw new Error(`Perf smoke reached ${bannerText} but no run report was written for ${runId}`);
    }

    const reportReady = await waitForFile(reportPath, 5000);
    if (!reportReady) {
      throw new Error(`Perf smoke did not find report file ${reportPath}`);
    }

    const latestPath = latestFile ? path.resolve(process.cwd(), latestFile) : null;
    const latestReady = latestPath ? await waitForFile(latestPath, 5000) : false;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    console.log(
      JSON.stringify(
        {
          banner: bannerText,
          latestFile: latestReady && latestFile ? latestFile : null,
          replayPath,
          requests,
          reportFile: path.relative(process.cwd(), reportPath),
          runId,
          summary: report.summary,
        },
        null,
        2,
      ),
    );

    if (pageErrors.length > 0) {
      console.error(JSON.stringify({ consoleMessages, pageErrors }, null, 2));
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
