import { describe, expect, it } from "vitest";
import { backfillReplayProvenance } from "./vite-replay-plugin";

describe("Vite replay provenance", () => {
  it("preserves existing provenance", () => {
    const data = { _buildId: "recorded", _savedAt: "recorded-at" };
    backfillReplayProvenance(data, "saving", "saving-at");
    expect(data).toEqual({ _buildId: "recorded", _savedAt: "recorded-at" });
  });

  it("backfills older replay payloads", () => {
    const data: Record<string, unknown> = {};
    backfillReplayProvenance(data, "saving", "saving-at");
    expect(data).toEqual({ _buildId: "saving", _savedAt: "saving-at" });
  });
});
