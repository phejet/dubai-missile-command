import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  pearson,
  spearman,
  ranks,
  fitLine,
  linearBaseline,
  residualCorrelation,
  pareto,
  quantile,
} from "./progression-stats.mjs";
const close = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
close(pearson([1, 2, 3], [3, 2, 1]), -1);
assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
assert.deepEqual(ranks([10, 20, 20, 40]), [1, 2.5, 2.5, 4]);
close(spearman([10, 20, 20, 40], [1, 2, 2, 4]), 1);
assert.deepEqual(fitLine([1, 2, 3], [5, 7, 9]), { intercept: 3, slope: 2 });
const line = linearBaseline(
  [1, 2, 3, 4].map((x) => ({ label: String(x), x, y: 2 * x + 3 })),
  "x",
  "y",
);
close(line.rSquared, 1);
close(line.looRSquared, 1);
const grouped = [
  { label: "a", g: 1, x: 1, y: 10 },
  { label: "b", g: 1, x: 2, y: 20 },
  { label: "a", g: 2, x: 101, y: 1010 },
  { label: "b", g: 2, x: 102, y: 1020 },
];
close(residualCorrelation(grouped, (r) => r.g, "x", "y").r, 1);
assert.equal(
  residualCorrelation(
    grouped.filter((r) => r.label === "a"),
    (r) => r.g,
    "x",
    "y",
  ).r,
  null,
);
assert.equal(pareto({ a: 0, b: 1 }, { a: 1, b: 1 }, ["a", "b"]), -1);
assert.equal(pareto({ a: 0, b: 2 }, { a: 1, b: 1 }, ["a", "b"]), null);
assert.equal(pareto({ a: 1 }, { a: 1 }, ["a"]), 0);
close(quantile([0, 10], 0.25), 2.5);
const root = "operator-results/scoring-study-20260915/";
const data = JSON.parse(readFileSync(root + "progression/analysis.json", "utf8"));
const attr = JSON.parse(readFileSync(root + "attribution/aggregate.json", "utf8"));
assert.equal(data.rows.length, 168);
assert.equal(data.terminal.length, 26);
assert.equal(new Set([...data.rows, ...data.terminal].map((r) => r.label + ":" + r.wave)).size, 194);
for (const run of attr.runs) {
  const all = [...data.rows, ...data.terminal].filter((r) => r.label === run.label);
  assert.equal(
    all.reduce((n, r) => n + r.score, 0),
    run.score,
  );
}
for (const tier of data.tiers) {
  assert.equal(tier.totalPairs, tier.lossTies + tier.mixedOutcomes + tier.comparablePairs);
  for (const key of ["totalScore", "combatScore"])
    assert.equal(
      Object.values(tier[key]).reduce((a, b) => a + b, 0),
      tier.comparablePairs,
    );
}
for (const row of data.rows) {
  assert.equal(row.score, row.combat + row.bonuses);
  assert.equal(row.bonuses, row.waveBonus + row.buildingBonus);
}
for (const e of data.examples) {
  assert.equal(e.betterRow.wave, e.worseRow.wave);
  assert.equal(e.betterRow.build, e.worseRow.build);
  assert.deepEqual(e.betterRow.owned, e.worseRow.owned);
  assert.deepEqual(e.betterRow.assets, e.worseRow.assets);
  assert.equal(pareto(e.betterRow, e.worseRow, ["burjLoss", "buildingLoss", "launcherLoss", "siteLoss"]), -1);
}
writeFileSync(
  root + "progression/checks.json",
  JSON.stringify(
    {
      statisticalCases: 13,
      completedRows: 168,
      terminalRows: 26,
      allRunScoreSums: true,
      allPairPartitions: true,
      strictExamplesVerified: true,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log("Statistics, score/bonus sums, complete/terminal partition and strict examples verified.");
