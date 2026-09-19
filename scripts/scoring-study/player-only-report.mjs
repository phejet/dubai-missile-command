import { readFileSync, writeFileSync } from "node:fs";
import { format, resolveConfig } from "prettier";
import { spearman } from "./progression-stats.mjs";

const root = "operator-results/scoring-study-20260915/player-only/";
const d = JSON.parse(readFileSync(root + "analysis.json", "utf8"));
const proof = JSON.parse(readFileSync(root + "crosscheck.json", "utf8"));
const t = d.totals;
const S = Object.fromEntries(d.summaries.map((s) => [s.id, s]));
const n = (x) => Math.round(x).toLocaleString("en-US");
const pct = (x, digits = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(digits) + "%";
const share = (x, of = t.original, digits = 1) => ((100 * x) / of).toFixed(digits) + "%";
const change = (id) => (100 * S[id].delta) / S[id].original;
const sources = Object.fromEntries(d.sources.map((s) => [s.source, s]));
const autoSources = d.sources.filter((s) => s.owner !== "player");
const autoKillPoints = t.ownerPoints.auto + t.ownerPoints.impact;
const autoUplift = autoSources.reduce((a, s) => a + s.uplift, 0);
const keptMulti = t.multi.auto + t.multi.impact;
const strict = S["P|C10"].total - keptMulti;
const player = sources.player;
const abilities = ["f15", "flare", "emp"].reduce((a, s) => a + sources[s].base + sources[s].uplift, 0);
const avgBase = t.playerSourceBase / t.productivePlayerShots;
const runsAt10 = d.runs.filter((r) => r.shotsAt10 > 0).length;
const pRuns = [...d.runs].sort((a, b) => a.scores["P|C10"] / a.original - b.scores["P|C10"] / b.original);
const runPct = (r, id) => (100 * (r.scores[id] - r.original)) / r.original;
const cashEffect = (r) => (100 * (r.scores["P|C5-350"] - r.scores["P|C10"])) / r.original;
const at10Share = (r) => r.playerPointsAt10 / r.playerPoints;
const streakRho = spearman(
  d.runs.filter((r) => r.playerPoints).map(at10Share),
  d.runs.filter((r) => r.playerPoints).map(cashEffect),
);
const byCash = [...d.runs].sort((a, b) => cashEffect(a) - cashEffect(b));
const empty = t.emptyCauses;
const emptyTotal = Object.values(empty).reduce((a, b) => a + b, 0);
const late = d.byWave.filter((w) => w.wave >= 5);
const early = d.byWave.filter((w) => w.wave >= 2 && w.wave <= 4);
const rate = (ws, k, of) => ws.reduce((a, w) => a + w[k], 0) / ws.reduce((a, w) => a + w[of], 0);
const streakKeys = ["1", "2", "3", "4", "5-9", "10-19", "20+"];
const streakCount = streakKeys.reduce((a, k) => a + (t.streaks[k] ?? 0), 0);
const productiveTriggers = streakKeys.reduce((a, k) => a + t.productiveTriggersInStreaks[k], 0);
const longStreaks = (t.streaks["10-19"] ?? 0) + (t.streaks["20+"] ?? 0);
const longShare = (t.productiveTriggersInStreaks["10-19"] + t.productiveTriggersInStreaks["20+"]) / productiveTriggers;
const shortShare = ["1", "2", "3", "4"].reduce((a, k) => a + t.streaks[k], 0) / streakCount;
const streakPoints = (len, cap, bonus) => {
  let c = 1,
    pts = 0;
  for (let i = 0; i < len; i++) {
    pts += avgBase * c;
    if (bonus !== null && c === cap) {
      pts += bonus;
      c = 1;
    } else c = Math.min(cap, c + 1);
  }
  return pts;
};
const crossover = (bonus) => {
  for (let len = 1; len < 200; len++) if (streakPoints(len, 10, null) > streakPoints(len, 5, bonus)) return len;
  return null;
};
const longRuns = d.runs.filter((r) => r.finalWave >= 8).map((r) => -runPct(r, "P|C10"));
const lowStreakRuns = d.runs.filter((r) => r.playerPoints && at10Share(r) < 0.3);
const lowStreakWorst = Math.min(...lowStreakRuns.map(cashEffect));
const lowStreakGain700 = lowStreakRuns.filter((r) => r.scores["P|C5-700"] > r.scores["P|C10"]).length;
const multiBeatsBase = autoSources.every((s) => s.multi > s.base);
const possibleBuilding = t.buildingBonus + t.forfeitedBuildingBonus;
const endCounts = d.runs.map((r) => r.buildingsAtEnd);
const meanEnd = endCounts.reduce((a, b) => a + b, 0) / endCounts.length;
const doneWaves = d.byWave.filter((w) => w.survival.completed);
const worstLossWave = [...d.byWave].sort((a, b) => b.survival.lostAllRuns - a.survival.lostAllRuns)[0];
const shareOf = (w, id) => (w.survival.share[id] === null ? "—" : (100 * w.survival.share[id]).toFixed(0) + "%");
const timeline = (r) =>
  r.buildingsTimeline.slice(0, -1).join(" ") +
  (r.buildingsTimeline.length > 1 ? " → " : "") +
  r.buildingsTimeline.at(-1);
const waveRho = d.byWave.filter((w) => w.rankCorrelation).map((w) => w.rankCorrelation["P|C10"]);
const comboLabel = (id) => (id === "C10" ? "×10 cap (today)" : `cap ×5, cash-out ${id.slice(3)}`);
const ownLabel = (id) => (id === "today" ? "all sources (today)" : "player actions only");

const table = (heads, body, id = "") =>
  `<div class="scroll"><table><thead><tr>${heads.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody${id ? ` id="${id}"` : ""}>${body}</tbody></table></div>`;
const tr = (cells) => "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
const bar = (value, max, cls = "") =>
  `<span class="bar ${cls}" style="width:${Math.max(2, (100 * Math.abs(value)) / max).toFixed(1)}%"></span>`;

const composition = [
  ["Wave-clear bonus (250 × wave)", t.waveClear, "kept"],
  ["Building bonus (100 × buildings standing × wave)", t.buildingBonus, "kept"],
  ["Interceptor kills: base value", player.base, "kept"],
  ["Interceptor kills: combo uplift", player.uplift, "kept"],
  ["F-15, flare and EMP kills", abilities, "kept"],
  ["Multi-kill bonuses from player actions", t.multi.player, "kept"],
  ["Multi-kill bonuses from automation and impacts", keptMulti, "kept (exception)"],
  [
    "Automation kills: base value",
    t.ownerPoints.auto - autoSources.filter((s) => s.owner === "auto").reduce((a, s) => a + s.uplift, 0),
    "removed",
  ],
  [
    "Automation kills: player's combo uplift",
    autoSources.filter((s) => s.owner === "auto").reduce((a, s) => a + s.uplift, 0),
    "removed",
  ],
  ["Impact kills (threat exploding on contact)", t.ownerPoints.impact, "removed"],
];
const compositionMax = Math.max(...composition.map((c) => c[1]));
const sourceRows = autoSources
  .map((s) => [
    { hornets: "Wild Hornets", patriot: "Patriot", roadrunner: "Roadrunner", ironBeam: "Iron Beam", impact: "Impact" }[
      s.source
    ] ?? s.source,
    n(s.kills),
    n(s.base),
    n(s.uplift),
    n(s.base + s.uplift),
    n(s.multi),
  ])
  .map(tr)
  .join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Part Six — Points for the player</title><style>
:root{color-scheme:dark;--bg:#0a1220;--card:#111e30;--line:#2c3e54;--ink:#e3ebf5;--ink2:#b5c4d8;--muted:#8fa1b8;--accent:#6ee1c2;--s1:#3987e5;--s2:#d95926;--removed:#d95926;--kept:#3987e5;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}main{max-width:1120px;padding:48px 24px 80px;margin:auto}
h1{font-size:clamp(34px,6vw,62px);line-height:1.08;letter-spacing:-.03em;max-width:900px;margin:.3em 0}h2{font-size:26px;line-height:1.25;margin-top:0}h3{font-size:18px;margin-bottom:.4em}p{max-width:90ch}
.tag{color:var(--accent);text-transform:uppercase;letter-spacing:.12em;font-size:12px}.lede{font-size:20px;color:var(--ink2)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:26px}.card,section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px}section{margin-top:22px}
.card strong{font-size:32px;display:block;line-height:1.2;margin:4px 0}.card small,.muted{color:var(--muted)}small{color:var(--muted)}
.callout{padding:14px 18px;border-left:3px solid #f3bc69;background:#1d2939;border-radius:0 8px 8px 0}
a,summary{color:var(--accent)}summary{cursor:pointer}details{margin:16px 0}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:right;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}th:first-child,td:first-child{text-align:left}th{color:var(--ink2);font-weight:600}td{font-variant-numeric:tabular-nums}
td.text{text-align:left}.bar{display:block;height:6px;border-radius:0 4px 4px 0;background:var(--kept);margin-top:4px;max-width:160px}.bar.removed{background:var(--removed)}.cellbar{min-width:170px}
.pill{display:inline-block;font-size:12px;padding:1px 8px;border-radius:99px;border:1px solid var(--line);color:var(--ink2)}.pill.removed{border-color:var(--removed);color:#ffb6a5}
.toolbar{display:flex;gap:18px;flex-wrap:wrap;margin:16px 0}label{display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:100%}select{background:var(--bg);color:inherit;font:inherit;border:1px solid #6b839e;border-radius:6px;padding:7px 9px;max-width:100%}
.up{color:#75dfb9}.down{color:#ffb6a5}
.chart{position:relative;margin-top:10px}.chart svg{width:100%;height:auto;display:block;overflow:visible}.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:14px;color:var(--ink2);margin-top:6px}.key{display:inline-block;width:18px;height:2px;vertical-align:middle;margin-right:6px}.seq{display:block;text-align:left}.key.rect{width:10px;height:10px;border-radius:2px}
.tip{position:absolute;pointer-events:none;background:#0a1220;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;min-width:150px;box-shadow:0 6px 20px #0008}.tip b{font-size:15px}.tip div{white-space:nowrap}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}.formula{font-family:ui-monospace,Menlo,monospace;font-size:14px;color:#b9d2ed}
@media(max-width:760px){main{padding:24px 16px 50px}.cards{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}section,.card{padding:18px 14px}h2{font-size:22px}.lede{font-size:17px}}
@media(max-width:420px){.cards{grid-template-columns:1fr}}
</style></head><body><main>
<div class="tag">Gameplay analysis · Part six · 19 September 2026</div>
<h1>Points for the player,<br>not the turrets.</h1>
<p class="lede">The same 26 recorded runs, rescored under two proposed rules. Rule 1: only player-initiated actions (interceptor shots, F-15, EMP, flares) earn kill points. Automated defenses earn nothing, apart from multi-kill bonuses. Rule 2, tested on its own and combined with rule 1: the combo caps at ×5 and pays a cash-out bonus on the next hit, then resets.</p>
<div class="cards">
<div class="card"><small>Rule 1 · automation earns nothing</small><strong>${pct(change("P|C10"))}</strong>total points; every run loses ${pct(-S["P|C10"].pctRange[1], 1).replace("+", "")} to ${pct(-S["P|C10"].pctRange[0], 1).replace("+", "")}</div>
<div class="card"><small>Rules 1 + 2 · cash-out 350</small><strong>${pct(change("P|C5-350"))}</strong>total points; cash-out alone is ${pct(change("today|C5-350"))}</div>
<div class="card"><small>Final leaderboard order</small><strong>ρ ${S["P|C10"].rankCorrelation.toFixed(3)}</strong>no run moves more than one place under rule 1</div>
<div class="card"><small>Survival bonuses</small><strong>${share(t.bonuses, t.original, 0)}</strong>of all points today: ${share(t.waveClear, t.original, 0)} wave clears, ${share(t.buildingBonus, t.original, 0)} buildings</div>
</div>

<section><h2>This is an exact rescoring, not a simulation</h2><p>All 26 recordings were played in draft mode: wave-end picks are free and score never feeds back into the game. Every recorded shot, kill, pick and outcome therefore stays valid, and each number below is exactly what that run would have scored under the rule. What the recordings cannot show is how players would <em>adapt</em> to the new incentives.</p><p class="muted">Rules and bonus sizes were fixed in the <a href="scoring-player-only-method.md">method note</a> before any result was calculated. Today's rules reproduce all ${n(t.original)} recorded points, every wave total and the recorded multiplier on all ${n(t.kills)} kills.</p></section>

<section><h2>Where today's points come from</h2><p>Survival bonuses are nearly half of all points. Automation and impact kills are ${share(autoKillPoints)}. Of automation's kill points, <strong>${share(autoUplift, autoKillPoints, 0)} came from the player's combo multiplier</strong>: a player's streak was multiplying Patriot and Hornet kills.</p>
${table(["Component", "Points", "Share", "Under rule 1"], composition.map(([label, v, fate]) => tr([label, n(v), `<span class="cellbar">${share(v)}${bar(v, compositionMax, fate === "removed" ? "removed" : "")}</span>`, `<span class="pill ${fate === "removed" ? "removed" : ""}">${fate}</span>`])).join(""))}
<p class="muted">Bars: blue kept, orange removed. Rows sum to ${n(t.original)}. No friendly-fire penalties or spending occurred in this corpus.</p></section>

<section><h2>Survival: waves cleared and buildings standing</h2>
<p>Two bonuses are paid only when a wave is completed; the wave that ends a run pays neither.</p>
<ul><li><strong>Wave clear:</strong> 250 × wave number. Pure survival, ${n(t.waveClear)} points (${share(t.waveClear)} of all points).</li>
<li><strong>Buildings:</strong> 100 × buildings standing × wave number. The city starts with ${t.buildingsAtStart} buildings and never rebuilds them. ${n(t.buildingBonus)} points (${share(t.buildingBonus)}).</li></ul>
<p>With every building standing, the building bonus would have paid ${n(possibleBuilding)}. Building losses cost only <strong>${n(t.forfeitedBuildingBonus)} points (${share(t.forfeitedBuildingBonus)} of all points)</strong>, so ${share(t.buildingBonus, possibleBuilding, 0)} of the possible building bonus was paid.</p>
<p class="callout"><strong>Large bonus, small spread.</strong> The building bonus is big because it is paid on every wave a run survives, and runs keep most of their buildings. What separates a run that defended its buildings well from one that did not is only the lost part: ${share(t.forfeitedBuildingBonus)} of all points here. For scale: clearing wave 5 with all 10 buildings pays 1,250 + 5,000 = 6,250; with 8 buildings it pays 5,250. A lost building costs 100 × wave on every later wave the run clears, so early losses cost most.</p>
<p>Both rules leave these bonuses untouched, so their share grows: ${share(t.survivalShare["today|C10"] * 100, 100)} of all points today, ${share(t.survivalShare["P|C10"] * 100, 100)} under rule 1, ${share(t.survivalShare["P|C5-350"] * 100, 100)} with cash-out 350 and ${share(t.survivalShare["P|C5-500"] * 100, 100)} with cash-out 500.</p>
<h3>Buildings lost, by wave</h3>
<p>Across 26 runs the city lost ${t.buildingsLost} buildings (${(t.buildingsLost / 26).toFixed(1)} per run), ${t.buildingsLostFinalWave} of them in the wave that ended the run. Losses peak in wave ${worstLossWave.wave} (${worstLossWave.survival.lostAllRuns}). At the end of every completed wave, runs averaged at least ${Math.min(...doneWaves.map((w) => w.survival.meanAlive)).toFixed(1)} of ${t.buildingsAtStart} buildings standing.</p>
<div class="chart" id="lossChart" role="img" aria-label="Buildings lost by wave"></div>
<div class="legend"><span><span class="key rect" style="background:var(--s1)"></span>Lost in a wave the run survived</span><span><span class="key rect" style="background:var(--s2)"></span>Lost in the run's final wave</span></div>
<h3>Survival as a share of each wave's points</h3>
<p>Completed waves only. Survival bonuses make up ${(100 * Math.min(...doneWaves.map((w) => w.survival.share["today|C10"]))).toFixed(0)}–${(100 * Math.max(...doneWaves.map((w) => w.survival.share["today|C10"]))).toFixed(0)}% of a completed wave's points today, and more under the new rules because kill points shrink.</p>
<div class="chart" id="shareChart" role="img" aria-label="Survival share of completed-wave points by wave"></div>
<div class="legend"><span><span class="key" style="background:var(--s1)"></span>Today</span><span><span class="key" style="background:var(--s2)"></span>Rule 1 (automation earns nothing)</span></div>
${table(["Wave", "Runs completing", "Wave clear", "Building bonus", "Lost to damage", "Avg standing", "All 10 standing", "Buildings lost", "Survival share today", "Rule 1", "Rules 1 + 2 (350)", "Rules 1 + 2 (500)"], d.byWave.map((w) => tr([w.wave, w.survival.completed, ...(w.survival.completed ? [n(w.survival.waveClear), n(w.survival.buildingBonus), n(w.survival.forfeited)] : ["—", "—", "—"]), w.survival.meanAlive === null ? "—" : w.survival.meanAlive.toFixed(1), w.survival.completed ? `${w.survival.allStanding} of ${w.survival.completed}` : "—", w.survival.lostAllRuns, shareOf(w, "today|C10"), shareOf(w, "P|C10"), shareOf(w, "P|C5-350"), shareOf(w, "P|C5-500")])).join(""), "survivalWaves")}
<p class="muted">"Buildings lost" counts every run that played the wave, including runs that died in it; the other columns count completed waves only. No run completed wave 10.</p>
<h3>Buildings standing, run by run</h3>
<p>At the end of the run, ${d.runs.filter((r) => r.buildingsAtEnd === t.buildingsAtStart).length} runs still had all ${t.buildingsAtStart} buildings. The average was ${meanEnd.toFixed(1)} and the fewest was ${Math.min(...endCounts)}. Sequence: buildings standing after each completed wave → at the end of the run.</p>
${table(
  [
    "Run",
    "Reached",
    "Buildings after each wave → end",
    "At end",
    "Wave clear",
    "Building bonus",
    "Lost to damage",
    "Survival share today",
    "Rule 1",
    "Rules 1 + 2 (350)",
  ],
  [...d.runs]
    .sort((a, b) => b.finalWave - a.finalWave || a.label.localeCompare(b.label))
    .map((r) =>
      tr([
        r.label,
        "wave " + r.finalWave,
        `<span class="seq">${timeline(r)}</span>`,
        r.buildingsAtEnd,
        n(r.waveClear),
        n(r.buildingBonus),
        n(r.forfeitedBuildingBonus),
        share(r.bonuses, r.original, 0),
        share(r.bonuses, r.scores["P|C10"], 0),
        share(r.bonuses, r.scores["P|C5-350"], 0),
      ]),
    )
    .join(""),
  "survivalRuns",
)}
</section>

<section><h2>Rule 1: automation earns nothing</h2>
<p>Pooled, the rule removes ${n(-S["P|C10"].delta)} points (${pct(change("P|C10"))}); the median run loses ${pct(S["P|C10"].medianPct)}. The hardest-hit runs were short and relied on automation: ${pRuns
  .slice(0, 3)
  .map((r) => `${r.label} (${pct(runPct(r, "P|C10"), 0)}, ended wave ${r.finalWave}, ${r.automation.join(" + ")})`)
  .join(
    ", ",
  )}. The ${longRuns.length} runs that reached wave 8 or later lose ${Math.min(...longRuns).toFixed(1)}–${Math.max(...longRuns).toFixed(1)}%.</p>
<h3>Points removed, by source</h3>
${table(["Source", "Kills", "Base value", "Combo uplift", "Removed", "Multi-kill bonus kept"], sourceRows)}
<p class="callout"><strong>The multi-kill exception is not small.</strong> Automation and impacts keep ${n(keptMulti)} points of multi-kill bonuses, ${share(keptMulti, autoKillPoints + keptMulti, 0)} of what they earned before. ${multiBeatsBase ? "Every automated source, and impacts, earned more from multi-kill bonuses than from its kills' base value." : "Patriot earned more from multi-kill bonuses than from its kills' base value."} Dropping the exception too would make rule 1 ${pct((100 * (strict - t.original)) / t.original)} instead of ${pct(change("P|C10"))}.</p>
<h3>By wave</h3><p>The loss grows as automation takes over: ${pct((100 * (d.byWave[0].scores["P|C10"] - d.byWave[0].scores["today|C10"])) / d.byWave[0].scores["today|C10"])} in wave 1, ${pct((100 * (d.byWave[3].scores["P|C10"] - d.byWave[3].scores["today|C10"])) / d.byWave[3].scores["today|C10"])} by wave 4, ${pct((100 * (d.byWave[8].scores["P|C10"] - d.byWave[8].scores["today|C10"])) / d.byWave[8].scores["today|C10"])} in wave 9.</p>
<div class="chart" id="waveChart" role="img" aria-label="Points change versus today by wave"></div>
<div class="legend"><span><span class="key" style="background:var(--s1)"></span>Rule 1 (automation earns nothing)</span><span><span class="key" style="background:var(--s2)"></span>Rules 1 + 2 (cash-out 350)</span></div>
<p class="muted">Every run's last wave is unfinished and pays no survival bonus, so kills dominate it. Wave 10 contains only such final waves (5 runs), which is why its loss is largest.</p>
<details><summary>Table: change by wave</summary>${table(["Wave", "Runs", "Today", "Rule 1", "Rules 1 + 2"], d.byWave.map((w) => tr([w.wave, w.runs, n(w.scores["today|C10"]), pct((100 * (w.scores["P|C10"] - w.scores["today|C10"])) / w.scores["today|C10"]), pct((100 * (w.scores["P|C5-350"] - w.scores["today|C10"])) / w.scores["today|C10"])])).join(""))}</details>
<h3>Does the ranking change?</h3><p>Barely, on final totals: how far a run got decides most of its score, through survival bonuses and more waves of kills. Comparing runs <em>within the same wave</em> is more sensitive: rank agreement with today ranges from ${Math.min(...waveRho).toFixed(2)} to ${Math.max(...waveRho).toFixed(2)} across waves.</p></section>

<section><h2>Rule 2: cap ×5 and cash out</h2>
<h3>How the combo behaves today</h3>
<p>${runsAt10} of 26 runs fired at ×10. Only ${share(t.shotsAt10, t.shots, 0)} of shots were fired at ×10, yet ${share(t.playerPointsAt10, t.playerPoints, 0)} of player kill points were earned there. ×10 is an early-game state: ${(100 * rate(early, "shotsAt10", "shots")).toFixed(0)}% of shots in waves 2–4, ${(100 * rate(late, "shotsAt10", "shots")).toFixed(0)}% from wave 5 on. Later waves break the streak because empty shots climb from ${((100 * d.byWave[0].emptyShots) / d.byWave[0].shots).toFixed(0)}% in wave 1 to ${(100 * rate(late, "emptyShots", "shots")).toFixed(0)}% from wave 5.</p>
<div class="chart" id="comboChart" role="img" aria-label="Share of shots at ×10 and empty shots by wave"></div>
<div class="legend"><span><span class="key" style="background:var(--s1)"></span>Shots fired at ×10</span><span><span class="key" style="background:var(--s2)"></span>Empty shots (no kill)</span></div>
<details><summary>Table: combo by wave</summary>${table(["Wave", "Shots", "At ×10", "Empty", "Target taken by automation", "Target taken by own shot"], d.byWave.map((w) => tr([w.wave, n(w.shots), share(w.shotsAt10, w.shots, 0), share(w.emptyShots, w.shots, 0), n(w.emptyCauses.automation ?? 0), n(w.emptyCauses.ownShot ?? 0)])).join(""))}</details>
<h3>What resets the combo</h3>
${table(
  ["Reset cause", "Resets", "Share", "From ×5 or higher"],
  [
    ["Missed: nothing was taken from the shot", "uncontested"],
    ["Target destroyed by automation first", "automation"],
    ["Target destroyed by another of the player's shots", "ownShot"],
    ["Flare explosion that hit nothing", "flare"],
    ["Target destroyed by an ability or an impact", "other"],
  ]
    .map(([label, k]) =>
      tr([label, n(empty[k] ?? 0), share(empty[k] ?? 0, emptyTotal, 0), n(t.emptyCausesFromFive[k] ?? 0)]),
    )
    .join(""),
)}
<p class="muted">"Destroyed first" means the shot's intended target died to something else during the shot's flight. That is overlap, not proof the other kill caused the miss.</p>
<p class="callout"><strong>Two resets look unfair under either combo rule.</strong> In ${n(empty.automation)} cases the player's combo reset after automation killed the shot's target first. In ${n(empty.flare)} cases a flare explosion with no kills counted as a player miss (${n(t.emptyResets.flareFromTwoPlus)} of them from ×2 or higher), because flare explosions feed the combo like interceptor shots.</p>
<h3>Streaks: short ones are common, long ones carry the points</h3>
<p>The recordings contain ${n(streakCount)} streaks of consecutive hits. ${share(shortShare * streakCount, streakCount, 0)} are 1–4 hits, and score identically under both rules. The ${longStreaks} streaks of 10 or more hits (longest ${t.longestStreak}) hold ${(100 * longShare).toFixed(0)}% of all productive shots. Cash-out pays less than sustained ×10 on those.</p>
${table(["Streak length", "Streaks", "Hits in them"], streakKeys.map((k) => tr([k, n(t.streaks[k] ?? 0), n(t.productiveTriggersInStreaks[k])])).join(""))}
<p>Worked example at the corpus average of ${avgBase.toFixed(0)} base points per productive shot (single-kill multipliers only, no multi-kill bonus):</p>
${table(["Hits in a row", "Today (×10 cap)", "Cash-out 150", "Cash-out 350", "Cash-out 500", "Cash-out 700"], [5, 8, 10, 20, 40].map((len) => tr([len, n(streakPoints(len, 10, null)), n(streakPoints(len, 5, 150)), n(streakPoints(len, 5, 350)), n(streakPoints(len, 5, 500)), n(streakPoints(len, 5, 700))])).join(""))}
<p>Cash-out wins short streaks and loses long ones. Today's rule pulls ahead from ${crossover(150)} hits in a row against cash-out 150, ${crossover(350)} against 350, ${crossover(500)} against 500 and ${crossover(700)} against 700. Matching sustained ×10 would need a bonus of about 35 × the base value per shot, roughly ${n(35 * avgBase)} points here.</p>
<h3>Who pays for the cash-out</h3>
<p>Across the corpus there are ${n(t.cashouts)} cash-outs (${(t.cashouts / 26).toFixed(1)} per run). On top of rule 1, cash-out 350 changes a run by ${pct(cashEffect(byCash[0]))} to ${pct(cashEffect(byCash.at(-1)))}. The loss tracks how much of a run's points came at ×10 (ρ ${streakRho.toFixed(2)}): ${byCash
  .slice(0, 3)
  .map(
    (r) =>
      `${r.label} earned ${(100 * at10Share(r)).toFixed(0)}% at ×10 and loses ${pct(-cashEffect(r)).replace("+", "")}`,
  )
  .join(
    "; ",
  )}. The ${lowStreakRuns.length} runs that earned under 30% of their player points at ×10 lose at most ${Math.abs(lowStreakWorst).toFixed(1)}% at 350; ${lowStreakGain700} of them gain at 700.</p>
${table(["Scenario", "Total points", "Change", "Median run", "Run range"], d.summaries.map((s) => tr([`${ownLabel(s.ownership)} · ${comboLabel(s.combo)}`, n(s.total), pct(change(s.id)), pct(s.medianPct), `${pct(s.pctRange[0])} … ${pct(s.pctRange[1])}`])).join(""))}
</section>

<section><h2>Every run, any scenario</h2>
<div class="toolbar"><label>Kill points <select id="own"><option value="P">player actions only</option><option value="today">all sources (today)</option></select></label><label>Combo <select id="combo">${d.combos.map((c) => `<option value="${c.id}" ${c.id === "C5-350" ? "selected" : ""}>${comboLabel(c.id)}</option>`).join("")}</select></label></div>
<p id="selection" class="callout"></p>
${table(["Run", "Change", "Today", "Scenario", "Rank change", "Reached", "Automation", "Ability"], "", "runs")}
<p class="muted">Sorted by change. Rank 1 is the highest final score; a positive rank change moves a run up.</p></section>

<section><h2>What this suggests</h2>
<ul>
<li><strong>Rule 1 is a clean, moderate cut.</strong> It removes ${pct(-change("P|C10")).replace("+", "")} of points, mostly from late waves and automation-heavy builds, and stops the player's combo from multiplying turret kills. It leaves the leaderboard order almost intact.</li>
<li><strong>Decide whether the multi-kill exception stays.</strong> It keeps ${n(keptMulti)} points flowing to automation, mostly Patriot and Hornets. It keeps the DOUBLE/TRIPLE toasts consistent, but it is ${share(keptMulti, t.original)} of all points.</li>
<li><strong>The cash-out at 350 penalizes the longest streaks</strong>, which are the most consistent shooting in these recordings. If the aim is a rhythm of short streaks without penalizing long ones, the bonus needs to be about 700 or more, or it should grow with each consecutive cash-out.</li>
<li><strong>Consider not resetting the combo on non-misses</strong>: when automation killed the target first, or when a flare hit nothing. These are ${n(empty.automation + empty.flare)} of ${n(emptyTotal)} resets, and the player could not prevent them.</li>
<li>Rescoring cannot show how people will play under a new combo. A playtest behind a debug toggle is the next honest step.</li>
</ul></section>

<section><h2>Verification and reproduction</h2><p>Today's rules, replayed from the ledgers, reproduce all 26 run totals, all ${t.waves} wave totals (${t.terminalWaves} terminal), every combo transition and the recorded multiplier on all ${n(t.kills)} kills. Independent Python agrees on ${n(proof.waveScenarioChecks)} wave × scenario values, ${proof.runRankChecks} rank checks, per-source totals and all ${proof.streaks} streaks. Ten hand-worked rule cases cover ownership, multi-kills, cash-out timing, resets and wave carry-over. SHA-256 digests confirm all ${proof.unchangedInputs} consumed inputs are unchanged.</p>
<p class="formula">node scripts/scoring-study/player-only-checks.mjs<br>node scripts/scoring-study/player-only-analysis.mjs<br>python3 scripts/scoring-study/player-only-crosscheck.py<br>node scripts/scoring-study/player-only-report.mjs</p>
<p><a href="scoring-player-only-method.md">Method and frozen rules</a> · <a href="scoring-rescoring-results.html">Part five</a> · <a href="README.md">Report series</a></p><p class="muted">Anonymous aggregate report. Raw recordings and ledgers stay in the ignored local study directory. No gameplay change.</p></section>

<script id="data" type="application/json">${JSON.stringify({ runs: d.runs.map(({ label, finalWave, automation, active, original, scores, ranks, originalRank }) => ({ label, finalWave, automation, active, original, scores, ranks, originalRank })), byWave: d.byWave.map((w) => ({ wave: w.wave, runs: w.runs, today: w.scores["today|C10"], p: w.scores["P|C10"], both: w.scores["P|C5-350"], shots: w.shots, at10: w.shotsAt10, empty: w.emptyShots, lostSurvived: w.survival.lostAllRuns - w.survival.lostInFinalWaves, lostFinal: w.survival.lostInFinalWaves, completed: w.survival.completed, shareToday: w.survival.share["today|C10"], shareP: w.survival.share["P|C10"] })) }).replace(/</g, "\\u003c")}</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent),$=id=>document.getElementById(id);
const fmt=n=>Math.round(n).toLocaleString('en-US'),pct=x=>(x>0?'+':x<0?'−':'')+Math.abs(x).toFixed(1)+'%',signed=n=>(n>0?'+':n<0?'−':'')+Math.abs(n);
function cell(tr,text,cls){const td=document.createElement('td');td.textContent=text;if(cls)td.className=cls;tr.appendChild(td);return td}
function renderRuns(){const id=$('own').value+'|'+$('combo').value;const rows=D.runs.map(r=>({...r,v:r.scores[id],c:100*(r.scores[id]-r.original)/r.original,m:r.originalRank-r.ranks[id]})).sort((a,b)=>a.c-b.c);
const total=rows.reduce((a,r)=>a+r.v,0),orig=rows.reduce((a,r)=>a+r.original,0),max=Math.max(1,...rows.map(r=>Math.abs(r.c)));
$('selection').textContent='26 runs · '+fmt(orig)+' → '+fmt(total)+' points ('+pct(100*(total-orig)/orig)+')';
const body=$('runs');body.replaceChildren();for(const r of rows){const tr=document.createElement('tr');cell(tr,r.label);
const c=cell(tr,pct(r.c),'cellbar');const b=document.createElement('span');b.className='bar'+(r.c<0?' removed':'');b.style.width=Math.max(2,100*Math.abs(r.c)/max)+'%';c.appendChild(b);cell(tr,fmt(r.original));cell(tr,fmt(r.v));cell(tr,r.m?signed(r.m):'0',r.m>0?'up':r.m<0?'down':'');cell(tr,'wave '+r.finalWave);cell(tr,r.automation.join(', ')||'—','text');cell(tr,r.active.join(', ')||'—','text');body.appendChild(tr)}}
function lineChart(el,series,opts){el.replaceChildren();const k=Math.min(2.2,Math.max(1,720/Math.max(1,el.clientWidth))),W=720,H=260+40*(k-1),L=48*k,R=16,T=14,B=34*k,xs=D.byWave.map(w=>w.wave),lo=opts.min,hi=opts.max;
const x=i=>L+(W-L-R)*i/(xs.length-1),y=v=>T+(H-T-B)*(hi-v)/(hi-lo);const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);
const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;svg.appendChild(e);return e};
for(const v of opts.ticks){add('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),stroke:v===0?'#4a5d74':'#22324a','stroke-width':1});add('text',{x:L-8,y:y(v)+4*k,'text-anchor':'end',fill:'#8fa1b8','font-size':12*k},v+'%')}
xs.forEach((w,i)=>add('text',{x:x(i),y:H-12*k,'text-anchor':'middle',fill:'#8fa1b8','font-size':12*k},(k>1.6?'':'W')+w));
for(const s of series){add('polyline',{points:s.values.map((v,i)=>v==null?null:x(i)+','+y(v)).filter(Boolean).join(' '),fill:'none',stroke:s.color,'stroke-width':2*k,'stroke-linejoin':'round'});s.values.forEach((v,i)=>{if(v!=null)add('circle',{cx:x(i),cy:y(v),r:4*k,fill:s.color,stroke:'#111e30','stroke-width':2*k})})}
const cross=add('line',{y1:T,y2:H-B,stroke:'#8fa1b8','stroke-width':1,opacity:0});el.appendChild(svg);const tip=document.createElement('div');tip.className='tip';tip.hidden=true;el.appendChild(tip);
const show=i=>{cross.setAttribute('x1',x(i));cross.setAttribute('x2',x(i));cross.setAttribute('opacity',.6);tip.replaceChildren();const h=document.createElement('div');h.textContent=opts.header?opts.header(i):'Wave '+xs[i]+' · '+D.byWave[i].runs+' runs';h.className='muted';tip.appendChild(h);
for(const s of series){const row=document.createElement('div');const k=document.createElement('span');k.className='key';k.style.background=s.color;const b=document.createElement('b');b.textContent=s.values[i]==null?'—':s.fmt(s.values[i]);row.append(k,b,' '+s.name);tip.appendChild(row)}
tip.hidden=false;const box=el.getBoundingClientRect(),px=x(i)/W*box.width;tip.style.left=Math.min(box.width-tip.offsetWidth,Math.max(0,px+12))+'px';tip.style.top='8px'};
const hit=add('rect',{x:L,y:T,width:W-L-R,height:H-T-B,fill:'transparent',tabindex:0});const pick=e=>{const b=svg.getBoundingClientRect();const px=(e.clientX-b.left)/b.width*W;return Math.max(0,Math.min(xs.length-1,Math.round((px-L)/(W-L-R)*(xs.length-1))))};
hit.addEventListener('pointermove',e=>show(pick(e)));hit.addEventListener('pointerleave',()=>{tip.hidden=true;cross.setAttribute('opacity',0)});let fi=0;hit.addEventListener('focus',()=>show(fi));hit.addEventListener('keydown',e=>{if(e.key==='ArrowRight')fi=Math.min(xs.length-1,fi+1);else if(e.key==='ArrowLeft')fi=Math.max(0,fi-1);else return;e.preventDefault();show(fi)});hit.addEventListener('blur',()=>{tip.hidden=true;cross.setAttribute('opacity',0)})}
function barChart(el,series,opts){el.replaceChildren();const k=Math.min(2.2,Math.max(1,720/Math.max(1,el.clientWidth))),W=720,H=240+40*(k-1),L=40*k,R=16,T=14,B=34*k,n=D.byWave.length,hi=opts.max;
const band=(W-L-R)/n,bw=band*0.56,x=i=>L+band*i+(band-bw)/2,y=v=>T+(H-T-B)*(hi-v)/hi;const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);
const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const a in attrs)e.setAttribute(a,attrs[a]);if(text!=null)e.textContent=text;svg.appendChild(e);return e};
for(const v of opts.ticks){add('line',{x1:L,x2:W-R,y1:y(v),y2:y(v),stroke:v===0?'#4a5d74':'#22324a','stroke-width':1});add('text',{x:L-8,y:y(v)+4*k,'text-anchor':'end',fill:'#8fa1b8','font-size':12*k},v)}
const tip=document.createElement('div');tip.className='tip';tip.hidden=true;
D.byWave.forEach((w,i)=>{add('text',{x:x(i)+bw/2,y:H-12*k,'text-anchor':'middle',fill:'#8fa1b8','font-size':12*k},(k>1.6?'':'W')+w.wave);let base=0;const marks=[];
for(const s of series){const v=s.value(w);if(v>0){const top=y(base+v),bottom=y(base)-(base>0?2:0);marks.push(add('rect',{x:x(i),y:top,width:bw,height:Math.max(1,bottom-top),fill:s.color,rx:Math.min(3,bw/4)}))}base+=v}
const total=series.reduce((a,s)=>a+s.value(w),0);if(total>0)add('text',{x:x(i)+bw/2,y:y(total)-6*k,'text-anchor':'middle',fill:'#b5c4d8','font-size':12*k},total);
const hit=add('rect',{x:L+band*i,y:T,width:band,height:H-T-B,fill:'transparent',tabindex:0});
const show=()=>{marks.forEach(m=>m.setAttribute('opacity',.8));tip.replaceChildren();const h=document.createElement('div');h.className='muted';h.textContent='Wave '+w.wave+' · '+w.runs+' runs played it';tip.appendChild(h);
for(const s of series){const row=document.createElement('div'),key=document.createElement('span'),b=document.createElement('b');key.className='key rect';key.style.background=s.color;b.textContent=s.value(w);row.append(key,b,' '+s.name);tip.appendChild(row)}
tip.hidden=false;const box=el.getBoundingClientRect(),px=(x(i)+bw)/W*box.width;tip.style.left=Math.min(box.width-tip.offsetWidth,Math.max(0,px+8))+'px';tip.style.top='8px'};
const hide=()=>{marks.forEach(m=>m.removeAttribute('opacity'));tip.hidden=true};hit.addEventListener('pointerenter',show);hit.addEventListener('pointerleave',hide);hit.addEventListener('focus',show);hit.addEventListener('blur',hide)});
el.appendChild(svg);el.appendChild(tip)}
const chg=(w,k)=>100*(w[k]-w.today)/w.today;
function charts(){lineChart($('waveChart'),[{name:'rule 1',color:'var(--s1)',values:D.byWave.map(w=>chg(w,'p')),fmt:pct},{name:'rules 1 + 2',color:'var(--s2)',values:D.byWave.map(w=>chg(w,'both')),fmt:pct}],{min:-30,max:10,ticks:[10,0,-10,-20,-30]});
lineChart($('comboChart'),[{name:'shots at ×10',color:'var(--s1)',values:D.byWave.map(w=>100*w.at10/w.shots),fmt:v=>v.toFixed(0)+'%'},{name:'empty shots',color:'var(--s2)',values:D.byWave.map(w=>100*w.empty/w.shots),fmt:v=>v.toFixed(0)+'%'}],{min:0,max:70,ticks:[0,20,40,60]});
barChart($('lossChart'),[{name:'in a wave the run survived',color:'var(--s1)',value:w=>w.lostSurvived},{name:"in the run's final wave",color:'var(--s2)',value:w=>w.lostFinal}],{max:18,ticks:[0,5,10,15]});
lineChart($('shareChart'),[{name:'today',color:'var(--s1)',values:D.byWave.map(w=>w.shareToday==null?null:100*w.shareToday),fmt:v=>v.toFixed(0)+'%'},{name:'rule 1',color:'var(--s2)',values:D.byWave.map(w=>w.shareP==null?null:100*w.shareP),fmt:v=>v.toFixed(0)+'%'}],{min:0,max:80,ticks:[0,20,40,60,80],header:i=>'Wave '+D.byWave[i].wave+' · '+D.byWave[i].completed+' runs completed it'})}
charts();let lastW=innerWidth;addEventListener('resize',()=>{if(innerWidth!==lastW){lastW=innerWidth;charts()}});
for(const id of ['own','combo'])$(id).addEventListener('change',renderRuns);renderRuns();
</script></main></body></html>`;
writeFileSync(
  "docs/gameplay analysis Sep 2026/scoring-player-only-results.html",
  await format(html, { ...(await resolveConfig(".prettierrc")), parser: "html" }),
);
console.log("Wrote Part Six report.");
