import { describe, expect, it } from "vitest";
import {
  isRetained,
  REPORT_RETENTION_MS,
  REPLAY_RETENTION_MS,
  retentionCutoff,
  SESSION_RETENTION_MS,
} from "./retention";

describe("capture retention boundaries", () => {
  it.each([
    ["diagnostic/free text", REPORT_RETENTION_MS],
    ["replay/share", REPLAY_RETENTION_MS],
    ["session summary", SESSION_RETENTION_MS],
  ])("keeps %s at the exact boundary and expires it one millisecond later", (_label, windowMs) => {
    const now = 2_000_000_000_000;
    const cutoff = retentionCutoff(now, windowMs);
    expect(isRetained(cutoff, now, windowMs)).toBe(true);
    expect(isRetained(cutoff - 1, now, windowMs)).toBe(false);
  });
});
