import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("capture Worker deployment gates", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");

  it("uses separate repository-visible staging and production switches", () => {
    expect(workflow).toContain("vars.CAPTURE_STAGING_PROVISIONED == 'true'");
    expect(workflow).toContain("vars.CAPTURE_PRODUCTION_PROVISIONED == 'true'");
    expect(workflow).not.toContain("vars.CAPTURE_WORKER_PROVISIONED");
  });
});
