import { describe, expect, it } from "vitest";
import {
  assertStagingProbeTarget,
  parseArgs,
  PROBE_KEY_PATTERN,
  STAGING_R2_CLOCK_TARGET,
  validateProbeResult,
} from "./probe-r2-upload-clock.mjs";

describe("R2 upload-clock proof guard", () => {
  it("accepts only the exact Staging account and bucket with confirmation", () => {
    expect(assertStagingProbeTarget(STAGING_R2_CLOCK_TARGET, true)).toBe(STAGING_R2_CLOCK_TARGET);
    expect(() => assertStagingProbeTarget(STAGING_R2_CLOCK_TARGET, false)).toThrow("only the explicit Staging");
    expect(() => assertStagingProbeTarget({ ...STAGING_R2_CLOCK_TARGET, bucket: "dmc-captures" }, true)).toThrow(
      "only the explicit Staging",
    );
  });

  it("requires explicit CLI confirmation and a mode-limited evidence location", () => {
    expect(() => parseArgs(["run"])).toThrow("Usage");
    expect(() => parseArgs(["run", "--confirm-staging", "--out=../outside.json"])).toThrow("under operator-results");
  });

  it("allows only randomized keys under the isolated replay-canary prefix", () => {
    expect(PROBE_KEY_PATTERN.test("replays/retention-clock-proof-550e8400-e29b-41d4-a716-446655440000.json")).toBe(
      true,
    );
    expect(PROBE_KEY_PATTERN.test("replays/genuine.json.gz")).toBe(false);
    expect(PROBE_KEY_PATTERN.test("diagnostics/retention-clock-proof-550e8400-e29b-41d4-a716-446655440000.json")).toBe(
      false,
    );
  });

  it("requires an advanced upload clock, changed version, equal payload size, and verified cleanup", () => {
    expect(
      validateProbeResult({
        ok: true,
        firstUploadedMs: 1_000,
        secondUploadedMs: 2_500,
        versionChanged: true,
        samePayloadSize: true,
        deleted: true,
      }),
    ).toEqual({
      firstUploadedMs: 1_000,
      secondUploadedMs: 2_500,
      uploadAdvancedMs: 1_500,
      versionChanged: true,
      samePayloadSize: true,
      deleted: true,
    });
    expect(() =>
      validateProbeResult({
        ok: true,
        firstUploadedMs: 1_000,
        secondUploadedMs: 1_000,
        versionChanged: true,
        samePayloadSize: true,
        deleted: true,
      }),
    ).toThrow("did not advance");
    expect(() =>
      validateProbeResult({
        ok: true,
        firstUploadedMs: 1_000,
        secondUploadedMs: 2_500,
        versionChanged: false,
        samePayloadSize: true,
        deleted: true,
      }),
    ).toThrow("did not advance");
  });
});
