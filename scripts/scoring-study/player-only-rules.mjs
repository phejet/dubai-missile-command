import assert from "node:assert/strict";

// Part Six rules. See docs/gameplay analysis Sep 2026/scoring-player-only-method.md.
// Consumes recorded ledger events only; no game imports or simulation feedback.
export const OWNER = {
  player: "player",
  f15: "player",
  emp: "player",
  flare: "player",
  hornets: "auto",
  roadrunner: "auto",
  patriot: "auto",
  ironBeam: "auto",
  phalanx: "auto",
  impact: "impact",
};
export const OWNERS = ["player", "auto", "impact"];
export const combos = [
  { id: "C10", cap: 10, bonus: null },
  ...[0, 150, 350, 500, 700].map((bonus) => ({ id: `C5-${bonus}`, cap: 5, bonus })),
];
export const ownerships = [
  { id: "today", paid: OWNERS },
  { id: "P", paid: ["player"] },
];
export const scenarios = ownerships.flatMap((o) => combos.map((c) => ({ id: `${o.id}|${c.id}`, own: o, combo: c })));
export const REFERENCE = { ownership: "P|C10", both: "P|C5-350" };
export const sum = (xs, f = (x) => x) => xs.reduce((n, x) => n + f(x), 0);

export function stepCombo(c, productive, variant) {
  if (!productive) return { next: 1, bonus: 0, cashout: false };
  if (variant.bonus === null) return { next: Math.min(variant.cap, c + 1), bonus: 0, cashout: false };
  if (c >= variant.cap) return { next: 1, bonus: variant.bonus, cashout: true };
  return { next: c + 1, bonus: 0, cashout: false };
}

const zero = () => Object.fromEntries(OWNERS.map((o) => [o, 0]));
function newWave(wave) {
  return {
    wave,
    original: 0,
    bonuses: 0,
    waveClear: 0,
    buildingBonus: 0,
    buildingsLost: 0,
    debits: 0,
    shots: 0,
    kills: zero(),
    multi: zero(),
    multiBySource: {},
    bySource: {},
    combo: Object.fromEntries(
      combos.map((c) => [
        c.id,
        { base: zero(), uplift: zero(), bySource: {}, cashouts: 0, cashoutPoints: 0, shotsAt: {}, playerPointsAt: {} },
      ]),
    ),
    emptyResets: { total: 0, fromFivePlus: 0, flare: 0, flareFromTwoPlus: 0 },
  };
}

// Returns one row per wave. Asserts that the C10 machine reproduces every recorded
// combo transition and kill multiplier, so today's rules are proven, not assumed.
export function rescoreRun(events) {
  const waves = new Map();
  const row = (wave) => {
    if (!waves.has(wave)) waves.set(wave, newWave(wave));
    return waves.get(wave);
  };
  const state = Object.fromEntries(combos.map((c) => [c.id, 1]));
  for (const e of events) {
    if (e.type === "asset_damage") {
      assert(e.buildings >= 0);
      row(e.wave).buildingsLost += e.buildings;
    } else if (e.type === "shot") {
      const w = row(e.wave);
      w.shots++;
      for (const c of combos) w.combo[c.id].shotsAt[state[c.id]] = (w.combo[c.id].shotsAt[state[c.id]] ?? 0) + 1;
    } else if (e.type === "combo") {
      const w = row(e.wave);
      const productive = e.reportedRootKills >= 1;
      assert.equal(e.before, state.C10, "Combo before diverges from C10 replay");
      if (!productive) {
        w.emptyResets.total++;
        if (state.C10 >= 5) w.emptyResets.fromFivePlus++;
        if (e.source === "flare") {
          w.emptyResets.flare++;
          if (state.C10 >= 2) w.emptyResets.flareFromTwoPlus++;
        }
      }
      for (const c of combos) {
        const { next, bonus, cashout } = stepCombo(state[c.id], productive, c);
        if (cashout) w.combo[c.id].cashouts++;
        w.combo[c.id].cashoutPoints += bonus;
        state[c.id] = next;
      }
      assert.equal(e.after, state.C10, "Combo after diverges from C10 replay");
    } else if (e.type === "reward") {
      const w = row(e.wave);
      w.original += e.amount;
      if (e.kind === "kill") {
        const owner = OWNER[e.source];
        assert(owner, "Unknown kill source: " + e.source);
        assert(e.base > 0);
        assert.equal(e.combo, state.C10, "Recorded kill combo diverges from C10 replay");
        assert.equal(e.base * e.combo, e.amount);
        w.kills[owner]++;
        const s = (w.bySource[e.source] ??= { kills: 0, base: 0, uplift: 0 });
        s.kills++;
        s.base += e.base;
        s.uplift += e.amount - e.base;
        for (const c of combos) {
          const m = state[c.id];
          const cw = w.combo[c.id];
          cw.base[owner] += e.base;
          cw.uplift[owner] += e.base * (m - 1);
          cw.bySource[e.source] = (cw.bySource[e.source] ?? 0) + e.base * m;
          if (owner === "player") cw.playerPointsAt[m] = (cw.playerPointsAt[m] ?? 0) + e.base * m;
        }
      } else if (e.kind === "multi") {
        const owner = OWNER[e.source];
        assert(owner, "Unknown multi source: " + e.source);
        assert(e.amount >= 0); // top-ups (e.g. 4 -> 5 kills at the 700 ceiling) can be 0
        w.multi[owner] += e.amount;
        w.multiBySource[e.source] = (w.multiBySource[e.source] ?? 0) + e.amount;
      } else if (e.kind === "wave_clear" || e.kind === "building_bonus") {
        assert(e.amount >= 0);
        w.bonuses += e.amount;
        w[e.kind === "wave_clear" ? "waveClear" : "buildingBonus"] += e.amount;
      } else if (e.kind === "friendly_fire") {
        assert(e.amount <= 0);
        w.debits += e.amount;
      } else {
        assert.fail("Unexpected reward kind (draft corpus has no spending): " + e.kind);
      }
    }
  }
  return [...waves.values()]
    .sort((a, b) => a.wave - b.wave)
    .map((w) => {
      const scores = Object.fromEntries(
        scenarios.map((s) => {
          const cw = w.combo[s.combo.id];
          const kills = sum(s.own.paid, (o) => cw.base[o] + cw.uplift[o]);
          return [s.id, w.bonuses + w.debits + sum(OWNERS, (o) => w.multi[o]) + kills + cw.cashoutPoints];
        }),
      );
      assert.equal(scores["today|C10"], w.original, "Today's rules do not reproduce the wave total");
      return { ...w, scores };
    });
}
