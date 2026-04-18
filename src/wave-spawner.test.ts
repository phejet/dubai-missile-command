import { afterEach, describe, expect, it } from "vitest";
import { setRng } from "./game-logic.js";
import type { SpawnType, Missile, Drone } from "./types.js";
import {
  THREAT_VALUES,
  TACTICS,
  COMMANDER_STYLES,
  getWaveConfig,
  createCommander,
  commanderPickTactics,
  generateWaveSchedule,
  computeAliveThreatValue,
  advanceSpawnSchedule,
  isWaveFullySpawned,
} from "./wave-spawner.js";

afterEach(() => setRng(Math.random));

function makeSeededRng(seed = 42) {
  // Simple mulberry32 for tests
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── getWaveConfig ──

describe("getWaveConfig", () => {
  it("returns valid config for waves 1-12", () => {
    for (let w = 1; w <= 12; w++) {
      const cfg = getWaveConfig(w);
      expect(cfg.budget).toBeGreaterThan(0);
      expect(cfg.concurrentCap).toBeGreaterThan(0);
      for (const type of ["missile", "drone136", "drone238", "mirv", "stack2", "stack3"] as SpawnType[]) {
        expect(cfg.types[type].min).toBeLessThanOrEqual(cfg.types[type].max);
        expect(cfg.types[type].min).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("budget increases with wave", () => {
    for (let w = 2; w <= 10; w++) {
      expect(getWaveConfig(w).budget).toBeGreaterThanOrEqual(getWaveConfig(w - 1).budget);
    }
  });

  it("concurrent cap increases with wave", () => {
    for (let w = 2; w <= 10; w++) {
      expect(getWaveConfig(w).concurrentCap).toBeGreaterThanOrEqual(getWaveConfig(w - 1).concurrentCap);
    }
  });

  it("no drone238 on waves 1-2", () => {
    for (let w = 1; w <= 2; w++) {
      const cfg = getWaveConfig(w);
      expect(cfg.types.drone238.max).toBe(0);
    }
  });

  it("no mirv on waves 1-4", () => {
    for (let w = 1; w <= 4; w++) {
      const cfg = getWaveConfig(w);
      expect(cfg.types.mirv.max).toBe(0);
    }
  });

  it("drone238 available wave 3+", () => {
    expect(getWaveConfig(3).types.drone238.max).toBeGreaterThan(0);
  });

  it("mirv available wave 5+", () => {
    expect(getWaveConfig(5).types.mirv.max).toBeGreaterThan(0);
  });
});

// ── generateWaveSchedule ──

describe("generateWaveSchedule", () => {
  it("schedule entries sorted by tick", () => {
    setRng(makeSeededRng(100));
    const cmdr = createCommander("balanced");
    const { schedule } = generateWaveSchedule(5, cmdr);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].tick).toBeGreaterThanOrEqual(schedule[i - 1].tick);
    }
  });

  it("total threat value of schedule <= budget", () => {
    for (const seed of [42, 77, 256]) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      for (let w = 1; w <= 8; w++) {
        const { schedule } = generateWaveSchedule(w, cmdr);
        const cfg = getWaveConfig(w);
        let threat = 0;
        for (const entry of schedule) threat += THREAT_VALUES[entry.type];
        expect(threat).toBeLessThanOrEqual(cfg.budget);
      }
    }
  });

  it("per-type counts within min/max", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    for (let w = 1; w <= 8; w++) {
      const { schedule } = generateWaveSchedule(w, cmdr);
      const cfg = getWaveConfig(w);
      const counts: Record<SpawnType, number> = { missile: 0, drone136: 0, drone238: 0, mirv: 0, stack2: 0, stack3: 0 };
      for (const entry of schedule) counts[entry.type]++;
      for (const type of Object.keys(counts) as SpawnType[]) {
        expect(counts[type]).toBeGreaterThanOrEqual(cfg.types[type].min);
        expect(counts[type]).toBeLessThanOrEqual(cfg.types[type].max);
      }
    }
  });

  it("no negative ticks", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    const { schedule } = generateWaveSchedule(5, cmdr);
    for (const entry of schedule) {
      expect(entry.tick).toBeGreaterThanOrEqual(0);
    }
  });

  it("wave 1-2 stay within their configured starter threat pools", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");

    const { schedule: wave1 } = generateWaveSchedule(1, cmdr);
    for (const entry of wave1) {
      expect(["drone136", "stack2"]).toContain(entry.type);
    }

    const { schedule: wave2 } = generateWaveSchedule(2, cmdr);
    for (const entry of wave2) {
      expect(["missile", "drone136"]).toContain(entry.type);
    }
  });

  it("wave 3+ can include drone238", () => {
    // Run multiple seeds to ensure at least one produces drone238
    let found = false;
    for (let seed = 1; seed <= 20; seed++) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      // Skip to wave 3 — need to burn through waves 1-2 for history
      generateWaveSchedule(1, cmdr);
      generateWaveSchedule(2, cmdr);
      const { schedule } = generateWaveSchedule(3, cmdr);
      if (schedule.some((e) => e.type === "drone238")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("wave 5+ includes mirvs", () => {
    let found = false;
    for (let seed = 1; seed <= 20; seed++) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      for (let w = 1; w <= 4; w++) generateWaveSchedule(w, cmdr);
      const { schedule } = generateWaveSchedule(5, cmdr);
      if (schedule.some((e) => e.type === "mirv")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// ── computeAliveThreatValue ──

describe("computeAliveThreatValue", () => {
  it("empty game = 0", () => {
    expect(computeAliveThreatValue({ missiles: [], drones: [] })).toBe(0);
  });

  it("counts missiles as 1.5", () => {
    const g = {
      missiles: [
        { alive: true, type: "missile" },
        { alive: true, type: "missile" },
      ] as Missile[],
      drones: [] as Drone[],
    };
    expect(computeAliveThreatValue(g)).toBe(3);
  });

  it("counts drone136 as 1, drone238 as 2.5", () => {
    const g = {
      missiles: [] as Missile[],
      drones: [
        { alive: true, subtype: "shahed136" },
        { alive: true, subtype: "shahed238" },
      ] as Drone[],
    };
    expect(computeAliveThreatValue(g)).toBe(3.5);
  });

  it("counts mirv as 3, mirv_warhead as 1.5", () => {
    const g = {
      missiles: [
        { alive: true, type: "mirv" },
        { alive: true, type: "mirv_warhead" },
      ] as Missile[],
      drones: [] as Drone[],
    };
    expect(computeAliveThreatValue(g)).toBe(4.5);
  });

  it("dead entities not counted", () => {
    const g = {
      missiles: [
        { alive: false, type: "missile" },
        { alive: true, type: "missile" },
      ] as Missile[],
      drones: [{ alive: false, subtype: "shahed136" }] as Drone[],
    };
    expect(computeAliveThreatValue(g)).toBe(1.5);
  });
});

// ── advanceSpawnSchedule ──

describe("advanceSpawnSchedule", () => {
  function makeGameWithSchedule(schedule: import("./types.js").SpawnEntry[], cap = 100) {
    return {
      schedule,
      scheduleIdx: 0,
      waveTick: 0,
      concurrentCap: cap,
      missiles: [] as Missile[],
      drones: [] as Drone[],
    };
  }

  it("spawns entries whose tick <= waveTick", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule([
      { tick: 0, type: "missile" },
      { tick: 5, type: "drone136" },
      { tick: 100, type: "missile" },
    ]);
    g.waveTick = 10;
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual(["missile", "drone136"]);
    expect(g.scheduleIdx).toBe(2);
  });

  it("stops at concurrent cap", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule(
      [
        { tick: 0, type: "missile" },
        { tick: 1, type: "missile" },
        { tick: 2, type: "missile" },
      ],
      2,
    );
    g.waveTick = 10;
    // Simulate 2 alive missiles
    g.missiles = [
      { alive: true, type: "missile" },
      { alive: true, type: "missile" },
    ] as Missile[];
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual([]);
    expect(g.scheduleIdx).toBe(0);
  });

  it("resumes after cap drops", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule(
      [
        { tick: 0, type: "missile" },
        { tick: 1, type: "missile" },
        { tick: 2, type: "missile" },
      ],
      2, // cap = 2 threat value
    );
    g.waveTick = 10;
    // 2 alive missiles = 2 threat value = at cap
    g.missiles = [
      { alive: true, type: "missile" },
      { alive: true, type: "missile" },
    ] as Missile[];
    // Mock spawn adds a missile to track threat
    const spawnFn = (_g: unknown, type: SpawnType) => {
      spawned.push(type);
      (g as typeof g).missiles.push({ alive: true, type: "missile" } as Missile);
    };
    advanceSpawnSchedule(g, 1, spawnFn);
    expect(spawned).toEqual([]); // blocked by cap

    // Kill one missile (threat drops to 1, below cap of 2)
    g.missiles[0].alive = false;
    advanceSpawnSchedule(g, 1, spawnFn);
    // Spawns one missile (threat goes 1→2, at cap), next blocked
    expect(spawned).toEqual(["missile"]);
    expect(g.scheduleIdx).toBe(1);
  });

  it("does nothing when schedule exhausted", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule([]);
    g.waveTick = 100;
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual([]);
  });

  it("passes overrides to spawn function", () => {
    const calls: Array<{ type: SpawnType; overrides: import("./types.js").SpawnEntry["overrides"] }> = [];
    const g = makeGameWithSchedule([{ tick: 0, type: "drone136", overrides: { side: "left" } }]);
    g.waveTick = 10;
    advanceSpawnSchedule(g, 1, (_g, type, overrides) => calls.push({ type, overrides }));
    expect(calls[0].overrides).toEqual({ side: "left" });
  });
});

// ── isWaveFullySpawned ──

describe("isWaveFullySpawned", () => {
  it("false when schedule not exhausted", () => {
    expect(isWaveFullySpawned({ schedule: [{ tick: 0, type: "missile" as SpawnType }], scheduleIdx: 0 })).toBe(false);
  });

  it("true when schedule exhausted", () => {
    expect(isWaveFullySpawned({ schedule: [{ tick: 0, type: "missile" as SpawnType }], scheduleIdx: 1 })).toBe(true);
  });
});

// ── commanderPickTactics ──

describe("commanderPickTactics", () => {
  it("wave 1-2: returns empty array", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    expect(commanderPickTactics(cmdr, 1)).toEqual([]);
    expect(commanderPickTactics(cmdr, 2)).toEqual([]);
  });

  it("wave 3+: returns 1-2 tactics", () => {
    let found = false;
    for (let seed = 1; seed <= 30; seed++) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      const tactics = commanderPickTactics(cmdr, 5);
      if (tactics.length >= 1 && tactics.length <= 2) found = true;
      expect(tactics.length).toBeLessThanOrEqual(2);
    }
    expect(found).toBe(true);
  });

  it("picks from available pool", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    const tactics = commanderPickTactics(cmdr, 3);
    // Wave 3 should only have direction and altitude tactics
    for (const t of tactics) {
      expect(TACTICS[t]).toBeDefined();
      expect(["direction", "altitude"]).toContain(TACTICS[t].cat);
    }
  });

  it("adaptive style avoids repeating tactics from last 2 waves", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("adaptive");
    cmdr.history = [
      { wave: 3, tactics: ["LEFT_FLANK"] },
      { wave: 4, tactics: ["RIGHT_FLANK", "LOW_APPROACH"] },
    ];
    // Run many seeds to check none repeat LEFT_FLANK, RIGHT_FLANK, or LOW_APPROACH
    for (let seed = 1; seed <= 50; seed++) {
      setRng(makeSeededRng(seed));
      const tactics = commanderPickTactics(cmdr, 5);
      expect(tactics).not.toContain("LEFT_FLANK");
      expect(tactics).not.toContain("RIGHT_FLANK");
      expect(tactics).not.toContain("LOW_APPROACH");
    }
  });

  it("deterministic with same RNG seed", () => {
    setRng(makeSeededRng(42));
    const cmdr1 = createCommander("balanced");
    const t1 = commanderPickTactics(cmdr1, 5);

    setRng(makeSeededRng(42));
    const cmdr2 = createCommander("balanced");
    const t2 = commanderPickTactics(cmdr2, 5);

    expect(t1).toEqual(t2);
  });
});

// ── Commander history ──

describe("commander history", () => {
  it("history grows each wave", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    for (let w = 1; w <= 5; w++) {
      generateWaveSchedule(w, cmdr);
    }
    expect(cmdr.history).toHaveLength(5);
  });

  it("tactics stored in history match schedule return", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    const { tactics } = generateWaveSchedule(5, cmdr);
    const last = cmdr.history[cmdr.history.length - 1];
    expect(last.tactics).toEqual(tactics);
    expect(last.wave).toBe(5);
  });
});
