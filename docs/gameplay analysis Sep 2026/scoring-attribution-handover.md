# Reward attribution study — completed handover

Date: 2026-09-15. **Point two is complete; awaiting user review.**

## Scope and current result

The user resumed this handover and authorized point two: attribute rewards in the
existing 26 Staging recordings and deliver an HTML results report. No gameplay,
scoring or spawn changes were authorized or made. The user subsequently authorized committing/pushing the three-report series.

**Report:** [Reward attribution results](./scoring-attribution-results.html).

Local URL:
<http://127.0.0.1:5173/dubai-missile-command/docs/gameplay%20analysis%20Sep%202026/scoring-attribution-results.html>

The Vite server was started and left running on port 5173. Browser verification
covered desktop and 390px phone layout, all 26 recording choices, normalized wave
bars, disclosure controls and page errors. Screenshots were inspected.

## Findings

Across all run totals, including terminal waves:

| Reward origin                                       |    Points | Share |
| --------------------------------------------------- | --------: | ----: |
| Explicit wave/building bonuses                      |   795,500 | 47.8% |
| Manual shots and their chains                       |   474,416 | 28.5% |
| Upgrade systems, including player-triggered systems |   375,944 | 22.6% |
| Impact effects                                      |    17,564 |  1.1% |
| Total                                               | 1,663,424 |  100% |

- Kill base value: 180,102; combo uplift: 376,472; multi-kill awards: 311,350.
- 5,308 scored kills plus 275 unscored flare neutralizations reconcile to 5,583 destroyed threats.
- 3,394 recorded fire attempts all launched shots. 2,086 shots produced a scored kill;
  1,247 resolved without damage; 61 had no logged resolved outcome. The last category
  can include boundary-cleared effects or unresolved effects at recording end.
- Multi-shot counter: 312 manual roots plus 33 flare roots. `playerCaused` is not manual shooting.
- Combo increases: 1,756 manual and 50 flare. Combo reductions: 623 manual and 40 flare.
- No paid spending, friendly-fire penalties or cross-source damaging assists occurred.
- The previous 53.2% bonus share used completed-wave earnings only; 47.8% includes terminal waves.

These are reward origins, **not counterfactual player contribution**. Manual/flare
roots affect a shared combo that benefits every kill source. Upgrade choices and
active timing are player decisions. No per-cast attribution or hypothetical saves
are claimed. Pressure/opportunity experiments remain separately authorized work.

## Implementation and verification

Analysis scripts live in `scripts/scoring-study/`:

- `build.mjs`: baseline and instrumented esbuild bundles; source transformations only
  in memory. Both expose the same read-only action/checkpoint-consumption metadata
  and private-function test exports. Actual source hashes and transformation inventory
  are recorded locally. Gameplay files are unchanged on disk.
- `observer.mjs`: external identity/lineage maps, real damage events, source attribution,
  rewards/debits, combo transitions, shots, active uses and multi-shot credits.
- `run.ts`: corpus runner, sampled state hashing, maintained checkpoint/summary validation,
  per-wave score/kill/shot/multi reconciliation and per-run destroyed-type reconciliation.
- `cases.ts`: 11 controlled real-simulation cases covering source-labelled chains after
  root removal, mixed-source damage, incremental multi awards, actual flare turncoat
  payoff, unscored neutralization and shot identity. Synthetic labelled explosions prove
  lineage, not every system's firing routine independently.
- `aggregate.mjs`, `report.mjs`, `verify-report.mjs`: summaries, HTML generation and browser checks.

All 26 observed runs match baseline: exact final ticks and summaries, all actions and
3,159 checkpoints consumed, and 4,819 equal state/RNG/metadata samples across 172,247 ticks.
Samples include 120-tick intervals, checkpoint ticks and observed state/shop/bonus
boundaries. State uses the maintained sanitized replay-anchor contract and preserves
Sets/Maps in hashing. This is **sampled**, not every-tick, full-state equivalence.

The observer's final-blow events fail on missing damage evidence or unknown kill
source; aggregation also rejects unknown kill/multi reward sources. Explicit bonuses
and spending have their own categories, independent of combat source.

## Reproduce

From the project root, with the existing private corpus:

```bash
node scripts/scoring-study/build.mjs
node operator-results/scoring-study-20260915/attribution/baseline.mjs
node operator-results/scoring-study-20260915/attribution/observed.mjs --cases
node operator-results/scoring-study-20260915/attribution/observed.mjs
node scripts/scoring-study/aggregate.mjs
node scripts/scoring-study/report.mjs
node scripts/scoring-study/verify-report.mjs
npx eslint scripts/scoring-study
npx prettier --check scripts/scoring-study "docs/gameplay analysis Sep 2026/scoring-attribution-results.html" "docs/gameplay analysis Sep 2026/scoring-attribution-handover.md"
```

Browser launch and local serving required sandbox escalation on this Mac. The
verification script keeps its browser temporary directory inside the project.

## Data and handoff constraints

Private corpus: `operator-results/scoring-study-20260915/`. Results, bundles,
event logs, hashes, controlled-case evidence and screenshots: its `attribution/`
subdirectory. Keep all study artifacts inside this checkout. No bearer is needed
for reproduction or stored in the generated artifacts. HTML contains only aggregate
measurements and anonymized study labels, not capture identifiers or raw action data.

The existing report, findings, study plan and lessons edits predate this continuation;
preserve them. The report series and supporting scripts are included in the user-requested report commit; private artifacts remain local. `tasks/todo.md` records completion.
Next action is user review, not redesign or deployment.
