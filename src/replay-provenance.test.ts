// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { ReplayData } from "./types";
import { describeEnvironment, stampReplayProvenance } from "./replay-provenance";

const replay = (): ReplayData => ({ version: 11, seed: 42, actions: [] });

describe("replay provenance", () => {
  it("stamps a new object without mutating the input", () => {
    vi.setSystemTime(new Date("2026-07-31T01:02:03.000Z"));
    const input = replay();
    const stamped = stampReplayProvenance(input, "build-1");

    expect(stamped).not.toBe(input);
    expect(input).toEqual(replay());
    expect(stamped).toMatchObject({ _buildId: "build-1", _savedAt: "2026-07-31T01:02:03.000Z" });
    expect(stamped._env).toMatchObject({ platform: expect.any(String), native: expect.any(Boolean) });
    vi.useRealTimers();
  });

  it("preserves provenance that was already stamped", () => {
    const env = { platform: "ios", native: true, ua: "webkit", dpr: 3, screenW: 390, screenH: 844 };
    const input = { ...replay(), _buildId: "old", _savedAt: "then", _env: env };
    expect(stampReplayProvenance(input, "new")).toMatchObject({
      _buildId: "old",
      _savedAt: "then",
      _env: env,
    });
  });

  it("uses safe values when browser globals are missing", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("screen", undefined);
    vi.stubGlobal("window", undefined);
    expect(describeEnvironment()).toMatchObject({ ua: "", dpr: 1, screenW: 0, screenH: 0 });
    vi.unstubAllGlobals();
  });
});
