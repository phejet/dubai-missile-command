import { describe, expect, it } from "vitest";
import { runGame } from "./headless/sim-runner";
import { validateReplay } from "./headless/validate-replay";
import { hashReplayDiagnostic } from "./replay-debug";
import type { ReplayCheckpoint, ReplayData } from "./types";
import {
  buildReplayCausalSnapshot,
  getReplayCausalOwnedKeys,
  REPLAY_CAUSAL_EXCLUDED_KEYS,
} from "./replay-causal-snapshot";
import { initGame } from "./game-sim";

function recordReplay(): ReplayData {
  const result = runGame(null, {
    seed: 74,
    record: true,
    draftMode: false,
    stopCondition: { type: "waveComplete", wave: 2 },
    checkpoints: true,
  });
  return {
    version: result.version!,
    seed: result.seed,
    actions: result.actions!,
    draftMode: false,
    stopCondition: { type: "waveComplete", wave: 2 },
    checkpoints: result.checkpoints,
  };
}

function perturb(replay: ReplayData, key: "rngState" | "schedule" | "explosions" | "timers"): ReplayData {
  const clone = structuredClone(replay);
  const checkpoint = clone.checkpoints!.find((entry) => !entry.reason)!;
  const diagnostics = checkpoint.diagnostics as Record<string, unknown>;
  if (key === "rngState") diagnostics.rngState = Number(diagnostics.rngState) + 1;
  else {
    const section = diagnostics[key] as Record<string, unknown>;
    const field = key === "schedule" ? "remainingHash" : key === "explosions" ? "hash" : "burjInvuln";
    section[field] = `${String(section[field])}-perturbed`;
  }
  checkpoint.hash = hashReplayDiagnostic(diagnostics);
  return clone;
}

describe("embedded replay checkpoint verification", () => {
  it("assigns every initialized state key to the causal snapshot or explicit runtime exclusions", () => {
    const game = initGame();
    const owned = new Set(getReplayCausalOwnedKeys(game));
    for (const key of Object.keys(game)) {
      expect(owned.has(key) || REPLAY_CAUSAL_EXCLUDED_KEYS.has(key as keyof typeof game), key).toBe(true);
    }
    expect(buildReplayCausalSnapshot(game)).toHaveProperty("state.schedule");
    expect(buildReplayCausalSnapshot(game)).not.toHaveProperty("state._timeAccum");
  });

  it("verifies an unmodified headless recording across interval and boundary checkpoints", () => {
    const replay = recordReplay();
    expect(replay.checkpoints?.some((checkpoint) => checkpoint.reason === "shopOpen")).toBe(true);
    expect(replay.checkpoints?.some((checkpoint) => checkpoint.reason === "waveStart:2")).toBe(true);
    expect(validateReplay(replay)).toEqual([]);
  });

  it.each(["rngState", "schedule", "explosions", "timers"] as const)(
    "reports a named field diff for a perturbed %s diagnostic",
    (key) => {
      const divergence = validateReplay(perturb(recordReplay(), key))[0];
      expect(divergence.tick).toBeGreaterThan(0);
      expect(Object.keys(divergence.fieldDiff)).toContain(
        `diagnostics.${key}${key === "rngState" ? "" : key === "schedule" ? ".remainingHash" : key === "explosions" ? ".hash" : ".burjInvuln"}`,
      );
    },
  );

  it("reports a non-empty diff when only the stored hash is corrupt", () => {
    const replay = recordReplay();
    const checkpoint = replay.checkpoints!.find((entry) => !entry.reason) as ReplayCheckpoint;
    checkpoint.hash = "00000000";
    const divergence = validateReplay(replay)[0];
    expect(divergence.fieldDiff.hash).toEqual({ expected: "00000000", actual: expect.any(String) });
  });
});
