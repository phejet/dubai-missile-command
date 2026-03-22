import { rand, randInt } from "./game-logic.js";

// ── Threat values ──

export const THREAT_VALUES = {
  missile: 1.5,
  drone136: 1,
  drone238: 2.5,
  mirv: 3,
};

// ── Tactic definitions ──

export const TACTICS = {
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
const STYLE_WEIGHTS = {
  balanced: { direction: 1, altitude: 1, formation: 1, special: 1 },
  aggressive: { direction: 0.6, altitude: 0.8, formation: 2, special: 2 },
  methodical: { direction: 2, altitude: 1, formation: 0.6, special: 0.8 },
  adaptive: { direction: 1.2, altitude: 1.2, formation: 1.2, special: 1 },
};

// ── Wave config table ──

const WAVE_TABLE = [
  null, // index 0 unused (waves start at 1)
  { budget: 14, cap: 8, missile: [2, 4], drone136: [4, 6], drone238: [0, 0], mirv: [0, 0] },
  { budget: 20, cap: 10, missile: [3, 5], drone136: [5, 7], drone238: [0, 0], mirv: [0, 0] },
  { budget: 28, cap: 12, missile: [4, 6], drone136: [5, 8], drone238: [0, 0], mirv: [0, 0] },
  { budget: 38, cap: 16, missile: [6, 8], drone136: [4, 6], drone238: [1, 3], mirv: [0, 0] },
  { budget: 48, cap: 18, missile: [8, 10], drone136: [4, 6], drone238: [2, 4], mirv: [0, 0] },
  { budget: 60, cap: 22, missile: [10, 12], drone136: [3, 5], drone238: [3, 5], mirv: [0, 0] },
  { budget: 74, cap: 26, missile: [12, 14], drone136: [3, 5], drone238: [4, 6], mirv: [1, 1] },
  { budget: 90, cap: 30, missile: [14, 16], drone136: [2, 4], drone238: [5, 7], mirv: [1, 2] },
];

export function getWaveConfig(wave) {
  if (wave >= 1 && wave <= 8) {
    const row = WAVE_TABLE[wave];
    return {
      budget: row.budget,
      concurrentCap: row.cap,
      types: {
        missile: { min: row.missile[0], max: row.missile[1] },
        drone136: { min: row.drone136[0], max: row.drone136[1] },
        drone238: { min: row.drone238[0], max: row.drone238[1] },
        mirv: { min: row.mirv[0], max: row.mirv[1] },
      },
    };
  }
  // Wave 9+: formula-based scaling
  const w = wave - 8;
  return {
    budget: 90 + w * 18,
    concurrentCap: 30 + w * 4,
    types: {
      missile: { min: 14 + w * 2, max: 16 + w * 2 },
      drone136: { min: 2, max: 4 },
      drone238: { min: 5 + w, max: 7 + w },
      mirv: { min: 1 + Math.floor((wave - 7) / 2), max: 2 + Math.floor((wave - 7) / 2) },
    },
  };
}

// ── Commander ──

export function createCommander(style = "balanced") {
  return { style, history: [] };
}

// Tactic availability by wave — returns tactic ids available for selection
function getAvailableTactics(wave, style) {
  const pool = [];
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
const EXCLUDED_COMBOS = [
  { pair: ["LEFT_FLANK", "RIGHT_FLANK"], replace: "PINCER" },
  { pair: ["LEFT_FLANK", "PINCER"], keep: "PINCER" },
  { pair: ["RIGHT_FLANK", "PINCER"], keep: "PINCER" },
  { pair: ["LOW_APPROACH", "HIGH_APPROACH"], keep: null }, // pick one randomly
];

function weightedPick(items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let r = rand(0, total);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function commanderPickTactics(commander, wave) {
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

  const picked = [];
  const usedIndices = new Set();

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

function resolveExclusions(tactics) {
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

function buildTacticOverrides(tacticIds, entryType, entryIndex) {
  const overrides = {};
  for (const id of tacticIds) {
    switch (id) {
      case "LEFT_FLANK":
        if (entryType.startsWith("drone") || entryType === "missile") overrides.side = "left";
        break;
      case "RIGHT_FLANK":
        if (entryType.startsWith("drone") || entryType === "missile") overrides.side = "right";
        break;
      case "PINCER":
        if (entryType.startsWith("drone")) overrides.side = entryIndex % 2 === 0 ? "left" : "right";
        if (entryType === "missile") overrides.side = entryIndex % 2 === 0 ? "left" : "right";
        break;
      case "TOP_BARRAGE":
        if (entryType === "missile") overrides.side = "top";
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
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

export function generateWaveSchedule(wave, commander) {
  const config = getWaveConfig(wave);
  const tactics = commanderPickTactics(commander, wave);

  // Pick counts per type
  const counts = {};
  let totalThreat = 0;
  const typeOrder = ["mirv", "drone238", "drone136", "missile"]; // reduce from highest value first

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

  const missileInterval = Math.max(22, 120 - wave * 8);
  const droneInterval = Math.max(36, 160 - wave * 20);
  const mirvInterval = Math.max(250, 600 - (wave - 5) * 50);

  function spacedTicks(count, interval, jitterFrac, offset) {
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
  const entries = [];

  // Missiles
  const mInterval = hasMissileRain ? Math.max(12, missileInterval * 0.5) : missileInterval;
  const mTicks = spacedTicks(counts.missile, mInterval, 0.15, 30);
  for (let i = 0; i < mTicks.length; i++) {
    entries.push({ tick: mTicks[i], type: "missile", _typeIndex: i });
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

  // MIRVs
  if (counts.mirv > 0) {
    const mOffset = hasMirvStrike ? 40 : 200; // early if MIRV_STRIKE
    const mirvTicks = spacedTicks(counts.mirv, mirvInterval, 0.1, mOffset);
    for (let i = 0; i < mirvTicks.length; i++) {
      entries.push({ tick: mirvTicks[i], type: "mirv", _typeIndex: i });
    }
  }

  // Sort by tick
  entries.sort((a, b) => a.tick - b.tick);

  // Apply MIXED_AXIS: drones from one side, missiles from other side/top
  const mixedSide = hasMixedAxis ? (rand(0, 1) < 0.5 ? "left" : "right") : null;

  // Build schedule with overrides
  const schedule = entries.map((e, globalIdx) => {
    let overrideInput = tactics;
    // MIXED_AXIS: apply directional override manually
    if (hasMixedAxis) {
      // Drones get one side, missiles get opposite/top
      if (e.type.startsWith("drone")) {
        overrideInput = [
          ...tactics.filter((t) => t !== "MIXED_AXIS"),
          mixedSide === "left" ? "LEFT_FLANK" : "RIGHT_FLANK",
        ];
      } else if (e.type === "missile") {
        overrideInput = [...tactics.filter((t) => t !== "MIXED_AXIS"), "TOP_BARRAGE"];
      } else {
        overrideInput = tactics.filter((t) => t !== "MIXED_AXIS");
      }
    }

    const overrides = buildTacticOverrides(overrideInput, e.type, globalIdx);
    const entry = { tick: e.tick, type: e.type };
    if (overrides) entry.overrides = overrides;
    return entry;
  });

  // Concurrent cap — SATURATION raises it by 50%
  const hasSaturation = tactics.includes("SATURATION");
  const concurrentCap = hasSaturation ? Math.floor(config.concurrentCap * 1.5) : config.concurrentCap;

  // Record in commander history
  commander.history.push({ wave, tactics, budget: config.budget });

  return { schedule, concurrentCap, tactics };
}

// ── Runtime helpers ──

export function computeAliveThreatValue(g) {
  let v = 0;
  for (const m of g.missiles) {
    if (m.alive) {
      if (m.type === "mirv") v += THREAT_VALUES.mirv;
      else if (m.type === "mirv_warhead") v += 1.5;
      else v += THREAT_VALUES.missile;
    }
  }
  for (const d of g.drones) {
    if (d.alive) v += d.subtype === "shahed238" ? THREAT_VALUES.drone238 : THREAT_VALUES.drone136;
  }
  return v;
}

export function advanceSpawnSchedule(g, dt, spawnFn) {
  while (g.scheduleIdx < g.schedule.length) {
    const next = g.schedule[g.scheduleIdx];
    if (next.tick > g.waveTick) break;
    const aliveValue = computeAliveThreatValue(g);
    if (aliveValue >= g.concurrentCap) break;
    spawnFn(g, next.type, next.overrides);
    g.scheduleIdx++;
  }
  g.waveTick += dt;
}

export function isWaveFullySpawned(g) {
  return g.scheduleIdx >= g.schedule.length;
}
