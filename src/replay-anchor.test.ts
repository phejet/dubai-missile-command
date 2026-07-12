import { afterEach, describe, expect, it } from "vitest";
import { setRng } from "./game-logic";
import { initGame } from "./game-sim";
import { mulberry32 } from "./headless/rng";
import { createReplayRunner, createReplayRunnerFromAnchor } from "./replay";
import { createReplayStateAnchor } from "./replay-anchor";
import { buildReplayCheckpoint } from "./replay-debug";
import { buildReplayCausalSnapshot } from "./replay-causal-snapshot";
import type { Hornet, Missile, ReplayData } from "./types";

afterEach(() => {
  setRng(Math.random);
});

describe("stateful replay RNG", () => {
  it("restores the next generated value from a captured state", () => {
    const rng = mulberry32(123);
    rng();
    const state = rng.getState();
    const expectedNext = rng();

    rng.setState(state);

    expect(rng()).toBe(expectedNext);
  });
});

describe("replay state anchors", () => {
  it("clones mutable game state, strips runtime handles, and preserves target references", () => {
    setRng(mulberry32(7));
    const game = initGame();
    const missile: Missile = {
      accel: 0,
      alive: true,
      trail: [],
      type: "missile",
      vx: 0,
      vy: 1,
      x: 100,
      y: 200,
    };
    const hornet: Hornet = {
      alive: true,
      blastRadius: 10,
      life: 60,
      maxLife: 60,
      retargetsRemaining: 0,
      speed: 4,
      targetRef: missile,
      trail: [],
      wobble: 0,
      x: 90,
      y: 210,
    };
    game.missiles.push(missile);
    game.hornets.push(hornet);
    game.ownedUpgradeNodes.add("rapidReload");
    game._laserHandle = { stop() {} };
    game._browserLaserHandle = { stop() {} };

    const anchor = createReplayStateAnchor(game, "test")!;

    missile.x = 999;
    game.ownedUpgradeNodes.add("doubleMagazine");

    expect(anchor.reason).toBe("test");
    expect(anchor.state).not.toBe(game);
    expect(anchor.state.missiles[0].x).toBe(100);
    expect(anchor.state.hornets[0].targetRef).toBe(anchor.state.missiles[0]);
    expect(anchor.state.ownedUpgradeNodes).toBeInstanceOf(Set);
    expect(anchor.state.ownedUpgradeNodes.has("rapidReload")).toBe(true);
    expect(anchor.state.ownedUpgradeNodes.has("doubleMagazine")).toBe(false);
    expect(anchor.state._laserHandle).toBeNull();
    expect(anchor.state._browserLaserHandle).toBeNull();
  });

  it("lets an anchored replay match the full replay from the same tick", () => {
    const replay: ReplayData = { seed: 77, actions: [], draftMode: true, version: 5 };
    const full = createReplayRunner(replay);
    full.init();
    for (let i = 0; i < 140; i++) full.step();

    const anchor = createReplayStateAnchor(full.getState()!, "test-anchor")!;
    for (let i = 0; i < 180; i++) full.step();
    const fullCheckpoint = buildReplayCheckpoint(full.getState()!, full.getTick()).hash;
    const fullCausal = buildReplayCausalSnapshot(full.getState()!);
    const fullExplosionIds = full.getState()!.explosions.map((explosion) => explosion.id);
    const fullNextExplosionId = full.getState()!.nextExplosionId;
    full.cleanup();

    const anchored = createReplayRunnerFromAnchor(replay, anchor);
    anchored.init();
    expect(anchored.getTick()).toBe(anchor.tick);
    for (let i = 0; i < 180; i++) anchored.step();
    const anchoredCheckpoint = buildReplayCheckpoint(anchored.getState()!, anchored.getTick()).hash;
    const anchoredCausal = buildReplayCausalSnapshot(anchored.getState()!);
    const anchoredExplosionIds = anchored.getState()!.explosions.map((explosion) => explosion.id);
    anchored.cleanup();

    expect(anchoredCheckpoint).toBe(fullCheckpoint);
    expect(anchoredCausal).toEqual(fullCausal);
    expect(anchored.getState()!.nextExplosionId).toBe(fullNextExplosionId);
    expect(anchoredExplosionIds).toEqual(fullExplosionIds);
  });
});
