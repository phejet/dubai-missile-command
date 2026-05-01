import { rand, randInt } from "./game-logic.js";
import type { TacticId, CommanderStyle, Commander, SpawnEntry, WaveResult, SpawnType, GameState } from "./types.js";

// ── Threat values ──

export const THREAT_VALUES = {
  missile: 1.5,
  drone136: 1,
  drone238: 2.5,
  mirv: 3,
  stack2: 3,
  stack3: 4.5,
};

// ── Tactic definitions ──

export const TACTICS: Record<TacticId, { id: TacticId; cat: string; label: string; intel: string }> = {
  LEFT_FLANK: {
    id: "LEFT_FLANK",
    cat: "direction",
    label: "Left flank attack",
    intel: "Threats incoming from the west",
  },
  RIGHT_FLANK: {
    id: "RIGHT_FLANK",
    cat: "direction",
    label: "Right flank attack",
    intel: "Threats incoming from the east",
  },
  PINCER: { id: "PINCER", cat: "direction", label: "Pincer attack", intel: "Coordinated attack from both flanks" },
  TOP_BARRAGE: {
    id: "TOP_BARRAGE",
    cat: "direction",
    label: "Overhead barrage",
    intel: "Ballistic missiles from above",
  },
  LOW_APPROACH: {
    id: "LOW_APPROACH",
    cat: "altitude",
    label: "Low altitude approach",
    intel: "Drones flying below radar",
  },
  HIGH_APPROACH: {
    id: "HIGH_APPROACH",
    cat: "altitude",
    label: "High altitude approach",
    intel: "High-altitude drone formation",
  },
  DRONE_SWARM: { id: "DRONE_SWARM", cat: "formation", label: "Drone swarm", intel: "Massed drone assault detected" },
  MISSILE_RAIN: { id: "MISSILE_RAIN", cat: "formation", label: "Missile rain", intel: "Heavy ballistic bombardment" },
  MIXED_AXIS: {
    id: "MIXED_AXIS",
    cat: "formation",
    label: "Split-axis assault",
    intel: "Drones east, missiles from above",
  },
  MIRV_STRIKE: {
    id: "MIRV_STRIKE",
    cat: "special",
    label: "MIRV first strike",
    intel: "MIRV launch detected — intercept before split",
  },
  SATURATION: { id: "SATURATION", cat: "special", label: "Saturation attack", intel: "Overwhelming force inbound" },
};

// ── Commander styles ──

export const COMMANDER_STYLES = {
  balanced: { id: "balanced", label: "Balanced", desc: "Mixed tactics, no strong bias" },
  aggressive: { id: "aggressive", label: "Aggressive", desc: "Favors saturation, swarms, rapid bursts" },
  methodical: { id: "methodical", label: "Methodical", desc: "Favors flanking, pincer, mixed-axis" },
  adaptive: { id: "adaptive", label: "Adaptive", desc: "Avoids repeating tactics, counters player strengths" },
};

// Style weights per tactic category: [direction, altitude, formation, special]
const STYLE_WEIGHTS: Record<CommanderStyle, Record<string, number>> = {
  balanced: { direction: 1, altitude: 1, formation: 1, special: 1 },
  aggressive: { direction: 0.6, altitude: 0.8, formation: 2, special: 2 },
  methodical: { direction: 2, altitude: 1, formation: 0.6, special: 0.8 },
  adaptive: { direction: 1.2, altitude: 1.2, formation: 1.2, special: 1 },
};

// ── Wave config table ──

const WAVE_TABLE = [
  null, // index 0 unused (waves start at 1)
  {
    budget: 14,
    cap: 10,
    missile: [0, 0],
    drone136: [5, 8],
    drone238: [0, 0],
    mirv: [0, 0],
    stack2: [2, 3],
    stack3: [0, 0],
  },
  {
    budget: 20,
    cap: 14,
    missile: [4, 8],
    drone136: [6, 10],
    drone238: [0, 0],
    mirv: [0, 0],
    stack2: [0, 0],
    stack3: [0, 0],
  },
  {
    budget: 32,
    cap: 16,
    missile: [5, 10],
    drone136: [6, 12],
    drone238: [1, 2],
    mirv: [0, 0],
    stack2: [0, 0],
    stack3: [0, 0],
  },
  {
    budget: 50,
    cap: 20,
    missile: [8, 17],
    drone136: [6, 12],
    drone238: [3, 8],
    mirv: [0, 0],
    stack2: [0, 0],
    stack3: [0, 0],
  },
  {
    budget: 65,
    cap: 24,
    missile: [10, 21],
    drone136: [6, 12],
    drone238: [4, 9],
    mirv: [1, 3],
    stack2: [1, 2],
    stack3: [0, 0],
  },
  {
    budget: 82,
    cap: 28,
    missile: [14, 27],
    drone136: [5, 11],
    drone238: [5, 11],
    mirv: [2, 5],
    stack2: [1, 3],
    stack3: [0, 0],
  },
  {
    budget: 100,
    cap: 34,
    missile: [16, 30],
    drone136: [4, 9],
    drone238: [6, 12],
    mirv: [3, 8],
    stack2: [1, 3],
    stack3: [1, 2],
  },
  {
    budget: 125,
    cap: 40,
    missile: [20, 36],
    drone136: [4, 9],
    drone238: [7, 15],
    mirv: [4, 9],
    stack2: [2, 4],
    stack3: [1, 3],
  },
];

function threatValueCapForBudget(budget: number, wave: number): number {
  const ratio = wave <= 2 ? 0.92 : wave <= 5 ? 0.88 : 0.82;
  return Math.round(budget * ratio);
}

export function getWaveConfig(wave: number) {
  if (wave >= 1 && wave <= 8) {
    const row = WAVE_TABLE[wave]!;
    return {
      budget: row.budget,
      concurrentCap: Math.max(row.cap, threatValueCapForBudget(row.budget, wave)),
      types: {
        missile: { min: row.missile[0], max: row.missile[1] },
        drone136: { min: row.drone136[0], max: row.drone136[1] },
        drone238: { min: row.drone238[0], max: row.drone238[1] },
        mirv: { min: row.mirv[0], max: row.mirv[1] },
        stack2: { min: row.stack2[0], max: row.stack2[1] },
        stack3: { min: row.stack3[0], max: row.stack3[1] },
      },
    };
  }
  // Wave 9+: exponential pressure — overwhelm defenses by wave 12-15
  const w = wave - 8;
  const budget = 105 + w * 40 + w * w * 8;
  return {
    budget,
    concurrentCap: Math.max(35 + w * 10 + w * w * 2, threatValueCapForBudget(budget, wave)),
    types: {
      missile: { min: 16 + w * 5, max: 30 + w * 8 },
      drone136: { min: 3 + w, max: 8 + w * 2 },
      drone238: { min: 6 + w * 3, max: 12 + w * 5 },
      mirv: { min: 3 + w, max: 6 + w * 2 },
      stack2: { min: 1 + Math.floor(w * 0.5), max: 3 + w },
      stack3: { min: Math.floor(w * 0.3), max: 1 + Math.floor(w * 0.7) },
    },
  };
}

// ── Commander ──

export function createCommander(style: CommanderStyle = "balanced"): Commander {
  return { style, history: [] };
}

// Tactic availability by wave — returns tactic ids available for selection
function getAvailableTactics(wave: number, style: CommanderStyle): TacticId[] {
  const pool: TacticId[] = [];
  // Direction tactics
  if (wave >= 3) pool.push("LEFT_FLANK", "RIGHT_FLANK");
  if (wave >= (style === "methodical" ? 3 : 4)) pool.push("PINCER");
  if (wave >= 4) pool.push("TOP_BARRAGE");
  // Altitude tactics
  if (wave >= 3) pool.push("LOW_APPROACH", "HIGH_APPROACH");
  // Formation tactics
  if (wave >= 5) pool.push("DRONE_SWARM", "MISSILE_RAIN");
  if (wave >= 5) pool.push("MIXED_AXIS");
  // Special tactics
  if (wave >= 7) pool.push("MIRV_STRIKE");
  if (wave >= (style === "aggressive" ? 5 : 7)) pool.push("SATURATION");
  return pool;
}

// Excluded combos — if both tactics are selected, keep only the replacement
const EXCLUDED_COMBOS: Array<{
  pair: [TacticId, TacticId];
  replace?: TacticId;
  keep?: TacticId | null;
}> = [
  { pair: ["LEFT_FLANK", "RIGHT_FLANK"], replace: "PINCER" },
  { pair: ["LEFT_FLANK", "PINCER"], keep: "PINCER" },
  { pair: ["RIGHT_FLANK", "PINCER"], keep: "PINCER" },
  { pair: ["LOW_APPROACH", "HIGH_APPROACH"], keep: null }, // pick one randomly
];

function weightedPick(items: TacticId[], weights: number[]): TacticId | null {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let r = rand(0, total);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function commanderPickTactics(commander: Commander, wave: number): TacticId[] {
  if (wave <= 2) return [];

  const style = commander.style;
  const available = getAvailableTactics(wave, style);
  if (available.length === 0) return [];

  const styleW = STYLE_WEIGHTS[style] || STYLE_WEIGHTS.balanced;

  // Build weights for each available tactic
  const recentTactics = new Set();
  if (style === "adaptive") {
    // Exclude tactics used in last 2 waves
    const histLen = commander.history.length;
    for (let i = Math.max(0, histLen - 2); i < histLen; i++) {
      for (const t of commander.history[i].tactics) recentTactics.add(t);
    }
  } else if (style === "methodical") {
    // Deprioritize direction tactics used last wave
    const last = commander.history[commander.history.length - 1];
    if (last) {
      for (const t of last.tactics) {
        if (TACTICS[t] && TACTICS[t].cat === "direction") recentTactics.add(t);
      }
    }
  }

  const filtered = available.filter((id) => !(style === "adaptive" && recentTactics.has(id)));
  if (filtered.length === 0) return [];

  const weights = filtered.map((id) => {
    const tactic = TACTICS[id];
    let w = styleW[tactic.cat] || 1;
    // Methodical: halve weight of recently used direction tactics
    if (style === "methodical" && recentTactics.has(id)) w *= 0.5;
    return w;
  });

  // Pick count: wave 3-4 → 1 tactic, wave 5+ → 1-2 tactics
  const maxTactics = wave >= 5 ? 2 : 1;
  const count = maxTactics === 1 ? 1 : rand(0, 1) < 0.6 ? 1 : 2;

  const picked: TacticId[] = [];
  const usedIndices = new Set<number>();

  for (let t = 0; t < count; t++) {
    const remainW = weights.map((w, i) => (usedIndices.has(i) ? 0 : w));
    const pick = weightedPick(filtered, remainW);
    if (!pick) break;
    const idx = filtered.indexOf(pick);
    usedIndices.add(idx);
    picked.push(pick);
  }

  // Resolve excluded combos
  return resolveExclusions(picked);
}

function resolveExclusions(tactics: TacticId[]): TacticId[] {
  let result = [...tactics];
  for (const rule of EXCLUDED_COMBOS) {
    const hasA = result.includes(rule.pair[0]);
    const hasB = result.includes(rule.pair[1]);
    if (hasA && hasB) {
      if (rule.replace) {
        result = result.filter((t) => !rule.pair.includes(t));
        result.push(rule.replace);
      } else if (rule.keep) {
        const remove = rule.pair.find((t) => t !== rule.keep);
        result = result.filter((t) => t !== remove);
      } else {
        // Remove one randomly
        const removeIdx = rand(0, 1) < 0.5 ? 0 : 1;
        result = result.filter((t) => t !== rule.pair[removeIdx]);
      }
    }
  }
  return [...new Set(result)];
}

// ── Spawn schedule generation ──

function buildTacticOverrides(
  tacticIds: TacticId[],
  entryType: SpawnType,
  entryIndex: number,
  groupIndex = 0,
  groupCount = 1,
  wave = 1,
): SpawnEntry["overrides"] {
  const overrides: NonNullable<SpawnEntry["overrides"]> = {};
  for (const id of tacticIds) {
    switch (id) {
      case "LEFT_FLANK":
        if (
          entryType.startsWith("drone") ||
          entryType === "missile" ||
          entryType === "stack2" ||
          entryType === "stack3"
        )
          overrides.side = "left";
        break;
      case "RIGHT_FLANK":
        if (
          entryType.startsWith("drone") ||
          entryType === "missile" ||
          entryType === "stack2" ||
          entryType === "stack3"
        )
          overrides.side = "right";
        break;
      case "PINCER":
        if (entryType.startsWith("drone")) overrides.side = entryIndex % 2 === 0 ? "left" : "right";
        if (entryType === "missile" || entryType === "stack2" || entryType === "stack3")
          overrides.side = entryIndex % 2 === 0 ? "left" : "right";
        break;
      case "TOP_BARRAGE":
        if (entryType === "missile" || entryType === "stack2" || entryType === "stack3") overrides.side = "top";
        break;
      case "LOW_APPROACH":
        if (entryType.startsWith("drone")) overrides.yRange = [200, 320];
        break;
      case "HIGH_APPROACH":
        if (entryType.startsWith("drone")) overrides.yRange = [40, 120];
        break;
      // DRONE_SWARM and MISSILE_RAIN affect tick spacing, handled during schedule generation
      // MIXED_AXIS handled during schedule generation
      // MIRV_STRIKE handled during schedule generation
      // SATURATION handled via cap modification
    }
  }
  const groupPressure = groupCount <= 1 ? 0 : groupIndex / (groupCount - 1);
  const fastChance =
    wave < 4
      ? 0
      : Math.max(
          0,
          Math.min(
            0.85,
            (wave < 7 ? 0.12 : wave < 10 ? 0.24 : Math.min(0.52, 0.34 + (wave - 10) * 0.04)) +
              groupPressure * 0.16 +
              (entryType === "drone238" ? 0.16 : entryType === "drone136" ? 0.06 : entryType === "mirv" ? -0.08 : 0),
          ),
        );
  if (fastChance > 0 && rand(0, 1) < fastChance) {
    const late = Math.max(0, wave - 7);
    const typeBoost = entryType === "drone238" ? 0.08 : entryType === "drone136" ? 0.04 : 0;
    overrides.variant = "fast";
    overrides.speedMul = Math.min(1.38, 1.14 + late * 0.025 + groupPressure * 0.08 + typeBoost);
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function getThreatValue(type: SpawnType): number {
  return THREAT_VALUES[type];
}

function getWaveGroupCount(wave: number): number {
  if (wave <= 3) return 1;
  if (wave <= 5) return 2;
  return 4;
}

function addGroupLulls(
  entries: Array<{ tick: number; type: SpawnType; _typeIndex: number }>,
  wave: number,
): Array<{ tick: number; type: SpawnType; _typeIndex: number; _groupIndex: number; _groupCount: number }> {
  if (entries.length === 0) return [];
  const groupCount = getWaveGroupCount(wave);
  const sorted = [...entries].sort((a, b) => a.tick - b.tick);
  const groupSize = Math.ceil(sorted.length / groupCount);
  const lullBase = Math.max(90, 150 - Math.min(45, wave * 5));
  return sorted.map((entry, index) => {
    const groupIndex = Math.min(groupCount - 1, Math.floor(index / groupSize));
    return { ...entry, tick: entry.tick + groupIndex * lullBase, _groupIndex: groupIndex, _groupCount: groupCount };
  });
}

export function generateWaveSchedule(wave: number, commander: Commander): WaveResult {
  const config = getWaveConfig(wave);
  const tactics = commanderPickTactics(commander, wave);

  // Pick counts per type
  const counts: Record<SpawnType, number> = { mirv: 0, stack3: 0, stack2: 0, drone238: 0, drone136: 0, missile: 0 };
  let totalThreat = 0;
  const typeOrder: SpawnType[] = ["stack3", "mirv", "stack2", "drone238", "drone136", "missile"];

  for (const type of typeOrder) {
    const range = config.types[type];
    counts[type] = randInt(range.min, range.max);
    totalThreat += counts[type] * THREAT_VALUES[type];
  }

  // Clamp to budget — reduce from highest-value types first
  for (const type of typeOrder) {
    while (totalThreat > config.budget && counts[type] > config.types[type].min) {
      counts[type]--;
      totalThreat -= THREAT_VALUES[type];
    }
  }

  // Compute spawn ticks per type
  const hasDroneSwarm = tactics.includes("DRONE_SWARM");
  const hasMissileRain = tactics.includes("MISSILE_RAIN");
  const hasMirvStrike = tactics.includes("MIRV_STRIKE");
  const hasMixedAxis = tactics.includes("MIXED_AXIS");

  const WAVE_DURATION_SCALE = 1.5;
  const lateFloor = Math.max(0, wave - 10) * 2; // shrinks floors on late waves
  const missileInterval = Math.max(Math.max(3, 7 - lateFloor), 63 - wave * 5) * WAVE_DURATION_SCALE;
  const droneInterval = Math.max(Math.max(4, 10 - lateFloor), 84 - wave * 8) * WAVE_DURATION_SCALE;
  function spacedTicks(count: number, interval: number, jitterFrac: number, offset: number) {
    const ticks = [];
    const jitter = Math.floor(interval * jitterFrac);
    for (let i = 0; i < count; i++) {
      const base = offset + i * interval;
      const t = Math.max(0, base + randInt(-jitter, jitter));
      ticks.push(t);
    }
    return ticks;
  }

  // Build per-type spawn entries
  const entries: Array<{ tick: number; type: SpawnType; _typeIndex: number }> = [];

  // Missiles
  const mInterval = hasMissileRain ? Math.max(12, missileInterval * 0.5) : missileInterval;
  const mTicks = spacedTicks(counts.missile, mInterval, 0.15, 30);
  for (let i = 0; i < mTicks.length; i++) {
    entries.push({ tick: mTicks[i], type: "missile", _typeIndex: i });
  }

  const stack2Ticks = spacedTicks(counts.stack2, Math.max(26, mInterval * 1.1), 0.12, 48);
  for (let i = 0; i < stack2Ticks.length; i++) {
    entries.push({ tick: stack2Ticks[i], type: "stack2", _typeIndex: i });
  }

  const stack3Ticks = spacedTicks(counts.stack3, Math.max(34, mInterval * 1.25), 0.1, 68);
  for (let i = 0; i < stack3Ticks.length; i++) {
    entries.push({ tick: stack3Ticks[i], type: "stack3", _typeIndex: i });
  }

  // Drone136
  const d136Interval = hasDroneSwarm ? Math.max(8, droneInterval * 0.3) : droneInterval;
  const d136Ticks = spacedTicks(counts.drone136, d136Interval, 0.15, 50);
  for (let i = 0; i < d136Ticks.length; i++) {
    entries.push({ tick: d136Ticks[i], type: "drone136", _typeIndex: i });
  }

  // Drone238
  const d238Interval = hasDroneSwarm ? Math.max(12, droneInterval * 0.4) : droneInterval;
  const d238Ticks = spacedTicks(counts.drone238, d238Interval, 0.15, 80);
  for (let i = 0; i < d238Ticks.length; i++) {
    entries.push({ tick: d238Ticks[i], type: "drone238", _typeIndex: i });
  }

  // MIRVs — distributed evenly across the same span as other threats
  if (counts.mirv > 0) {
    const nonMirvMax = entries.length > 0 ? Math.max(...entries.map((e) => e.tick)) : 400;
    const startTick = hasMirvStrike ? 40 : 80;
    const endTick = Math.max(nonMirvMax - 40, startTick + counts.mirv * 60);
    for (let i = 0; i < counts.mirv; i++) {
      const base =
        counts.mirv === 1 ? startTick : Math.round(startTick + (i / (counts.mirv - 1)) * (endTick - startTick));
      const jitter = Math.round((endTick - startTick) * 0.05);
      entries.push({ tick: Math.max(0, base + randInt(-jitter, jitter)), type: "mirv", _typeIndex: i });
    }
  }

  const groupedEntries = addGroupLulls(entries, wave).sort((a, b) => a.tick - b.tick);

  // Apply MIXED_AXIS: drones from one side, missiles from other side/top
  const mixedSide = hasMixedAxis ? (rand(0, 1) < 0.5 ? "left" : "right") : null;

  // Build schedule with overrides
  const schedule = groupedEntries.map((e, globalIdx) => {
    let overrideInput = tactics;
    // MIXED_AXIS: apply directional override manually
    if (hasMixedAxis) {
      // Drones get one side, missiles get opposite/top
      if (e.type.startsWith("drone")) {
        overrideInput = [
          ...tactics.filter((t) => t !== "MIXED_AXIS"),
          mixedSide === "left" ? "LEFT_FLANK" : "RIGHT_FLANK",
        ];
      } else if (e.type === "missile" || e.type === "stack2" || e.type === "stack3") {
        overrideInput = [...tactics.filter((t) => t !== "MIXED_AXIS"), "TOP_BARRAGE"];
      } else {
        overrideInput = tactics.filter((t) => t !== "MIXED_AXIS");
      }
    }

    const overrides = buildTacticOverrides(overrideInput, e.type, globalIdx, e._groupIndex, e._groupCount, wave);
    const entry: SpawnEntry = { tick: e.tick, type: e.type };
    if (overrides) entry.overrides = overrides;
    return entry;
  });

  const concurrentCap = tactics.includes("SATURATION")
    ? Math.min(config.budget, Math.round(config.concurrentCap * 1.18))
    : config.concurrentCap;

  // Record in commander history
  commander.history.push({ wave, tactics });

  return { schedule, concurrentCap, tactics };
}

// ── Runtime helpers ──

export function computeAliveThreatValue(g: Pick<GameState, "missiles" | "drones">) {
  let v = 0;
  for (const m of g.missiles) {
    if (m.alive) {
      if (m.type === "mirv") v += THREAT_VALUES.mirv;
      else if (m.type === "mirv_warhead") v += 1.5;
      else if (m.type === "stack3") v += THREAT_VALUES.stack3;
      else if (m.type === "stack2") v += THREAT_VALUES.stack2;
      else v += THREAT_VALUES.missile;
    }
  }
  for (const d of g.drones) {
    if (d.alive) v += d.subtype === "shahed238" ? THREAT_VALUES.drone238 : THREAT_VALUES.drone136;
  }
  return v;
}

export function advanceSpawnSchedule(
  g: Pick<GameState, "missiles" | "drones" | "schedule" | "scheduleIdx" | "waveTick" | "concurrentCap">,
  dt: number,
  spawnFn: (g: unknown, type: SpawnType, overrides: SpawnEntry["overrides"]) => void,
) {
  while (g.scheduleIdx < g.schedule.length) {
    const next = g.schedule[g.scheduleIdx];
    if (next.tick > g.waveTick) break;
    const aliveValue = computeAliveThreatValue(g);
    if (aliveValue + getThreatValue(next.type) > g.concurrentCap) break;
    spawnFn(g, next.type, next.overrides);
    g.scheduleIdx++;
  }
  g.waveTick += dt;
}

export function isWaveFullySpawned(g: Pick<GameState, "schedule" | "scheduleIdx">) {
  return g.scheduleIdx >= g.schedule.length;
}
