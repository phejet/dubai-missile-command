import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";

type Operation = {
  test: string;
  retry: number;
  category: string;
  operation: string;
  location: string;
  duration: number;
};

/** Browser protocol timings only: no screenshots/tracing that would distort rendering cost. */
export default class TimingReporter implements Reporter {
  private operations: Operation[] = [];

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    if (!["pw:api", "expect"].includes(step.category) || step.duration < 100) return;
    this.operations.push({
      test: test.title,
      retry: result.retry,
      category: step.category,
      operation: step.title,
      location: step.location ? `${step.location.file}:${step.location.line}` : "",
      duration: step.duration,
    });
  }

  onEnd() {
    this.operations.sort((a, b) => b.duration - a.duration);
    mkdirSync("playwright-report", { recursive: true });
    writeFileSync("playwright-report/operations.json", JSON.stringify(this.operations, null, 2));
    const escape = (text: string) => text.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
    const rows = this.operations
      .slice(0, 30)
      .map(
        (op) =>
          `| ${escape(op.test)} | ${escape(op.operation)} | ${escape(op.location)} | ${(op.duration / 1000).toFixed(2)}s |`,
      );
    const summary = [
      "## Slow browser operations",
      "",
      "Operations over 100ms are saved in operations.json. Nested operations may overlap; durations must not be summed.",
      "",
      "| Test | Operation | Source | Duration |",
      "| --- | --- | --- | ---: |",
      ...rows,
      "",
    ].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}
