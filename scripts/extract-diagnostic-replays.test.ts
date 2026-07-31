import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReplayArchiveRecords } from "../src/replay-archive";
import type { ReplayData } from "../src/types";
import { extractDiagnosticReplays } from "./extract-diagnostic-replays";

const replay = (version = 11): ReplayData => ({
  version,
  seed: 7,
  actions: [],
  initialState: { metaProgression: { version: 1, completedObjectives: [] }, forcedUpgradeFamilies: [], burjHealth: 7 },
  replayId: "human-label",
  score: 900,
  wave: 3,
});
const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const compress = async (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes));

async function archiveLines(value = replay(), options: { digest?: typeof digest; partChars?: number } = {}) {
  const result = await buildReplayArchiveRecords(
    value,
    { build: "b1", fallbackArchiveId: "fallback-a0" },
    { digest: options.digest ?? digest, compress, partChars: options.partChars },
  );
  if (!result.ok) throw result.error;
  return result.records.map((record, index) => JSON.stringify({ seq: index, boot: "boot-1", t: index, ...record }));
}

async function run(lines: string[]) {
  const root = await mkdtemp(join(tmpdir(), "dmc-extract-"));
  const input = join(root, "diagnostics.jsonl");
  const out = join(root, "out");
  await writeFile(input, `${lines.join("\n")}\n`, "utf8");
  return { root, out, report: await extractDiagnosticReplays([input], out) };
}

describe("diagnostic replay extractor", () => {
  it("recovers clean multipart archives with out-of-order parts and deduplicated envelopes", async () => {
    const lines = await archiveLines(replay(), { partChars: 64 });
    const manifest = lines[0];
    const complete = lines.at(-1)!;
    const parts = lines.slice(1, -1).reverse();
    const { out, report } = await run(["malformed legacy", manifest, ...parts, complete, complete]);

    expect(report.malformedLines).toBe(1);
    expect(report.duplicateEnvelopeRecords).toBe(1);
    expect(report.archives[0]).toMatchObject({ status: "playable", replayVersion: 11 });
    expect(report.archives[0].outputFile).toMatch(/^b1-w3-s900-[a-f0-9]{16}\.json$/);
    const recovered = JSON.parse(await readFile(join(out, report.archives[0].outputFile!), "utf8"));
    expect(recovered).toEqual(replay());
    expect(recovered.replayId).toBe("human-label");
    expect(recovered.archiveId).toBeUndefined();
  });

  it("recovers hashless archives as unverified", async () => {
    const lines = await archiveLines(replay(), { digest: async () => null });
    const { report } = await run(lines);
    expect(report.archives[0]).toMatchObject({ archiveId: "fallback-a0", status: "unverified" });
    expect(report.playableCount).toBe(1);
  });

  it("rejects an unsafe hashless archiveId before constructing an output path", async () => {
    const lines = (await archiveLines(replay(), { digest: async () => null })).map((line) =>
      line.replaceAll("fallback-a0", "../../../tmp/escaped"),
    );
    const { report } = await run(lines);
    expect(report.archives[0]).toMatchObject({ status: "invalid", message: "archiveId is unsafe" });
    expect(report.archives[0].outputFile).toBeUndefined();
  });

  it("writes unsupported versions but never counts them playable", async () => {
    const lines = await archiveLines(replay(10));
    const { out, report } = await run(lines);
    expect(report.archives[0]).toMatchObject({ status: "unsupported-version", replayVersion: 10 });
    expect(report.playableCount).toBe(0);
    expect(await readFile(join(out, report.archives[0].outputFile!), "utf8")).toContain('"version": 10');
  });

  it.each([
    ["missing manifest", (lines: string[]) => lines.slice(1)],
    ["duplicate manifest", (lines: string[]) => [lines[0], ...lines]],
    ["missing completion", (lines: string[]) => lines.slice(0, -1)],
    ["missing part", (lines: string[]) => lines.filter((_, index) => index !== 1)],
    ["duplicate part", (lines: string[]) => [lines[0], lines[1], ...lines.slice(1)]],
  ])("rejects %s", async (_name, mutate) => {
    const lines = await archiveLines(replay(), { partChars: 64 });
    const renumbered = mutate(lines).map((line, index) => JSON.stringify({ ...JSON.parse(line), seq: 100 + index }));
    const { report } = await run(renumbered);
    expect(report.playableCount).toBe(0);
    expect(["incomplete", "invalid"]).toContain(report.archives[0].status);
    expect(report.archives[0].outputFile).toBeUndefined();
  });

  it("rejects byte-count, hash, and current-version structure corruption", async () => {
    for (const mutate of [
      (record: Record<string, unknown>) => {
        record.compressedBytes = Number(record.compressedBytes) + 1;
      },
      (record: Record<string, unknown>) => {
        record.sha256 = "0".repeat(64);
      },
      (record: Record<string, unknown>) => {
        record.replayVersion = 10;
      },
    ]) {
      const lines = await archiveLines();
      const manifest = JSON.parse(lines[0]);
      mutate(manifest);
      lines[0] = JSON.stringify(manifest);
      const { report } = await run(lines);
      expect(report.archives[0].status).toBe("corrupt");
    }

    const invalid = replay();
    delete invalid.initialState;
    const { report } = await run(await archiveLines(invalid));
    expect(report.archives[0]).toMatchObject({ status: "invalid", message: expect.stringContaining("initialState") });
  });
});
