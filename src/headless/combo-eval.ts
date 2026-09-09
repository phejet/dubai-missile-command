// Combo-scheme evaluator.
//
// Records a per-event log from headless runs, then re-scores that same log under
// alternative combo rules. This is exact rather than approximate: g.combo is
// read only at the score-award sites, the HUD and the maxCombo stat, so a
// different combo rule would not have changed how any run played out.
//
// Usage:
//   npx tsx src/headless/combo-eval.ts --games=40 [--seed=1000] [--json=out.json]

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { runGame } from "./sim-runner";
import { SRC, attachScoreProbe, emptyLedger, type BlastEvent, type RunEvent } from "./score-probe";

const args = process.argv.slice(2);
const getArg = (name: string, def: string): string => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : def;
};

const TIERS = ["novice", "average", "good", "perfect"] as const;
type Tier = (typeof TIERS)[number];

// Hold the upgrade build constant so a tier comparison measures aim and
// reaction skill rather than which upgrades the preset happens to buy.
const baseConfig = JSON.parse(readFileSync(resolve(SRC, "headless/bot-config.json"), "utf8"));
{
  const shared = baseConfig.presets.perfect.upgradePriority;
  for (const p of Object.values(baseConfig.presets) as Record<string, unknown>[]) {
    p.upgradePriority = shared;
    delete p.upgradeStrategy;
  }
}

interface Run {
  tier: Tier;
  seed: number;
  wave: number;
  score: number;
  shots: number;
  kills: number;
  events: RunEvent[];
}

function record(tier: Tier, seed: number): Run {
  const led = emptyLedger();
  const res = runGame(baseConfig, {
    seed,
    preset: tier,
    isHuman: true,
    maxTicks: 200000,
    onInit: (g) => attachScoreProbe(g, led),
  });
  return {
    tier,
    seed,
    wave: res.wave,
    score: res.score,
    shots: res.stats.shotsFired,
    kills: res.stats.missileKills + res.stats.droneKills,
    events: led.events,
  };
}

// ── scheme framework ──────────────────────────────────────────────────────────
// Every scheme returns only its COMBO TERM. The rest of the score (base kill
// rewards, multi-kill bonuses, flat wave bonuses) is identical across schemes,
// so isolating the combo term is what makes them comparable.

interface SchemeResult {
  comboTerm: number;
  triggers: number; // how many times the player is shown a payoff
}
interface Scheme {
  name: string;
  blurb: string;
  run: (events: RunEvent[], k: number) => SchemeResult;
  /** true when `k` is a free payout constant to be calibrated, false when it is a scale factor */
  calibrates: boolean;
}

/** Current shipped rule: +1 per hitting blast (cap 10), reset to 1 on a whiff,
 *  multiplies every kill in the game including automated ones. */
const current: Scheme = {
  name: "current",
  blurb: "x1..x10 multiplier, +1 per hitting shot, resets to x1 on a miss, applied to ALL kills",
  calibrates: false,
  run: (events, k) => {
    let combo = 1;
    let term = 0;
    let triggers = 0;
    for (const e of events) {
      if (e.kind === "blast") {
        if (e.kills >= 1) {
          const next = Math.min(10, combo + 1);
          if (next > combo) triggers++;
          combo = next;
        } else combo = 1;
      } else if (e.kind === "kill") {
        term += e.baseReward * (combo - 1);
      }
    }
    return { comboTerm: term * k, triggers };
  },
};

/** Same multiplier, but it only pays out on kills from the player's own blasts. */
const playerOnly: Scheme = {
  name: "player-only",
  blurb: "identical multiplier, but automated kills are paid at base rate (no combo)",
  calibrates: false,
  run: (events, k) => {
    let combo = 1;
    let term = 0;
    let triggers = 0;
    for (const e of events) {
      if (e.kind === "blast") {
        if (e.kills >= 1) {
          const next = Math.min(10, combo + 1);
          if (next > combo) triggers++;
          combo = next;
        } else combo = 1;
      } else if (e.kind === "kill" && e.fromPlayerBlast) {
        term += e.baseReward * (combo - 1);
      }
    }
    return { comboTerm: term * k, triggers };
  },
};

/** Cash-out: count consecutive hitting shots to N, pay a flat bonus, reset to 0.
 *  Kills themselves always pay base rate. */
function cashout(n: number, escalating = false): Scheme {
  return {
    name: escalating ? `cashout-${n}-escalating` : `cashout-${n}`,
    blurb: escalating
      ? `${n} hits in a row pays a bonus that grows with each cash-out held in the same wave`
      : `${n} consecutive hitting shots pays a flat bonus and resets the counter to 0`,
    calibrates: true,
    run: (events, k) => {
      let streak = 0;
      let chain = 0;
      let wave = 1;
      let term = 0;
      let triggers = 0;
      for (const e of events) {
        if ("wave" in e && e.wave !== wave) {
          wave = e.wave;
          chain = 0;
        }
        if (e.kind !== "blast") continue;
        if (e.kills >= 1) {
          streak++;
          if (streak >= n) {
            streak = 0;
            term += escalating ? k * (1 + chain * 0.5) : k;
            chain++;
            triggers++;
          }
        } else {
          streak = 0;
          chain = 0;
        }
      }
      return { comboTerm: term, triggers };
    },
  };
}

/** Rhythm: N consecutive hits pay out, but the bonus scales with how tightly the
 *  blasts landed. windowTicks is the span within which a full-value burst must fit. */
function rhythm(n: number, windowTicks: number): Scheme {
  return {
    name: `rhythm-${n}@${windowTicks}t`,
    blurb: `${n} hits in a row, bonus scaled by tightness — full value if all ${n} land within ${windowTicks} ticks, tapering to 0.25x when spread out`,
    calibrates: true,
    run: (events, k) => {
      const streak: BlastEvent[] = [];
      let term = 0;
      let triggers = 0;
      for (const e of events) {
        if (e.kind !== "blast") continue;
        if (e.kills >= 1) {
          streak.push(e);
          if (streak.length >= n) {
            const span = streak[streak.length - 1].bornTick - streak[0].bornTick;
            const tightness = Math.max(0.25, Math.min(1, windowTicks / Math.max(1, span)));
            term += k * tightness;
            triggers++;
            streak.length = 0;
          }
        } else streak.length = 0;
      }
      return { comboTerm: term, triggers };
    },
  };
}

/** Rolling window: pay out every time N hits land inside a W-tick window. A miss
 *  does not reset anything — it simply fails to advance the window. Rewards
 *  density of good shooting rather than an unbroken run of it. */
function windowBurst(n: number, windowTicks: number): Scheme {
  return {
    name: `window-${n}@${windowTicks}t`,
    blurb: `pays every time ${n} hits land inside a rolling ${windowTicks}-tick window; misses do not reset, they just do not count`,
    calibrates: true,
    run: (events, k) => {
      const hits: number[] = [];
      let term = 0;
      let triggers = 0;
      for (const e of events) {
        if (e.kind !== "blast" || e.kills < 1) continue;
        hits.push(e.bornTick);
        while (hits.length && e.bornTick - hits[0] > windowTicks) hits.shift();
        if (hits.length >= n) {
          term += k;
          triggers++;
          hits.length = 0;
        }
      }
      return { comboTerm: term, triggers };
    },
  };
}

/** Tempo: the multiplier decays with time as well as on misses, so holding a high
 *  multiplier requires sustained pressure rather than just never whiffing. */
function tempo(decayTicks: number): Scheme {
  return {
    name: `tempo-${decayTicks}t`,
    blurb: `multiplier +1 per hit, -1 for every ${decayTicks} ticks without a hit, -2 on a miss; pays player kills only`,
    calibrates: false,
    run: (events, k) => {
      let combo = 1;
      let lastHit = 0;
      let term = 0;
      let triggers = 0;
      for (const e of events) {
        if (e.kind === "blast") {
          const idle = Math.floor((e.bornTick - lastHit) / decayTicks);
          if (idle > 0) combo = Math.max(1, combo - idle);
          if (e.kills >= 1) {
            const next = Math.min(10, combo + 1);
            if (next > combo) triggers++;
            combo = next;
            lastHit = e.bornTick;
          } else {
            combo = Math.max(1, combo - 2);
            lastHit = e.bornTick;
          }
        } else if (e.kind === "kill" && e.fromPlayerBlast) {
          term += e.baseReward * (combo - 1);
        }
      }
      return { comboTerm: term * k, triggers };
    },
  };
}

/** Superlinear multiplier: every hit still advances it (so the player gets
 *  feedback on each shot, like today) but the value grows faster than linearly,
 *  so the high rungs are worth disproportionately more and only good play
 *  reaches them. Pays player kills only. */
const escalatingMult: Scheme = {
  name: "escalating-mult",
  blurb:
    "continuous multiplier like today, but superlinear (x1, x2, x4, x7, x11...) so the top rungs are worth far more; player kills only",
  calibrates: false,
  run: (events, k) => {
    const value = (s: number) => 1 + (s * (s + 1)) / 2;
    let streak = 0;
    let term = 0;
    let triggers = 0;
    for (const e of events) {
      if (e.kind === "blast") {
        if (e.kills >= 1) {
          if (streak < 5) triggers++;
          streak = Math.min(5, streak + 1);
        } else streak = 0;
      } else if (e.kind === "kill" && e.fromPlayerBlast) {
        term += e.baseReward * (value(streak) - 1);
      }
    }
    return { comboTerm: term * k, triggers };
  },
};

/** The full rhythm proposal: cash out every 3 hits, value scaled by how tightly
 *  the three landed AND by how many cash-outs have been chained without a miss. */
const rhythmChain: Scheme = {
  name: "rhythm-3-chain",
  blurb:
    "cash out every 3 hits; value x tightness (all 3 inside 90 ticks = full) x chain bonus (+75% per consecutive cash-out, reset on a miss)",
  calibrates: true,
  run: (events, k) => {
    const streak: BlastEvent[] = [];
    let chain = 0;
    let term = 0;
    let triggers = 0;
    for (const e of events) {
      if (e.kind !== "blast") continue;
      if (e.kills >= 1) {
        streak.push(e);
        if (streak.length >= 3) {
          const span = streak[streak.length - 1].bornTick - streak[0].bornTick;
          const tightness = Math.max(0.25, Math.min(1, 90 / Math.max(1, span)));
          term += k * tightness * (1 + chain * 0.75);
          chain++;
          triggers++;
          streak.length = 0;
        }
      } else {
        streak.length = 0;
        chain = 0;
      }
    }
    return { comboTerm: term, triggers };
  },
};

const SCHEMES: Scheme[] = [
  escalatingMult,
  rhythmChain,
  current,
  playerOnly,
  cashout(3),
  cashout(3, true),
  cashout(5),
  cashout(5, true),
  rhythm(3, 60),
  rhythm(3, 120),
  rhythm(5, 150),
  windowBurst(3, 90),
  windowBurst(3, 150),
  windowBurst(4, 150),
  tempo(90),
  tempo(150),
];

// ── run ───────────────────────────────────────────────────────────────────────
const games = parseInt(getArg("games", "40"));
const baseSeed = parseInt(getArg("seed", "1000"));

const runs: Run[] = [];
for (const tier of TIERS) for (let i = 0; i < games; i++) runs.push(record(tier, baseSeed + i));

// --reform re-bases the score on the structural fixes from the attribution pass
// (flat per-wave income cut to a third and scaled by city integrity, automated
// kills paid at 0.45x, multi-kill bonuses gated to the player's own blasts).
// Under that base the combo term is a far larger share of the score, so it shows
// how much the choice of combo rule actually matters once the flat income that
// currently drowns it is removed.
const REFORM = args.includes("--reform");
const AUTO_RATE = 0.45;

/** Points that no combo rule touches: base kill value, multi-kill bonuses, flat bonuses. */
function baseScore(events: RunEvent[]): number {
  let s = 0;
  for (const e of events) {
    if (e.kind === "kill") {
      s += REFORM && !e.fromPlayerBlast ? e.baseReward * AUTO_RATE : e.baseReward;
    } else if (e.kind === "multikill") {
      s += REFORM && !e.fromPlayerBlast ? 0 : e.points;
    } else if (e.kind === "flat") {
      if (!REFORM || !e.label.startsWith("bonus:")) {
        s += e.points;
      } else if (e.label === "bonus:buildings-survived") {
        // The award is 100 * buildingsAlive * wave, so the count is recoverable.
        const alive = e.points / (100 * Math.max(1, e.wave));
        s += (e.points / 3) * (alive / 12);
      } else {
        s += e.points / 3;
      }
    }
  }
  return s;
}

// Calibrate every scheme to spend the SAME total combo budget as the current
// rule across the whole dataset, so comparisons isolate the shape of the
// mechanic rather than how generous its constant happens to be.
const currentBudget = runs.reduce((a, r) => a + current.run(r.events, 1).comboTerm, 0);
const calibration = new Map<string, number>();
for (const s of SCHEMES) {
  const unit = runs.reduce((a, r) => a + s.run(r.events, 1).comboTerm, 0);
  calibration.set(s.name, unit > 0 ? currentBudget / unit : 0);
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy || 1);
}

interface SchemeReport {
  name: string;
  blurb: string;
  byTier: Record<string, { median: number; ratio: number; comboShare: number; triggersPerWave: number }>;
  skillSpread: number;
  accuracyCorr: number;
  sameWaveSpread: number;
}

const reports: SchemeReport[] = [];
for (const s of SCHEMES) {
  const k = calibration.get(s.name)!;
  const per = runs.map((r) => {
    const { comboTerm, triggers } = s.run(r.events, k);
    return { r, total: baseScore(r.events) + comboTerm, comboTerm, triggers };
  });
  const byTier: SchemeReport["byTier"] = {};
  let novMedian = 0;
  for (const t of TIERS) {
    const rows = per.filter((p) => p.r.tier === t);
    const m = median(rows.map((p) => p.total));
    if (t === "novice") novMedian = m;
    byTier[t] = {
      median: m,
      ratio: m / (novMedian || 1),
      comboShare: median(rows.map((p) => p.comboTerm / Math.max(1, p.total))),
      triggersPerWave: median(rows.map((p) => p.triggers / Math.max(1, p.r.wave))),
    };
  }
  // Does the combo term track accuracy WITHIN a skill tier? Pooling across tiers
  // just re-measures the tier gap, so correlate inside each tier and average.
  const tierCorrs = TIERS.map((t) => {
    const rows = per.filter((p) => p.r.tier === t);
    return pearson(
      rows.map((p) => p.comboTerm / Math.max(1, p.r.wave)),
      rows.map((p) => p.r.kills / Math.max(1, p.r.shots)),
    );
  }).filter((c) => Number.isFinite(c));
  // Same-wave separation: within each final wave, best tier vs worst tier present.
  const spreads: number[] = [];
  const waves = new Set(per.map((p) => p.r.wave));
  for (const w of waves) {
    const present = TIERS.filter((t) => per.filter((p) => p.r.wave === w && p.r.tier === t).length >= 3);
    if (present.length < 2) continue;
    const lo = median(per.filter((p) => p.r.wave === w && p.r.tier === present[0]).map((p) => p.total));
    const hi = median(
      per.filter((p) => p.r.wave === w && p.r.tier === present[present.length - 1]).map((p) => p.total),
    );
    if (lo > 0) spreads.push(hi / lo);
  }
  reports.push({
    name: s.name,
    blurb: s.blurb,
    byTier,
    skillSpread: byTier.perfect.median / (byTier.novice.median || 1),
    accuracyCorr: tierCorrs.reduce((a, b) => a + b, 0) / Math.max(1, tierCorrs.length),
    sameWaveSpread: spreads.length ? median(spreads) : NaN,
  });
}

console.log(
  `\n${runs.length} runs (${games} per tier), upgrade build held constant` +
    `${REFORM ? " — REFORMED base (flat income cut, automated kills at 0.45x, multikills player-gated)" : " — current base"}\n`,
);
console.log(
  `${"scheme".padEnd(22)}${"nov".padStart(9)}${"avg".padStart(9)}${"good".padStart(9)}${"perf".padStart(10)}` +
    `${"spread".padStart(9)}${"same-wave".padStart(11)}${"combo%".padStart(9)}${"acc corr".padStart(10)}${"fires/wave".padStart(12)}`,
);
for (const r of reports) {
  console.log(
    r.name.padEnd(22) +
      TIERS.map((t) => Math.round(r.byTier[t].median).toLocaleString().padStart(t === "perfect" ? 10 : 9)).join("") +
      `${r.skillSpread.toFixed(2)}x`.padStart(9) +
      (Number.isFinite(r.sameWaveSpread) ? `${r.sameWaveSpread.toFixed(3)}x` : "-").padStart(11) +
      `${(r.byTier.perfect.comboShare * 100).toFixed(1)}%`.padStart(9) +
      r.accuracyCorr.toFixed(2).padStart(10) +
      r.byTier.perfect.triggersPerWave.toFixed(1).padStart(12),
  );
}

// ── is a tight burst actually harder? ────────────────────────────────────────
// The design premise behind a rhythm bonus is that landing 3 shots in quick
// succession is harder than 3 spread out. Test it: bucket every player blast by
// the gap since the previous one and measure the hit rate in each bucket.
console.log(`\n── hit rate by gap since the previous shot (does firing fast cost accuracy?) ──`);
const BUCKETS: [number, number][] = [
  [0, 15],
  [15, 30],
  [30, 60],
  [60, 120],
  [120, Infinity],
];
console.log(
  `${"tier".padEnd(10)}` + BUCKETS.map(([a, b]) => `${a}-${b === Infinity ? "+" : b}t`.padStart(14)).join(""),
);
const burstStats: Record<string, { lo: number; hi: number; rate: number; n: number }[]> = {};
for (const t of TIERS) {
  const row: { lo: number; hi: number; rate: number; n: number }[] = BUCKETS.map(([lo, hi]) => ({
    lo,
    hi,
    rate: 0,
    n: 0,
  }));
  const hits = BUCKETS.map(() => 0);
  for (const r of runs.filter((x) => x.tier === t)) {
    // Gaps are only meaningful inside one run and one wave — a wave boundary is
    // a lull, not a slow shot.
    let prevTick: number | null = null;
    let prevWave = -1;
    for (const e of r.events) {
      if (e.kind !== "blast") continue;
      if (e.wave !== prevWave) {
        prevTick = null;
        prevWave = e.wave;
      }
      if (prevTick !== null) {
        const gap = e.bornTick - prevTick;
        const bi = BUCKETS.findIndex(([lo, hi]) => gap >= lo && gap < hi);
        if (bi >= 0) {
          row[bi].n++;
          if (e.kills >= 1) hits[bi]++;
        }
      }
      prevTick = e.bornTick;
    }
  }
  row.forEach((b, i) => (b.rate = b.n ? hits[i] / b.n : 0));
  burstStats[t] = row;
  console.log(
    t.padEnd(10) +
      row.map((b) => (b.n ? `${(b.rate * 100).toFixed(1)}% (n=${b.n})` : "-")).map((x) => x.padStart(14)).join(""),
  );
}

// ── how far do streaks actually get? picks the cash-out threshold ────────────
console.log(`\n── distribution of consecutive-hit streak lengths (what threshold is reachable?) ──`);
const streakDist: Record<string, number[]> = {};
console.log(`${"tier".padEnd(10)}${"streaks/wave".padStart(14)}` + [1, 2, 3, 4, 5, 6, 8, 10].map((n) => `>=${n}`.padStart(8)).join(""));
for (const t of TIERS) {
  const tierRuns = runs.filter((r) => r.tier === t);
  const lens: number[] = [];
  let waves = 0;
  for (const r of tierRuns) {
    waves += r.wave;
    let s = 0;
    for (const e of r.events) {
      if (e.kind !== "blast") continue;
      if (e.kills >= 1) s++;
      else {
        if (s > 0) lens.push(s);
        s = 0;
      }
    }
    if (s > 0) lens.push(s);
  }
  streakDist[t] = lens;
  const line =
    t.padEnd(10) +
    (lens.length / Math.max(1, waves)).toFixed(1).padStart(14) +
    [1, 2, 3, 4, 5, 6, 8, 10]
      .map((n) => `${((lens.filter((l) => l >= n).length / Math.max(1, lens.length)) * 100).toFixed(0)}%`.padStart(8))
      .join("");
  console.log(line);
}

const out = getArg("json", "");
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        games,
        baseSeed,
        reports,
        burstStats,
        streakDist,
        runs: runs.map((r) => ({ tier: r.tier, seed: r.seed, wave: r.wave, score: r.score, shots: r.shots, kills: r.kills })),
        schemes: SCHEMES.map((s) => ({ name: s.name, blurb: s.blurb, k: calibration.get(s.name) })),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}`);
}
