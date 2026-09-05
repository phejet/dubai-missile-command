import { readFileSync } from "node:fs";
import { basename } from "node:path";

const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
const cell = (value) => String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

for (const path of process.argv.slice(2)) {
  console.log(`## E2E timings: ${basename(path)}\n`);
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.log("No report produced; inspect the preceding setup/test step.\n");
    continue;
  }
  const attempts = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "skipped") continue;
          attempts.push({
            title: `${spec.file ?? suite.file}:${spec.line} ${spec.title}`,
            project: test.projectName,
            ...result,
          });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  const stats = report.stats;
  console.log(
    `Playwright total (includes server startup): **${seconds(stats.duration)}**. ` +
      `Passed: ${stats.expected}; failed: ${stats.unexpected}; flaky: ${stats.flaky}; skipped: ${stats.skipped}.\n`,
  );
  const starts = attempts.map((attempt) => Date.parse(attempt.startTime)).filter(Number.isFinite);
  if (starts.length) {
    console.log(
      `Before first test (server + worker setup): **${seconds(Math.min(...starts) - Date.parse(stats.startTime))}**.\n`,
    );
  }
  console.log(
    `Summed test-attempt time: **${seconds(attempts.reduce((sum, attempt) => sum + attempt.duration, 0))}** ` +
      "(overlaps when workers run in parallel). npm launch and dependency/browser installation are outside Playwright's total; see workflow step durations.\n",
  );
  console.log("| Slowest attempts | Project | Status | Retry | Duration |\n| --- | --- | --- | ---: | ---: |");
  for (const attempt of attempts.sort((a, b) => b.duration - a.duration).slice(0, 15)) {
    console.log(
      `| ${cell(attempt.title)} | ${cell(attempt.project)} | ${cell(attempt.status)} | ${attempt.retry} | ${seconds(attempt.duration)} |`,
    );
  }
  console.log();
}
