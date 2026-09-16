import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "operator-results/scoring-study-20260915/";
const out = root + "quality/";
const results = JSON.parse(readFileSync(out + "observed-results.json", "utf8"));
assert.deepEqual(results, JSON.parse(readFileSync(root + "attribution/baseline-results.json", "utf8")));
const sum = (a, f) => a.reduce((n, e) => n + f(e), 0);
const allShots = [],
  allWindows = [],
  runs = [];
for (const run of results) {
  const es = JSON.parse(readFileSync(out + run.label + "-events.json", "utf8"));
  const frames = JSON.parse(readFileSync(out + run.label + "-frames.json", "utf8"));
  const kills = es.filter((e) => e.kind === "kill");
  const losses = es.filter((e) => e.type === "asset_damage");
  const ends = new Map(es.filter((e) => e.type === "shot_end").map((e) => [e.shotId, e]));
  const shots = es
    .filter((e) => e.type === "shot")
    .map((s) => {
      const end = ends.get(s.shotId);
      assert(end, "shot lifetime missing");
      const owned = kills.filter((k) => k.shotId === s.shotId);
      const damage = es.filter((e) => e.type === "damage" && e.shotId === s.shotId && e.applied > 0);
      const contested = kills.filter(
        (k) => s.intended.includes(k.targetId) && k.shotId !== s.shotId && k.tick >= s.tick && k.tick <= end.tick,
      );
      const urgent = owned.filter((k) =>
        damage.some((d) => d.targetId === k.targetId && d.tick === k.tick && d.projectedBurjImpactTicks !== null),
      );
      return {
        label: run.label,
        shotId: s.shotId,
        wave: s.wave,
        tick: s.tick,
        endTick: end.tick,
        status: end.status,
        kills: owned.length,
        base: sum(owned, (k) => k.base),
        chainKills: owned.filter((k) => k.chain).length,
        damaging: damage.length > 0,
        intended: s.intended.length,
        overlap: s.overlap.length,
        contested: contested.map((k) => ({ source: k.source, shotId: k.shotId, tick: k.tick })),
        urgentKills: urgent.length,
        minProjectedImpactTicks: urgent.length
          ? Math.min(
              ...damage.filter((d) => d.projectedBurjImpactTicks !== null).map((d) => d.projectedBurjImpactTicks),
            )
          : null,
        aimX: s.aimX,
        aimY: s.aimY,
        threats: s.threats,
        chargesAfter: s.chargesAfter,
      };
    });
  assert.equal(shots.length, run.stats.shotsFired);
  allShots.push(...shots);
  const firedTicks = new Set(shots.map((s) => s.tick));
  let window = [];
  const windows = [];
  function flush() {
    if (window.length >= 60) {
      const first = window[0],
        last = window.at(-1);
      const during = kills.filter((k) => k.tick >= first.tick && k.tick <= last.tick);
      const damage = losses.filter((e) => e.tick >= first.tick && e.tick <= last.tick);
      windows.push({
        label: run.label,
        wave: first.wave,
        start: first.tick,
        end: last.tick + 1,
        ticks: window.length,
        upgradeKills: during.filter((k) => !["player", "impact"].includes(k.source)).length,
        manualKills: during.filter((k) => k.source === "player").length,
        loss: sum(damage, (e) => e.burj + e.buildings + e.launcherHP + e.sites),
        meanThreats: sum(window, (e) => e.threats) / window.length,
        airborneTicks: window.filter((f) => f.manualAirborne > 0).length,
      });
    }
    window = [];
  }
  for (const f of frames) {
    if (f.charges > 0 && f.threats > 0 && !firedTicks.has(f.tick)) {
      if (window.length && (f.tick !== window.at(-1).tick + 1 || f.wave !== window.at(-1).wave)) flush();
      window.push(f);
    } else flush();
  }
  flush();
  allWindows.push(...windows);
  const waves = Object.keys(run.waveDeltas).map((w) => {
    const wf = frames.filter((f) => f.wave === Number(w)),
      ss = shots.filter((s) => s.wave === Number(w));
    return {
      wave: Number(w),
      terminal: !run.recap.waveCards.some((c) => c.wave === Number(w) && !c.terminal),
      ...summarize(ss),
      combatTicks: wf.length,
      threatPresentTicks: wf.filter((f) => f.threats > 0).length,
      emptyChargeThreatTicks: wf.filter((f) => f.threats > 0 && f.charges === 0).length,
      readyThreatNoFireTicks: wf.filter((f) => f.threats > 0 && f.charges > 0 && !firedTicks.has(f.tick)).length,
      existingBlastCoverageTicks: wf.filter((f) => f.threats > 0 && f.blastCovered === f.threats).length,
      damage: Object.fromEntries(
        ["burj", "buildings", "launcherHP", "sites"].map((k) => [
          k,
          sum(
            losses.filter((e) => e.wave === Number(w)),
            (e) => e[k],
          ),
        ]),
      ),
      sourceKills: Object.fromEntries(
        [...new Set(kills.map((k) => k.source))].map((source) => [
          source,
          kills.filter((k) => k.wave === Number(w) && k.source === source).length,
        ]),
      ),
    };
  });
  runs.push({ label: run.label, ...summarize(shots), waves, windows });
}
function summarize(shots) {
  const resolved = shots.filter((s) => s.status === "resolved");
  return {
    shots: shots.length,
    resolved: resolved.length,
    boundaryCleared: shots.filter((s) => s.status === "boundary_cleared").length,
    terminalUnresolved: shots.filter((s) => s.status === "terminal_unresolved").length,
    successful: resolved.filter((s) => s.damaging).length,
    killProducing: resolved.filter((s) => s.kills > 0).length,
    resolvedKills: sum(resolved, (s) => s.kills),
    resolvedBase: sum(resolved, (s) => s.base),
    allKills: sum(shots, (s) => s.kills),
    allBase: sum(shots, (s) => s.base),
    distribution: [0, 1, 2, 3, 4].map((n) => resolved.filter((s) => (n === 4 ? s.kills >= 4 : s.kills === n)).length),
    contestedEmpty: resolved.filter((s) => !s.damaging && s.contested.length > 0).length,
    contestedEmptyUpgrade: resolved.filter(
      (s) => !s.damaging && s.contested.some((k) => !["player", "impact"].includes(k.source)),
    ).length,
    repeatedCoverage: shots.filter((s) => s.overlap > 0).length,
    urgentKills: sum(shots, (s) => s.urgentKills),
    emptyNoIntended: resolved.filter((s) => !s.damaging && s.intended === 0).length,
    productiveNoIntended: resolved.filter((s) => s.kills > 0 && s.intended === 0).length,
  };
}
const summary = { pooled: summarize(allShots), runs, windows: allWindows };
writeFileSync(out + "shooting-metrics.json", JSON.stringify(summary, null, 2), { mode: 0o600 });
writeFileSync(out + "shots.json", JSON.stringify(allShots, null, 2), { mode: 0o600 });
// Deterministic category sampling, not score/rank sampling. No overlap within a run.
if (process.argv.includes("--select-clips")) {
  const clips = [];
  const selectedCounts = {};
  function choose(category, candidates) {
    let picked = 0;
    for (const c of candidates) {
      const start = Math.max(c.waveStart ?? 0, c.tick - 120),
        end = Math.min(c.finalTick ?? results.find((r) => r.label === c.label).finalTick, c.tick + 360);
      if (
        end - start < 360 ||
        (selectedCounts[c.label] ?? 0) >= 2 ||
        clips.some((p) => p.label === c.label && start < p.end && end > p.start)
      )
        continue;
      clips.push({
        id: "clip-" + String(clips.length + 1).padStart(2, "0"),
        category,
        label: c.label,
        wave: c.wave,
        start,
        end,
        focusTick: c.tick,
        shotId: c.shotId ?? null,
      });
      selectedCounts[c.label] = (selectedCounts[c.label] ?? 0) + 1;
      if (++picked === 2) break;
    }
    assert.equal(picked, 2, category + " candidates");
  }
  // Balanced deterministic preference for category clarity, with diversity enforced.
  choose(
    "cluster",
    allShots
      .filter((s) => s.status === "resolved" && s.kills >= 3)
      .sort((a, b) => b.kills - a.kills || a.tick - b.tick),
  );
  choose(
    "empty",
    allShots
      .filter((s) => s.status === "resolved" && !s.damaging && !s.contested.length && s.threats >= 2 && s.tick > 120)
      .sort((a, b) => a.tick - b.tick),
  );
  choose(
    "contested",
    allShots
      .filter(
        (s) =>
          s.status === "resolved" && !s.damaging && s.contested.some((k) => !["player", "impact"].includes(k.source)),
      )
      .sort((a, b) => b.overlap - a.overlap || a.tick - b.tick),
  );
  choose(
    "withholding",
    allWindows
      .filter((w) => w.upgradeKills >= 2 && w.loss === 0 && w.ticks >= 90)
      .map((w) => ({ ...w, tick: w.start + Math.min(90, Math.floor(w.ticks / 2)) }))
      .sort((a, b) => b.ticks - a.ticks),
  );
  choose(
    "urgent",
    allShots
      .filter((s) => s.urgentKills > 0 && s.tick > 120)
      .sort((a, b) => a.minProjectedImpactTicks - b.minProjectedImpactTicks),
  );
  // Fixed permutation makes viewing order unrelated to category and hides run/wave/outcome.
  const order = [4, 0, 7, 3, 8, 5, 1, 9, 2, 6];
  const ordered = order.map((index, i) => ({ ...clips[index], id: "clip-" + String(i + 1).padStart(2, "0") }));
  writeFileSync(out + "clips-private.json", JSON.stringify(ordered, null, 2), { mode: 0o600 });
  writeFileSync(
    out + "clips.json",
    JSON.stringify(
      ordered.map(({ category, shotId, ...c }) => {
        void category;
        void shotId;
        return c;
      }),
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(ordered);
}
console.log(
  JSON.stringify(
    {
      pooled: summary.pooled,
      withholdingWindows: allWindows.length,
      safeUpgradeWindows: allWindows.filter((w) => w.upgradeKills > 0 && !w.loss).length,
    },
    null,
    2,
  ),
);
