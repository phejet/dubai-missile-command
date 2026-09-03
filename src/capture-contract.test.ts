import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reportFixture, sessionFixture } from "../test-fixtures/capture";
import { serializedBytes, type SessionUpload } from "./capture";
import { validateReportBody, validateSessionBody } from "./capture-contract";
import { sha256HexFallback } from "./sha256";

function compileTimeSessionPrivacy(session: SessionUpload): void {
  // @ts-expect-error Session uploads cannot represent diagnostics, even through a shared helper.
  void session.events;
}
void compileTimeSessionPrivacy;

async function validate(
  kind: "session" | "report",
  value: unknown,
  headers: { build?: string; install?: string; sha?: string } = {},
) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sha = createHash("sha256").update(bytes).digest("hex");
  const input = {
    build: headers.build ?? "build+dirty",
    install: headers.install ?? "12345678-abcd",
    sha256: headers.sha ?? sha,
  };
  return kind === "session" ? validateSessionBody(bytes, input, sha) : validateReportBody(bytes, input, sha);
}

function setAtPath(value: unknown, path: string, replacement: unknown): void {
  const parts = path.split(".");
  let cursor = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts[parts.length - 1]] = replacement;
}

describe("capture contracts", () => {
  it("accepts both products", async () => {
    await expect(validate("session", sessionFixture())).resolves.toMatchObject({ ok: true, ephemeral: false });
    await expect(validate("report", reportFixture())).resolves.toMatchObject({ ok: true, ephemeral: false });
  });

  it("accepts only the reserved emoji feedback set", async () => {
    const accepted = sessionFixture();
    accepted.meta.feedbackEmoji = "🔥";
    await expect(validate("session", accepted)).resolves.toMatchObject({ ok: true });
    const rejected = sessionFixture() as unknown as { meta: Record<string, unknown> };
    rejected.meta.feedbackEmoji = "❤️";
    await expect(validate("session", rejected)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it.each(["events", "eventsUnparsed", "eventsTruncated", "attachments"])(
    "rejects forbidden session key %s",
    async (key) => {
      const value = sessionFixture() as unknown as Record<string, unknown>;
      value[key] = key === "events" || key === "attachments" ? [] : key === "eventsUnparsed" ? 0 : false;
      await expect(validate("session", value)).resolves.toMatchObject({ ok: false, stage: "parse" });
    },
  );

  it("rejects environment metadata on sessions and non-empty report attachments", async () => {
    const session = sessionFixture() as unknown as { meta: Record<string, unknown> };
    session.meta.env = {};
    await expect(validate("session", session)).resolves.toMatchObject({ ok: false, stage: "parse" });
    const replayEnvironment = sessionFixture();
    replayEnvironment.replay!._env = {
      platform: "web",
      native: false,
      ua: "private",
      dpr: 2,
      screenW: 390,
      screenH: 844,
    };
    replayEnvironment.meta.replaySha256 = sha256HexFallback(serializedBytes(replayEnvironment.replay));
    await expect(validate("session", replayEnvironment)).resolves.toMatchObject({ ok: false, stage: "parse" });
    const report = reportFixture();
    (report.attachments as unknown[]).push({ kind: "surprise" });
    await expect(validate("report", report)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it("recomputes the replay hash", async () => {
    const session = sessionFixture();
    session.replay!.seed += 1;
    await expect(validate("session", session)).resolves.toMatchObject({ ok: false, stage: "hash" });
  });

  it("enforces product preconditions and trigger separation", async () => {
    const session = sessionFixture();
    (session.meta.partial as boolean) = true;
    await expect(validate("session", session)).resolves.toMatchObject({ ok: false, stage: "parse" });
    const report = reportFixture();
    (report.meta.trigger as string) = "gameover";
    await expect(validate("report", report)).resolves.toMatchObject({ ok: false, stage: "parse" });
    const replayless = sessionFixture({ replay: null });
    delete replayless.replayOmitted;
    await expect(validate("session", replayless)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it("distinguishes request hash and header failures", async () => {
    await expect(validate("session", sessionFixture(), { sha: "0".repeat(64) })).resolves.toMatchObject({
      ok: false,
      stage: "hash",
    });
    await expect(validate("report", reportFixture(), { build: "other" })).resolves.toMatchObject({
      ok: false,
      stage: "parse",
    });
    const invalidJson = new TextEncoder().encode("not json");
    await expect(
      validateSessionBody(
        invalidJson,
        { build: "build+dirty", install: "12345678-abcd", sha256: "0".repeat(64) },
        "1".repeat(64),
      ),
    ).resolves.toMatchObject({ ok: false, stage: "hash" });
  });

  it.each([
    ["meta.runId", "../unsafe"],
    ["meta.capturedAt", -1],
    ["meta.note", "n".repeat(2_001)],
    ["meta.appScreen", "paused"],
    ["meta.replaySource", "archive"],
    ["meta.platform", ""],
    ["meta.inputClass", "keyboard"],
    ["summary.outcome", "unknown"],
    ["summary.deathCause", "meteor"],
    ["summary.waveReached", -1],
    ["summary.score", "900"],
    ["summary.score", -1],
    ["summary.score", Number.NaN],
    ["summary.score", Infinity],
    ["summary.timePlayedMs", Infinity],
    ["summary.burjHealth", Number.NaN],
    ["summary.shotsFired", 1.5],
    ["summary.totalKills", Number.MAX_SAFE_INTEGER + 1],
    ["summary.hitRatio", 1.01],
    ["summary.multiShots", -1],
    ["summary.maxCombo", 1.5],
    ["summary.destroyedByType.ballisticMissile", -1],
    ["summary.upgrades", {}],
  ])("rejects a hostile session field at %s", async (path, replacement) => {
    const session = sessionFixture();
    setAtPath(session, path as string, replacement);
    await expect(validate("session", session)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it.each([
    ["reportId", "../unsafe"],
    ["meta.runId", "run/unsafe"],
    ["meta.env.dpr", -1],
    ["meta.env.native", "false"],
    ["meta.replayEnv.screenW", Infinity],
    ["eventsUnparsed", -1],
    ["eventsTruncated", "false"],
  ])("rejects a hostile report field at %s", async (path, replacement) => {
    const report = reportFixture();
    setAtPath(report, path as string, replacement);
    await expect(validate("report", report)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it("rejects invalid install IDs and unhoisted report replay environments", async () => {
    await expect(
      validate("session", sessionFixture({ installId: "../unsafe" }), { install: "../unsafe" }),
    ).resolves.toMatchObject({
      ok: false,
      stage: "parse",
    });
    const report = reportFixture();
    report.replay!._env = report.meta.replayEnv;
    report.meta.replaySha256 = sha256HexFallback(serializedBytes(report.replay));
    await expect(validate("report", report)).resolves.toMatchObject({ ok: false, stage: "parse" });
  });

  it.each([null, ""])("rejects a missing or empty install ID (%s)", async (installId) => {
    const session = sessionFixture();
    session.meta.installId = installId;
    await expect(validate("session", session, { install: installId ?? "" })).resolves.toMatchObject({
      ok: false,
      stage: "parse",
    });
  });
});
