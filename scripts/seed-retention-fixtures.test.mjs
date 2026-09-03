import { describe, expect, it } from "vitest";
import { assertStagingTarget, createFixtureManifest } from "./seed-retention-fixtures.mjs";

describe("Staging retention fixture guard", () => {
  const staging = {
    environment: "staging",
    database: "dmc-captures-staging",
    bucket: "dmc-captures-staging",
    config: "worker/wrangler.jsonc",
  };

  it("requires the exact Staging bindings and an explicit confirmation", () => {
    expect(assertStagingTarget(staging, true)).toBe(staging);
    expect(() => assertStagingTarget(staging, false)).toThrow("only the explicit Staging");
    expect(() => assertStagingTarget({ ...staging, database: "dmc-captures" }, true)).toThrow(
      "only the explicit Staging",
    );
  });

  it("creates every requested boundary and a deduplicated replay/report reference", () => {
    const manifest = createFixtureManifest(2_000_000_000_000);
    expect(manifest.sessions.map((row) => row.age)).toEqual([89, 91, 269, 271, 364, 366]);
    expect(manifest.sessions[0].replaySha).toBe(manifest.sessions[1].replaySha);
    expect(manifest.report.replaySha).toBe(manifest.sessions[0].replaySha);
    expect(manifest.deletionJob.jobId).toContain("retention-proof-");
    expect(new Set(manifest.objects.map((object) => object.key)).size).toBe(manifest.objects.length);
  });
});
