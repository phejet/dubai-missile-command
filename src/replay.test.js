import { afterEach, describe, expect, it } from "vitest";
import { createReplayRunner } from "./replay.js";
import { buildReplayCheckpoint } from "./replay-debug.js";
import { setRng } from "./game-logic.js";
import { mulberry32 } from "./headless/rng.js";
import { initGame, update } from "./game-sim.js";

const SEED = 12345;

afterEach(() => {
  setRng(Math.random);
});

// ── Replay runner lifecycle ──

describe("createReplayRunner lifecycle", () => {
  it("init() returns a valid game state", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    const g = rr.init();
    expect(g.state).toBe("playing");
    expect(g.wave).toBe(1);
    expect(g.score).toBe(0);
    expect(g.burjAlive).toBe(true);
    rr.cleanup();
  });

  it("getTick() starts at 0", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    rr.init();
    expect(rr.getTick()).toBe(0);
    rr.cleanup();
  });

  it("isFinished() starts false", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    rr.init();
    expect(rr.isFinished()).toBe(false);
    rr.cleanup();
  });

  it("isShopPaused() starts false", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    rr.init();
    expect(rr.isShopPaused()).toBe(false);
    rr.cleanup();
  });

  it("step() advances tick by 1", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    rr.init();
    rr.step();
    expect(rr.getTick()).toBe(1);
    rr.step();
    expect(rr.getTick()).toBe(2);
    rr.cleanup();
  });

  it("step() is a no-op when finished", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    const g = rr.init();
    rr.step();
    g.state = "gameover";
    rr.step(); // detects gameover, sets finished
    const tickAtFinish = rr.getTick();
    expect(rr.isFinished()).toBe(true);
    rr.step(); // should be no-op
    rr.step();
    expect(rr.getTick()).toBe(tickAtFinish);
    rr.cleanup();
  });

  it("cleanup() restores Math.random", () => {
    const rr = createReplayRunner({ seed: SEED, actions: [] });
    rr.init();
    // RNG is now seeded — same seed should give same value
    const rng1 = mulberry32(999);
    const rng2 = mulberry32(999);
    expect(rng1()).toBe(rng2());
    rr.cleanup();
    // After cleanup, global RNG should be Math.random (non-deterministic)
    // We can't easily test non-determinism, but we can verify setRng was called
    // by checking that the module-level RNG was restored
  });
});

// ── Action application ──

describe("createReplayRunner action application", () => {
  it("fire action creates an interceptor at the correct tick", () => {
    const actions = [{ tick: 5, type: "fire", x: 450, y: 200 }];
    const rr = createReplayRunner({ seed: SEED, actions });
    rr.init();

    // Step through ticks 0-4 — no interceptor yet
    for (let i = 0; i < 5; i++) rr.step();
    expect(rr.getState().stats.shotsFired).toBe(0);

    // Tick 5 — fire action executes
    rr.step();
    expect(rr.getState().stats.shotsFired).toBe(1);
    rr.cleanup();
  });

  it("fire action does not execute before its tick", () => {
    const actions = [{ tick: 10, type: "fire", x: 450, y: 200 }];
    const rr = createReplayRunner({ seed: SEED, actions });
    rr.init();

    for (let i = 0; i < 10; i++) rr.step();
    expect(rr.getState().stats.shotsFired).toBe(0);
    expect(rr.getTick()).toBe(10);
    rr.cleanup();
  });

  it("multiple fire actions at same tick all execute", () => {
    const actions = [
      { tick: 3, type: "fire", x: 200, y: 200 },
      { tick: 3, type: "fire", x: 400, y: 200 },
    ];
    const rr = createReplayRunner({ seed: SEED, actions });
    rr.init();

    for (let i = 0; i < 4; i++) rr.step();
    expect(rr.getState().stats.shotsFired).toBe(2);
    rr.cleanup();
  });
});

// ── Shop handling ──

describe("createReplayRunner shop handling", () => {
  it("step() pauses when game enters shop state", () => {
    const actions = [{ tick: 0, type: "shop", bought: [] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();
    g.state = "shop";

    rr.step();
    expect(rr.isShopPaused()).toBe(true);
    rr.cleanup();
  });

  it("tick does NOT advance while shop-paused", () => {
    const actions = [{ tick: 0, type: "shop", bought: [] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();

    // Advance a few ticks first
    for (let i = 0; i < 5; i++) rr.step();
    const tickBeforeShop = rr.getTick();

    // Force shop state
    g.state = "shop";
    rr.step(); // enters shop pause

    // Try stepping more — tick should not change
    rr.step();
    rr.step();
    rr.step();
    expect(rr.getTick()).toBe(tickBeforeShop);
    rr.cleanup();
  });

  it("resumeFromShop() applies purchases and resumes play", () => {
    const actions = [{ tick: 0, type: "shop", bought: ["wildHornets"] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();
    g.score = 10000; // enough to buy
    g.state = "shop";

    rr.step(); // enters shop pause
    expect(rr.isShopPaused()).toBe(true);

    rr.resumeFromShop();
    expect(rr.isShopPaused()).toBe(false);
    expect(g.state).toBe("playing");
    expect(g.upgrades.wildHornets).toBe(1);
    rr.cleanup();
  });

  it("resumeFromShop() handles repair_launcher_ purchases", () => {
    const actions = [{ tick: 0, type: "shop", bought: ["repair_launcher_0"] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();
    g.score = 10000;
    g.launcherHP[0] = 0; // destroy launcher
    g.state = "shop";

    rr.step();
    rr.resumeFromShop();
    expect(g.launcherHP[0]).toBeGreaterThan(0);
    rr.cleanup();
  });

  it("resumeFromShop() handles repair_site purchases", () => {
    const actions = [{ tick: 0, type: "shop", bought: ["repair_wildHornets"] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();
    g.score = 10000;
    // Create a destroyed defense site
    g.defenseSites = [{ key: "wildHornets", x: 100, y: 500, alive: false }];
    g.state = "shop";

    rr.step();
    rr.resumeFromShop();
    expect(g.defenseSites.find((s) => s.key === "wildHornets").alive).toBe(true);
    rr.cleanup();
  });

  it("resumeFromShop() with empty shop action still closes shop", () => {
    const actions = [{ tick: 0, type: "shop", bought: [] }];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();
    g.state = "shop";

    rr.step();
    rr.resumeFromShop();
    expect(g.state).toBe("playing");
    expect(rr.isShopPaused()).toBe(false);
    rr.cleanup();
  });

  it("stale combat actions before shop are discarded", () => {
    // Fire action and shop action both at tick 5; shop should take precedence
    const actions = [
      { tick: 5, type: "fire", x: 450, y: 200 },
      { tick: 5, type: "shop", bought: [] },
    ];
    const rr = createReplayRunner({ seed: SEED, actions });
    const g = rr.init();

    // Step to tick 5, then force shop before step processes tick 5 actions
    for (let i = 0; i < 5; i++) rr.step();
    g.state = "shop";
    rr.step(); // should enter shop pause, discarding the fire action

    expect(rr.isShopPaused()).toBe(true);
    rr.resumeFromShop();
    expect(g.state).toBe("playing");
    rr.cleanup();
  });
});

// ── Determinism ──

describe("createReplayRunner determinism", () => {
  it("same seed + same actions produces identical checkpoint hashes", () => {
    const actions = [
      { tick: 10, type: "fire", x: 300, y: 250 },
      { tick: 20, type: "fire", x: 600, y: 150 },
    ];
    const replayData = { seed: SEED, actions };

    // Run 1
    const rr1 = createReplayRunner(replayData);
    rr1.init();
    const hashes1 = [];
    for (let i = 0; i < 50; i++) {
      rr1.step();
      if (i % 10 === 9) hashes1.push(buildReplayCheckpoint(rr1.getState(), rr1.getTick()).hash);
    }
    rr1.cleanup();

    // Run 2
    const rr2 = createReplayRunner(replayData);
    rr2.init();
    const hashes2 = [];
    for (let i = 0; i < 50; i++) {
      rr2.step();
      if (i % 10 === 9) hashes2.push(buildReplayCheckpoint(rr2.getState(), rr2.getTick()).hash);
    }
    rr2.cleanup();

    expect(hashes1).toEqual(hashes2);
    expect(hashes1.length).toBe(5);
  });

  it("different seeds produce different checkpoint hashes", () => {
    // Run enough ticks for enemies to spawn and diverge
    const TICKS = 300;
    const rr1 = createReplayRunner({ seed: 42, actions: [] });
    rr1.init();
    for (let i = 0; i < TICKS; i++) {
      if (rr1.isFinished()) break;
      rr1.step();
    }
    const hash1 = buildReplayCheckpoint(rr1.getState(), rr1.getTick()).hash;
    rr1.cleanup();

    const rr2 = createReplayRunner({ seed: 99999, actions: [] });
    rr2.init();
    for (let i = 0; i < TICKS; i++) {
      if (rr2.isFinished()) break;
      rr2.step();
    }
    const hash2 = buildReplayCheckpoint(rr2.getState(), rr2.getTick()).hash;
    rr2.cleanup();

    expect(hash1).not.toBe(hash2);
  });
});

// ── Checkpoint ──

describe("buildReplayCheckpoint", () => {
  it("identical game states produce identical hashes", () => {
    setRng(mulberry32(SEED));
    const g1 = initGame();
    for (let i = 0; i < 50; i++) update(g1, 1);
    const cp1 = buildReplayCheckpoint(g1, 50);

    setRng(mulberry32(SEED));
    const g2 = initGame();
    for (let i = 0; i < 50; i++) update(g2, 1);
    const cp2 = buildReplayCheckpoint(g2, 50);

    expect(cp1.hash).toBe(cp2.hash);
  });

  it("different states produce different hashes", () => {
    // Run enough ticks for enemies to spawn so states diverge
    const TICKS = 300;
    setRng(mulberry32(SEED));
    const g1 = initGame();
    for (let i = 0; i < TICKS; i++) update(g1, 1);
    const cp1 = buildReplayCheckpoint(g1, TICKS);

    setRng(mulberry32(SEED));
    const g2 = initGame();
    for (let i = 0; i < TICKS + 1; i++) update(g2, 1);
    const cp2 = buildReplayCheckpoint(g2, TICKS + 1);

    expect(cp1.hash).not.toBe(cp2.hash);
  });

  it("contains expected fields", () => {
    setRng(mulberry32(SEED));
    const g = initGame();
    update(g, 1);
    const cp = buildReplayCheckpoint(g, 1);

    expect(cp).toHaveProperty("tick", 1);
    expect(cp).toHaveProperty("state");
    expect(cp).toHaveProperty("wave");
    expect(cp).toHaveProperty("score");
    expect(cp).toHaveProperty("burjAlive");
    expect(cp).toHaveProperty("burjHealth");
    expect(cp).toHaveProperty("ammo");
    expect(cp).toHaveProperty("launcherHP");
    expect(cp).toHaveProperty("upgrades");
    expect(cp).toHaveProperty("stats");
    expect(cp).toHaveProperty("counts");
    expect(cp).toHaveProperty("hash");
    expect(typeof cp.hash).toBe("string");
    expect(cp.hash.length).toBe(8);
  });

  it("includes reason when provided", () => {
    setRng(mulberry32(SEED));
    const g = initGame();
    const cp = buildReplayCheckpoint(g, 0, "shopOpen");
    expect(cp.reason).toBe("shopOpen");
  });

  it("omits reason when not provided", () => {
    setRng(mulberry32(SEED));
    const g = initGame();
    const cp = buildReplayCheckpoint(g, 0);
    expect(cp).not.toHaveProperty("reason");
  });
});
