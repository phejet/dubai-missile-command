#!/usr/bin/env node

import { watch } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(process.cwd(), "perf-results", "runs");
const DEFAULT_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 500;

function printUsage() {
  console.log(`Usage: node scripts/perf-wait.mjs --run-id <runId> [--root <dir>] [--timeout-ms <ms>]

Waits for a schema-v1 perf report file whose basename ends with "-<runId>.json".
Outputs a single JSON object describing the matched report.`);
}

function parseArgs(argv) {
  const options = {
    root: DEFAULT_ROOT,
    runId: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = argv[index + 1] ?? "";
      index++;
      continue;
    }
    if (arg === "--root") {
      options.root = path.resolve(argv[index + 1] ?? "");
      index++;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(argv[index + 1] ?? "", 10);
      index++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getBuildId(report, filePath) {
  if (typeof report.buildId === "string" && report.buildId.trim()) return report.buildId.trim();
  if (typeof report._buildId === "string" && report._buildId.trim()) return report._buildId.trim();
  return path.basename(path.dirname(filePath));
}

function getDeviceHash(filePath, runId) {
  const basename = path.basename(filePath, ".json");
  const suffix = `-${runId}`;
  if (basename.endsWith(suffix)) {
    return basename.slice(0, -suffix.length);
  }
  return basename;
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
  const entryStat = await stat(entryPath).catch(() => null);
  if (!entryStat) return;

  if (entryStat.isDirectory()) {
    const entries = await readdir(entryPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      await collectJsonFiles(path.join(entryPath, entry.name), files);
    }
    return;
  }

  if (entryStat.isFile() && entryPath.endsWith(".json")) {
    files.push(entryPath);
  }
}

async function findReportFile(root, runId) {
  const files = [];
  await collectJsonFiles(root, files);
  const matchSuffix = `-${runId}.json`;
  return files.find((file) => path.basename(file).endsWith(matchSuffix)) ?? null;
}

async function readMatchedReport(filePath, runId) {
  const raw = await readFile(filePath, "utf8");
  const report = JSON.parse(raw);
  if (!isPerfReport(report)) {
    throw new Error(`Matched file is not a schema-v1 perf report: ${filePath}`);
  }

  const relativeFile = path.relative(process.cwd(), filePath);
  const latestStableFile = path.relative(
    process.cwd(),
    path.join(process.cwd(), "perf-results", "latest", `${report.replayId}.json`),
  );

  return {
    buildId: getBuildId(report, filePath),
    deviceHash: getDeviceHash(filePath, runId),
    file: relativeFile,
    latestStableFile,
    replayId: report.replayId,
    runId,
    summary: report.summary,
  };
}

async function waitForReport(root, runId, timeoutMs) {
  await mkdir(root, { recursive: true });

  const immediateMatch = await findReportFile(root, runId);
  if (immediateMatch) {
    return readMatchedReport(immediateMatch, runId);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let scanPending = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearInterval(pollId);
      clearTimeout(timeoutId);
      watcher.close();
      callback(value);
    };

    const scan = async () => {
      if (scanPending || settled) return;
      scanPending = true;
      try {
        const matchedFile = await findReportFile(root, runId);
        if (matchedFile) {
          const report = await readMatchedReport(matchedFile, runId);
          finish(resolve, report);
        }
      } catch (error) {
        finish(reject, error);
      } finally {
        scanPending = false;
      }
    };

    const watcher = watch(root, { recursive: true }, () => {
      void scan();
    });
    const pollId = setInterval(() => {
      void scan();
    }, POLL_INTERVAL_MS);
    const timeoutId = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting ${timeoutMs}ms for perf report runId=${runId}`));
    }, timeoutMs);

    void scan();
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.runId) {
    throw new Error("--run-id is required");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }

  const report = await waitForReport(options.root, options.runId, options.timeoutMs);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(`[perf-wait] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
