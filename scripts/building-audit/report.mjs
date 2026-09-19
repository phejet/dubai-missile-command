import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { format } from "prettier";
const out = "operator-results/building-audit-20260919";
const all = JSON.parse(readFileSync(out + "/observed-results.json", "utf8"));
const inventory = JSON.parse(readFileSync(out + "/inventory.json", "utf8"));
const runs = all.filter((r) => r.cohort === "human-study" && r.status === "verified");
const records = runs.flatMap((r) => r.audit.records.map((t) => ({ ...t, run: r.studyLabel })));
const bombs = records.filter((t) => t.type === "bomb");
const count = (a, fn) => a.reduce((d, x) => ((d[fn(x)] = (d[fn(x)] ?? 0) + 1), d), {});
function outcome(t) {
  if (t.hitBuilding !== null)
    return t.hitBuilding === t.target ? "Intended building destroyed" : "Different building destroyed";
  if (t.outcome === "game-sim.ts:2216")
    return t.context.playerCaused ? "Player-caused blast / chain" : "Non-player blast / chain";
  return (
    {
      "game-sim-flare.ts:191": "Flare neutralization",
      "game-sim.ts:1578": "Flare destruction",
      "game-logic.ts:1083": "Direct defense damage",
      "game-sim.ts:1840": "Ground: target already destroyed",
      unresolved: "Still alive at recording end",
    }[t.outcome] ?? "UNCLASSIFIED"
  );
}
for (const r of runs) {
  assert.equal(r.audit.buildings.length, 10);
  assert.equal(
    r.audit.deaths.length,
    r.audit.buildings.filter((b) => !b.alive).length,
    "All building deaths reconcile",
  );
  assert.equal(new Set(r.audit.deaths.map((d) => d.building)).size, r.audit.deaths.length);
  for (const d of r.audit.deaths)
    assert(
      r.audit.records.some((t) => t.id === d.actor),
      "Every building death has causal threat",
    );
  for (const c of r.audit.contacts.filter((c) => c.eligible && c.point))
    assert(
      r.audit.deaths.some((d) => d.building === c.building && d.tick === c.tick && d.actor === c.id),
      "Every eligible endpoint contact destroys building",
    );
  assert(!r.audit.records.some((t) => t.outcome === "unobserved-removal"), "No unaccounted threat removals");
}
assert(bombs.every((t) => t.selectedAtSpawn && t.target !== null));
assert(!bombs.some((t) => outcome(t) === "UNCLASSIFIED"));
const wrong = bombs.find((t) => t.hitBuilding !== null && t.hitBuilding !== t.target);
const sweepRun = runs.find((r) => r.audit.contacts.some((c) => c.eligible && !c.point));
const sweep = sweepRun.audit.contacts.find((c) => c.eligible && !c.point);
const success = bombs.find((t) => t.hitBuilding === t.target && t.hitBuilding !== null);
const stale = bombs.find((t) => t.outcome === "game-sim.ts:1840");
assert.equal(stale.end.targetAlive, false);
const data = {
  files: inventory.files,
  unique: inventory.unique,
  coverage: count(all, (r) => r.status),
  runCount: runs.length,
  total: records.length,
  missilesAndBombs: records.filter((t) => t.type !== "drone").length,
  bombs: bombs.length,
  rayMisses: bombs.filter((t) => !t.initialRayHits).length,
  outcomes: count(bombs, outcome),
  types: count(records, (t) => t.type),
  contacts: count(
    runs.flatMap((r) => r.audit.contacts),
    (c) => (c.eligible ? (c.point ? "endpoint" : "swept-only") : "precedence"),
  ),
  buildingDeaths: runs.reduce((n, r) => n + r.audit.deaths.length, 0),
  deathTypes: count(
    runs.flatMap((r) => r.audit.deaths.map((d) => r.audit.records.find((t) => t.id === d.actor))),
    (t) => t.type,
  ),
  checkpoints: runs.reduce((n, r) => n + r.meta.verifiedCheckpointIndexes.length, 0),
  samples: runs.reduce((n, r) => n + r.samples.length, 0),
  roots: records.filter((t) => t.parent === null).length,
  descendants: records.filter((t) => t.parent !== null).length,
  rows: runs.map((r) => {
    const bs = r.audit.records.filter((t) => t.type === "bomb");
    return {
      run: r.studyLabel,
      build: r.build,
      wave: r.wave,
      threats: r.audit.records.length,
      bombs: bs.length,
      rayMisses: bs.filter((t) => !t.initialRayHits).length,
      hits: bs.filter((t) => t.hitBuilding === t.target && t.target !== null).length,
      survivors: r.audit.buildings.filter((b) => b.alive).length,
    };
  }),
  waves: Array.from({ length: Math.max(...records.map((t) => t.wave)) }, (_, i) => {
    const a = records.filter((t) => t.wave === i + 1),
      b = a.filter((t) => t.type === "bomb");
    return {
      wave: i + 1,
      threats: a.length,
      bombs: b.length,
      rayMisses: b.filter((t) => !t.initialRayHits).length,
      hits: b.filter((t) => t.hitBuilding === t.target && t.target !== null).length,
    };
  }),
  examples: [
    {
      name: "Bomb misses intended building",
      threat: wrong,
      buildings: runs.find((r) => r.studyLabel === wrong.run).audit.buildings,
    },
    {
      name: "Successful intended hit",
      threat: success,
      buildings: runs.find((r) => r.studyLabel === success.run).audit.buildings,
    },
    {
      name: "Target already destroyed",
      threat: stale,
      buildings: runs.find((r) => r.studyLabel === stale.run).audit.buildings,
    },
  ],
  sweep: { ...sweep, run: sweepRun.studyLabel, threat: sweepRun.audit.records.find((t) => t.id === sweep.id) },
  rayMissOutcomes: count(
    bombs.filter((t) => !t.initialRayHits),
    outcome,
  ),
  buildings: Array.from({ length: 10 }, (_, i) => ({
    building: i + 1,
    targeted: bombs.filter((t) => t.target === i).length,
    destroyed: runs.filter((r) => !r.audit.buildings[i].alive).length,
  })),
  coverageRows: all.map((r) => ({
    label: r.studyLabel ?? r.label,
    cohort: r.cohort,
    status: r.status,
    reason: r.reason ?? "",
  })),
};
writeFileSync(out + "/analysis.json", JSON.stringify(data, null, 2));
const pct = (n, d) => ((100 * n) / d).toFixed(1) + "%";
const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const table = (heads, rows) =>
  '<div class="table"><table><thead><tr>' +
  heads.map((h) => "<th>" + esc(h) + "</th>").join("") +
  "</tr></thead><tbody>" +
  rows.map((r) => "<tr>" + r.map((c) => "<td>" + esc(c) + "</td>").join("") + "</tr>").join("") +
  "</tbody></table></div>";
const intercepted = bombs.filter(
  (t) =>
    ![
      "Intended building destroyed",
      "Different building destroyed",
      "Ground: target already destroyed",
      "Still alive at recording end",
    ].includes(outcome(t)),
).length;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>City buildings: targeting and impact audit</title><style>
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#0c131d;color:#dce7f2}body{margin:0}main{max-width:1040px;margin:auto;padding:36px 24px 80px}h1,h2,h3{line-height:1.2;color:#fff}h1{font-size:clamp(2rem,5vw,3.5rem);max-width:850px}h2{margin-top:46px}a{color:#83cfff}.muted,small{color:#a3b5c9}.lead{font-size:1.2rem}.notice{border-left:4px solid #ffb45c;padding:16px 20px;background:#192331}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.card{padding:18px;background:#172330;border:1px solid #314658;border-radius:8px}.card strong{font-size:2rem;display:block;color:#85dec5}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.94rem}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #304153}th{color:#9bc6df}code{color:#b7e3ff;overflow-wrap:anywhere}select{max-width:100%;padding:10px;font:inherit;background:#182738;color:#fff;border:1px solid #58748a;border-radius:6px}svg{width:100%;height:auto;background:#111c29;border:1px solid #304153;border-radius:8px}details{padding:14px 0}summary{cursor:pointer;color:#9bd4ff}.diagram{max-width:650px;margin:20px auto}li{margin:8px 0} @media(max-width:600px){main{padding:20px 16px 50px}.cards{grid-template-columns:1fr}.card strong{font-size:1.7rem}th,td{padding:8px}}
</style></head><body><main><p class="muted">RM-09 · 19 September 2026 · Existing recordings, unchanged simulation</p><h1>City buildings survive mostly because threats never reach them. Two real defects also exist.</h1>
<p class="lead">This audit covers the ten surrounding buildings. The main tower is excluded. All 26 saved human runs reproduce exactly, and the observer preserves their simulation state.</p>
<div class="cards"><div class="card"><strong>${pct(bombs.length, data.missilesAndBombs)}</strong>of spawned missiles + bombs target buildings<br><small>${bombs.length} / ${data.missilesAndBombs}; all are dropped bombs</small></div><div class="card"><strong>${pct(intercepted, bombs.length)}</strong>of those bombs are intercepted or neutralized<br><small>${intercepted} / ${bombs.length}</small></div><div class="card"><strong>${pct(data.rayMisses, bombs.length)}</strong>start on a path that misses the selected building<br><small>${data.rayMisses} / ${bombs.length}; geometric prediction, not observed ground misses</small></div></div>
<h2>What targets the skyline?</h2><p>Every one of the ${bombs.length} dropped bombs selects a live building’s roof center. Ordinary missiles, MIRVs and stack missiles select the tower, launchers or defense sites instead. They can still hit city buildings incidentally. The selector’s “70%” means nearest versus second-nearest target; it is not a building-targeting percentage.</p>
<p>Including carrier drones, bombs represent <strong>${pct(bombs.length, records.length)} (${bombs.length}/${records.length})</strong> of all spawned hostile entities. These counts include each spawned descendant once: ${data.roots} root entities and ${data.descendants} descendants. A stack parent changing type is not counted again. Bombs are counted at drop, not when their carrier spawns; intercepted carriers therefore reduce actual bomb exposure.</p>
${table(
  ["Threat at spawn", "Count", "City building selected"],
  Object.entries(data.types).map(([type, n]) => [
    type,
    n,
    type === "bomb" ? "100% (verified selector trace)" : "0% (target-selection code; incidental hits possible)",
  ]),
)}
<h2>Where did the building-directed bombs go?</h2>${table(
  ["Recorded outcome", "Bombs", "Share of all bombs"],
  Object.entries(data.outcomes).map(([k, n]) => [k, n, pct(n, bombs.length)]),
)}
<p><strong>Only 18 bombs destroyed their intended building; one destroyed a different building.</strong> Of the 19 resolved bombs arriving at a building while their selected target remained alive, 18 hit the intended target (${pct(18, 19)}). That conditional figure excludes ${intercepted} intercepted/neutralized bombs, 69 still alive at recording end, and one ground impact after its target had already died. It must not be read as general bomb accuracy.</p>
<p>“Player-caused” is the explosion’s recorded ownership flag, including inherited chains; “non-player” includes defense and impact-origin blasts. These categories do not establish that the player deliberately defended a building, or that every interception prevented a future hit. Flare outcomes and direct defense damage are recorded at their actual destruction branches.</p>
<h2>Defect 1: the bomb selects a target but its velocity does not reliably reach it</h2>
<p>At drop, <code>vx = (targetX − startX) × 0.004</code>, while <code>vy</code> is independently randomized between 2.4 and 4.0. Both stay constant in normal bomb flight. Horizontal arrival therefore depends on drop height and vertical speed; storing <code>targetX / targetY</code> does not guide the bomb.</p>
<p>At the roof, <code>x = startX + vx × (roofY − startY) / vy</code>. ${data.rayMisses} initial forward rays never intersect the selected building’s rectangle. Most of those bombs are intercepted first; the geometric defect is not ${data.rayMisses} observed failed impacts.</p>
${table(["Outcome among the 132 initially misaligned bombs", "Count"], Object.entries(data.rayMissOutcomes))}
<div class="notice"><strong>Recorded proof: ${wrong.run}, wave ${wrong.wave}, bomb ${wrong.id}, ticks ${wrong.born}–${wrong.end.tick}.</strong> It selects building ${wrong.target + 1}, whose horizontal bounds are 150–184. Its trajectory reaches that roof at x=${wrong.roofX.toFixed(1)}, already beyond the building. It continues into building ${wrong.hitBuilding + 1} while the intended building is still alive. Replaying that exact initial state through the real missile updater reproduces the wrong-building hit.</div>
<h3>Inspect the trajectories</h3><label for="example">Recorded case </label><select id="example">${data.examples.map((e, i) => '<option value="' + i + '">' + esc(e.name) + "</option>").join("")}</select><p id="exampleText"></p><div class="diagram"><svg id="trajectory" viewBox="0 0 900 1470" role="img" aria-label="Recorded bomb trajectory and selected city building"></svg></div><p class="muted">Orange: intended building. Pink: actual building hit, if different. Cyan: sampled recorded path. Dashed orange: direct line to the selected roof center. Gray rectangles show geometry, not contemporaneous survival. Coordinates use the actual 900-pixel game world; building labels are left-to-right, starting at 1.</p>
<h2>Defect 2: endpoint-only collision can miss a crossing</h2><p><strong>${data.sweep.run}, wave ${data.sweep.threat.wave}, warhead ${data.sweep.id}, tick ${data.sweep.tick}:</strong> a MIRV child travels from (${sweep.previous.x.toFixed(2)}, ${sweep.previous.y.toFixed(2)}) to (${sweep.current.x.toFixed(2)}, ${sweep.current.y.toFixed(2)}). The segment crosses building ${sweep.building + 1}, but its endpoint lies beyond the right edge. The collision checks only that endpoint, so the building survives. The warhead is intercepted two ticks later. This was an incidental building crossing by a threat aimed at a defense site, not a building-targeted bomb.</p>
<div class="diagram"><svg viewBox="250 1220 80 200" role="img" aria-label="Magnified missed building corner crossing"><rect x="262" y="1260" width="34" height="144" fill="#e4a55233" stroke="#ffb45c" stroke-width=".6"/><path d="M ${sweep.previous.x} ${sweep.previous.y} L ${sweep.current.x} ${sweep.current.y}" stroke="#71e3df" stroke-width=".8"/><circle cx="${sweep.previous.x}" cy="${sweep.previous.y}" r="1.3" fill="#71e3df"/><circle cx="${sweep.current.x}" cy="${sweep.current.y}" r="1.3" fill="#ff83b0"/></svg></div>
<p>Across all verified human runs, <strong>52 eligible endpoint contacts destroyed their buildings: zero damage-application failures</strong>. An independent swept-segment check finds <strong>one additional missed crossing</strong> (1/53 observed geometric contacts, ${pct(1, 53)}). No swept-only bomb contact occurs. The actual missed missile segment reproduces in an isolated real update; a separate deliberately high-speed fixture also demonstrates the general endpoint limitation.</p>
<h2>Why survival feels generous</h2><p>The 26 runs start with 260 building instances and end with 200 still alive: <strong>76.9% survival</strong>, or 7.7 of 10 buildings per run on average. This mixes different run lengths and is descriptive, not a balance target. All 60 losses reconcile to an actual threat: 52 missile/bomb collisions and eight drone dive impacts.</p>
${table(["Threat responsible for building loss", "Buildings destroyed"], Object.entries(data.deathTypes))}
<p>Most building-directed bombs disappear in combat well before impact. Broad blasts, chains and flares can protect the skyline without a deliberate building-defense shot. The bomb trajectory bug and one missed missile corner are real, but the evidence does not support blaming most building survival on failed collision damage.</p>
<details><summary>Exposure and loss by building</summary>${table(
  ["Building", "Bombs selecting it", "Destroyed across 26 runs"],
  data.buildings.map((b) => [b.building, b.targeted, b.destroyed]),
)}</details>
<details><summary>All 26 verified human runs</summary>${table(
  ["Run", "Final wave", "Threats", "Bombs", "Initially misaligned", "Intended hits", "Buildings left"],
  data.rows.map((r) => [r.run, r.wave, r.threats, r.bombs, r.rayMisses, r.hits, r.survivors]),
)}</details>
<details><summary>Breakdown by spawn wave</summary>${table(
  ["Spawn wave", "Threats", "Bombs", "Misaligned at drop", "Eventual intended hits"],
  data.waves.map((w) => [w.wave, w.threats, w.bombs, w.rayMisses, w.hits]),
)}<p>Grouped by spawn wave; a bomb can resolve later. Final waves can be truncated.</p></details>
<details><summary>Breakdown by recorded build</summary>${table(
  ["Build", "Runs", "Bombs", "Misaligned at drop"],
  Object.keys(count(data.rows, (r) => r.build)).map((build) => {
    const a = data.rows.filter((r) => r.build === build);
    return [build, a.length, a.reduce((n, r) => n + r.bombs, 0), a.reduce((n, r) => n + r.rayMisses, 0)];
  }),
)}<p>These are descriptive strata; no cross-build causality is inferred.</p></details>
<h2>Coverage and verification</h2><p>Scanned the repository’s local JSON replay payloads, including nested diagnostics, saved runs, Staging backups, public/performance fixtures and prior study inputs: <strong>${data.files} payloads, ${data.unique} unique replay signatures</strong>. Overlapping exports are deduplicated using seed, actions, initial state, mode, endpoint, version and build.</p><ul><li>26 saved human runs: verified checkpoints, endpoint, actions and full operator summaries.</li><li>One automated recording also verifies, but contains no spawned threats and contributes no gameplay measurements.</li><li>50 automated recordings diverge from the current simulator and are quarantined. They are not silently treated as valid historical evidence.</li><li>12 legacy fixtures lack a recorded final tick and cannot establish a verified historical endpoint.</li></ul>
<p>All ${data.checkpoints.toLocaleString("en-US")} human checkpoints and ${data.samples.toLocaleString("en-US")} sampled full-state/RNG hashes agree between unmodified and observed playback. Four controlled collision cases pass, and both replay-derived defects reproduce independently of player input. Input simulation files were not changed; instrumentation is applied only to generated analysis bundles.</p>
<p class="notice">This is exhaustive for the local payloads discovered, including the 26-session Staging snapshot previously retrieved on September 15. No operator bearer is available in this session, so the live server inventory was not refreshed. Newer, expired or deleted recordings are not covered. Checkpoint agreement supports current-code reconstruction; it cannot prove every unrecorded historical intermediate state.</p>
<details><summary>Full coverage ledger</summary>${table(
  ["Anonymous recording", "Cohort", "Status", "Reason"],
  data.coverageRows.map((r) => [r.label, r.cohort, r.status, r.reason]),
)}</details>
<h2>Recommended next change</h2><ol><li>Make bomb launch velocity geometrically consistent with its selected roof target, preserving a deliberate speed/fall-time policy. Re-measure building pressure afterward; this will change replay outcomes.</li><li>Use swept collision for missile/bomb building intersections, with explicit first-contact and collision-order rules. Keep the tower outside this investigation’s scope.</li><li>Only then decide whether building-directed threat frequency needs tuning. The present recordings already show substantial incidental protection.</li></ol><p>No gameplay fixes, tuning, commits or pushes were performed. Scripts are retained in <code>scripts/building-audit/</code> for the eventual commit; private inputs, bundles and machine-readable ledgers remain under <code>operator-results/building-audit-20260919/</code>.</p>
<p><a href="building-impact-audit-plan.md">Audit plan</a> · <a href="building-impact-audit-method.md">Reproduction and limits</a> · <a href="../../ROADMAP.html#rm-09">Roadmap</a> · <a href="README.md">Study index</a></p>
<script type="application/json" id="auditData">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script>
const data=JSON.parse(document.querySelector('#auditData').textContent);const sel=document.querySelector('#example');
function draw(){const e=data.examples[Number(sel.value)],t=e.threat;document.querySelector('#exampleText').textContent=t.run+' · wave '+t.wave+' · threat '+t.id+' · ticks '+t.born+'–'+t.end.tick+'. Intended building '+(t.target+1)+'; '+(t.hitBuilding===null?'no building hit': 'building '+(t.hitBuilding+1)+' destroyed')+'.';
const rects=e.buildings.map(b=>{const r=b.bounds,color=b.id===t.target?'#ffb45c':b.id===t.hitBuilding?'#ff83b0':'#54718c';return '<rect x="'+r.left+'" y="'+r.top+'" width="'+(r.right-r.left)+'" height="'+(r.bottom-r.top)+'" fill="'+color+'33" stroke="'+color+'" stroke-width="2"/><text x="'+((r.left+r.right)/2)+'" y="1436" fill="#b5c9df" text-anchor="middle" font-size="18">'+(b.id+1)+'</text>'}).join('');
const points=[[t.start.x,t.start.y],...t.trajectory.map(p=>[p[1],p[2]]),[t.end.x,t.end.y]].map(p=>p.join(',')).join(' ');document.querySelector('#trajectory').innerHTML=rects+'<line x1="'+t.start.x+'" y1="'+t.start.y+'" x2="'+t.aim.x+'" y2="'+t.aim.y+'" stroke="#ffb45c" stroke-dasharray="10 10" stroke-width="2"/><polyline points="'+points+'" fill="none" stroke="#71e3df" stroke-width="4"/><circle cx="'+t.end.x+'" cy="'+t.end.y+'" r="7" fill="#ff83b0"/>';}
sel.addEventListener('change',draw);draw();
</script></main></body></html>`;
writeFileSync(
  "docs/gameplay analysis Sep 2026/building-impact-audit-results.html",
  await format(html, { parser: "html", printWidth: 120 }),
);
console.log(
  JSON.stringify({
    bombs: data.bombs,
    total: data.total,
    missilesAndBombs: data.missilesAndBombs,
    intercepted,
    rayMisses: data.rayMisses,
    outcomes: data.outcomes,
    contacts: data.contacts,
    deaths: data.deathTypes,
  }),
);
