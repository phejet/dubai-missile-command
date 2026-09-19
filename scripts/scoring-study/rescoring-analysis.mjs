import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { variants, rescore, sum } from "./rescoring-rules.mjs";
import { ranks, spearman } from "./progression-stats.mjs";
const root = "operator-results/scoring-study-20260915/",
  out = root + "rescoring/";
mkdirSync(out, { recursive: true, mode: 0o700 });
const inputs = new Map();
function read(path) {
  const bytes = readFileSync(path);
  inputs.set(path, createHash("sha256").update(bytes).digest("hex"));
  return JSON.parse(bytes);
}
const baseline = read(root + "attribution/baseline-results.json");
assert.deepEqual(baseline, read(root + "attribution/observed-results.json"));
assert.deepEqual(baseline, read(root + "quality/observed-results.json"));
const progression = read(root + "progression/analysis.json");
const pairs = read(root + "progression/matched-pairs.json")[3];
const shots = read(root + "quality/shots.json");
const clips = read(root + "quality/clips-private.json");
const labels = read("docs/gameplay analysis Sep 2026/scoring-quality-user-labels.json");
const runs = [],
  clipRows = [];
for (const b of baseline) {
  const replay = read(root + b.label + "-replay.json");
  const es = read(root + "quality/" + b.label + "-events.json");
  const waves = rescore(es);
  assert.equal(
    sum(waves, (w) => w.original),
    b.score,
  );
  assert.equal(
    sum(waves, (w) => w.shots),
    b.stats.shotsFired,
  );
  assert.equal(
    sum(waves, (w) => w.kills) + es.filter((e) => e.type === "destroyed" && !e.scored).length,
    b.stats.missileKills + b.stats.droneKills,
  );
  assert(
    replay.actions.filter((a) => a.type === "fire").length >= b.stats.shotsFired,
    "Accepted shots exceed recorded attempts",
  );
  assert.equal(b.initialScore, 0);
  assert.equal(b.initialStats.shotsFired, 0);
  for (const w of waves) {
    assert.equal(w.original, b.waveDeltas[w.wave].score);
    const card = b.recap.waveCards.find((c) => c.wave === w.wave);
    assert(card);
    assert.equal(w.original, card.scoreEarned);
    w.terminal = card.terminal;
  }
  const p = progression.runRows.find((r) => r.label === b.label);
  const scores = Object.fromEntries(
    variants.map((v) => [
      v.id,
      { gross: sum(waves, (w) => w.scores[v.id].gross), net: sum(waves, (w) => w.scores[v.id].net) },
    ]),
  );
  runs.push({
    label: b.label,
    build: p.build,
    finalWave: p.finalWave,
    subset: Number(b.label.slice(-3)) % 4 === 0 ? "holdout" : "reference",
    original: b.score,
    gross: sum(waves, (w) => w.gross),
    debits: sum(waves, (w) => w.debits),
    automationBaseShare: sum(waves, (w) => w.base - w.playerBase) / sum(waves, (w) => w.base),
    scores,
    waves,
  });
  for (const clip of clips.filter((c) => c.label === b.label)) {
    const shot = shots.find((s) => s.label === b.label && s.shotId === clip.shotId);
    const rewards = es.filter((e) => e.type === "reward" && clip.shotId !== null && e.shotId === clip.shotId);
    const kills = rewards.filter((e) => e.kind === "kill");
    const damageCredit = sum(
      es.filter((e) => e.type === "reward" && e.kind === "kill"),
      (e) => {
        const total = sum(e.contributors, (c) => c.damage);
        return (
          (e.base *
            sum(
              e.contributors.filter((c) => c.source === "player" && c.shotId === clip.shotId),
              (c) => c.damage,
            )) /
          total
        );
      },
    );
    clipRows.push({
      id: clip.id,
      label: b.label,
      wave: clip.wave,
      focusTick: clip.focusTick,
      judgment: labels[clip.id]?.judgment ?? "Unlabelled",
      shotId: clip.shotId,
      kills: shot?.kills ?? null,
      contested: shot?.contested.length ?? null,
      status: shot?.status ?? null,
      original: shot ? sum(rewards, (e) => e.amount) : null,
      A: shot
        ? sum(kills, (e) => e.amount) +
          sum(
            rewards.filter((e) => e.kind === "multi" || e.kind === "friendly_fire"),
            (e) => e.amount,
          )
        : null,
      B: shot
        ? sum(kills, (e) => e.base) +
          (kills.length ? 50 + 100 * Math.min(3, kills.length - 1) : 0) +
          sum(
            rewards.filter((e) => e.kind === "friendly_fire"),
            (e) => e.amount,
          )
        : null,
      credit: shot ? damageCredit : null,
    });
  }
}
const originalRanks = ranks(runs.map((r) => -r.gross));
for (const [i, r] of runs.entries()) r.originalRank = originalRanks[i];
for (const v of variants) {
  const rr = ranks(runs.map((r) => -r.scores[v.id].gross));
  runs.forEach((r, i) => {
    r.scores[v.id].rank = rr[i];
    r.scores[v.id].delta = r.scores[v.id].net - r.original;
  });
}
const comparison = (selected, v) => {
  const deltas = selected.map((r) => r.scores[v.id].net - r.original);
  return {
    n: selected.length,
    original: sum(selected, (r) => r.gross),
    candidate: sum(selected, (r) => r.scores[v.id].gross),
    delta: sum(deltas),
    gain: deltas.filter((n) => n > 1e-8).length,
    lose: deltas.filter((n) => n < -1e-8).length,
    rankCorrelation: spearman(
      selected.map((r) => r.gross),
      selected.map((r) => r.scores[v.id].gross),
    ),
  };
};
const pairRows = pairs.map((p) => ({
  better: p.better,
  worse: p.worse,
  wave: p.wave,
  original: p.scoreDelta,
  scores: Object.fromEntries(
    variants.map((v) => [
      v.id,
      runs.find((r) => r.label === p.better).waves.find((w) => w.wave === p.wave).scores[v.id].net -
        runs.find((r) => r.label === p.worse).waves.find((w) => w.wave === p.wave).scores[v.id].net,
    ]),
  ),
}));
const summaries = variants.map((v) => {
  const loo = runs.map((omit) =>
    comparison(
      runs.filter((r) => r !== omit),
      v,
    ),
  );
  const count = (rs) => ({
    higher: rs.filter((p) => p.scores[v.id] > 1e-8).length,
    tied: rs.filter((p) => Math.abs(p.scores[v.id]) <= 1e-8).length,
    lower: rs.filter((p) => p.scores[v.id] < -1e-8).length,
  });
  return {
    ...v,
    ...comparison(runs, v),
    subsets: ["reference", "holdout"].map((subset) => ({
      subset,
      ...comparison(
        runs.filter((r) => r.subset === subset),
        v,
      ),
    })),
    builds: [...new Set(runs.map((r) => r.build))].map((build) => ({
      build,
      ...comparison(
        runs.filter((r) => r.build === build),
        v,
      ),
    })),
    looPercentRange: [
      Math.min(...loo.map((s) => (100 * s.delta) / s.original)),
      Math.max(...loo.map((s) => (100 * s.delta) / s.original)),
    ],
    pairs: count(pairRows),
    pairLeaveOneRunOut: runs.map((r) => ({
      omit: r.label,
      n: pairRows.filter((p) => p.better !== r.label && p.worse !== r.label).length,
      ...count(pairRows.filter((p) => p.better !== r.label && p.worse !== r.label)),
    })),
    saturated:
      v.family === "C"
        ? sum(runs, (r) => r.waves.filter((w) => w.base > 0 && w.manualCredit >= v.cap * w.base - 1e-8).length)
        : null,
  };
});
const throughWave = Array.from({ length: 9 }, (_, i) => ({
  wave: i + 1,
  rows: runs
    .filter((r) => r.waves.some((w) => w.wave === i + 1 && !w.terminal))
    .map((r) => {
      const ws = r.waves.filter((w) => w.wave <= i + 1 && !w.terminal);
      return {
        label: r.label,
        original: sum(ws, (w) => w.gross),
        scores: Object.fromEntries(variants.map((v) => [v.id, sum(ws, (w) => w.scores[v.id].gross)])),
      };
    }),
}));
const contested = shots.filter((s) => !s.kills && s.contested.length);
const data = {
  spec: "scoring-rescoring-method.md",
  variants,
  summaries,
  runs,
  pairs: pairRows,
  throughWave,
  clips: clipRows.sort((a, b) => a.id.localeCompare(b.id)),
  checks: {
    runs: runs.length,
    waves: sum(runs, (r) => r.waves.length),
    completed: sum(runs, (r) => r.waves.filter((w) => !w.terminal).length),
    shots: shots.length,
    unresolved: shots.filter((s) => s.status !== "resolved").length,
    contestedEmpty: contested.length,
    assistCredit: sum(runs, (r) => sum(r.waves, (w) => w.assistCredit)),
    original: sum(runs, (r) => r.original),
  },
};
for (const [path, hash] of inputs)
  assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash, "Input mutated: " + path);
writeFileSync(out + "input-digests.json", JSON.stringify(Object.fromEntries(inputs), null, 2), { mode: 0o600 });
writeFileSync(out + "analysis.json", JSON.stringify(data, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(
    {
      checks: data.checks,
      summaries: summaries.map((s) => ({
        id: s.id,
        delta: s.delta,
        gain: s.gain,
        lose: s.lose,
        pairs: s.pairs,
        saturated: s.saturated,
        loo: s.looPercentRange,
      })),
    },
    null,
    2,
  ),
);
