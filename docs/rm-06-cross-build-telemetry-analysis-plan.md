# RM-06 Cross-Build Telemetry Analysis Plan

Status: core implementation and Staging smoke proof complete; RM-08 and diverse-cohort exit gates remain

Roadmap initiative: [`RM-06`](../ROADMAP.html#rm-06)

Depends on: [`RM-04`](../ROADMAP.html#rm-04), [`RM-08`](../ROADMAP.html#rm-08)

Last reviewed: 2026-09-04

This document defines the implementation and verification path for RM-06. `ROADMAP.html`
remains the authority for priority, status, gates, and next work.

RM-06 answers **what changed across cohorts of completed runs**. RM-08 answers **what happened
inside one selected replay**. The intended handoff is aggregate signal → representative run →
replay inspection. Combining both into one initiative would produce a small analytics platform
before the project has enough players to justify one, which is how dashboards acquire more
features than evidence.

## 1. Pre-Implementation Worktree And Staging Snapshot

This snapshot was taken before implementation on 2026-09-04 so later work does not rewrite the
starting conditions into a suspiciously convenient green field.

| Surface           | Present now                                                                                                                                                                                          | Missing before RM-06 is credible                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Session summaries | D1 stores score, wave, duration, outcome, Burj health, shots, kills, capped `hit_ratio`, combos, destroyed-threat counts, upgrade timeline, feedback emoji, build, platform, input class, and source | A reviewed analysis projection and stable field semantics                          |
| Provenance        | App Attest-derived app flavor, bundle ID, and Apple environment exist on newer rows                                                                                                                  | Legacy `unknown` rows need explicit exploratory-only treatment                     |
| Cohort identity   | App-local install ID and ephemeral flag allow within-export clustering                                                                                                                               | Direct install IDs must never be written to analysis artifacts                     |
| Retention         | Session summaries are query-gated and swept at 365 days; replay and report windows are separate                                                                                                      | Exported private artifacts need their own shorter cleanup rule                     |
| Acquisition       | An operator can run authenticated listings or direct D1 queries                                                                                                                                      | No fixed, guarded, reproducible summary export exists                              |
| Analysis          | Existing gameplay reports use basic means, medians, and quantiles                                                                                                                                    | No maintained human-session comparison engine, confidence labels, or anomaly rules |
| Replay follow-up  | RM-04 delivered a read-only operator list and replay launch                                                                                                                                          | RM-08 must provide the inspection workflow used by RM-06 candidates                |

### 1.1 Live Staging evidence

A read-only aggregate query on 2026-09-04 returned:

- 21 retained sessions from 3 non-ephemeral installs and 5 exact build IDs;
- one distinct install represented in each build cohort;
- 14 legacy sessions with `app_flavor = 'unknown'`;
- 21 sessions with replay references and valid upgrade/destroyed-type JSON;
- zero feedback emojis and one manually submitted session;
- only iOS/touch sessions, all ending in `burj_destroyed`;
- data received from 2026-08-21 through 2026-09-01 UTC.

The query reported zero writes. This is enough to smoke-test acquisition, validation, grouping,
and honest confidence labels. It is **not** enough to infer that any build improved or regressed:
build is completely confounded with player/install in the current sample.

### 1.2 Implementation evidence

The core pipeline was implemented on 2026-09-04:

- a fixed summary-only Staging query and strict comparison/row contracts;
- deterministic run-level and install-weighted metrics, clustered intervals, confidence labels,
  practical-signal rules, outcome/upgrade analysis, confounder warnings, and candidate selection;
- atomic identifier-free JSON/Markdown reports plus 30-day private candidate artifacts and
  explicit/age-based cleanup;
- maintained npm command, synthetic fixtures, safety tests, and operator documentation.

Two independently acquired runs of the bounded Staging smoke comparison produced identical query,
data, calculation, and candidate digests. Both reported 13 sessions/1 install versus 4 sessions/1
install, `smoke_only`, zero qualified signals, 17 validated rows, four deterministic candidates,
and zero database writes. Public artifacts contained no forbidden identifiers. Both private proof
candidate files were deleted through the maintained cleanup command after verification.

An implementation review then found and repaired representation-blind Markdown privacy checks,
mismatched proportion estimands, silent candidate-rule drops, duplicated policy thresholds,
verification-matrix gaps, and a missing deletion cross-check for derived private artifacts. The
repaired suite executes the checked-in query against in-memory SQLite and directly covers zero
denominators, the 365-day boundary, filter combinations, upgrade permutations, empty cohorts,
Markdown injection, candidate audit states, Wrangler diagnostics, and telemetry-aware deletion.

The full repository suite passed 751 tests across 71 files, plus typecheck, ESLint, Prettier, and
`git diff --check`. Two final Staging runs matched query, data, calculation, and candidate digests,
reported zero writes, and measured privacy checks across structured JSON and raw Markdown. This is
implementation and Staging smoke evidence, not RM-06 completion: RM-08 cannot yet consume the
candidates, and no real comparison meets the diverse-cohort exit threshold.

## 2. Outcome And Fixed Scope

### 2.1 Outcome

Give a developer a repeatable way to compare declared build cohorts, detect practical gameplay
signals, and hand deterministic representative run IDs to RM-08 without querying D1 by hand or
exporting raw replays.

The workflow must support these decisions:

1. Did reach, score, survival, duration, or defensive efficiency move materially between two
   explicitly declared build cohorts?
2. Did upgrade adoption or purchase timing move with the outcome metrics?
3. Is a change broad across installs, or dominated by one prolific player?
4. Are capture coverage, provenance, or replay availability too weak to trust the comparison?
5. Which median, lower-tail, upper-tail, or anomaly runs should be opened in RM-08 to explain the
   aggregate signal?

### 2.2 Fixed implementation choices

- Start with a local, human-run CLI and generated report. Do not build a dashboard for 21 rows.
- Query compact `sessions` summaries only. Do not read diagnostic payloads or R2 replay bodies.
- Use a fixed reviewed D1 `SELECT`; do not add an arbitrary remote-SQL escape hatch.
- Accept only Staging in the first slice. Production analysis requires a later roadmap refinement
  after its capture gates and provisioning state allow it.
- Use server-controlled `received_at` for windows and watermarks. Never use client `created_at`
  as a retention or cohort boundary.
- Treat exact build IDs as opaque artifact identities. Dirty/composite IDs are separate cohorts,
  not aliases for their first hash.
- Make no D1 migration or capture-contract change in the first slice. Missing dimensions remain
  visible limitations; a later schema proposal must be justified by real comparisons.
- Keep the analysis deterministic: the comparison specification, selected rows, calculations,
  exclusions, and generated candidate set all receive stable digests.

### 2.3 Non-goals

- Player-facing history, charts, accounts, or analytics.
- Leaderboards, score verification, anti-cheat claims, or competitive ranking.
- Automatic balance changes or automatic roadmap status changes.
- General-purpose BI, streaming telemetry, a warehouse, or a permanent analytics API.
- Diagnostic-event mining, free-text analysis, session replay mutation, or collaborative notes.
- Claiming causation from observational playtest data.

## 3. Trust And Privacy Contract

### 3.1 Field authority

| Field class                     | Authority                                                    | RM-06 treatment                                                                               |
| ------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `received_at`                   | Worker clock                                                 | Canonical time boundary and data watermark                                                    |
| `app_flavor`, Apple environment | Derived from the verified App Attest credential              | Preferred provenance dimension; `unknown` is excluded from directional comparisons by default |
| `build`                         | Authenticated and allowlisted submission value               | Exact cohort key, but not a semantic release name                                             |
| Outcome and gameplay summary    | Client-produced, schema-validated, owner-authenticated       | Suitable for exploratory playtest analysis; not a server-verified score                       |
| `install_id`                    | Pseudonymous app-local label                                 | Used in memory to cluster repeated runs; never persisted directly                             |
| Platform and input class        | Validated client metadata                                    | Useful dimensions, not identity or proof of hardware                                          |
| `created_at`                    | Device clock                                                 | Informational only; never used for eligibility or retention                                   |
| `replay_verified`               | Currently not populated as a completed verification pipeline | Reported as coverage only; never used to imply competitive validity                           |

The stored `hit_ratio` is not literal projectile accuracy. It is
`min(1, total kills / player shots fired)` and includes kills produced by automatic defenses.
Reports must label it **display hit ratio** and must not describe it as direct-hit accuracy.

### 3.2 Export minimisation

The fixed query may select only:

- `run_id` and `install_id` transiently for clustering and RM-08 candidate handoff;
- `received_at`, exact `build`, `app_flavor`, Apple environment, `platform`, `input_class`,
  `source`, and `install_ephemeral`;
- outcome and compact numeric summary fields;
- `destroyed_by_type_json`, `upgrades_json`, and bounded `feedback_emoji`;
- replay presence/omission and share flags needed for capture-quality reporting.

It must not select display name, feedback note, submitter key hash, Apple bundle ID, raw request
hash, replay SHA, diagnostic rows, deletion records, or any R2 key/body.

The exporter must:

1. capture Wrangler JSON output in memory without echoing row data;
2. validate every row before analysis;
3. use install IDs only in memory for clustering and candidate limits, then discard them;
4. write exact run IDs only to a gitignored private candidate artifact;
5. write no raw D1 row dump;
6. omit all identifiers from the shareable Markdown/JSON summary.

Private candidate artifacts expire after 30 days or immediately after review, whichever comes
first. Identifier-free aggregate summaries may be retained as cross-build evidence. A verified
manual deletion request must include any still-live private telemetry artifact in its local
operator search; deleting from D1 while leaving a convenient local copy would be privacy by
stage magic.

## 4. Comparison Contract

Each run begins from a reviewed comparison specification, for example:

```json
{
  "schema": 1,
  "id": "wave-balance-f155635-vs-next",
  "question": "Did the candidate change early-wave reach without reducing defensive efficiency?",
  "baselineBuilds": ["f155635"],
  "candidateBuilds": ["NEXT_BUILD_ID"],
  "receivedFrom": "2026-09-01T00:00:00.000Z",
  "receivedTo": "2026-10-01T00:00:00.000Z",
  "filters": {
    "appFlavors": ["staging"],
    "platforms": ["ios"],
    "inputClasses": ["touch"],
    "sources": ["gameover"],
    "excludeEphemeral": true,
    "excludeUnknownProvenance": true
  },
  "knownChanges": ["describe the gameplay change under review"],
  "knownConfounders": []
}
```

Rules:

- Baseline and candidate build sets must be explicit, non-empty, and disjoint.
- The time window must be bounded and cannot begin before the 365-day retained-summary cutoff.
- Filtering happens after the query returns and before any statistics are calculated; excluded
  counts and reasons remain visible in the report.
- A row with invalid enums, impossible numeric values, malformed JSON, or an undeclared build is
  rejected, not silently coerced.
- Manual uploads, ephemeral installs, unknown provenance, mixed platforms, or mixed input classes
  can be included only through explicit comparison-spec choices.
- Runs are the observational unit; installs are the independence cluster. The report always shows
  both counts.
- When the same install appears in both cohorts, report paired install-level deltas separately.
  Otherwise label the comparison unpaired.
- A build with bundled gameplay changes remains observationally inseparable. The report names the
  declared change set but never attributes a signal to one line of code.

### 4.1 Confidence labels

These labels prevent tiny cohorts from becoming accidental product verdicts:

| Label       | Minimum evidence in each cohort                                                            | Allowed conclusion                                                 |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Smoke only  | Fewer than 3 installs or fewer than 10 sessions                                            | Pipeline/data-quality statements only                              |
| Exploratory | At least 3 installs and 10 sessions, but below the directional minimum in either dimension | Candidate observations requiring more play                         |
| Directional | At least 5 installs and 20 sessions                                                        | Practical regression/improvement candidate; still not causal proof |

Classification follows the weakest dimension: `directional` requires both directional minima;
`smoke only` applies when either smoke boundary is missed; everything between is `exploratory`.
The thresholds are review policy, not a claim of statistical power. Every report must print the
label beside every comparison. Current Staging data must produce `smoke only`.

## 5. Metrics And Statistics

### 5.1 Required measures

| Area             | Measures                                                                       | Required caveat                                                         |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Reach            | `wave_reached`, outcome distribution                                           | Wave values are build-specific when wave content changes                |
| Score            | Score median and distribution                                                  | Scoring-rule changes can invalidate direct comparison                   |
| Duration         | `time_played_ms`, derived minutes                                              | Longer may mean survival or slower play; inspect with reach             |
| Defense output   | Total kills, destroyed-by-type counts, kills/minute                            | Threat mix changes with build and wave reach                            |
| Player fire      | Shots fired, display hit ratio                                                 | Auto-defense kills contaminate the ratio; never call it direct accuracy |
| Combos           | Multi-shots and max combo                                                      | Scoring/combo-rule changes must be declared                             |
| Upgrade behavior | Adoption, purchase wave, sequence, and final purchased set                     | Availability depends on progression and build rules                     |
| Sentiment        | Emoji distribution and response rate                                           | Missing feedback is not neutral feedback                                |
| Capture quality  | Replay present/omitted, provenance coverage, source mix, invalid/excluded rows | Operational health, not gameplay quality                                |

Do not invent per-wave combat metrics from the session summary; those facts currently live only
inside replay data. RM-08 may inspect them for selected runs. If aggregate per-wave analysis later
becomes necessary, propose a compact capture-schema addition rather than bulk-reading every R2
replay and quietly changing RM-06's data boundary.

### 5.2 Statistical presentation

For every numeric measure, report:

- sessions, distinct installs, missing count, median, p10, p25, p75, and p90;
- the raw run-level distribution summary;
- an install-weighted summary formed from one median per install;
- candidate minus baseline absolute and relative deltas where the denominator is meaningful;
- a deterministic cluster bootstrap interval resampling installs, seeded from the comparison ID.

For proportions, report two explicitly different estimands:

- pooled numerator/denominator rates and their percentage-point delta across runs;
- equally weighted per-install rates, their percentage-point delta, and a clustered bootstrap
  interval that resamples those install rates.

Never present the install-cluster interval as if it brackets the pooled run-level delta. Suppress
the interval when either cohort contains fewer than two installs; resampling one cluster merely
prints counterfeit precision. Do not average per-run percentages when the underlying numerator
and denominator are available.

Initial practical-signal defaults live in one reviewed configuration:

- median wave: at least 1 wave;
- median score, duration, kills/minute, or shots: at least 15% relative change;
- display hit ratio or outcome rate: at least 10 percentage points;
- upgrade adoption: at least 20 percentage points.

A metric becomes an anomaly candidate only when the cohort is `directional`, its practical
threshold is crossed, and its cluster interval does not span zero. Otherwise it remains a
descriptive observation. These defaults are tuning constants, not tablets from the mountain;
change them in one obvious file with a dated rationale.

### 5.3 Required confounder warnings

The report must automatically warn when it detects:

- fewer distinct installs than the confidence label requires;
- one install contributing more than 40% of a cohort's sessions;
- no install overlap between cohorts;
- unknown app provenance or dirty/composite build IDs;
- different platform, input, source, or feedback-response mixes;
- overlapping collection dates that make learning/order effects plausible;
- score or wave-rule changes declared in the comparison specification;
- upgrade IDs present in only one build;
- missing run-mode or starting-progression context.

The current schema does not persist draft mode or starting meta-progression in D1. The first
slice must expose that limitation instead of guessing from build history. Add new capture fields
only after a real comparison demonstrates that this context changes the decision.

## 6. Acquisition And Artifact Flow

```text
reviewed comparison spec
        ↓
fixed Staging D1 SELECT (Wrangler JSON, read only)
        ↓
strict validation + in-memory install clustering
        ↓
deterministic aggregates and confidence/anomaly rules
        ├── summary.json / summary.md (no identifiers)
        └── candidates.private.json (run IDs for RM-08, 30-day maximum)
```

### 6.1 Output contract

Each analysis directory under gitignored `telemetry-results/` contains:

- `manifest.json` — comparison ID, exact input spec, environment, query watermark, row/exclusion
  counts, tool/build version, and digests;
- `summary.json` — identifier-free machine-readable metrics, deltas, confidence labels, warnings,
  and triggered practical signals;
- `summary.md` — the same evidence in a compact human review format;
- `candidates.private.json` — exact run IDs, merged reasons, and a selected/fallback/merged/unavailable
  audit row for every deterministic RM-08 selection rule;
- `verification.json` — query reported zero writes, schemas validated, digests matched, and cleanup
  due date, plus measured privacy-check formats and counts.

Generated timestamps must not affect calculation digests. Re-running against the same bounded
row set and specification must produce identical summaries and candidate selection.

### 6.2 Candidate selection for RM-08

Avoid choosing only spectacular failures. For each cohort, select deterministically:

- the run closest to the install-weighted median wave;
- one lower-tail and one upper-tail run;
- one representative run for each triggered metric;
- no more than two runs from one install unless the report explicitly says why.

Selection falls through to the next eligible run when the preferred run is already selected or its
install reached the cap. If no eligible row exists, the private audit records the rule as merged or
unavailable rather than silently dropping it. RM-08 consumes the run ID; RM-06 does not download
or alter the replay.

## 7. Implementation Phases

### Phase A — Freeze the analysis contract with fixtures

1. Add a versioned comparison-spec validator and a strict `TelemetryRow` projection matching the
   reviewed D1 columns.
2. Add fixtures for repeated runs from one install, paired/unpaired installs, outliers, zero
   shots, absent feedback, unknown provenance, dirty build IDs, malformed JSON, upgrade IDs that
   appear in only one build, and retention-boundary timestamps.
3. Implement deterministic quantiles, install weighting, paired deltas, clustered bootstrap, and
   proportion intervals as pure functions.
4. Prove that the live 21-row shape yields `smoke only` and cannot emit a directional anomaly.

No remote access belongs in the pure analysis module. Statistics that cannot be explained with a
small fixture do not belong in the first version.

### Phase B — Add the guarded Staging exporter

1. Add one CLI entrypoint requiring `--env staging`, a comparison file, and an output directory.
2. Bind Staging to the explicit `dmc-captures-staging` database and checked-in Wrangler config;
   reject empty, local, wildcard, or environment-derived database names.
3. Run only the checked-in `SELECT` projection with `--remote --json`; capture output in memory and
   verify Wrangler reports zero changes/rows written.
4. Apply the 365-day boundary and comparison window using `received_at` in both SQL and the
   analysis validator.
5. Never print row bodies, install IDs, run IDs, credentials, or private candidate contents.
6. Refuse every environment except Staging. A Production path is a later, separately reviewed
   scope change, not an exciting hidden flag.

The CLI should fail closed if Wrangler output changes shape. Parsing a cheerful human log as data
is how an analysis tool becomes performance art.

### Phase C — Generate the reproducible comparison report

1. Calculate required distributions, install-weighted summaries, paired results, confidence
   labels, practical thresholds, and confounder warnings.
2. Parse upgrade timelines into per-node adoption, first purchase wave, and purchase sequence
   without assuming unknown IDs are invalid; unknown-to-one-build IDs are a warning.
3. Generate the identifier-free JSON and Markdown summaries plus stable digests.
4. Make the first page lead with question, cohort sizes, confidence label, primary deltas, and
   warnings. Do not bury “one install per build” below twelve lovely percentiles.

### Phase D — Add the RM-08 handoff

1. Generate the private candidate set through the deterministic rules in §6.2.
2. Add an RM-08-compatible launch reference for each candidate once its run-detail route exists.
3. Test that summary artifacts cannot contain run IDs, install IDs, replay hashes, names,
   notes, bundle IDs, or credential hashes.
4. Test cleanup by age and explicit artifact-directory name without broad globs or directory deletion.
5. Make the operator deletion preview scan its target session IDs against all private candidate
   artifacts; remove matching files before remote execution and record only the removal count.

### Phase E — Prove the workflow on Staging

1. Run the exporter against the current retained Staging cohort and confirm it reports `smoke
only`, legacy-provenance warnings, one-install-per-build confounding, and zero false anomalies.
2. Re-run the exact bounded comparison and prove stable calculations/digests.
3. Open each selected candidate through RM-08 and confirm its cohort/build metadata agrees with
   the report.
4. When two future cohorts meet the directional minimum, review one real comparison with the
   human and record whether its signal led to more playtesting, a replay diagnosis, or no action.
5. Delete the private candidate artifact after review and verify the identifier-free summary
   remains useful.

Production remains untouched throughout initial proof.

## 8. Implemented Change Map

| File                                                | Responsibility                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/telemetry/query.sql`                       | Fixed summary-only D1 projection and retention/window predicates       |
| `scripts/telemetry/comparisons/`                    | Reviewed, versioned comparison specifications and examples             |
| `scripts/telemetry/comparison-schema.mjs`           | Versioned comparison input validation                                  |
| `scripts/telemetry/constants.mjs`                   | Shared IDs and capture enums used by schema, analysis, and SQL guards  |
| `scripts/telemetry/analysis.mjs`                    | Pure cohorting, statistics, warnings, thresholds, and candidate rules  |
| `scripts/telemetry/private-artifacts.mjs`           | Candidate discovery, expiry, explicit cleanup, and deletion matching   |
| `scripts/analyze-telemetry.mjs`                     | Guarded Wrangler acquisition, redaction, artifact writing, and cleanup |
| `scripts/analyze-telemetry.test.mjs`                | Fixtures, determinism, privacy, weighting, threshold, and CLI guards   |
| `scripts/operator-delete-capture.mjs`               | Pre-execution private-candidate discovery/removal and redacted count   |
| `test-fixtures/telemetry/`                          | Small synthetic cohorts with known expected results                    |
| `package.json`                                      | `telemetry:analyze` command                                            |
| `.gitignore`                                        | `/telemetry-results/` private/generated artifacts                      |
| `docs/script-inventory.md`                          | Trust boundary and operator usage                                      |
| `docs/testing-matrix.md`                            | Unit, CLI, local-D1, and Staging proof ownership                       |
| `docs/rm-06-cross-build-telemetry-analysis-plan.md` | Design and exit contract; never current status                         |
| `ROADMAP.html`                                      | Canonical RM-06 status, dependency, and next action only               |

Do not change the Worker API, D1 schema, capture payload, operator browser, or replay runtime in
the initial RM-06 implementation. If implementation evidence proves one of those boundaries
insufficient, amend the roadmap/plan before widening scope.

## 9. Verification Matrix

| Layer               | Proof                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Comparison contract | Invalid, overlapping, unbounded, and unknown build specs fail closed                                            |
| Row validation      | Invalid enums/numbers/JSON and undeclared builds are rejected before artifact output                            |
| Statistics          | Golden fixtures prove quantiles, pooled/install-weighted proportions, pairing, intervals, and zero denominators |
| Confidence          | Tiny or install-dominated cohorts cannot emit directional labels or anomalies                                   |
| Determinism         | Same bounded rows/spec produce identical digests and candidate IDs/order                                        |
| Privacy             | Structured JSON and raw Markdown injection fail before writes; deletion removes matching private candidates     |
| Export safety       | Explicit Staging target, fixed `SELECT`, zero writes, bounded window, sanitized failure context                 |
| Retention           | Rows outside 365 days are unavailable; private artifacts receive and obey a 30-day cleanup date                 |
| Upgrade parsing     | Empty, repeated, reordered, and build-specific upgrade IDs remain well-defined                                  |
| Query integration   | The rendered checked-in query executes against migrated-shape in-memory SQLite                                  |
| Staging             | Current live cohort produces the expected smoke/confounder result and stable rerun                              |
| RM-08 handoff       | Selected run IDs open the matching build/run evidence without replay download                                   |

Expected implementation commands:

```bash
npm test -- scripts/analyze-telemetry.test.mjs
npm run telemetry:analyze -- --env staging --comparison scripts/telemetry/comparisons/staging-smoke.json
npm run typecheck
npm run lint
npm run format:check
node .agents/skills/roadmap/scripts/validate-roadmap.mjs
```

The fixed query and Wrangler response adapter have local integration coverage. Do not run browser
E2E for RM-06 itself; UI verification belongs to RM-08.

## 10. Rollout, Failure, And Rollback

Rollout is Staging-only and operator-initiated:

1. pure fixture tests;
2. local migrated D1 query proof;
3. current Staging smoke report;
4. repeatability and privacy review;
5. first sufficiently diverse human cohort comparison.

On acquisition, validation, or digest failure, write no partial report and preserve no raw rows.
On report-rendering failure after validated analysis, retain only the identifier-free intermediate
summary and make retry explicit. Never silently drop invalid rows and continue with a smaller,
friendlier cohort.

Rollback is deletion of the local scripts and ignored artifacts; the first slice has no deployed
service or database migration to reverse. If a later schema addition is approved, use a forward
migration and dual-version capture rollout rather than rewriting applied history.

## 11. Exit Evidence

RM-06 is complete only when all of the following exist:

- [x] a fixed, guarded Staging D1 acquisition path that reports zero writes;
- [x] deterministic, tested run-level and install-weighted comparison calculations;
- [x] explicit confidence labels that keep the current tiny dataset in smoke-only mode;
- [x] identifier-free JSON/Markdown reports and short-lived private RM-08 candidate artifacts;
- [x] one repeated Staging analysis with matching digests;
- [ ] one sufficiently diverse real build comparison reviewed by the human;
- [ ] representative candidates opened successfully in RM-08;
- [x] documented retention cleanup and no Production access during initial proof.

The next RM-06 action after RM-08 can accept direct run handoffs is to open the deterministic
Staging candidates there. Final exit then waits for two real cohorts that each meet the directional
minimum and a human-reviewed comparison that changes or confirms a product decision.
