import { afterEach, describe, expect, it, vi } from "vitest";
import { createReplayArchiveGate, REPLAY_ARCHIVE_GATE_TIMEOUT_MS } from "./replay-archive-gate";

describe("replay archive UI gate", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["success", "failure"])("opens when persistence reports %s", async (outcome) => {
    vi.useFakeTimers();
    let settle!: (value: never) => void;
    const persistence = new Promise<never>((resolve) => {
      settle = resolve;
    });
    const gate = createReplayArchiveGate(persistence);
    let opened = false;
    void gate.then(() => {
      opened = true;
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(opened).toBe(false);
    settle({
      ok: outcome === "success",
      archiveId: "a",
      ...(outcome === "failure" ? { stage: "flush", error: new Error() } : {}),
    } as never);
    await gate;
    expect(opened).toBe(true);
  });

  it("opens after the bounded timeout without settling persistence", async () => {
    vi.useFakeTimers();
    const gate = createReplayArchiveGate(new Promise(() => {}));
    let opened = false;
    void gate.then(() => {
      opened = true;
    });

    await vi.advanceTimersByTimeAsync(REPLAY_ARCHIVE_GATE_TIMEOUT_MS - 1);
    expect(opened).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await gate;
    expect(opened).toBe(true);
  });
});
