#!/usr/bin/env node

import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

import { applyGpuTraceProfile } from "./perf-trace-profile.mjs";

const DEFAULT_BASE_URL = "http://localhost:5173/dubai-missile-command/";
const DEFAULT_REPLAY = "perf-wave1";
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_TRACE_CAPTURE_MODE = "chromium-headless";
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "toplevel",
  "gpu",
  "cc",
  "viz",
  "blink.user_timing",
].join(",");

function roundMetric(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0] ?? 0;
  const index = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lowerValue = sortedValues[lowerIndex] ?? sortedValues[sortedValues.length - 1] ?? 0;
  const upperValue = sortedValues[upperIndex] ?? lowerValue;
  if (lowerIndex === upperIndex) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex);
}

function summarizeFrameMetric(frames, key) {
  const values = frames
    .map((frame) => Number(frame[key]))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  return {
    avg: roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length),
    max: roundMetric(values[values.length - 1] ?? 0),
    p50: roundMetric(quantile(values, 0.5)),
    p95: roundMetric(quantile(values, 0.95)),
    p99: roundMetric(quantile(values, 0.99)),
    samples: values.length,
    total: roundMetric(values.reduce((sum, value) => sum + value, 0)),
  };
}

function resolveReplayPath(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return `/replays/${DEFAULT_REPLAY}.json`;
  if (trimmed.startsWith("/")) return trimmed;
  if (trimmed.endsWith(".json")) return `/replays/${trimmed}`;
  return `/replays/${trimmed}.json`;
}

function buildPerfUrl(baseUrl, replayPath, runId, options = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("perf", "1");
  url.searchParams.set("replay", replayPath);
  url.searchParams.set("autoquit", "1");
  url.searchParams.set("runId", runId);
  if (options.perfSink) {
    url.searchParams.set("perfSink", options.perfSink);
  }
  return url.toString();
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractConsolePerfReport(consoleMessages) {
  const match = [...consoleMessages]
    .reverse()
    .find(
      (message) =>
        message.type === "log" && typeof message.text === "string" && message.text.startsWith("PERF_REPORT_V1 "),
    );
  if (!match) return null;
  return parseJsonSafe(match.text.slice("PERF_REPORT_V1 ".length));
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

async function persistReport(reportPath, latestPath, report) {
  const serialized = JSON.stringify(report, null, 2);
  await writeFile(reportPath, serialized);
  if (latestPath) {
    await writeFile(latestPath, serialized);
  }
}

async function startChromiumTrace(page) {
  const client = await page.context().newCDPSession(page);
  const traceEvents = [];
  let stopped = false;
  await client.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    transferMode: "ReportEvents",
  });
  client.on("Tracing.dataCollected", (event) => {
    if (!Array.isArray(event.value)) return;
    traceEvents.push(...event.value);
  });
  const completed = new Promise((resolve) => {
    client.once("Tracing.tracingComplete", resolve);
  });

  return {
    async stop() {
      if (stopped) return traceEvents;
      stopped = true;
      await client.send("Tracing.end");
      await completed;
      return traceEvents;
    },
  };
}

async function runPerfPass({ baseUrl, captureTrace, launchOptions, perfSink, replayPath, runId, timeoutMs }) {
  const browser = await chromium.launch(launchOptions);
  const consoleMessages = [];
  const pageErrors = [];
  const perfResponses = [];
  const requests = [];
  const perfUrl = buildPerfUrl(baseUrl, replayPath, runId, { perfSink });
  let traceController = null;
  let traceEvents = null;

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    if (captureTrace) {
      traceController = await startChromiumTrace(page);
    }

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

    if (traceController) {
      traceEvents = await traceController.stop();
      traceController = null;
    }

    return {
      bannerText: await page.locator("#perf-status-banner").innerText(),
      consoleMessages,
      pageErrors,
      perfPayload: parseJsonSafe(perfResponses.at(-1)?.body || ""),
      perfReportFromConsole: extractConsolePerfReport(consoleMessages),
      requests,
      traceEvents,
    };
  } finally {
    if (traceController) {
      await traceController.stop().catch(() => {});
    }
    await browser.close();
  }
}

function findNearestTick(sortedTicks, targetTick) {
  if (sortedTicks.length === 0 || !Number.isFinite(targetTick)) return null;
  let low = 0;
  let high = sortedTicks.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const value = sortedTicks[mid];
    if (value === targetTick) return value;
    if (value < targetTick) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const left = high >= 0 ? sortedTicks[high] : null;
  const right = low < sortedTicks.length ? sortedTicks[low] : null;
  if (left === null) return right;
  if (right === null) return left;
  return Math.abs(targetTick - left) <= Math.abs(right - targetTick) ? left : right;
}

function mergeGpuFrames(targetFrames, sourceFrames) {
  const framesByTick = new Map();
  for (const frame of sourceFrames) {
    const tick = Number(frame.tick);
    if (!Number.isFinite(tick)) continue;
    if (!framesByTick.has(tick)) framesByTick.set(tick, []);
    framesByTick.get(tick).push(frame);
  }

  const sortedTicks = [...framesByTick.keys()].sort((a, b) => a - b);
  const usageByTick = new Map();
  let matchedFrames = 0;
  let fallbackMatches = 0;

  for (const frame of targetFrames) {
    const tick = Number(frame.tick);
    let resolvedTick = Number.isFinite(tick) ? tick : null;
    if (resolvedTick === null || !framesByTick.has(resolvedTick)) {
      resolvedTick = findNearestTick(sortedTicks, tick);
      if (resolvedTick === null) continue;
      fallbackMatches++;
    }

    const candidates = framesByTick.get(resolvedTick) ?? [];
    if (candidates.length === 0) continue;
    const usageIndex = usageByTick.get(resolvedTick) ?? 0;
    const sourceFrame = candidates[Math.min(usageIndex, candidates.length - 1)];
    usageByTick.set(resolvedTick, usageIndex + 1);

    if (Number.isFinite(sourceFrame.gpuMs)) frame.gpuMs = sourceFrame.gpuMs;
    if (Number.isFinite(sourceFrame.presentMs)) frame.presentMs = sourceFrame.presentMs;
    matchedFrames++;
  }

  return { fallbackMatches, matchedFrames };
}

async function main() {
  const replayArg = process.argv[2];
  const baseUrlArg = process.argv[3];
  const timeoutArg = process.argv[4];
  const replayPath = resolveReplayPath(replayArg);
  const runId = `smoke-${Date.now().toString(36)}`;
  const baseUrl = baseUrlArg || process.env.PERF_BASE_URL || DEFAULT_BASE_URL;
  const timeoutMs = Number(timeoutArg || process.env.PERF_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const captureGpuTrace = process.env.PERF_CAPTURE_GPU !== "0";
  const saveRawTrace = process.env.PERF_SAVE_TRACE === "1";

  const primaryPass = await runPerfPass({
    baseUrl,
    captureTrace: false,
    launchOptions: { headless: true },
    replayPath,
    runId,
    timeoutMs,
  });

  const relativeFile = typeof primaryPass.perfPayload?.file === "string" ? primaryPass.perfPayload.file : null;
  const latestFile =
    typeof primaryPass.perfPayload?.latestFile === "string" ? primaryPass.perfPayload.latestFile : null;
  const reportPath = relativeFile ? path.resolve(process.cwd(), relativeFile) : await findReportForRun(runId, 5000);
  if (!reportPath) {
    throw new Error(`Perf smoke reached ${primaryPass.bannerText} but no run report was written for ${runId}`);
  }

  const reportReady = await waitForFile(reportPath, 5000);
  if (!reportReady) {
    throw new Error(`Perf smoke did not find report file ${reportPath}`);
  }

  const latestPath = latestFile ? path.resolve(process.cwd(), latestFile) : null;
  const report = JSON.parse(await readFile(reportPath, "utf8"));

  let gpuCaptureNote = null;
  if (captureGpuTrace) {
    try {
      const traceRunId = `${runId}-gpu`;
      const tracePass = await runPerfPass({
        baseUrl,
        captureTrace: true,
        launchOptions: { channel: "chromium", headless: true },
        perfSink: "console",
        replayPath,
        runId: traceRunId,
        timeoutMs,
      });

      const traceReport = tracePass.perfReportFromConsole;
      if (!traceReport) {
        gpuCaptureNote = "GPU trace completed but the console perf report was not captured";
      } else if (!Array.isArray(tracePass.traceEvents) || tracePass.traceEvents.length === 0) {
        gpuCaptureNote = "GPU trace completed but no trace events were collected";
      } else {
        const traceResult = applyGpuTraceProfile(traceReport, tracePass.traceEvents, {
          captureMode: DEFAULT_TRACE_CAPTURE_MODE,
        });
        if (!traceResult.applied) {
          gpuCaptureNote = traceResult.reason;
        } else {
          const mergeResult = mergeGpuFrames(report.frames ?? [], traceReport.frames ?? []);
          report.gpuProfile = {
            ...traceReport.gpuProfile,
            frameCount: report.frames?.length ?? 0,
            gpuSummary: summarizeFrameMetric(report.frames ?? [], "gpuMs"),
            notes: [
              ...(traceReport.gpuProfile?.notes ?? []),
              `GPU trace was captured in a second ${DEFAULT_TRACE_CAPTURE_MODE} pass and merged onto the primary perf report by replay tick.`,
              `Matched ${mergeResult.matchedFrames} frames; ${mergeResult.fallbackMatches} used nearest-tick fallback.`,
            ],
            presentSummary: summarizeFrameMetric(report.frames ?? [], "presentMs"),
          };
          await persistReport(reportPath, latestPath, report);
          if (saveRawTrace) {
            const tracePath = reportPath.replace(/\.json$/i, ".trace.json");
            await writeFile(tracePath, JSON.stringify({ traceEvents: tracePass.traceEvents }, null, 2));
          }
        }
      }

      if (tracePass.pageErrors.length > 0) {
        console.error(
          JSON.stringify({ consoleMessages: tracePass.consoleMessages, pageErrors: tracePass.pageErrors }, null, 2),
        );
        process.exitCode = 1;
      }
    } catch (error) {
      gpuCaptureNote = `GPU trace disabled: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const gpuSummary = report.gpuProfile?.gpuSummary;
  const presentSummary = report.gpuProfile?.presentSummary;
  console.log(
    JSON.stringify(
      {
        banner: primaryPass.bannerText,
        gpu: gpuSummary
          ? {
              captureMode: report.gpuProfile?.captureMode || null,
              p50: roundMetric(gpuSummary.p50),
              p95: roundMetric(gpuSummary.p95),
              presentP95: Number.isFinite(presentSummary?.p95) ? roundMetric(presentSummary.p95) : null,
            }
          : null,
        gpuCaptureNote,
        latestFile: latestFile || null,
        replayPath,
        requests: primaryPass.requests,
        reportFile: path.relative(process.cwd(), reportPath),
        runId,
        summary: report.summary,
      },
      null,
      2,
    ),
  );

  if (primaryPass.pageErrors.length > 0) {
    console.error(
      JSON.stringify({ consoleMessages: primaryPass.consoleMessages, pageErrors: primaryPass.pageErrors }, null, 2),
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
