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

const SHAHED_136_TYPES = [
  "shahed-136",
  "shahed-136-bomber",
  "shahed-136-dive",
  "shahed-136-dive-bomber",
] as const satisfies readonly SpawnType[];

const ALL_SPAWN_TYPES = [
  "missile",
  ...SHAHED_136_TYPES,
  "drone238",
  "mirv",
  "stack2",
  "stack3",
] as const satisfies readonly SpawnType[];

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
      for (const type of ALL_SPAWN_TYPES) {
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

  it("uses configured concurrent cap instead of wave budget", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    const result = generateWaveSchedule(1, cmdr);
    expect(result.concurrentCap).toBe(getWaveConfig(1).concurrentCap);
    expect(result.concurrentCap).toBeLessThan(getWaveConfig(1).budget);
  });

  it("per-type counts within min/max", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");
    for (let w = 1; w <= 8; w++) {
      const { schedule } = generateWaveSchedule(w, cmdr);
      const cfg = getWaveConfig(w);
      const counts = Object.fromEntries(ALL_SPAWN_TYPES.map((type) => [type, 0])) as Record<SpawnType, number>;
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

  it("adds intra-wave lull gaps between attack groups", () => {
    setRng(makeSeededRng(77));
    const cmdr = createCommander("balanced");
    for (let w = 1; w <= 5; w++) generateWaveSchedule(w, cmdr);
    const { schedule } = generateWaveSchedule(6, cmdr);
    const gaps = schedule.slice(1).map((entry, index) => entry.tick - schedule[index].tick);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(80);
  });

  it("does not create fast variants before wave 4", () => {
    for (let seed = 1; seed <= 20; seed++) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      for (let w = 1; w <= 3; w++) {
        const { schedule } = generateWaveSchedule(w, cmdr);
        expect(schedule.some((entry) => entry.overrides?.variant === "fast")).toBe(false);
      }
    }
  });

  it("leans on fast variants more often in late waves", () => {
    let wave5Fast = 0;
    let wave10Fast = 0;
    for (let seed = 1; seed <= 40; seed++) {
      setRng(makeSeededRng(seed));
      const early = createCommander("balanced");
      for (let w = 1; w < 5; w++) generateWaveSchedule(w, early);
      wave5Fast += generateWaveSchedule(5, early).schedule.filter(
        (entry) => entry.overrides?.variant === "fast",
      ).length;

      setRng(makeSeededRng(seed));
      const late = createCommander("balanced");
      for (let w = 1; w < 10; w++) generateWaveSchedule(w, late);
      wave10Fast += generateWaveSchedule(10, late).schedule.filter(
        (entry) => entry.overrides?.variant === "fast",
      ).length;
    }
    expect(wave10Fast).toBeGreaterThan(wave5Fast * 2);
  });

  it("wave 1-2 stay within their configured starter threat pools", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");

    const { schedule: wave1 } = generateWaveSchedule(1, cmdr);
    for (const entry of wave1) {
      expect(["shahed-136", "stack2"]).toContain(entry.type);
    }

    const { schedule: wave2 } = generateWaveSchedule(2, cmdr);
    for (const entry of wave2) {
      expect(["missile", "shahed-136", "shahed-136-bomber"]).toContain(entry.type);
    }
  });

  it("introduces Shahed-136 variants by wave tier", () => {
    setRng(makeSeededRng(42));
    const cmdr = createCommander("balanced");

    const wave1 = generateWaveSchedule(1, cmdr).schedule;
    expect(wave1.some((entry) => entry.type === "shahed-136")).toBe(true);
    expect(wave1.some((entry) => entry.type === "shahed-136-bomber")).toBe(false);
    expect(wave1.some((entry) => entry.type === "shahed-136-dive")).toBe(false);
    expect(wave1.some((entry) => entry.type === "shahed-136-dive-bomber")).toBe(false);

    const wave2 = generateWaveSchedule(2, cmdr).schedule;
    expect(wave2.some((entry) => entry.type === "shahed-136-bomber")).toBe(true);
    expect(wave2.some((entry) => entry.type === "shahed-136-dive-bomber")).toBe(false);

    const wave3 = generateWaveSchedule(3, cmdr).schedule;
    expect(wave3.some((entry) => entry.type === "shahed-136-dive")).toBe(true);
    expect(wave3.some((entry) => entry.type === "shahed-136-dive-bomber")).toBe(false);

    const wave4 = generateWaveSchedule(4, cmdr).schedule;
    expect(wave4.some((entry) => entry.type === "shahed-136-dive-bomber")).toBe(true);
  });

  it("replaces the old drone136 budget with more dangerous late-wave Shahed mix", () => {
    let wave1Dangerous = 0;
    let wave8Dangerous = 0;
    for (let seed = 1; seed <= 30; seed++) {
      setRng(makeSeededRng(seed));
      const cmdr = createCommander("balanced");
      wave1Dangerous += generateWaveSchedule(1, cmdr).schedule.filter(
        (entry) => entry.type === "shahed-136-dive" || entry.type === "shahed-136-dive-bomber",
      ).length;
      for (let wave = 2; wave < 8; wave++) generateWaveSchedule(wave, cmdr);
      wave8Dangerous += generateWaveSchedule(8, cmdr).schedule.filter(
        (entry) => entry.type === "shahed-136-dive" || entry.type === "shahed-136-dive-bomber",
      ).length;
    }
    expect(wave1Dangerous).toBe(0);
    expect(wave8Dangerous).toBeGreaterThan(40);
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

  it("counts Shahed-136 variants and drone238 by threat value", () => {
    const g = {
      missiles: [] as Missile[],
      drones: [
        { alive: true, subtype: "shahed136", shahedVariant: "shahed-136" },
        { alive: true, subtype: "shahed136", shahedVariant: "shahed-136-dive-bomber" },
        { alive: true, subtype: "shahed238" },
      ] as Drone[],
    };
    expect(computeAliveThreatValue(g)).toBe(4.5);
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
      { tick: 5, type: "shahed-136" },
      { tick: 100, type: "missile" },
    ]);
    g.waveTick = 10;
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual(["missile", "shahed-136"]);
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

  it("does not spawn the next entry when it would exceed concurrent cap", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule(
      [
        { tick: 0, type: "missile" },
        { tick: 1, type: "missile" },
      ],
      2,
    );
    g.waveTick = 10;
    g.missiles = [{ alive: true, type: "missile" }] as Missile[];
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual([]);
    expect(g.scheduleIdx).toBe(0);
  });

  it("spawns while the next entry still fits under concurrent cap", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule([{ tick: 0, type: "shahed-136" }], 2.5);
    g.waveTick = 10;
    g.missiles = [{ alive: true, type: "missile" }] as Missile[];
    advanceSpawnSchedule(g, 1, (_g, type) => spawned.push(type));
    expect(spawned).toEqual(["shahed-136"]);
    expect(g.scheduleIdx).toBe(1);
  });

  it("passes fast variant overrides to spawn function", () => {
    const calls: Array<{ type: SpawnType; overrides: import("./types.js").SpawnEntry["overrides"] }> = [];
    const g = makeGameWithSchedule([{ tick: 0, type: "drone238", overrides: { variant: "fast", speedMul: 1.25 } }]);
    g.waveTick = 10;
    advanceSpawnSchedule(g, 1, (_g, type, overrides) => calls.push({ type, overrides }));
    expect(calls).toEqual([{ type: "drone238", overrides: { variant: "fast", speedMul: 1.25 } }]);
  });

  it("resumes after cap drops", () => {
    const spawned: SpawnType[] = [];
    const g = makeGameWithSchedule(
      [
        { tick: 0, type: "missile" },
        { tick: 1, type: "missile" },
        { tick: 2, type: "missile" },
      ],
      3, // cap = 3 threat value
    );
    g.waveTick = 10;
    // 2 alive missiles = 3 threat value = at cap
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

    // Kill one missile (threat drops to 1.5, leaving room for one more missile)
    g.missiles[0].alive = false;
    advanceSpawnSchedule(g, 1, spawnFn);
    // Spawns one missile (threat goes 1.5→3, at cap), next blocked
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
    const g = makeGameWithSchedule([{ tick: 0, type: "shahed-136-bomber", overrides: { side: "left" } }]);
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
