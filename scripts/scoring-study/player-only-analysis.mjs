import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { OWNER, OWNERS, combos, scenarios, REFERENCE, rescoreRun, sum } from "./player-only-rules.mjs";
import { ranks, spearman } from "./progression-stats.mjs";

// Part Six: rescore the 26 draft-mode recordings under player-only points and the
// combo cash-out variants. Reads observations only; writes to the ignored study dir.
const root = "operator-results/scoring-study-20260915/",
  out = root + "player-only/";
mkdirSync(out, { recursive: true, mode: 0o700 });
const inputs = new Map();
function read(path) {
  const bytes = readFileSync(path);
  inputs.set(path, createHash("sha256").update(bytes).digest("hex"));
  return JSON.parse(bytes);
}
// Survival bonus formulas (src/game-sim.ts wave completion, src/wave-bonus.ts), verified below.
const BUILDINGS_AT_START = 10,
  WAVE_CLEAR_PER_WAVE = 250,
  BUILDING_BONUS_PER_WAVE = 100;
const FAMILY = [
  [/^(wildHornets|skyHunter)/, "Hornets"],
  [/^roadrunner/, "Roadrunner"],
  [/^patriot/, "Patriot"],
  [/^ironBeam/, "Iron Beam"],
  [/^phalanx/, "Phalanx"],
];
const ACTIVE = [
  [/^emp/, "EMP"],
  [/^f15/, "F-15"],
  [/^flare/, "Flares"],
];
const families = (picks, table) => [
  ...new Set(picks.flatMap((p) => table.filter(([re]) => re.test(p)).map(([, n]) => n))),
];

const baseline = read(root + "attribution/baseline-results.json");
const progression = read(root + "progression/analysis.json");
const shots = read(root + "quality/shots.json");
// Why an empty trigger was empty: whose kill removed the shot's intended target first.
// Overlap during the shot's lifetime, not proof that the other kill caused the miss.
function emptyCause(e, shot) {
  if (e.source === "flare") return "flare";
  const owners = new Set((shot?.contested ?? []).map((c) => (c.source === "player" ? "own" : OWNER[c.source])));
  if (owners.has("auto")) return "automation";
  if (owners.has("own")) return "ownShot";
  if (owners.has("player") || owners.has("impact")) return "other";
  return "uncontested";
}
const runs = [];
const emptyTriggers = [];
const streaks = []; // consecutive productive combo triggers, ended by an empty trigger or the run end
for (const b of baseline) {
  const replay = read(root + b.label + "-replay.json");
  assert.equal(replay.draftMode, true, b.label + " is not draft mode");
  const events = read(root + "quality/" + b.label + "-events.json");
  assert(!events.some((e) => e.kind === "spending"));
  const waves = rescoreRun(events);
  const runShots = new Map(shots.filter((x) => x.label === b.label).map((x) => [x.shotId, x]));
  let streak = 0;
  for (const e of events) {
    if (e.type !== "combo") continue;
    if (e.reportedRootKills >= 1) {
      streak++;
      continue;
    }
    emptyTriggers.push({ label: b.label, wave: e.wave, from: e.before, cause: emptyCause(e, runShots.get(e.shotId)) });
    if (streak) streaks.push(streak);
    streak = 0;
  }
  if (streak) streaks.push(streak);
  assert.equal(b.initialScore, 0);
  assert.equal(
    sum(waves, (w) => w.original),
    b.score,
  );
  assert.equal(
    sum(waves, (w) => w.shots),
    b.stats.shotsFired,
  );
  assert.equal(waves.length, b.recap.waveCards.length);
  let alive = BUILDINGS_AT_START;
  for (const w of waves) {
    assert.equal(w.original, b.waveDeltas[w.wave].score);
    const card = b.recap.waveCards.find((c) => c.wave === w.wave);
    assert.equal(w.original, card.scoreEarned);
    w.terminal = card.terminal;
    w.picks = card.bought ?? [];
    // Buildings never come back: start minus logged losses must match every recap count,
    // and both survival bonuses must follow their formulas exactly.
    alive -= w.buildingsLost;
    w.alive = alive;
    assert(alive >= 0);
    if (w.terminal) {
      assert.equal(w.waveClear + w.buildingBonus, 0, "Terminal wave paid a survival bonus");
    } else {
      assert.equal(alive, card.buildingsSurviving, "Building count diverges from recap");
      assert.equal(w.waveClear, WAVE_CLEAR_PER_WAVE * w.wave);
      assert.equal(w.buildingBonus, BUILDING_BONUS_PER_WAVE * alive * w.wave);
    }
  }
  assert(waves.at(-1).terminal && waves.slice(0, -1).every((w) => !w.terminal));
  const p = progression.runRows.find((r) => r.label === b.label);
  const picks = waves.flatMap((w) => w.picks);
  const scores = Object.fromEntries(scenarios.map((s) => [s.id, sum(waves, (w) => w.scores[s.id])]));
  const bySource = {};
  for (const w of waves)
    for (const [src, v] of Object.entries(w.bySource)) {
      const t = (bySource[src] ??= { kills: 0, base: 0, uplift: 0 });
      t.kills += v.kills;
      t.base += v.base;
      t.uplift += v.uplift;
    }
  const at = (key, m) => sum(waves, (w) => w.combo.C10[key][m] ?? 0);
  const playerPoints = sum(waves, (w) => sum(Object.values(w.combo.C10.playerPointsAt)));
  runs.push({
    label: b.label,
    build: p.build,
    buildId: replay._buildId,
    finalWave: p.finalWave,
    completedWaves: p.completedWaves,
    automation: families(picks, FAMILY),
    active: families(picks, ACTIVE),
    original: b.score,
    scores,
    bySource,
    ownerPoints: Object.fromEntries(
      OWNERS.map((o) => [o, sum(waves, (w) => w.combo.C10.base[o] + w.combo.C10.uplift[o])]),
    ),
    multi: Object.fromEntries(OWNERS.map((o) => [o, sum(waves, (w) => w.multi[o])])),
    bonuses: sum(waves, (w) => w.bonuses),
    waveClear: sum(waves, (w) => w.waveClear),
    buildingBonus: sum(waves, (w) => w.buildingBonus),
    forfeitedBuildingBonus: sum(
      waves.filter((w) => !w.terminal),
      (w) => BUILDING_BONUS_PER_WAVE * (BUILDINGS_AT_START - w.alive) * w.wave,
    ),
    buildingsTimeline: waves.map((w) => w.alive),
    buildingsAtEnd: waves.at(-1).alive,
    buildingsLostFinalWave: waves.at(-1).buildingsLost,
    debits: sum(waves, (w) => w.debits),
    shots: sum(waves, (w) => w.shots),
    shotsAt10: at("shotsAt", 10),
    playerPoints,
    playerPointsAt10: at("playerPointsAt", 10),
    maxCombo: Math.max(...waves.flatMap((w) => Object.keys(w.combo.C10.shotsAt).map(Number)), 1),
    cashouts: sum(waves, (w) => w.combo["C5-0"].cashouts),
    emptyResets: Object.fromEntries(
      Object.keys(waves[0].emptyResets).map((k) => [k, sum(waves, (w) => w.emptyResets[k])]),
    ),
    upliftTotal: sum(OWNERS, (o) => sum(waves, (w) => w.combo.C10.uplift[o])),
    waves,
  });
}
const bucket = (n) => (n >= 20 ? "20+" : n >= 10 ? "10-19" : n >= 5 ? "5-9" : String(n));
const countBy = (xs, key) => xs.reduce((m, x) => ((m[key(x)] = (m[key(x)] ?? 0) + 1), m), {});
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b),
    m = s.length / 2;
  return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2;
};
const scoreRanks = (key) => ranks(runs.map((r) => -key(r)));
const originalRank = scoreRanks((r) => r.original);
runs.forEach((r, i) => (r.originalRank = originalRank[i]));
const scenarioSummaries = scenarios.map((s) => {
  const rk = scoreRanks((r) => r.scores[s.id]);
  runs.forEach((r, i) => (r.ranks = { ...r.ranks, [s.id]: rk[i] }));
  const deltas = runs.map((r) => r.scores[s.id] - r.original);
  const pct = runs.map((r) => (100 * (r.scores[s.id] - r.original)) / r.original);
  const moves = runs.map((r, i) => r.originalRank - rk[i]);
  return {
    id: s.id,
    ownership: s.own.id,
    combo: s.combo.id,
    total: sum(runs, (r) => r.scores[s.id]),
    original: sum(runs, (r) => r.original),
    delta: sum(deltas),
    pctRange: [Math.min(...pct), Math.max(...pct)],
    medianPct: median(pct),
    gain: deltas.filter((d) => d > 0).length,
    lose: deltas.filter((d) => d < 0).length,
    rankCorrelation: spearman(
      runs.map((r) => r.original),
      runs.map((r) => r.scores[s.id]),
    ),
    rankMoves: { up: Math.max(...moves), down: Math.min(...moves), moved: moves.filter((m) => m !== 0).length },
  };
});
const maxWave = Math.max(...runs.flatMap((r) => r.waves.map((w) => w.wave)));
const byWave = Array.from({ length: maxWave }, (_, i) => {
  const ws = runs.flatMap((r) => r.waves.filter((w) => w.wave === i + 1));
  const comp = (comboId) => {
    const pts = (srcs) => sum(ws, (w) => sum(srcs, (s) => w.combo[comboId].bySource[s] ?? 0));
    const baseOf = (srcs) => sum(ws, (w) => sum(srcs, (s) => w.bySource[s]?.base ?? 0));
    const auto = Object.keys(OWNER).filter((s) => OWNER[s] === "auto");
    return {
      interceptorBase: baseOf(["player"]),
      interceptorCombo: pts(["player"]) - baseOf(["player"]),
      abilities: pts(["f15", "emp", "flare"]),
      automated: pts(auto),
      impact: pts(["impact"]),
      multiPlayer: sum(ws, (w) => w.multi.player),
      multiOther: sum(ws, (w) => w.multi.auto + w.multi.impact),
      survival: sum(ws, (w) => w.bonuses),
      waveClear: sum(ws, (w) => w.waveClear),
      buildingBonus: sum(ws, (w) => w.buildingBonus),
      debits: sum(ws, (w) => w.debits),
      cashoutEvents: sum(ws, (w) => w.combo[comboId].cashouts),
    };
  };
  return {
    wave: i + 1,
    runs: ws.length,
    completed: ws.filter((w) => !w.terminal).length,
    scores: Object.fromEntries(scenarios.map((s) => [s.id, sum(ws, (w) => w.scores[s.id])])),
    composition: { C10: comp("C10"), C5: comp("C5-0") },
    shots: sum(ws, (w) => w.shots),
    shotsAt10: sum(ws, (w) => w.combo.C10.shotsAt[10] ?? 0),
    emptyShots: shots.filter((x) => x.wave === i + 1 && !x.kills).length,
    emptyCauses: countBy(
      emptyTriggers.filter((t) => t.wave === i + 1),
      (t) => t.cause,
    ),
    // Same-wave rank agreement among runs that completed this wave.
    survival: (() => {
      const done = ws.filter((w) => !w.terminal);
      const alive = done.map((w) => w.alive);
      return {
        completed: done.length,
        waveClear: sum(done, (w) => w.waveClear),
        buildingBonus: sum(done, (w) => w.buildingBonus),
        forfeited: sum(done, (w) => BUILDING_BONUS_PER_WAVE * (BUILDINGS_AT_START - w.alive) * w.wave),
        meanAlive: done.length ? sum(alive) / done.length : null,
        minAlive: done.length ? Math.min(...alive) : null,
        allStanding: alive.filter((a) => a === BUILDINGS_AT_START).length,
        lostAllRuns: sum(ws, (w) => w.buildingsLost),
        lostInFinalWaves: sum(
          ws.filter((w) => w.terminal),
          (w) => w.buildingsLost,
        ),
        // Share of completed-wave points that are survival bonuses, per scenario.
        share: Object.fromEntries(
          scenarios.map((s) => [
            s.id,
            done.length ? sum(done, (w) => w.bonuses) / sum(done, (w) => w.scores[s.id]) : null,
          ]),
        ),
      };
    })(),
    rankCorrelation: (() => {
      const done = ws.filter((w) => !w.terminal);
      if (done.length < 5) return null;
      return Object.fromEntries(
        scenarios.map((s) => [
          s.id,
          spearman(
            done.map((w) => w.original),
            done.map((w) => w.scores[s.id]),
          ),
        ]),
      );
    })(),
  };
});
const sources = [...new Set(runs.flatMap((r) => Object.keys(r.bySource)))].map((src) => ({
  source: src,
  owner: OWNER[src],
  kills: sum(runs, (r) => r.bySource[src]?.kills ?? 0),
  base: sum(runs, (r) => r.bySource[src]?.base ?? 0),
  uplift: sum(runs, (r) => r.bySource[src]?.uplift ?? 0),
  multi: sum(runs, (r) => sum(r.waves, (w) => w.multiBySource[src] ?? 0)),
}));
const pooled = (key) => sum(runs, key);
const data = {
  spec: "scoring-player-only-method.md",
  combos,
  scenarios: scenarios.map((s) => ({ id: s.id, ownership: s.own.id, combo: s.combo.id })),
  reference: REFERENCE,
  summaries: scenarioSummaries,
  sources: sources.sort((a, b) => b.base + b.uplift - (a.base + a.uplift)),
  byWave,
  runs: runs.map(({ waves, ...r }) => ({
    ...r,
    waves: waves.map((w) => ({
      wave: w.wave,
      terminal: w.terminal,
      picks: w.picks,
      original: w.original,
      shots: w.shots,
      cashouts: w.combo["C5-0"].cashouts,
      alive: w.alive,
      buildingsLost: w.buildingsLost,
      waveClear: w.waveClear,
      buildingBonus: w.buildingBonus,
      scores: w.scores,
    })),
  })),
  totals: {
    runs: runs.length,
    waves: sum(runs, (r) => r.waves.length),
    terminalWaves: sum(runs, (r) => r.waves.filter((w) => w.terminal).length),
    original: pooled((r) => r.original),
    ownerPoints: Object.fromEntries(OWNERS.map((o) => [o, pooled((r) => r.ownerPoints[o])])),
    multi: Object.fromEntries(OWNERS.map((o) => [o, pooled((r) => r.multi[o])])),
    bonuses: pooled((r) => r.bonuses),
    waveClear: pooled((r) => r.waveClear),
    buildingBonus: pooled((r) => r.buildingBonus),
    forfeitedBuildingBonus: pooled((r) => r.forfeitedBuildingBonus),
    buildingsAtStart: BUILDINGS_AT_START,
    buildingsLost: pooled((r) => BUILDINGS_AT_START - r.buildingsAtEnd),
    buildingsLostFinalWave: pooled((r) => r.buildingsLostFinalWave),
    buildingsAtEnd: countBy(runs, (r) => r.buildingsAtEnd),
    survivalShare: Object.fromEntries(
      scenarios.map((s) => [s.id, pooled((r) => r.bonuses) / pooled((r) => r.scores[s.id])]),
    ),
    debits: pooled((r) => r.debits),
    uplift: pooled((r) => r.upliftTotal),
    shots: pooled((r) => r.shots),
    shotsAt10: pooled((r) => r.shotsAt10),
    playerPoints: pooled((r) => r.playerPoints),
    playerPointsAt10: pooled((r) => r.playerPointsAt10),
    cashouts: pooled((r) => r.cashouts),
    emptyResets: Object.fromEntries(Object.keys(runs[0].emptyResets).map((k) => [k, pooled((r) => r.emptyResets[k])])),
    emptyCauses: countBy(emptyTriggers, (t) => t.cause),
    emptyCausesFromFive: countBy(
      emptyTriggers.filter((t) => t.from >= 5),
      (t) => t.cause,
    ),
    emptyShots: shots.filter((x) => !x.kills).length,
    streaks: countBy(streaks, bucket),
    productiveTriggersInStreaks: Object.fromEntries(
      ["1", "2", "3", "4", "5-9", "10-19", "20+"].map((k) => [k, sum(streaks.filter((n) => bucket(n) === k))]),
    ),
    longestStreak: Math.max(...streaks),
    productivePlayerShots: shots.filter((x) => x.kills > 0).length,
    playerSourceBase: sum(runs, (r) => r.bySource.player?.base ?? 0),
    kills: sum(sources, (s) => s.kills),
  },
};
for (const [path, hash] of inputs)
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash, "Input mutated: " + path);
writeFileSync(out + "input-digests.json", JSON.stringify(Object.fromEntries(inputs), null, 2), { mode: 0o600 });
writeFileSync(out + "analysis.json", JSON.stringify(data, null, 2), { mode: 0o600 });
const pct = (s) => ((100 * s.delta) / s.original).toFixed(1) + "%";
console.log(JSON.stringify(data.totals, null, 1));
for (const s of scenarioSummaries)
  console.log(
    s.id.padEnd(12),
    String(Math.round(s.total)).padStart(8),
    pct(s).padStart(7),
    `range ${s.pctRange.map((n) => n.toFixed(1)).join("..")}`,
    `rho ${s.rankCorrelation.toFixed(3)}`,
    `moves +${s.rankMoves.up}/${s.rankMoves.down}`,
  );
