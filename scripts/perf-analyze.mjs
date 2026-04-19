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

function summaryFromReport(report) {
  const summary = report?.summary;
  if (
    summary &&
    Number.isFinite(summary.p50) &&
    Number.isFinite(summary.p95) &&
    Number.isFinite(summary.p99) &&
    Number.isFinite(summary.longFrameCount16) &&
    Number.isFinite(summary.longFrameCount33)
  ) {
    return {
      longFrameCount16: Number(summary.longFrameCount16),
      longFrameCount33: Number(summary.longFrameCount33),
      p50: roundMetric(Number(summary.p50)),
      p95: roundMetric(Number(summary.p95)),
      p99: roundMetric(Number(summary.p99)),
    };
  }
  return summarizeFrames(report.frames ?? []);
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

function summarizeLoadedReport(loaded) {
  return {
    buildId: loaded.buildId,
    deviceHash: loaded.deviceHash,
    file: loaded.file,
    replayId: loaded.report.replayId,
    summary: summaryFromReport(loaded.report),
    ua: loaded.report.deviceInfo?.ua || "unknown device",
  };
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

function printUsage() {
  console.log(`Usage:
  node scripts/perf-analyze.mjs [path ...]
  node scripts/perf-analyze.mjs --compare <candidate-report-or-dir> --baseline <baseline-report-or-dir>

Default mode prints grouped summaries for schema-v1 perf reports.
Compare mode matches a candidate report against a baseline report with the same replayId and device hash.`);
}

function parseArgs(argv) {
  const options = {
    baseline: null,
    compare: null,
    help: false,
    inputs: [],
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--compare") {
      options.compare = argv[index + 1] ?? null;
      index++;
      continue;
    }
    if (arg === "--baseline") {
      options.baseline = argv[index + 1] ?? null;
      index++;
      continue;
    }
    options.inputs.push(arg);
  }

  return options;
}

async function loadSingleReport(inputPath) {
  const reports = await loadReports([inputPath]);
  if (reports.length === 0) {
    throw new Error(`No schema-v1 perf report found under: ${inputPath}`);
  }
  if (reports.length > 1) {
    throw new Error(`Expected exactly one perf report under ${inputPath}, found ${reports.length}`);
  }
  return summarizeLoadedReport(reports[0]);
}

async function findMatchingBaseline(candidate, baselineInput) {
  const baselineReports = await loadReports([baselineInput]);
  if (baselineReports.length === 0) {
    throw new Error(`No baseline perf reports found under: ${baselineInput}`);
  }

  const matches = baselineReports
    .map((loaded) => summarizeLoadedReport(loaded))
    .filter((report) => report.replayId === candidate.replayId && report.deviceHash === candidate.deviceHash);

  if (matches.length === 0) {
    throw new Error(
      `No baseline report matched replayId=${candidate.replayId} and deviceHash=${candidate.deviceHash} under ${baselineInput}`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Baseline match is ambiguous for replayId=${candidate.replayId} and deviceHash=${candidate.deviceHash} under ${baselineInput}`,
    );
  }
  return matches[0];
}

function formatDelta(candidateValue, baselineValue) {
  const delta = roundMetric(candidateValue - baselineValue);
  const percent = baselineValue === 0 ? 0 : roundMetric((delta / baselineValue) * 100);
  const sign = delta > 0 ? "+" : "";
  const percentSign = percent > 0 ? "+" : "";
  return `${sign}${delta.toFixed(3)}ms (${percentSign}${percent.toFixed(1)}%)`;
}

function printComparison(candidate, baseline) {
  console.log(`${candidate.replayId} | device ${candidate.deviceHash}`);
  console.log(`  baseline build ${baseline.buildId} -> ${baseline.file}`);
  console.log(`  candidate build ${candidate.buildId} -> ${candidate.file}`);
  console.log(`  ua ${candidate.ua}`);
  console.log("");
  console.log("  metric     baseline      candidate     delta");
  console.log(
    `  p50        ${baseline.summary.p50.toFixed(3)}ms    ${candidate.summary.p50.toFixed(3)}ms    ${formatDelta(candidate.summary.p50, baseline.summary.p50)}`,
  );
  console.log(
    `  p95        ${baseline.summary.p95.toFixed(3)}ms    ${candidate.summary.p95.toFixed(3)}ms    ${formatDelta(candidate.summary.p95, baseline.summary.p95)}`,
  );
  console.log(
    `  p99        ${baseline.summary.p99.toFixed(3)}ms    ${candidate.summary.p99.toFixed(3)}ms    ${formatDelta(candidate.summary.p99, baseline.summary.p99)}`,
  );
  console.log(
    `  long>16.67 ${String(baseline.summary.longFrameCount16).padStart(6)}      ${String(candidate.summary.longFrameCount16).padStart(6)}      ${candidate.summary.longFrameCount16 - baseline.summary.longFrameCount16}`,
  );
  console.log(
    `  long>33    ${String(baseline.summary.longFrameCount33).padStart(6)}      ${String(candidate.summary.longFrameCount33).padStart(6)}      ${candidate.summary.longFrameCount33 - baseline.summary.longFrameCount33}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (options.compare) {
    if (!options.baseline) {
      throw new Error("--compare requires --baseline");
    }
    const candidate = await loadSingleReport(options.compare);
    const baseline = await findMatchingBaseline(candidate, options.baseline);
    printComparison(candidate, baseline);
    return;
  }

  const inputPaths = options.inputs.length > 0 ? options.inputs : [DEFAULT_INPUT];
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
