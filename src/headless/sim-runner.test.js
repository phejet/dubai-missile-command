import { afterEach, describe, expect, it } from "vitest";
import { runGame } from "./sim-runner.js";
import { createReplayRunner } from "../replay.js";
import { buildReplayCheckpoint } from "../replay-debug.js";
import { setRng } from "../game-logic.js";

afterEach(() => {
  setRng(Math.random);
});

/** Helper: replay a recorded game to completion via createReplayRunner */
function replayToCompletion(seed, actions) {
  const rr = createReplayRunner({ seed, actions });
  rr.init();
  const MAX_STEPS = 200000;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (rr.isFinished()) break;
    if (rr.isShopPaused()) {
      rr.resumeFromShop();
      continue;
    }
    rr.step();
  }
  const g = rr.getState();
  rr.cleanup();
  return g;
}

// ── Determinism ──

describe("runGame determinism", () => {
  it("same seed produces identical score, wave, and stats", () => {
    const r1 = runGame(null, { seed: 42, maxTicks: 3000 });
    const r2 = runGame(null, { seed: 42, maxTicks: 3000 });
    expect(r1.score).toBe(r2.score);
    expect(r1.wave).toBe(r2.wave);
    expect(r1.stats).toEqual(r2.stats);
  });

  it("different seeds produce different results", () => {
    const r1 = runGame(null, { seed: 42, maxTicks: 5000 });
    const r2 = runGame(null, { seed: 99999, maxTicks: 5000 });
    const same = r1.score === r2.score && r1.wave === r2.wave && JSON.stringify(r1.stats) === JSON.stringify(r2.stats);
    expect(same).toBe(false);
  });
});

// ── Recording ──

describe("runGame recording", () => {
  it("record:true returns actions array", () => {
    const r = runGame(null, { seed: 42, maxTicks: 3000, record: true });
    expect(Array.isArray(r.actions)).toBe(true);
    expect(r.actions.length).toBeGreaterThan(0);
  });

  it("recorded actions have valid structure", () => {
    const r = runGame(null, { seed: 42, maxTicks: 3000, record: true });
    for (const action of r.actions) {
      expect(typeof action.tick).toBe("number");
      expect(["fire", "shop", "emp", "wave_plan", "cursor"]).toContain(action.type);
      if (action.type === "fire") {
        expect(typeof action.x).toBe("number");
        expect(typeof action.y).toBe("number");
      }
      if (action.type === "shop") {
        expect(Array.isArray(action.bought)).toBe(true);
      }
    }
  });

  it("actions are in tick-ascending order", () => {
    const r = runGame(null, { seed: 42, maxTicks: 5000, record: true });
    for (let i = 1; i < r.actions.length; i++) {
      expect(r.actions[i].tick).toBeGreaterThanOrEqual(r.actions[i - 1].tick);
    }
  });
});

// ── Round-trip replay ──
// These tests use games that end naturally (deathCause: "destroyed") so
// both runGame and createReplayRunner reach the same gameover state.

describe("replay round-trip", () => {
  it("replaying a recorded game produces identical final score, wave, and stats", () => {
    const original = runGame(null, { seed: 77, record: true });
    expect(original.deathCause).toBe("destroyed");

    const g = replayToCompletion(77, original.actions);
    expect(g.score).toBe(original.score);
    expect(g.wave).toBe(original.wave);
    expect(g.stats.missileKills).toBe(original.stats.missileKills);
    expect(g.stats.droneKills).toBe(original.stats.droneKills);
    expect(g.stats.shotsFired).toBe(original.stats.shotsFired);
  });

  it("replaying produces identical checkpoint hashes at intervals", () => {
    const original = runGame(null, { seed: 256, record: true });
    expect(original.deathCause).toBe("destroyed");
    const replayData = { seed: 256, actions: original.actions };

    // Run replay twice, compare checkpoints every 200 ticks
    const hashSets = [[], []];
    for (let run = 0; run < 2; run++) {
      const rr = createReplayRunner(replayData);
      rr.init();
      for (let i = 0; i < 200000; i++) {
        if (rr.isFinished()) break;
        if (rr.isShopPaused()) {
          rr.resumeFromShop();
          continue;
        }
        rr.step();
        if (rr.getTick() % 200 === 0) {
          hashSets[run].push(buildReplayCheckpoint(rr.getState(), rr.getTick()).hash);
        }
      }
      rr.cleanup();
    }

    expect(hashSets[0].length).toBeGreaterThan(0);
    expect(hashSets[0]).toEqual(hashSets[1]);
  });

  it("round-trip works with multiple seeds", () => {
    for (const seed of [42, 77, 256]) {
      const original = runGame(null, { seed, record: true });
      expect(original.deathCause).toBe("destroyed");

      const g = replayToCompletion(seed, original.actions);
      expect(g.score).toBe(original.score);
      expect(g.wave).toBe(original.wave);
    }
  });
});

// ── Golden-seed canary ──

describe("golden-seed canary", () => {
  // This test asserts exact values for a known seed. When game balance changes
  // break it, update the expected values below. This is intentional friction
  // to track balance impact.
  it("seed 42 at 5000 ticks produces expected score and wave", () => {
    const r = runGame(null, { seed: 42, maxTicks: 5000 });
    expect(r.score).toBe(3341);
    expect(r.wave).toBe(6);
    expect(r.deathCause).toBe("timeout");
  });
});
