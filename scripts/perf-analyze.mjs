#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "perf-results/runs";
const LONG_FRAME_16_MS = 16.67;
const LONG_FRAME_33_MS = 33;
const ENTITY_KEYS = ["missiles", "drones", "interceptors", "particles", "explosions"];

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
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

function summarizeFrames(frames) {
  const values = frames
    .map((frame) => frame.frameMs)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);

  return {
    p50: roundMetric(quantile(values, 0.5)),
    p95: roundMetric(quantile(values, 0.95)),
    p99: roundMetric(quantile(values, 0.99)),
    longFrameCount16: values.filter((value) => value > LONG_FRAME_16_MS).length,
    longFrameCount33: values.filter((value) => value > LONG_FRAME_33_MS).length,
  };
}

function pearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (let index = 0; index < xs.length; index++) {
    const dx = xs[index] - xMean;
    const dy = ys[index] - yMean;
    numerator += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }

  if (xVariance === 0 || yVariance === 0) return 0;
  return numerator / Math.sqrt(xVariance * yVariance);
}

function buildDeviceHash(report) {
  const payload = JSON.stringify(report.deviceInfo ?? {});
  return createHash("sha1").update(payload).digest("hex").slice(0, 10);
}

function getBuildId(report) {
  if (typeof report.buildId === "string" && report.buildId.trim()) return report.buildId.trim();
  if (typeof report._buildId === "string" && report._buildId.trim()) return report._buildId.trim();
  return "unknown";
}

function isPerfReport(report) {
  return (
    report &&
    typeof report === "object" &&
    report.schemaVersion === 1 &&
    typeof report.replayId === "string" &&
    Array.isArray(report.frames)
  );
}

async function collectJsonFiles(entryPath, files) {
  const entryStat = await stat(entryPath);
  if (entryStat.isDirectory()) {
    const children = await readdir(entryPath);
    for (const child of children.sort()) {
      await collectJsonFiles(path.join(entryPath, child), files);
    }
    return;
  }

  if (entryStat.isFile() && entryPath.endsWith(".json")) {
    files.push(entryPath);
  }
}

async function loadReports(inputPaths) {
  const files = [];
  for (const inputPath of inputPaths) {
    await collectJsonFiles(inputPath, files);
  }

  const reports = [];
  for (const file of files) {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      if (!isPerfReport(parsed)) continue;
      reports.push({
        buildId: getBuildId(parsed),
        deviceHash: buildDeviceHash(parsed),
        file,
        report: parsed,
      });
    } catch (error) {
      console.warn(`[perf-analyze] Skipping ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return reports;
}

function groupReports(loadedReports) {
  const groups = new Map();
  for (const loaded of loadedReports) {
    const key = `${loaded.report.replayId}::${loaded.buildId}::${loaded.deviceHash}`;
    if (!groups.has(key)) {
      groups.set(key, {
        buildId: loaded.buildId,
        deviceHash: loaded.deviceHash,
        files: [],
        replayId: loaded.report.replayId,
        reports: [],
      });
    }
    const group = groups.get(key);
    group.files.push(loaded.file);
    group.reports.push(loaded.report);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.replayId !== b.replayId) return a.replayId.localeCompare(b.replayId);
    if (a.buildId !== b.buildId) return a.buildId.localeCompare(b.buildId);
    return a.deviceHash.localeCompare(b.deviceHash);
  });
}

function buildCorrelationSummary(frames) {
  const frameMsValues = frames.map((frame) => frame.frameMs);
  return ENTITY_KEYS.map((key) => {
    const values = frames.map((frame) => Number(frame[key] ?? 0));
    return `${key}=${roundMetric(pearsonCorrelation(frameMsValues, values)).toFixed(3)}`;
  }).join(" ");
}

function printGroup(group) {
  const frames = group.reports.flatMap((report) => report.frames ?? []);
  const summary = summarizeFrames(frames);
  const deviceLabel = group.reports[0]?.deviceInfo?.ua || "unknown device";

  console.log(`${group.replayId} | build ${group.buildId} | device ${group.deviceHash}`);
  console.log(`  runs=${group.reports.length} frames=${frames.length}`);
  console.log(`  p50=${summary.p50.toFixed(3)}ms p95=${summary.p95.toFixed(3)}ms p99=${summary.p99.toFixed(3)}ms`);
  console.log(`  long>16.67=${summary.longFrameCount16} long>33=${summary.longFrameCount33}`);
  console.log(`  corr ${buildCorrelationSummary(frames)}`);
  console.log(`  ua ${deviceLabel}`);
  for (const file of group.files) {
    console.log(`  file ${file}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const inputPaths = args.length > 0 ? args : [DEFAULT_INPUT];
  const loadedReports = await loadReports(inputPaths);
  if (loadedReports.length === 0) {
    console.error(`[perf-analyze] No schema-v1 perf reports found under: ${inputPaths.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const groups = groupReports(loadedReports);
  for (const [index, group] of groups.entries()) {
    if (index > 0) console.log("");
    printGroup(group);
  }
}

main().catch((error) => {
  console.error(`[perf-analyze] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
