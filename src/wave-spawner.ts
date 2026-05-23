import { rand, randInt } from "./game-logic.js";
import type {
  TacticId,
  CommanderStyle,
  Commander,
  SpawnEntry,
  WaveResult,
  WaveSetPiece,
  SpawnType,
  GameState,
  Shahed136Variant,
} from "./types.js";

// ── Threat values ──

export const THREAT_VALUES = {
  missile: 1.5,
  "shahed-136": 0.75,
  "shahed-136-bomber": 1,
  "shahed-136-dive": 1.05,
  "shahed-136-dive-bomber": 1.25,
  drone238: 2.5,
  mirv: 3,
  stack2: 3,
  stack3: 4.5,
};

const SHAHED_136_VARIANTS: Shahed136Variant[] = [
  "shahed-136",
  "shahed-136-bomber",
  "shahed-136-dive",
  "shahed-136-dive-bomber",
];

function isShahed136SpawnType(type: SpawnType): type is Shahed136Variant {
  return SHAHED_136_VARIANTS.includes(type as Shahed136Variant);
}

function isMissileLike(type: SpawnType): type is "missile" | "stack2" | "stack3" | "mirv" {
  return type === "missile" || type === "stack2" || type === "stack3" || type === "mirv";
}

function isDroneLike(type: SpawnType): type is Shahed136Variant | "drone238" {
  return type === "drone238" || isShahed136SpawnType(type);
}

function supportsSideOverride(type: SpawnType): boolean {
  return isDroneLike(type) || type === "missile" || type === "stack2" || type === "stack3";
}

function supportsAltitudeOverride(type: SpawnType): boolean {
  // Altitude tactics spawn threats high so they can descend onto the city.
  // Non-dive Shahed-136 variants cruise horizontally at their spawn y, so
  // sending them to y=40-320 just makes them sail over the Burj harmlessly.
  return type === "drone238" || type === "shahed-136-dive" || type === "shahed-136-dive-bomber";
}

type CellRole = NonNullable<SpawnEntry["role"]>;

interface PlannedEntry {
  tick: number;
  type: SpawnType;
  _typeIndex: number;
  _groupIndex: number;
  _groupCount: number;
  cellId?: string;
  role?: CellRole;
  cellOverrides?: NonNullable<SpawnEntry["overrides"]>;
}

function mergeOverrides(base: SpawnEntry["overrides"], extra: SpawnEntry["overrides"]): SpawnEntry["overrides"] {
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, ...extra };
}

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

export const WAVE_SET_PIECES: Partial<Record<number, WaveSetPiece>> = {
  5: {
    name: "First Split",
    intel: "A single MIRV probe opens the mid-game.",
    tactics: ["MIRV_STRIKE"],
  },
  10: {
    name: "Crosswind Raid",
    intel: "Drones and missiles split attack axes.",
    tactics: ["MIXED_AXIS"],
  },
};

export function getWaveSetPiece(wave: number): WaveSetPiece | null {
  return WAVE_SET_PIECES[wave] ?? null;
}

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
    missile: [4, 6],
    drone136: [3, 4],
    drone238: [0, 0],
    mirv: [0, 0],
    stack2: [0, 0],
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
    budget: 38,
    cap: 18,
    missile: [7, 11],
    drone136: [6, 10],
    drone238: [2, 3],
    mirv: [0, 0],
    stack2: [0, 0],
    stack3: [0, 0],
  },
  {
    budget: 45,
    cap: 22,
    missile: [8, 13],
    drone136: [5, 9],
    drone238: [3, 4],
    mirv: [1, 1],
    stack2: [0, 1],
    stack3: [0, 0],
  },
  {
    budget: 58,
    cap: 28,
    missile: [10, 18],
    drone136: [5, 9],
    drone238: [4, 7],
    mirv: [1, 2],
    stack2: [1, 2],
    stack3: [0, 0],
  },
  {
    budget: 74,
    cap: 34,
    missile: [13, 22],
    drone136: [4, 8],
    drone238: [5, 8],
    mirv: [2, 4],
    stack2: [1, 2],
    stack3: [0, 1],
  },
  {
    budget: 90,
    cap: 40,
    missile: [15, 26],
    drone136: [4, 8],
    drone238: [5, 10],
    mirv: [3, 5],
    stack2: [1, 3],
    stack3: [1, 2],
  },
];

function threatValueCapForBudget(budget: number, wave: number): number {
  const ratio = wave <= 2 ? 0.78 : wave <= 5 ? 0.72 : 0.65;
  return Math.round(budget * ratio);
}

function emptySpawnTypeRanges(): Record<SpawnType, { min: number; max: number }> {
  return {
    missile: { min: 0, max: 0 },
    "shahed-136": { min: 0, max: 0 },
    "shahed-136-bomber": { min: 0, max: 0 },
    "shahed-136-dive": { min: 0, max: 0 },
    "shahed-136-dive-bomber": { min: 0, max: 0 },
    drone238: { min: 0, max: 0 },
    mirv: { min: 0, max: 0 },
    stack2: { min: 0, max: 0 },
    stack3: { min: 0, max: 0 },
  };
}

function getShahed136Weights(wave: number): Partial<Record<Shahed136Variant, number>> {
  if (wave <= 1) return { "shahed-136": 1 };
  if (wave === 2) return { "shahed-136": 0.65, "shahed-136-bomber": 0.35 };
  if (wave === 3) return { "shahed-136": 0.45, "shahed-136-bomber": 0.35, "shahed-136-dive": 0.2 };
  if (wave === 4) {
    return {
      "shahed-136": 0.32,
      "shahed-136-bomber": 0.4,
      "shahed-136-dive": 0.28,
      "shahed-136-dive-bomber": 0,
    };
  }
  if (wave === 5) {
    return {
      "shahed-136": 0.15,
      "shahed-136-bomber": 0.3,
      "shahed-136-dive": 0.25,
      "shahed-136-dive-bomber": 0.3,
    };
  }
  if (wave <= 7) {
    return {
      "shahed-136": 0.08,
      "shahed-136-bomber": 0.22,
      "shahed-136-dive": 0.32,
      "shahed-136-dive-bomber": 0.38,
    };
  }
  return {
    "shahed-136": 0.03,
    "shahed-136-bomber": 0.17,
    "shahed-136-dive": 0.35,
    "shahed-136-dive-bomber": 0.45,
  };
}

function allocateShahed136Variants(wave: number, total: number): Record<Shahed136Variant, number> {
  const weights = getShahed136Weights(wave);
  const counts: Record<Shahed136Variant, number> = {
    "shahed-136": 0,
    "shahed-136-bomber": 0,
    "shahed-136-dive": 0,
    "shahed-136-dive-bomber": 0,
  };
  if (total <= 0) return counts;
  if (wave === 1) {
    // Tutorial wave: exactly 2 dives + 1 bomber, rest base. Establishes the
    // three core drone behaviours (level flight, dive, bomb-drop) on day one
    // without burying the variety under a slog of base shaheds.
    const dives = Math.min(2, total);
    const bombers = total >= 3 ? 1 : 0;
    counts["shahed-136-dive"] = dives;
    counts["shahed-136-bomber"] = bombers;
    counts["shahed-136"] = Math.max(0, total - dives - bombers);
    return counts;
  }

  const active = SHAHED_136_VARIANTS.filter((variant) => (weights[variant] ?? 0) > 0);
  let assigned = 0;
  const weighted = active.map((variant) => {
    const raw = total * (weights[variant] ?? 0);
    const base = Math.floor(raw);
    counts[variant] = base;
    assigned += base;
    return { variant, remainder: raw - base, weight: weights[variant] ?? 0 };
  });

  while (assigned < total) {
    const remainderTotal = weighted.reduce((sum, item) => sum + item.remainder, 0);
    let pick: Shahed136Variant | null = null;
    if (remainderTotal > 0) {
      let r = rand(0, remainderTotal);
      for (const item of weighted) {
        r -= item.remainder;
        if (r <= 0) {
          pick = item.variant;
          break;
        }
      }
    }
    if (!pick) {
      const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
      let r = rand(0, weightTotal);
      for (const item of weighted) {
        r -= item.weight;
        if (r <= 0) {
          pick = item.variant;
          break;
        }
      }
    }
    counts[pick ?? active[active.length - 1]]++;
    assigned++;
  }
  return counts;
}

function getShahed136Ranges(
  wave: number,
  minTotal: number,
  maxTotal: number,
): Record<Shahed136Variant, { min: number; max: number }> {
  if (wave === 1) {
    return {
      "shahed-136": { min: Math.max(0, minTotal - 3), max: Math.max(0, maxTotal - 3) },
      "shahed-136-bomber": { min: minTotal >= 3 ? 1 : 0, max: maxTotal >= 3 ? 1 : 0 },
      "shahed-136-dive": { min: Math.min(2, minTotal), max: Math.min(2, maxTotal) },
      "shahed-136-dive-bomber": { min: 0, max: 0 },
    };
  }

  const weights = getShahed136Weights(wave);
  const ranges = {} as Record<Shahed136Variant, { min: number; max: number }>;
  const activeCount = SHAHED_136_VARIANTS.filter((variant) => (weights[variant] ?? 0) > 0).length;
  for (const variant of SHAHED_136_VARIANTS) {
    const weight = weights[variant] ?? 0;
    const min = activeCount === 1 && weight > 0 ? minTotal : 0;
    const max = weight <= 0 ? 0 : maxTotal;
    ranges[variant] = { min, max };
  }
  return {
    "shahed-136": ranges["shahed-136"],
    "shahed-136-bomber": ranges["shahed-136-bomber"],
    "shahed-136-dive": ranges["shahed-136-dive"],
    "shahed-136-dive-bomber": ranges["shahed-136-dive-bomber"],
  };
}

export function getWaveConfig(wave: number) {
  if (wave >= 1 && wave <= 8) {
    const row = WAVE_TABLE[wave]!;
    const types = emptySpawnTypeRanges();
    const shahedRanges = getShahed136Ranges(wave, row.drone136[0], row.drone136[1]);
    types.missile = { min: row.missile[0], max: row.missile[1] };
    types.drone238 = { min: row.drone238[0], max: row.drone238[1] };
    types.mirv = { min: row.mirv[0], max: row.mirv[1] };
    types.stack2 = { min: row.stack2[0], max: row.stack2[1] };
    types.stack3 = { min: row.stack3[0], max: row.stack3[1] };
    for (const variant of SHAHED_136_VARIANTS) types[variant] = shahedRanges[variant];
    return {
      budget: row.budget,
      concurrentCap: Math.max(row.cap, threatValueCapForBudget(row.budget, wave)),
      shahed136Total: { min: row.drone136[0], max: row.drone136[1] },
      types,
    };
  }
  // Wave 9+: linear pressure with capped quadratic load to avoid screen saturation.
  const w = wave - 8;
  const cappedQuad = Math.min(w, 4);
  const budget = 105 + w * 40 + cappedQuad * cappedQuad * 8;
  const shahed136Total = { min: 3 + w, max: 8 + w * 2 };
  const types = emptySpawnTypeRanges();
  const shahedRanges = getShahed136Ranges(wave, shahed136Total.min, shahed136Total.max);
  types.missile = { min: 16 + w * 5, max: 30 + w * 8 };
  types.drone238 = { min: 6 + w * 3, max: 12 + w * 5 };
  types.mirv = { min: 3 + w, max: 6 + w * 2 };
  types.stack2 = { min: 1 + Math.floor(w * 0.5), max: 3 + w };
  types.stack3 = { min: Math.floor(w * 0.3), max: 1 + Math.floor(w * 0.7) };
  for (const variant of SHAHED_136_VARIANTS) types[variant] = shahedRanges[variant];
  return {
    budget,
    concurrentCap: Math.max(35 + w * 8 + w * w * 1.2, threatValueCapForBudget(budget, wave)),
    shahed136Total,
    types,
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
  if (wave >= 6) pool.push("TOP_BARRAGE");
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
  const setPiece = getWaveSetPiece(wave);
  if (setPiece) return [...setPiece.tactics];

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
  allowRandomFast = true,
): SpawnEntry["overrides"] {
  const overrides: NonNullable<SpawnEntry["overrides"]> = {};
  for (const id of tacticIds) {
    switch (id) {
      case "LEFT_FLANK":
        if (supportsSideOverride(entryType)) overrides.side = "left";
        break;
      case "RIGHT_FLANK":
        if (supportsSideOverride(entryType)) overrides.side = "right";
        break;
      case "PINCER":
        if (supportsSideOverride(entryType)) overrides.side = entryIndex % 2 === 0 ? "left" : "right";
        break;
      case "TOP_BARRAGE":
        if (entryType === "missile" || entryType === "stack2" || entryType === "stack3") overrides.side = "top";
        break;
      case "LOW_APPROACH":
        if (supportsAltitudeOverride(entryType)) overrides.yRange = [200, 320];
        break;
      case "HIGH_APPROACH":
        if (supportsAltitudeOverride(entryType)) overrides.yRange = [40, 120];
        break;
      // DRONE_SWARM and MISSILE_RAIN affect tick spacing, handled during schedule generation
      // MIXED_AXIS handled during schedule generation
      // MIRV_STRIKE handled during schedule generation
      // SATURATION handled via cap modification
    }
  }
  const groupPressure = groupCount <= 1 ? 0 : groupIndex / (groupCount - 1);
  const fastChance =
    wave < 6
      ? 0
      : Math.max(
          0,
          Math.min(
            0.85,
            (wave < 7 ? 0.12 : wave < 10 ? 0.24 : Math.min(0.52, 0.34 + (wave - 10) * 0.04)) +
              groupPressure * 0.16 +
              (entryType === "drone238"
                ? 0.16
                : isShahed136SpawnType(entryType)
                  ? 0.06
                  : entryType === "mirv"
                    ? -0.08
                    : 0),
          ),
        );
  if (allowRandomFast && fastChance > 0 && rand(0, 1) < fastChance) {
    const late = Math.max(0, wave - 7);
    const typeBoost = entryType === "drone238" ? 0.08 : isShahed136SpawnType(entryType) ? 0.04 : 0;
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
): PlannedEntry[] {
  if (entries.length === 0) return [];
  const groupCount = getWaveGroupCount(wave);
  const sorted = [...entries].sort((a, b) => a.tick - b.tick);
  const groupSize = Math.ceil(sorted.length / groupCount);
  const lullBase = Math.max(110, 165 - Math.min(45, wave * 5));
  return sorted.map((entry, index) => {
    const groupIndex = Math.min(groupCount - 1, Math.floor(index / groupSize));
    return { ...entry, tick: entry.tick + groupIndex * lullBase, _groupIndex: groupIndex, _groupCount: groupCount };
  });
}

function rolePriority(type: SpawnType): number {
  if (type === "mirv") return 9;
  if (type === "stack3") return 8;
  if (type === "stack2") return 7;
  if (type === "missile") return 6;
  if (type === "drone238") return 5;
  if (type === "shahed-136-dive-bomber") return 4;
  if (type === "shahed-136-dive") return 3;
  if (type === "shahed-136-bomber") return 2;
  return 1;
}

function cellSizeForTactics(wave: number, tactics: TacticId[]): number {
  if (wave <= 2) return 0;
  if (tactics.includes("SATURATION")) return 3;
  if (tactics.includes("MIXED_AXIS")) return 3;
  if (tactics.includes("DRONE_SWARM")) return 3;
  if (tactics.includes("MIRV_STRIKE")) return 3;
  return 2;
}

function assignCellRoles(entries: PlannedEntry[]): PlannedEntry[] {
  if (entries.length === 0) return [];
  const ranked = entries.map((entry, index) => ({ entry, index, priority: rolePriority(entry.type) }));
  const anchorIndex = ranked.sort((a, b) => b.priority - a.priority || a.index - b.index)[0].index;
  return entries.map((entry, index) => {
    if (index === anchorIndex) return { ...entry, role: "anchor" };
    const role: CellRole =
      index === entries.length - 1 && entries.length >= 3
        ? "punisher"
        : isDroneLike(entry.type)
          ? "disruptor"
          : "screen";
    return { ...entry, role };
  });
}

function sideForCell(cellIndex: number, first: "left" | "right" = "left"): "left" | "right" {
  const evenSide = first;
  const oddSide = first === "left" ? "right" : "left";
  return cellIndex % 2 === 0 ? evenSide : oddSide;
}

function buildCellOverrides(
  entry: PlannedEntry,
  entryIndex: number,
  cellIndex: number,
  tactics: TacticId[],
  wave: number,
): NonNullable<SpawnEntry["overrides"]> {
  const overrides: NonNullable<SpawnEntry["overrides"]> = {};
  const primarySide = tactics.includes("LEFT_FLANK")
    ? "left"
    : tactics.includes("RIGHT_FLANK")
      ? "right"
      : sideForCell(cellIndex);
  const oppositeSide = primarySide === "left" ? "right" : "left";

  if (tactics.includes("MIXED_AXIS")) {
    if (isDroneLike(entry.type)) overrides.side = entryIndex % 2 === 0 ? primarySide : oppositeSide;
    else if (entry.type === "missile" || entry.type === "stack2" || entry.type === "stack3") overrides.side = "top";
  } else if (tactics.includes("PINCER")) {
    if (supportsSideOverride(entry.type)) overrides.side = entryIndex % 2 === 0 ? primarySide : oppositeSide;
  } else if (tactics.includes("TOP_BARRAGE")) {
    if (entry.type === "missile" || entry.type === "stack2" || entry.type === "stack3") overrides.side = "top";
    else if (supportsSideOverride(entry.type)) overrides.side = entryIndex % 2 === 0 ? oppositeSide : primarySide;
  } else if (tactics.includes("LEFT_FLANK") || tactics.includes("RIGHT_FLANK")) {
    if (supportsSideOverride(entry.type)) {
      const useOppositeDisruptor = entry.role === "disruptor" && cellIndex % 3 === 2;
      overrides.side = useOppositeDisruptor ? oppositeSide : primarySide;
    }
  } else if (tactics.includes("MIRV_STRIKE")) {
    if (entry.type === "missile" || entry.type === "stack2" || entry.type === "stack3")
      overrides.side = entry.role === "punisher" ? oppositeSide : "top";
    else if (isDroneLike(entry.type)) overrides.side = entryIndex % 2 === 0 ? primarySide : oppositeSide;
  } else if (supportsSideOverride(entry.type) && wave >= 6) {
    overrides.side = entryIndex % 2 === 0 ? primarySide : oppositeSide;
  }

  if (tactics.includes("DRONE_SWARM") && supportsAltitudeOverride(entry.type)) {
    overrides.side = entryIndex % 2 === 0 ? primarySide : oppositeSide;
    overrides.yRange = entryIndex % 2 === 0 ? [200, 320] : [40, 120];
  } else if (tactics.includes("LOW_APPROACH") && supportsAltitudeOverride(entry.type)) {
    overrides.yRange = [200, 320];
  } else if (tactics.includes("HIGH_APPROACH") && supportsAltitudeOverride(entry.type)) {
    overrides.yRange = [40, 120];
  }

  if (entry.role === "punisher" && wave >= 6 && entry.type !== "mirv") {
    overrides.variant = "fast";
    overrides.speedMul = Math.min(1.38, 1.14 + Math.max(0, wave - 7) * 0.025 + cellIndex * 0.01);
  }

  return overrides;
}

function applyAttackCells(entries: PlannedEntry[], wave: number, tactics: TacticId[]): PlannedEntry[] {
  const cellSize = cellSizeForTactics(wave, tactics);
  if (cellSize <= 0 || entries.length === 0) return entries;

  const byGroup = new Map<number, PlannedEntry[]>();
  for (const entry of entries) {
    const group = byGroup.get(entry._groupIndex) ?? [];
    group.push(entry);
    byGroup.set(entry._groupIndex, group);
  }

  const planned: PlannedEntry[] = [];
  let cellIndex = 0;
  for (const groupIndex of [...byGroup.keys()].sort((a, b) => a - b)) {
    const groupEntries = [...(byGroup.get(groupIndex) ?? [])].sort((a, b) => a.tick - b.tick);
    for (let i = 0; i < groupEntries.length; i += cellSize) {
      const rawCell = groupEntries.slice(i, i + cellSize);
      const roles = assignCellRoles(rawCell);
      const baseTick = Math.min(...roles.map((entry) => entry.tick));
      const cellId = `w${wave}g${groupIndex}c${cellIndex}`;
      const cellSpacing = wave >= 7 ? 22 : 30;
      roles.forEach((entry, entryIndex) => {
        const roleOffset =
          entry.role === "disruptor" ? 0 : entry.role === "anchor" ? cellSpacing : cellSpacing * (entryIndex + 1);
        planned.push({
          ...entry,
          tick: baseTick + roleOffset,
          cellId,
          cellOverrides: buildCellOverrides(entry, entryIndex, cellIndex, tactics, wave),
        });
      });
      cellIndex++;
    }
  }

  return planned.sort((a, b) => a.tick - b.tick);
}

export function generateWaveSchedule(wave: number, commander: Commander): WaveResult {
  const config = getWaveConfig(wave);
  const setPiece = getWaveSetPiece(wave) ?? undefined;
  const tactics = commanderPickTactics(commander, wave);

  // Pick counts per type
  const counts: Record<SpawnType, number> = {
    mirv: 0,
    stack3: 0,
    stack2: 0,
    drone238: 0,
    "shahed-136": 0,
    "shahed-136-bomber": 0,
    "shahed-136-dive": 0,
    "shahed-136-dive-bomber": 0,
    missile: 0,
  };
  let totalThreat = 0;
  const nonShahedTypeOrder: SpawnType[] = ["stack3", "mirv", "stack2", "drone238", "missile"];
  const clampTypeOrder: SpawnType[] = [
    "stack3",
    "mirv",
    "stack2",
    "drone238",
    "shahed-136-dive-bomber",
    "shahed-136-dive",
    "shahed-136-bomber",
    "missile",
    "shahed-136",
  ];

  for (const type of nonShahedTypeOrder) {
    const range = config.types[type];
    counts[type] = randInt(range.min, range.max);
    totalThreat += counts[type] * THREAT_VALUES[type];
  }
  const shahedCounts = allocateShahed136Variants(wave, randInt(config.shahed136Total.min, config.shahed136Total.max));
  for (const variant of SHAHED_136_VARIANTS) {
    counts[variant] = shahedCounts[variant];
    totalThreat += counts[variant] * THREAT_VALUES[variant];
  }

  // Clamp to budget — reduce from highest-value types first
  for (const type of clampTypeOrder) {
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
  // Wave 1 is the tutorial — keep the threat *count* low (see drone136 range +
  // allocateShahed136Variants special case) but pull the spawns closer together
  // so it doesn't drag once the player knows what they're doing.
  const earlyWaveScale = wave === 1 ? 0.65 : 1;
  const missileInterval = Math.max(Math.max(3, 7 - lateFloor), 63 - wave * 5) * WAVE_DURATION_SCALE * earlyWaveScale;
  const droneInterval = Math.max(Math.max(4, 10 - lateFloor), 84 - wave * 8) * WAVE_DURATION_SCALE * earlyWaveScale;
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

  // Shahed-136 prop variants
  const d136Interval = hasDroneSwarm ? Math.max(8, droneInterval * 0.3) : droneInterval;
  let shahedTickOffset = 0;
  for (const variant of SHAHED_136_VARIANTS) {
    if (wave === 1 && (variant === "shahed-136-dive" || variant === "shahed-136-bomber") && counts[variant] > 0) {
      // Wave 1: place the bomber and the dives across the wave so the player
      // hits all three drone behaviours in sequence — base shaheds early,
      // bomber mid, first dive mid, second dive as the closing flourish.
      const baseCount = Math.max(1, counts["shahed-136"]);
      const span = baseCount * d136Interval;
      const bomberFraction = 0.5;
      const diveFractions = [0.55, 0.95];
      for (let i = 0; i < counts[variant]; i++) {
        const fraction =
          variant === "shahed-136-bomber"
            ? bomberFraction
            : (diveFractions[i] ?? diveFractions[diveFractions.length - 1]);
        entries.push({ tick: Math.round(50 + span * fraction), type: variant, _typeIndex: i });
      }
      shahedTickOffset += 12;
      continue;
    }
    const offset = 50 + shahedTickOffset;
    const variantTicks = spacedTicks(counts[variant], d136Interval, 0.15, offset);
    shahedTickOffset += 12;
    for (let i = 0; i < variantTicks.length; i++) {
      entries.push({ tick: variantTicks[i], type: variant, _typeIndex: i });
    }
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

  const groupedEntries = applyAttackCells(
    addGroupLulls(entries, wave).sort((a, b) => a.tick - b.tick),
    wave,
    tactics,
  );

  // Apply MIXED_AXIS: drones from one side, missiles from other side/top
  const mixedSide = hasMixedAxis ? (rand(0, 1) < 0.5 ? "left" : "right") : null;

  // Build schedule with overrides
  const schedule = groupedEntries.map((e, globalIdx) => {
    let overrideInput = tactics;
    // MIXED_AXIS: apply directional override manually
    if (hasMixedAxis) {
      // Drones get one side, missiles get opposite/top
      if (isDroneLike(e.type)) {
        overrideInput = [
          ...tactics.filter((t) => t !== "MIXED_AXIS"),
          mixedSide === "left" ? "LEFT_FLANK" : "RIGHT_FLANK",
        ];
      } else if (isMissileLike(e.type) && e.type !== "mirv") {
        overrideInput = [...tactics.filter((t) => t !== "MIXED_AXIS"), "TOP_BARRAGE"];
      } else {
        overrideInput = tactics.filter((t) => t !== "MIXED_AXIS");
      }
    }

    const tacticOverrides = buildTacticOverrides(
      overrideInput,
      e.type,
      globalIdx,
      e._groupIndex,
      e._groupCount,
      wave,
      !e.cellId,
    );
    const overrides = mergeOverrides(tacticOverrides, e.cellOverrides);
    const entry: SpawnEntry = { tick: e.tick, type: e.type };
    if (e.cellId) entry.cellId = e.cellId;
    if (e.role) entry.role = e.role;
    if (overrides) entry.overrides = overrides;
    return entry;
  });

  const concurrentCap = tactics.includes("SATURATION")
    ? Math.min(config.budget, Math.round(config.concurrentCap * 1.18))
    : config.concurrentCap;

  // Record in commander history
  commander.history.push({ wave, tactics });

  return { schedule, concurrentCap, tactics, setPiece };
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
    if (d.alive) {
      v += d.subtype === "shahed238" ? THREAT_VALUES.drone238 : THREAT_VALUES[d.shahedVariant ?? "shahed-136"];
    }
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
    if (aliveValue + getThreatValue(next.type) > g.concurrentCap) {
      const bypassIndex = findSameCellBypassIndex(g, next, aliveValue);
      if (bypassIndex === -1) break;
      const [bypass] = g.schedule.splice(bypassIndex, 1);
      spawnFn(g, bypass.type, bypass.overrides);
      continue;
    }
    spawnFn(g, next.type, next.overrides);
    g.scheduleIdx++;
  }
  g.waveTick += dt;
}

function findSameCellBypassIndex(
  g: Pick<GameState, "schedule" | "scheduleIdx" | "waveTick" | "concurrentCap">,
  blocked: SpawnEntry,
  aliveValue: number,
): number {
  if (!blocked.cellId) return -1;
  for (let i = g.scheduleIdx + 1; i < g.schedule.length; i++) {
    const candidate = g.schedule[i];
    if (candidate.tick > g.waveTick) break;
    if (candidate.cellId !== blocked.cellId) continue;
    if (candidate.role !== "disruptor" && candidate.role !== "screen") continue;
    const value = getThreatValue(candidate.type);
    if (value <= 1.25 && aliveValue + value <= g.concurrentCap) return i;
  }
  return -1;
}

export function isWaveFullySpawned(g: Pick<GameState, "schedule" | "scheduleIdx">) {
  return g.scheduleIdx >= g.schedule.length;
}
