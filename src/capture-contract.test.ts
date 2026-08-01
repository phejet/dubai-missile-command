import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureFixture } from "../test-fixtures/capture";
import { validateCaptureBody } from "./capture-contract";

export function validate(value: unknown, headers: { build?: string; install?: string; sha?: string } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sha = createHash("sha256").update(bytes).digest("hex");
  return validateCaptureBody(
    bytes,
    {
      build: headers.build ?? "build+dirty",
      install: headers.install ?? "12345678-abcd",
      sha256: headers.sha ?? sha,
    },
    sha,
  );
}

describe("capture contract", () => {
  it("accepts a complete envelope and identifies ephemeral installs", () => {
    expect(validate(captureFixture())).toMatchObject({ ok: true, installId: "12345678-abcd", ephemeral: false });
    const ephemeral = captureFixture();
    ephemeral.meta.installId = "eph-12345678";
    expect(validate(ephemeral, { install: ephemeral.meta.installId })).toMatchObject({ ok: true, ephemeral: true });
  });

  it.each([
    [
      "missing projected field",
      (value: ReturnType<typeof captureFixture>) => delete (value.meta as Partial<typeof value.meta>).platform,
    ],
    ["unsafe capture id", (value: ReturnType<typeof captureFixture>) => (value.captureId = "../../etc/x")],
    ["unsafe install id", (value: ReturnType<typeof captureFixture>) => (value.meta.installId = "../bad")],
    ["wrong number type", (value: ReturnType<typeof captureFixture>) => ((value.summary!.score as unknown) = "banana")],
    ["unsafe integer", (value: ReturnType<typeof captureFixture>) => (value.summary!.score = 1e100)],
    ["out-of-range ratio", (value: ReturnType<typeof captureFixture>) => (value.summary!.hitRatio = 2)],
    ["unknown enum", (value: ReturnType<typeof captureFixture>) => ((value.meta.trigger as unknown) = "telepathy")],
    ["partial/outcome mismatch", (value: ReturnType<typeof captureFixture>) => (value.meta.partial = true)],
    ["null install", (value: ReturnType<typeof captureFixture>) => ((value.meta.installId as unknown) = null)],
  ])("rejects %s", (_name, mutate) => {
    const value = captureFixture();
    mutate(value);
    expect(validate(value)).toMatchObject({ ok: false, stage: "parse" });
  });

  it("distinguishes hash failures and header disagreements", () => {
    expect(validate(captureFixture(), { sha: "0".repeat(64) })).toMatchObject({ ok: false, stage: "hash" });
    expect(validate(captureFixture(), { build: "other" })).toMatchObject({ ok: false, stage: "parse" });
    expect(validate(captureFixture(), { install: "other-install" })).toMatchObject({ ok: false, stage: "parse" });
  });
});
