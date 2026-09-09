// Shared score probe.
//
// Intercepts every write to GameState.score during a headless run and tags it
// with the subsystem responsible, and records a per-event log that downstream
// tools can re-score under alternative rules.
//
// This is safe to do offline because g.combo is score-only: grep shows it is
// read at the five score-award sites, the HUD, and the maxCombo stat, and
// nowhere in spawning, targeting, damage or the fire economy. Re-scoring a
// recorded event log under a different combo rule is therefore exact, not an
// approximation — the run itself would have played out identically.

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { Explosion, GameState } from "../types";

export type Tagged = Explosion & { _src?: string; _bornTick?: number };

// ── source maps, derived from the source files themselves ─────────────────────
// Stack frames give us file:line but no function names (the sim is built from
// arrow callbacks), so we build the file:line -> label maps by reading the sim
// source at startup. That keeps the tool honest when the sim is edited.

export const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (f: string) => readFileSync(resolve(SRC, f), "utf8").split("\n");

const WEAPON_BY_COLOR: [RegExp, string][] = [
  [/COL\.hornet/, "hornet"],
  [/COL\.roadrunner/, "roadrunner"],
  [/COL\.patriot/, "patriot"],
  [/COL\.interceptor/, "player-interceptor"],
  [/COL\.flare/, "flare"],
  [/COL\.phalanx/, "phalanx"],
  [/COL\.laser/, "ironbeam"],
  [/COL\.emp/, "emp"],
];

function labelFromWindow(lines: string[], idx: number, span = 12): string | null {
  const chunk = lines.slice(idx, idx + span).join("\n");
  for (const [re, label] of WEAPON_BY_COLOR) if (re.test(chunk)) return label;
  return null;
}

/** file:line of every boom()/createExplosion() call site -> the weapon that owns it. */
const explosionSites = new Map<string, string>();
/** file:line of every score write -> a coarse kind. */
const scoreSites = new Map<string, string>();
/** file:line of every damageTarget() call site -> the weapon that owns it. */
const damageSites = new Map<string, string>();

for (const file of ["game-sim.ts", "game-sim-flare.ts", "game-sim-emp.ts", "game-sim-patriot.ts"]) {
  const lines = readSrc(file);
  lines.forEach((line, i) => {
    const key = `${file}:${i + 1}`;
    if (/\bboom\(/.test(line) && !/function boom/.test(line)) {
      explosionSites.set(key, labelFromWindow(lines, i) ?? (file === "game-sim-flare.ts" ? "flare" : "enemy-impact"));
    }
    if (/\bdamageTarget\(/.test(line) && !/function damageTarget/.test(line)) {
      damageSites.set(key, labelFromWindow(lines, i, 3) ?? "unknown-weapon");
    }
    if (/\.score\s*[+-]=/.test(line)) {
      const win = lines.slice(Math.max(0, i - 8), i + 2).join("\n");
      if (/getBuildingSurvivalBonus/.test(line)) scoreSites.set(key, "bonus:buildings-survived");
      else if (/250 \* g\.wave/.test(line)) scoreSites.set(key, "bonus:wave-clear");
      else if (/\.score\s*-=/.test(line)) scoreSites.set(key, "penalty:f15-friendly-fire");
      else if (/getKillReward/.test(line)) scoreSites.set(key, /updateFlares|destroyThreat/.test(win) ? "kill:flare" : "kill:aoe");
      else if (/[Bb]onus/.test(line)) scoreSites.set(key, "multikill:aoe");
      else scoreSites.set(key, "unclassified");
    }
  });
}
{
  const lines = readSrc("game-logic.ts");
  lines.forEach((line, i) => {
    if (/\.score\s*\+=/.test(line) && /getKillReward/.test(line)) {
      scoreSites.set(`game-logic.ts:${i + 1}`, "kill:damageTarget");
    }
  });
}
// The buildings-survived bonus is applied by the host (bonus screen in the browser,
// the sim-runner sink headlessly), not by the sim.
{
  const lines = readSrc("headless/sim-runner.ts");
  lines.forEach((line, i) => {
    if (/getBuildingSurvivalBonus/.test(line) && /\.score\s*\+=/.test(line)) {
      scoreSites.set(`sim-runner.ts:${i + 1}`, "bonus:buildings-survived");
    }
  });
}

Error.stackTraceLimit = 60;
const FRAME_RE = /([A-Za-z0-9._-]+\.ts):(\d+):\d+/;

function frames(): { key: string; raw: string }[] {
  const err = new Error();
  const out: { key: string; raw: string }[] = [];
  for (const raw of (err.stack ?? "").split("\n").slice(2)) {
    const m = FRAME_RE.exec(raw);
    if (m) out.push({ key: `${m[1]}:${m[2]}`, raw });
  }
  return out;
}

/** Which weapon created this explosion? Walk out until we hit a known boom() site. */
function classifyExplosionSource(fs: { key: string }[]): string {
  for (const f of fs) {
    const hit = explosionSites.get(f.key);
    if (hit) return hit;
  }
  return "other";
}

/** Which subsystem awarded these points? */
function classifyScore(fs: { key: string }[], currentSrc: string | null): string {
  for (const f of fs) {
    const kind = scoreSites.get(f.key);
    if (!kind) continue;
    if (kind === "kill:aoe") return `kill:${currentSrc ?? "?"}`;
    if (kind === "multikill:aoe") return `multikill:${currentSrc ?? "?"}`;
    if (kind === "kill:damageTarget") {
      for (const g of fs) {
        const w = damageSites.get(g.key);
        if (w) return `kill:${w}`;
      }
      return "kill:direct-damage";
    }
    return kind;
  }
  return "unknown";
}


// ── event log ─────────────────────────────────────────────────────────────────
/** One player-interceptor blast resolving. This is the unit the combo counter
 *  advances on: kills >= 1 increments, kills === 0 resets. */
export interface BlastEvent {
  kind: "blast";
  tick: number; // when the blast resolved (combo is evaluated here)
  bornTick: number; // when the interceptor detonated — the rhythm signal
  wave: number;
  kills: number;
  source: string;
}
/** One threat dying. baseReward is the pre-combo value. */
export interface KillEvent {
  kind: "kill";
  tick: number;
  wave: number;
  source: string;
  baseReward: number;
  fromPlayerBlast: boolean;
}
/** A flat award that no combo rule touches (wave clear, buildings survived). */
export interface FlatEvent {
  kind: "flat";
  tick: number;
  wave: number;
  label: string;
  points: number;
}
/** A multi-kill bonus, tagged with whose blast earned it. */
export interface MultiKillEvent {
  kind: "multikill";
  tick: number;
  wave: number;
  source: string;
  points: number;
  fromPlayerBlast: boolean;
}
export interface ShotEvent {
  kind: "shot";
  tick: number;
  wave: number;
}
export type RunEvent = BlastEvent | KillEvent | FlatEvent | MultiKillEvent | ShotEvent;

export interface Ledger {
  bySource: Record<string, number>;
  comboAmplification: number; // points that exist only because combo > 1
  baseKillPoints: number; // sum of raw kill rewards, combo stripped
  killsBySource: Record<string, number>;
  comboSamples: number[];
  rawSites: Record<string, number>;
  comboAmpBySource: Record<string, number>;
  events: RunEvent[];
}

export function attachScoreProbe(g: GameState, led: Ledger): void {
  let currentEx: Tagged | null = null;

  // Tag explosions with their creator, and let chain blasts inherit their root's tag.
  let arr = g.explosions as Tagged[];
  const wrap = (a: Tagged[]): Tagged[] => {
    const push = Array.prototype.push.bind(a);
    const forEach = Array.prototype.forEach.bind(a);
    Object.defineProperty(a, "push", {
      configurable: true,
      value: (...items: Tagged[]) => {
        const fs = frames();
        for (const it of items) {
          // Chain blasts belong to whatever weapon started the chain.
          it._src =
            it.rootExplosionId != null
              ? (a.find((e) => e.id === it.rootExplosionId)?._src ?? "chain")
              : classifyExplosionSource(fs);
          it._bornTick = Math.floor(g.time);
        }
        return push(...items);
      },
    });
    Object.defineProperty(a, "forEach", {
      configurable: true,
      value: (cb: (e: Tagged, i: number, all: Tagged[]) => void, thisArg?: unknown) =>
        forEach((e: Tagged, i: number, all: Tagged[]) => {
          const prev = currentEx;
          currentEx = e;
          try {
            cb.call(thisArg, e, i, all);
          } finally {
            currentEx = prev;
          }
        }),
    });
    return a;
  };
  wrap(arr);
  Object.defineProperty(g, "explosions", {
    configurable: true,
    get: () => arr,
    set: (v: Tagged[]) => {
      arr = wrap(v);
    },
  });

  // Intercept combo writes. Every write to g.combo is exactly one combo step:
  // processRootExplosionCombo iterates g.explosions, so currentEx is the player
  // blast that just resolved, and we read its kill count and detonation tick
  // straight off it. This is the unit any alternative combo rule operates on.
  let combo = g.combo;
  Object.defineProperty(g, "combo", {
    configurable: true,
    get: () => combo,
    set: (v: number) => {
      const prev = combo;
      combo = v;
      if (currentEx && currentEx.playerCaused && currentEx.rootExplosionId === null) {
        led.events.push({
          kind: "blast",
          tick: Math.floor(g.time),
          bornTick: currentEx._bornTick ?? Math.floor(g.time),
          wave: g.wave,
          kills: currentEx.kills ?? 0,
          source: currentEx._src ?? "player-interceptor",
        });
      }
      void prev;
    },
  });

  // Intercept every score write.
  let score = g.score;
  Object.defineProperty(g, "score", {
    configurable: true,
    get: () => score,
    set: (v: number) => {
      const delta = v - score;
      score = v;
      if (delta === 0) return;
      const fs = frames();
      const tag = classifyScore(fs, currentEx?._src ?? null);
      const tick = Math.floor(g.time);
      const fromPlayer = currentEx?._src === "player-interceptor";
      if (tag.startsWith("kill:")) {
        led.events.push({
          kind: "kill",
          tick,
          wave: g.wave,
          source: tag.slice(5),
          baseReward: delta / Math.max(1, g.combo),
          fromPlayerBlast: fromPlayer,
        });
      } else if (tag.startsWith("multikill:")) {
        led.events.push({
          kind: "multikill",
          tick,
          wave: g.wave,
          source: tag.slice(10),
          points: delta,
          fromPlayerBlast: fromPlayer,
        });
      } else if (tag.startsWith("bonus:") || tag.startsWith("penalty:")) {
        led.events.push({ kind: "flat", tick, wave: g.wave, label: tag, points: delta });
      }
      led.bySource[tag] = (led.bySource[tag] ?? 0) + delta;
      if (tag === "unknown" || tag === "unclassified") {
        const site = fs.slice(0, 4).map((f) => f.key).join(" <- ");
        led.rawSites[site] = (led.rawSites[site] ?? 0) + delta;
      }
      if (tag.startsWith("kill:")) {
        const combo = Math.max(1, g.combo);
        const base = delta / combo;
        led.baseKillPoints += base;
        led.comboAmplification += delta - base;
        led.comboAmpBySource[tag] = (led.comboAmpBySource[tag] ?? 0) + (delta - base);
        led.killsBySource[tag] = (led.killsBySource[tag] ?? 0) + 1;
        led.comboSamples.push(combo);
      }
    },
  });
}

export function reportUnclassified(led: Ledger): void {
  for (const [site, pts] of Object.entries(led.rawSites)) {
    console.log(`  !! unclassified ${pts} pts from ${site}`);
  }
}

export function emptyLedger(): Ledger {
  return {
    bySource: {},
    comboAmplification: 0,
    baseKillPoints: 0,
    killsBySource: {},
    comboSamples: [],
    rawSites: {},
    comboAmpBySource: {},
    events: [],
  };
}


