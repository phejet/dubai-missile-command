import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReplayArchiveRecords, type ArchiveRecord } from "./replay-archive";
import type { ReplayData } from "./types";

const replay = (extra: Partial<ReplayData> = {}): ReplayData => ({
  version: 11,
  seed: 123,
  actions: [{ tick: 1, type: "fire", x: 10, y: 20 }],
  initialState: { metaProgression: { version: 1, completedObjectives: [] }, forcedUpgradeFamilies: [], burjHealth: 7 },
  ...extra,
});

const digest = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const compress = async (bytes: Uint8Array) => new Uint8Array(gzipSync(bytes));
const payload = (records: ArchiveRecord[]) => {
  const joined = records
    .filter((record) => record.event === "part")
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((record) => String(record.data))
    .join("");
  return new Uint8Array(Buffer.from(joined, "base64"));
};

describe("replay archive records", () => {
  it("round trips a gzip replay byte-for-byte", async () => {
    const input = replay({ replayId: "perf-wave1" });
    const result = await buildReplayArchiveRecords(
      input,
      { build: "b1", fallbackArchiveId: "fallback" },
      { digest, compress },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.parse(gunzipSync(payload(result.records)).toString("utf8"))).toEqual(input);
    expect(result.records[0]).toMatchObject({
      event: "manifest",
      archiveId: digestId(input),
      compression: "gzip",
      integrity: "sha256",
    });
    expect(JSON.parse(gunzipSync(payload(result.records)).toString("utf8")).replayId).toBe("perf-wave1");
  });

  it("splits base64 on independently decodable bounded boundaries", async () => {
    const input = replay({ replayId: "x".repeat(100_000) });
    const result = await buildReplayArchiveRecords(
      input,
      { build: "b1", fallbackArchiveId: "fallback" },
      { digest, compress: async () => null, partChars: 128 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parts = result.records.filter((record) => record.event === "part");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(String(part.data).length).toBeLessThanOrEqual(128);
      expect(String(part.data).length % 4).toBe(0);
      expect(() => Buffer.from(String(part.data), "base64")).not.toThrow();
    }
    expect(JSON.parse(Buffer.from(payload(result.records)).toString("utf8"))).toEqual(input);
  });

  it("encodes a multi-megabyte uncompressed replay without variadic calls", async () => {
    const input = replay({ replayId: "z".repeat(3_000_000) });
    const result = await buildReplayArchiveRecords(
      input,
      { build: "b1", fallbackArchiveId: "f" },
      { digest, compress: async () => null },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rawBytes).toBeGreaterThan(3_000_000);
  });

  it("degrades independently when compression and hashing are unavailable", async () => {
    const result = await buildReplayArchiveRecords(
      replay(),
      { build: "b1", fallbackArchiveId: "boot-a0" },
      { digest: async () => null, compress: async () => null },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.archiveId).toBe("boot-a0");
    expect(result.records[0]).toMatchObject({ compression: "none", integrity: "none", sha256: null });
    expect(JSON.parse(Buffer.from(payload(result.records)).toString("utf8"))).toEqual(replay());
  });

  it.each([
    ["config", { partChars: 3 }],
    [
      "hash",
      {
        digest: async () => {
          throw new Error("hash");
        },
      },
    ],
    [
      "compress",
      {
        digest,
        compress: async () => {
          throw new Error("gzip");
        },
      },
    ],
  ] as const)("returns a %s failure without throwing", async (stage, deps) => {
    const result = await buildReplayArchiveRecords(replay(), { build: "b1", fallbackArchiveId: "f" }, deps);
    expect(result).toMatchObject({ ok: false, stage });
  });

  it("reports circular payload serialization failure", async () => {
    const input = replay() as ReplayData & { circular?: unknown };
    input.circular = input;
    await expect(
      buildReplayArchiveRecords(input, { build: "b1", fallbackArchiveId: "f" }, { digest, compress }),
    ).resolves.toMatchObject({
      ok: false,
      stage: "serialize",
    });
  });
});

function digestId(value: ReplayData): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
