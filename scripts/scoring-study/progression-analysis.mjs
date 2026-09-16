import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { sum, mean, pearson, spearman, groupBy, linearBaseline, sensitivity, pareto } from "./progression-stats.mjs";
const root = "operator-results/scoring-study-20260915/";
const out = root + "progression/";
const read = (p) => JSON.parse(readFileSync(root + p, "utf8"));
const contexts = read("progression/contexts.json"),
  baseline = read("attribution/baseline-results.json"),
  quality = read("quality/shooting-metrics.json"),
  attribution = read("attribution/aggregate.json");
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const builds = [...new Set(contexts.map((c) => c.build))];
const rows = [],
  terminal = [],
  runRows = [];
for (const c of contexts) {
  const b = baseline.find((r) => r.label === c.label),
    q = quality.runs.find((r) => r.label === c.label),
    a = attribution.runs.find((r) => r.label === c.label);
  const events = read("quality/" + c.label + "-events.json");
  let cumulativeScore = 0,
    cumulativeCombat = 0;
  const cumulativeLoss = { burj: 0, buildings: 0, launcherHP: 0, sites: 0 };
  for (const card of b.recap.waveCards) {
    const wave = card.wave,
      start = c.starts.find((s) => s.wave === wave),
      qw = q.waves.find((w) => w.wave === wave),
      aw = a.waves.find((w) => w.wave === wave);
    assert(start && qw && aw);
    assert.equal(aw.score, b.waveDeltas[wave].score, c.label + " ledger wave");
    assert.equal(aw.score, card.scoreEarned, c.label + " recap wave");
    assert.equal(aw.spending, 0);
    assert.equal(aw.friendlyFire, 0);
    const end = c.ends.find((e) => e.wave === wave);
    if (!card.terminal) {
      assert(end);
      assert.equal(end.score - start.score, aw.score, c.label + " boundary score");
    }
    cumulativeScore += aw.score;
    cumulativeCombat += aw.score - aw.waveClear - aw.buildingBonus;
    for (const k of Object.keys(cumulativeLoss)) cumulativeLoss[k] += qw.damage[k];
    const assets = {
      burj: start.burj,
      launchers: start.launchers,
      buildings: start.buildings,
      sites: start.sites,
      meta: { ...start.meta, completedObjectives: [...start.meta.completedObjectives].sort() },
    };
    const duration = qw.combatTicks / 60;
    const row = {
      label: c.label,
      build: "build-" + String(builds.indexOf(c.build) + 1).padStart(2, "0"),
      mode: c.draftMode ? "draft" : "paid",
      wave,
      terminal: card.terminal,
      score: aw.score,
      combat: aw.score - aw.waveClear - aw.buildingBonus,
      bonuses: aw.waveClear + aw.buildingBonus,
      buildingBonus: aw.buildingBonus,
      waveBonus: aw.waveClear,
      cumulativeScore,
      cumulativeCombat,
      cumulativeLoss: { ...cumulativeLoss },
      burjLoss: qw.damage.burj,
      buildingLoss: qw.damage.buildings,
      launcherLoss: qw.damage.launcherHP,
      siteLoss: qw.damage.sites,
      owned: start.owned,
      assets,
      comboStart: start.combo,
      seedHash: digest(c.seed),
      encounterHash: digest([start.schedule, start.concurrentCap, start.tactics, start.commander]),
      duration,
      shots: qw.shots,
      resolved: qw.resolved,
      shotSuccess: qw.resolved ? qw.successful / qw.resolved : null,
      killsPerShot: qw.resolved ? qw.resolvedKills / qw.resolved : null,
      manualKills: aw.sources.player?.kills ?? 0,
      upgradeKills: sum(
        Object.entries(aw.sources).filter(([s]) => !["player", "impact"].includes(s)),
        ([, v]) => v.kills,
      ),
      sources: aw.sources,
      activeUses: events
        .filter((e) => e.type === "active" && e.wave === wave && ["emp", "f15"].includes(e.source))
        .map((e) => ({ source: e.source, secondsIntoWave: (e.tick - start.tick) / 60 })),
      startTick: start.tick,
      endTick: card.endTick,
    };
    (card.terminal ? terminal : rows).push(row);
  }
  assert.equal(cumulativeScore, b.score);
  runRows.push({
    label: c.label,
    build: "build-" + String(builds.indexOf(c.build) + 1).padStart(2, "0"),
    finalWave: b.recap.wave,
    score: b.score,
    completedWaves: b.recap.waveCards.filter((w) => !w.terminal).length,
  });
}
const tierKeys = [
  (r) => JSON.stringify([r.wave, r.mode]),
  (r) => JSON.stringify([r.wave, r.mode, r.build]),
  (r) => JSON.stringify([r.wave, r.mode, r.build, r.owned]),
  (r) => JSON.stringify([r.wave, r.mode, r.build, r.owned, r.assets]),
];
const lossKeys = ["burjLoss", "buildingLoss", "launcherLoss", "siteLoss"];
const pairLists = [];
const tiers = tierKeys.map((key, i) => {
  const groups = groupBy(rows, key).filter((g) => g.length >= 2),
    pairs = [];
  for (const g of groups)
    for (let a = 0; a < g.length; a++)
      for (let b = a + 1; b < g.length; b++) {
        const order = pareto(g[a], g[b], lossKeys);
        if (order === 0 || order === null) {
          pairs.push({ order });
          continue;
        }
        const better = order < 0 ? g[a] : g[b],
          worse = order < 0 ? g[b] : g[a];
        pairs.push({
          order,
          better: better.label,
          worse: worse.label,
          wave: better.wave,
          scoreDelta: better.score - worse.score,
          combatDelta: better.combat - worse.combat,
          betterRow: better,
          worseRow: worse,
        });
      }
  pairLists.push(pairs.filter((p) => p.order !== 0 && p.order !== null));
  const comparable = pairLists[i];
  const countFor = (key) => ({
    higher: comparable.filter((p) => p[key] > 0).length,
    tied: comparable.filter((p) => p[key] === 0).length,
    lower: comparable.filter((p) => p[key] < 0).length,
  });
  const associations = [];
  for (const outcome of [...lossKeys, "shotSuccess"])
    for (const reward of ["score", "combat"]) {
      const eligible = rows.filter((r) => r[outcome] !== null);
      associations.push({ outcome, reward, ...sensitivity(eligible, key, outcome, reward) });
    }
  return {
    tier: i + 1,
    groups: groups.length,
    rows: sum(groups, (g) => g.length),
    runs: new Set(groups.flat().map((r) => r.label)).size,
    totalPairs: pairs.length,
    lossTies: pairs.filter((p) => p.order === 0).length,
    mixedOutcomes: pairs.filter((p) => p.order === null).length,
    comparablePairs: comparable.length,
    comparableRuns: new Set(comparable.flatMap((p) => [p.better, p.worse])).size,
    worseOutcomeRuns: new Set(comparable.map((p) => p.worse)).size,
    informativeWaves: [...new Set(comparable.map((p) => p.wave))],
    totalScore: countFor("scoreDelta"),
    combatScore: countFor("combatDelta"),
    byWave: Array.from({ length: 9 }, (_, w) => ({
      wave: w + 1,
      rows: groups.flat().filter((r) => r.wave === w + 1).length,
      groups: groups.filter((g) => g[0].wave === w + 1).length,
    })),
    associations,
    matchedGroups: groups.map((g, index) => ({
      id: "tier-" + (i + 1) + "-group-" + (index + 1),
      wave: g[0].wave,
      builds: [...new Set(g.map((r) => r.build))],
      labels: g.map((r) => r.label),
      owned: i >= 2 ? g[0].owned : null,
      comboValues: [...new Set(g.map((r) => r.comboStart))],
      seeds: new Set(g.map((r) => r.seedHash)).size,
      encounters: new Set(g.map((r) => r.encounterHash)).size,
    })),
  };
});
const throughWave = Array.from({ length: 9 }, (_, i) => {
  const w = rows.filter((r) => r.wave === i + 1);
  return {
    wave: i + 1,
    runs: w.length,
    min: Math.min(...w.map((r) => r.cumulativeScore)),
    max: Math.max(...w.map((r) => r.cumulativeScore)),
    mean: mean(w.map((r) => r.cumulativeScore)),
    scoreVsBurjLoss: pearson(
      w.map((r) => r.cumulativeScore),
      w.map((r) => r.cumulativeLoss.burj),
    ),
    combatVsBurjLoss: pearson(
      w.map((r) => r.cumulativeCombat),
      w.map((r) => r.cumulativeLoss.burj),
    ),
    spearmanScoreVsBurjLoss: spearman(
      w.map((r) => r.cumulativeScore),
      w.map((r) => r.cumulativeLoss.burj),
    ),
    points: w.map((r) => ({
      label: r.label,
      score: r.cumulativeScore,
      combat: r.cumulativeCombat,
      burjLoss: r.cumulativeLoss.burj,
      buildingLoss: r.cumulativeLoss.buildings,
    })),
  };
});
const examples = [];
const strictPairs = pairLists[3];
for (const predicate of [
  (p) => p.scoreDelta < 0,
  (p) => p.scoreDelta > 0 && p.combatDelta < 0,
  (p) => p.scoreDelta > 0 && p.combatDelta > 0,
]) {
  const p = [...strictPairs]
    .filter(predicate)
    .sort((a, b) => b.wave - a.wave || Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
    .find((p) => !examples.some((e) => e.better === p.better && e.worse === p.worse && e.wave === p.wave));
  if (p) examples.push(p);
}
const result = {
  method: {
    runs: 26,
    completedWaveRows: rows.length,
    terminalWaveRows: terminal.length,
    bootstrapDraws: 1000,
    bootstrapSeed: 16092026,
  },
  progression: linearBaseline(runRows, "finalWave", "score"),
  runRows,
  tiers,
  throughWave,
  examples,
  rows,
  terminal,
};
writeFileSync(out + "analysis.json", JSON.stringify(result, null, 2), { mode: 0o600 });
writeFileSync(out + "matched-pairs.json", JSON.stringify(pairLists), { mode: 0o600 });
console.log(
  JSON.stringify(
    {
      progression: { ...result.progression, estimates: undefined },
      tiers: tiers.map((t) => ({
        ...t,
        matchedGroups: undefined,
        associations: t.associations.filter((a) => a.outcome === "burjLoss"),
      })),
      examples: examples.map((p) => ({
        better: p.better,
        worse: p.worse,
        wave: p.wave,
        scoreDelta: p.scoreDelta,
        combatDelta: p.combatDelta,
      })),
    },
    null,
    2,
  ),
);
