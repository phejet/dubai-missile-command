import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "operator-results/scoring-study-20260915/";
const out = root + "attribution/";
const observed = JSON.parse(readFileSync(out + "observed-results.json", "utf8"));
assert.deepEqual(observed, JSON.parse(readFileSync(out + "baseline-results.json", "utf8")));
const sum = (a, f) => a.reduce((n, e) => n + f(e), 0);
function summarize(events) {
  const rewards = events.filter((e) => e.type === "reward");
  const kills = rewards.filter((e) => e.kind === "kill");
  const sources = {};
  for (const e of rewards) {
    if (!["kill", "multi", "friendly_fire"].includes(e.kind)) continue;
    assert.notEqual(e.source, "unattributed");
    const s = (sources[e.source] ??= { base: 0, uplift: 0, multi: 0, kills: 0, chainKills: 0, assistedKills: 0 });
    if (e.kind === "kill") {
      s.base += e.base;
      s.uplift += e.uplift;
      s.kills++;
      s.chainKills += Number(e.chain);
      s.assistedKills += Number(e.contributors.some((c) => c.source !== e.source));
    } else if (e.kind === "multi") s.multi += e.amount;
  }
  const combo = {};
  for (const e of events.filter((e) => e.type === "combo")) {
    const c = (combo[e.source] ??= { up: 0, reset: 0, same: 0 });
    c[e.after > e.before ? "up" : e.after < e.before ? "reset" : "same"]++;
  }
  const shots = events.filter((e) => e.type === "shot");
  const outcomes = { kill: 0, assistOnly: 0, emptyResolved: 0, unresolved: 0, friendlyHit: 0 };
  for (const shot of shots) {
    const own = events.filter((e) => e.shotId === shot.shotId);
    if (own.some((e) => e.kind === "friendly_fire")) outcomes.friendlyHit++;
    else if (own.some((e) => e.kind === "kill")) outcomes.kill++;
    else if (own.some((e) => e.type === "damage" && e.applied > 0)) outcomes.assistOnly++;
    else if (own.some((e) => e.type === "combo")) outcomes.emptyResolved++;
    else outcomes.unresolved++;
  }
  const multiShots = {};
  for (const e of events.filter((e) => e.type === "multiShot")) multiShots[e.source] = (multiShots[e.source] ?? 0) + 1;
  return {
    score: sum(rewards, (e) => e.amount),
    base: sum(kills, (e) => e.base),
    uplift: sum(kills, (e) => e.uplift),
    multi: sum(
      rewards.filter((e) => e.kind === "multi"),
      (e) => e.amount,
    ),
    waveClear: sum(
      rewards.filter((e) => e.kind === "wave_clear"),
      (e) => e.amount,
    ),
    buildingBonus: sum(
      rewards.filter((e) => e.kind === "building_bonus"),
      (e) => e.amount,
    ),
    spending: sum(
      rewards.filter((e) => e.kind === "spending"),
      (e) => e.amount,
    ),
    friendlyFire: sum(
      rewards.filter((e) => e.kind === "friendly_fire"),
      (e) => e.amount,
    ),
    sources,
    combo,
    shots: shots.length,
    outcomes,
    multiShots,
    kills: kills.length,
    neutralized: events.filter((e) => e.type === "destroyed" && !e.scored).length,
    assistedKills: kills.filter((e) => e.contributors.some((c) => c.source !== e.source)).length,
  };
}
const allEvents = [];
const runs = observed.map((r) => {
  const replay = JSON.parse(readFileSync(root + r.label + "-replay.json", "utf8"));
  const events = JSON.parse(readFileSync(out + r.label + "-events.json", "utf8"));
  // Make shot identities unique in pooled data while retaining per-run output.
  const summary = summarize(events);
  const waves = Object.keys(r.waveDeltas).map((wave) => ({
    wave: Number(wave),
    terminal: !r.recap.waveCards.find((w) => w.wave === Number(wave) && !w.terminal),
    ...summarize(events.filter((e) => e.wave === Number(wave))),
  }));
  allEvents.push(
    ...events.map((e) => ({
      ...e,
      shotId: e.shotId === null || e.shotId === undefined ? null : r.label + ":" + e.shotId,
    })),
  );
  const attempts = replay.actions.filter((a) => a.type === "fire").length;
  assert(attempts >= summary.shots);
  assert.equal(summary.kills + summary.neutralized, r.stats.missileKills + r.stats.droneKills);
  assert.equal(
    sum(Object.values(summary.multiShots), (n) => n),
    r.stats.multiShots,
  );
  return {
    label: r.label,
    finalWave: r.recap.wave,
    ...summary,
    attempts,
    rejected: attempts - summary.shots,
    waves,
    purchases: replay.actions.filter((a) => a.type === "shop").map((a) => ({ tick: a.tick, bought: a.bought })),
    activeUses: events.filter((e) => e.type === "active").map(({ source, tick, wave }) => ({ source, tick, wave })),
  };
});
const pooled = summarize(allEvents);
const data = {
  method: {
    runs: runs.length,
    samples: sum(observed, (r) => r.samples.length),
    checkpoints: sum(observed, (r) => r.metadata.verifiedCheckpointIndexes.length),
    ticks: sum(observed, (r) => r.finalTick),
    cases: JSON.parse(readFileSync(out + "controlled-cases.json", "utf8")),
  },
  pooled,
  runs,
};
writeFileSync(out + "aggregate.json", JSON.stringify(data, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(
    { method: data.method, pooled, attempts: sum(runs, (r) => r.attempts), rejected: sum(runs, (r) => r.rejected) },
    null,
    2,
  ),
);
