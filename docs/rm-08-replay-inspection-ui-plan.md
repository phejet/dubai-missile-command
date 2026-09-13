# RM-08 Replay Inspection UI Plan

Status: implementation in progress; RM-04 completed and user authorized RM-08 on 2026-09-13

Roadmap initiative: [`RM-08`](../ROADMAP.html#rm-08)

Depends on: [`RM-04`](../ROADMAP.html#rm-04)

Unblocks: the representative-run handoff in [`RM-06`](./rm-06-cross-build-telemetry-analysis-plan.md)

Last reviewed: 2026-09-13

This document defines the implementation and verification path for RM-08. `ROADMAP.html`
remains authoritative for initiative order, status, gates, and next action.

## 1. Outcome And Exit Evidence

RM-08 turns the existing developer-only upload list into a practical investigation workflow:

1. authenticate against Staging;
2. find a run by exact RM-06 candidate ID or filter retained sessions by build, score, wave,
   outcome, feedback, and replay status;
3. inspect a privacy-minimised run summary, upgrade timeline, and per-wave evidence;
4. launch the deterministic replay at a selected wave or tick without downloading a replay or
   waiting through every preceding wave in real time;
5. move between the operator evidence and visual playback without losing the filtered result set.

The roadmap exit is met only when a developer can complete that flow against an unusual retained
Staging run entirely through the UI. A mocked browser test proves wiring; it does not replace the
deployed Staging proof or the human usefulness review.

### Non-goals

- player-facing history, accounts, or links into this surface;
- replay editing, mutation, upload, or file download;
- deletion controls; the confirmed operator deletion runbook remains separate;
- comments, annotations, assignments, or other collaboration machinery;
- rankings, anti-cheat, or setting `replay_verified`;
- an analytics dashboard or a replacement for RM-06 cohort analysis;
- Production enablement during the first rollout;
- retaining new personal or diagnostic data.

## 2. Entry Gate And Current Worktree Snapshot

RM-04 is canonically complete. PR #22 shipped as Staging TestFlight build 6, and the user
confirmed updating and authorized RM-08 on 2026-09-13. The following snapshot is historical;
implementation progress and verification evidence are tracked in tasks/todo.md.

The 2026-09-04 worktree provides the following starting point:

| Surface           | Present                                                                                                                                                                              | Missing for RM-08                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Operator entry    | `operator.html`, a Staging/Production selector, bearer input, and an explicit load action                                                                                            | search/filter controls, paging, selection state, and a detail pane                                                            |
| Session list API  | authenticated `GET /api/operator/sessions`, 365-day query gate, newest-first limit, and replay status resolved through D1 plus R2 `HEAD`                                             | server-side filters, stable cursor paging, feedback, exact-run handoff, and a typed response contract                         |
| Session retrieval | authenticated `GET /api/session/:runId` returns the full D1 row and referenced replay; its only non-test caller is the operator browser RM-08 replaces                               | retire the obsolete raw session reads; add a curated operator detail response and separate replay fetch                       |
| Stored summary    | score, wave, outcome, duration, Burj health, shots, kills, hit ratio, combos, destroyed types, upgrade timeline, feedback, build, platform, input, source, and App Attest provenance | safe parsing/projection for the operator UI; no schema migration is required                                                  |
| Replay evidence   | content-addressed replay body, action log, checkpoints, final tick, build/version provenance                                                                                         | an inspection model that derives wave cards and checks replay output against the stored summary                               |
| Playback runtime  | deterministic runner; renderer-readiness gate; play/pause, stop, previous/next wave; asynchronous tick seeking; public `Game.loadReplay(replay)`                                     | widen that existing public method with typed seek/start-paused options and validate them in the bridge                        |
| RM-06 handoff     | private candidate artifacts contain exact run IDs and reasons                                                                                                                        | a fragment-based operator launch reference and exact-run loading path                                                         |
| Automated proof   | Worker coverage for auth/CORS/status; one Playwright browse-to-play path; replay bridge/wave seek unit tests                                                                         | filter boundaries, pagination, privacy projection, detail states, timeline derivation, deep links, and selected-tick playback |
| External proof    | RM-04 implementation is deployed to Staging                                                                                                                                          | RM-04's remaining physical gates and the eventual deployed RM-08 investigation                                                |

## 3. Fixed Design Choices

### 3.1 Extend the vanilla operator surface

Keep `operator.html` and the existing vanilla TypeScript entrypoint. This is one bounded internal
tool, not a persuasive argument for smuggling a second application framework into the build.

Use a responsive master/detail layout:

- filter bar above the retained-run results;
- newest-first table on wide screens and readable stacked rows at narrow widths;
- selected-run inspector beside the list on wide screens and below it on narrow screens;
- replay opens in the existing game window so the production renderer and replay controller remain
  the only visual-playback implementation.

The bearer token stays only in the password input and request headers. Never put it in a URL,
fragment, storage API, log, error body, or generated RM-06 artifact.

### 3.2 Staging first, Production visibly unavailable

The UI may retain the existing environment selector, but RM-08 acceptance and candidate deep links
target Staging only. Production remains disabled unless its configured endpoint and roadmap gates
are both deliberately enabled in later work. The Worker keeps the same bearer authentication,
restricted browser CORS, and `private, no-store` response policy.

### 3.3 No D1 or capture-schema migration

The existing `sessions` row already contains every required list/detail field. Per-wave evidence
can be reconstructed from the retained deterministic replay using the current simulation and
`buildRunRecapData`; the upgrade timeline is already stored in `upgrades_json` and in replay shop
actions. Do not add a parallel wave-history column merely to save a short, time-sliced local replay
pass.

When a replay is omitted, expired, missing, or incompatible with the current runtime, show the
stored summary and upgrade history plus an explicit limitation. Never invent wave metrics from
totals.

### 3.4 Retire raw session reads and use curated projections

The current raw session routes have no non-test consumer after `src/operator-browser.ts` moves to
RM-08. Retire both `GET /api/session/:runId` and the generic `GET /api/sessions` during Phase B,
remove their route/tests/docs as active interfaces, and add operator-specific list, detail, and
replay responses that expose only the fields the workflow uses. In particular, exclude:

- `install_id`, `display_name`, and `feedback_note`;
- `sha256`, `replay_sha256`, `r2_key`, and raw storage sizes;
- `submitter_key_id_hash` and Apple bundle ID;
- diagnostic bodies, notes, events, and environment user-agent strings.

`runId` remains present because exact run selection is the purpose of the tool. It must remain
inside the authenticated UI/private candidate boundary.

This is a real reduction of session-data exposure, but not a new authorization tier. The bearer
still authorizes separately maintained diagnostic-report tooling through `scripts/diag-pull.mjs`;
those report routes and their more sensitive payload are outside RM-08. The curated projection is
the least-data contract for session inspection and defense-in-depth against accidental UI/network
exposure. A separately scoped credential would require its own security design and is not implied
by this plan.

### 3.5 Fragment-based candidate handoff

Use an operator URL fragment, not query parameters:

```text
https://phejet.github.io/dubai-missile-command/operator.html#environment=staging&run=<encoded-run-id>
```

Fragments are not sent in the static page request or cross-origin Worker referrer. On load, the
page validates the fragment, preselects Staging, and waits for the operator to enter the bearer
token before retrieving the exact run. Selecting another row updates the fragment with
`history.replaceState`; it must not create a browser-history entry for every click.

The RM-06 private candidate artifact may contain this launch URL because it already contains the
same private run ID and has a 30-day maximum lifetime. Public RM-06 artifacts remain
identifier-free.

## 4. Operator API Contract

Move the growing operator-session logic out of `worker/src/index.ts` into a focused module while
leaving route dispatch and shared auth/CORS helpers in their current owners.

### 4.1 Filtered list

```http
GET /api/operator/sessions
  ?limit=50
  &cursor=<opaque-cursor>
  &build=<exact-build-id>
  &minScore=<integer>
  &maxScore=<integer>
  &minWave=<integer>
  &maxWave=<integer>
  &outcome=burj_destroyed|survived|abandoned
  &feedback=none|%F0%9F%94%A5|%F0%9F%91%8D|%F0%9F%98%95|%F0%9F%98%A4
  &replay=available|expired|missing|omitted
```

Response:

```json
{
  "ok": true,
  "sessions": [
    {
      "runId": "run-id",
      "receivedAt": 0,
      "build": "exact-build-id",
      "score": 0,
      "wave": 1,
      "outcome": "burj_destroyed",
      "feedbackEmoji": null,
      "replayStatus": "available"
    }
  ],
  "nextCursor": null
}
```

Contract rules:

- deliberately narrow the current `1..200` limit to `1..100`, defaulting to `50`; the only UI
  caller already requests `100`, and the lower cap bounds R2 status work without removing a used
  capability;
- validate every integer, range, enum, build ID, and cursor before touching D1;
- reject inverted score/wave ranges with `400` rather than quietly returning interpretive dance;
- query only sessions inside the 365-day summary window;
- order by `received_at DESC, run_id DESC`;
- encode both ordering fields in the opaque cursor and validate its schema on decode;
- apply SQL-capable filters in bound parameters, never string interpolation;
- preserve the existing replay meanings: `omitted`, `expired`, `missing`, `available`;
- push status predicates that D1 can prove into SQL: `omitted` requires a null replay SHA;
  `expired` requires a non-null SHA outside the 270-day replay window; `missing` and `available`
  preselect only non-null, in-window SHAs, with a null joined `r2_key` immediately classified as
  `missing`;
- issue R2 `HEAD` only for in-window rows with a non-null joined `r2_key`; these calls distinguish
  `available` from the object-missing half of `missing` and are unnecessary for `omitted`,
  `expired`, and missing-index rows;
- only `available` and the object-missing branch of `missing` need post-D1 status filtering.
  Process bounded candidate batches in sort order until the requested page is full or exhausted,
  then return a cursor at the last inspected ordering boundary so skipped rows are neither lost
  nor duplicated;
- return `private, no-store` and the existing restricted CORS headers for success and error paths.

The first implementation does not add arbitrary sort expressions, fuzzy build matching, or
unbounded result export. Exact build identity matters to RM-06, and server-side novelty is a poor
substitute for a query plan.

### 4.2 Curated detail

```http
GET /api/operator/sessions/:runId
```

Return a camel-cased, validated projection containing:

- run ID, created/received times, exact build, app flavor, Apple environment, platform, input
  class, and capture source;
- score, wave, outcome/death cause, duration, Burj health, shots, total kills, display hit ratio,
  multi-shots, max combo, and destroyed-by-type counts;
- parsed upgrade timeline and feedback emoji;
- replay status, replay-complete claim, and whether a replay body can currently be requested.

Detail is D1-only: `available` means indexed and eligible to request, not object-existence proof.
The UI labels this explicitly. List R2 HEAD and replay GET establish actual object availability;
a missing object can therefore downgrade status at fetch time. No R2 read belongs in detail.

Do not include the replay body. Malformed stored JSON in `upgrades_json` or
`destroyed_by_type_json` is an observable storage-contract failure: return a bounded `500` with no
row contents, log only the run ID plus field name, and cover it with a Worker test.

### 4.3 Replay body

```http
GET /api/operator/sessions/:runId/replay
```

Resolve the same 365/270-day boundaries and `omitted`/`expired`/`missing`/`available` meanings as
the list and detail routes. Return `{ ok, replay, replayStatus }` with `private, no-store`. Do not
add a download response or expose the R2 key/SHA. The retired raw session routes do not remain as
parallel ways around this projection.

## 5. Client State And Investigation Flow

Represent the page as explicit state rather than letting DOM text become a small accidental
database:

```ts
interface OperatorFilters {
  build: string;
  minScore: number | null;
  maxScore: number | null;
  minWave: number | null;
  maxWave: number | null;
  outcome: CaptureOutcome | "";
  feedback: RunFeedbackEmoji | "none" | "";
  replay: OperatorReplayStatus | "";
}

interface OperatorViewState {
  environment: "staging" | "production";
  filters: OperatorFilters;
  sessions: OperatorSessionSummary[];
  nextCursor: string | null;
  selectedRunId: string | null;
  detail: OperatorSessionDetail | null;
  replay: ReplayData | null;
  inspection: ReplayInspection | null;
}
```

Use explicit actions:

- **Apply filters** resets paging and selection, then requests the first page;
- **Load more** appends one cursor page and deduplicates by run ID;
- **Select run** loads curated detail, updates the fragment, and keeps the list/filter state;
- **Inspect replay** fetches the replay only when selected and available, then derives its timeline;
- **Play** opens the existing game replay at tick `0`;
- **Play wave / Play from here** opens at a validated tick, initially paused when the user selected
  an exact moment;
- **Back to results** changes focus/scroll position on narrow layouts without clearing state.

Use `AbortController` for list, detail, and replay requests. A response from an old filter or row
selection must not overwrite the current view because the network completed in a different order.

Keep status text accessible through the existing live region, add visible empty/error states, and
restore focus to the selected row when a detail panel closes. All controls require labels; color
must not be the only replay-status signal.

## 6. Deterministic Inspection Model

Add a pure, UI-independent inspection module. It accepts the curated stored summary and a replay,
then produces a display model; it never fetches, renders, mutates D1, or writes artifacts.

### 6.1 Time-sliced replay pass

Reuse `createReplayRunner` and extract the existing pause-resume stepping rules from
`replay-seek.ts` so both seeking and inspection use one implementation. Run to completion in
bounded animation-frame slices with cancellation and progress callbacks. Always call
`runner.cleanup()` on completion, cancellation, or error.

At completion, call `buildRunRecapData(finalState, replay)` to derive:

- per-wave score earned, missile/drone kills, multi-shots, max combo, surviving buildings, Burj
  health, start/end tick, terminal state, and upgrades bought;
- full upgrade timeline;
- final score, wave, outcome, duration, and totals.

This pass may take CPU time, but it remains faster than real-time playback and avoids a migration.
Show progress and allow cancellation. Cache only in page memory by selected run ID; do not use
local storage or IndexedDB.

Load this module through a dynamic import only after the operator requests replay inspection. The
initial operator page must not eagerly pull `game-sim`, `run-recap`, Pixi, renderer, or audio code.
Phase A records the current production-build transfer baseline; the initial RM-08 operator entry
may add no more than 20 KiB gzip over that baseline, and its build graph must contain no Pixi or
renderer chunk. Record the lazy inspection chunk separately rather than disguising it as free.

### 6.2 Consistency, not competitive verification

Compare the derived replay result with the curated D1 summary for score, wave, outcome, duration,
Burj health, shots, kills, display hit ratio, combos, destroyed types, and upgrades. Use these
named comparison rules:

- exact equality for score, wave, outcome, Burj health, shots, kills, multi-shots, max combo, and
  every destroyed-type integer;
- exact deep equality for the ordered, normalized upgrade timeline (`tick`, `wave`, and `bought`);
- `DURATION_TOLERANCE_MS = Math.ceil(SIMULATION_TICK_MS)` (17 ms at the exported 60 Hz simulation
  rate) for duration;
- `HIT_RATIO_EPSILON = 1e-9` after both hit-ratio values are validated and clamped to `[0, 1]`.

Do not apply one vague epsilon to integer evidence. Report:

- `matches summary` when all normalized fields agree;
- `mismatch` with field names and expected/derived values;
- `unavailable` when the replay cannot be inspected because it is absent, expired, missing, or
  incompatible.

Call this a local consistency check. It must not update or describe D1 `replay_verified`, which is
reserved for a future server-owned verification pipeline and is currently always false.

### 6.3 Timeline and seek targets

Build one ordered timeline from the derived wave cards and replay actions:

- each wave start and completion;
- each non-empty shop purchase;
- EMP, F-15, and flare activations;
- the terminal moment, with a lead-in target when `finalTick` permits it.

Use the exported `SIMULATION_HZ = 60` timebase from `src/fixed-step-clock.ts` and define
`TERMINAL_LEAD_IN_TICKS = 10 * SIMULATION_HZ` (600 ticks). Clamp the terminal target to
`max(lastWaveStartTick, finalTick - TERMINAL_LEAD_IN_TICKS)`. UI labels may say “10 seconds”; seek
messages always carry the computed integer tick.

Do not render every fire or cursor action; that would turn evidence into scrolling punishment.

Each timeline item has a wave, tick, elapsed game time, label, and validated seek target. Add a
bounded tick slider/input from `0` through `finalTick` for arbitrary moments. The UI shows the
containing wave and time before launch. Wave links seek to their start; event links start paused at
the exact tick; the terminal shortcut uses `TERMINAL_LEAD_IN_TICKS`.

## 7. Playback Bridge And Runtime Changes

Extend the same-origin operator bridge message to carry typed launch options:

```ts
interface OperatorReplayLaunch {
  replay: ReplayData;
  seekToTick?: number;
  startPaused?: boolean;
}
```

Validation requirements:

- accept only the known message type from the opener at the same origin;
- require replay version, finite seed, action array, and initial state before dispatch;
- require `seekToTick` to be a finite non-negative integer no greater than `finalTick` when that
  field exists;
- coerce nothing surprising; reject the whole launch when invalid;
- keep the one-message receiver behaviour so a stray later `postMessage` cannot replace playback.

Widen the existing public `Game.loadReplay(replay)` signature to
`Game.loadReplay(replay, options)`, with options limited to `seekToTick` and `startPaused`; forward
them to the already-capable private `startReplay`. The runtime already implements asynchronous
seek, cancellation, replay divergence reporting, pause, stop, and previous/next wave. Reuse those
paths. Do not add a second scheduler or a speed multiplier in the first slice.

Imported operator replays do not have live-run state anchors, so the first far seek re-simulates
from tick zero in time-sliced batches. Measure the longest retained Staging candidate during proof.
Add anchor caching only if that measurement misses the usability budget below; speculative replay
caches are how memory leaks put on a lab coat.

## 8. RM-06 Candidate Handoff

Extend only `candidates.private.json`; public summaries and manifests remain unchanged. Each
selected candidate receives an `inspectionUrl` built from a single validated Staging operator-base
constant plus an encoded fragment containing environment and run ID.

Requirements:

- the URL exists only in the mode-0600 private artifact;
- keep the existing data, calculation, and candidate digest inputs unchanged. Add `inspectionUrl`
  only while assembling `candidates.private.json`, after analysis and digest calculation, because
  it is a deterministic encoding of an existing run ID rather than new analytical evidence;
- assert the exact URL string from environment plus run ID in a focused unit test and in the
  repeated-artifact determinism test; do not publish a redundant URL digest;
- public-artifact privacy checks prove neither the run ID nor inspection URL can enter JSON or raw
  Markdown outputs;
- private cleanup and operator deletion cross-checks continue to remove the artifact containing the
  URL;
- the analyzer never opens a browser or transmits a token;
- the operator deep link retrieves one exact run after authentication even when that run is older
  than the first result page.

After RM-08 deploys, use the existing deterministic Staging candidate selection to prove this
handoff, then delete the private candidate artifact through the maintained cleanup command.

## 9. Implementation Sequence

### Phase A — Freeze contracts and acceptance fixtures

1. Confirm RM-04 is canonically complete and re-read the worktree immediately before coding.
2. Add shared operator DTOs/enums plus strict filter, cursor, detail-row, replay-launch, and fragment
   validation fixtures.
3. Define representative sessions for every feedback and replay state, equal timestamps, range
   boundaries, malformed JSON, incompatible replay version, and an RM-06 deep-linked run outside
   page one.
4. Record the current production-build initial operator JS/CSS transfer baseline before adding the
   lazy inspection dependency graph in a checked-in operator bundle-budget fixture.
5. Record the acceptance budgets: initial operator transfer no more than 20 KiB gzip above that
   baseline with no Pixi/renderer chunk; first list response under two seconds on current Staging
   data; selected detail under two seconds; far replay seek ready in under five seconds on the
   longest retained candidate on the review machine. Treat these as review-machine usability
   evidence, not universal SLAs.

### Phase B — Build the least-privilege Worker API

1. Extract operator list/status projection from `worker/src/index.ts` into a focused module.
2. Implement bound SQL filters and stable cursor pagination against the 365-day window.
3. Classify omitted, expired, and missing-index rows in SQL; preserve actual object status with
   bounded concurrent R2 `HEAD` calls only for the remaining available/object-missing candidates,
   including correct filtered-page continuation.
4. Add curated detail parsing/projection and the separate replay route.
5. Retire `GET /api/sessions` and `GET /api/session/:runId`; remove their now-obsolete tests and
   update active API documentation. Preserve the report routes used by `scripts/diag-pull.mjs`.
6. Apply auth, CORS, method, cache, retention, and bounded-error handling consistently.
7. Run `EXPLAIN QUERY PLAN` against the migrated local D1 fixture; add an index only if the real
   filtered query demonstrates the need. A migration based on aesthetic concern stays out.

### Phase C — Build the operator investigation UI

1. Add filter controls, reset/apply/load-more states, and the responsive result list.
2. Add selection, fragment deep linking, cancellable detail loading, and the curated metadata
   inspector.
3. Parse no raw Worker rows in the DOM layer; keep network validation and state transitions in
   testable modules.
4. Add the replay fetch action, progress/error/compatibility states, wave cards, upgrades, totals,
   and consistency result.
5. Preserve the token-in-memory rule and separate deletion note.

### Phase D — Connect useful replay navigation

1. Extract shared time-sliced runner advancement and build the inspection model.
2. Render the bounded event/wave timeline and arbitrary tick control.
3. Extend the bridge and public game wrapper with validated seek/start-paused options.
4. Prove direct wave, event, terminal lead-in, previous/next wave, pause/resume, stop, cancellation,
   and replay-error behaviour.
5. Measure far-seek latency and add no anchor cache unless the recorded budget fails.

### Phase E — Complete the RM-06 handoff

1. Add the private candidate `inspectionUrl` and its validation.
2. Extend telemetry privacy, determinism, cleanup, and deletion-cross-check tests.
3. Generate a bounded Staging comparison, open each selected candidate through its deep link, and
   confirm run ID/build/reason alignment.
4. Delete the private candidate artifact after review.

### Phase F — Verify and roll out

1. Run focused unit, Worker, browser, type, lint, format, build, and diff gates.
2. Deploy the exact reviewed commit to Staging through the protected Worker workflow; leave
   Production untouched.
3. On the deployed GitHub Pages operator UI, execute the full acceptance flow against an unusual
   Staging run and record response/seek timings without recording the run ID or token.
4. Have the human feel-check filtering, detail density, and replay navigation. Watch especially for
   losing context between list and popup, ambiguous tick controls, and a far seek that feels hung.
5. Update RM-08 to shipped only when its exit evidence exists. Update RM-06 only for the candidate
   handoff gate actually proven; its diverse-cohort gate remains separate.

## 10. Expected Change Map

| File or area                                               | Responsibility                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `operator.html`                                            | filter form, result list, detail/inspection regions, accessible status and empty states                          |
| `src/operator.css`                                         | responsive master/detail layout and non-color status/timeline treatment                                          |
| `src/operator-browser.ts`                                  | page orchestration, cancellation, focus, fragment, and popup lifecycle                                           |
| new `src/operator-api.ts`                                  | typed request construction and hostile-response validation                                                       |
| new `src/operator-inspection.ts`                           | time-sliced replay inspection, summary comparison, wave cards, and event targets                                 |
| `src/operator-replay-bridge.ts`                            | validated replay plus seek/start-paused same-origin handoff                                                      |
| `src/game.ts`                                              | widen existing public replay-load options; reuse private seek/player implementation                              |
| `src/replay-seek.ts`                                       | shared cancellable advancement primitive used by seek and inspection                                             |
| new `worker/src/operator-sessions.ts`                      | filter/cursor parsing, SQL projection, replay status, curated detail, and replay response                        |
| `worker/src/index.ts`                                      | new route dispatch and retirement of obsolete raw session reads                                                  |
| `worker/test/worker.test.ts`                               | auth/CORS/cache, filters, pagination, retention/status, privacy projection, corrupt-row tests                    |
| `e2e/operator.spec.ts`                                     | complete find → inspect → selected-tick playback workflow                                                        |
| `scripts/analyze-telemetry.mjs` and tests                  | private fragment URL handoff without public identifier leakage                                                   |
| new `scripts/check-operator-bundle.mjs` and budget fixture | trace the Vite manifest's static operator graph, enforce gzip delta/no-renderer rules, and report the lazy chunk |
| `package.json`                                             | focused operator bundle-budget command                                                                           |
| `docs/testing-matrix.md`                                   | RM-08 unit/Worker/E2E/Staging ownership                                                                          |
| `docs/script-inventory.md`                                 | bundle-budget checker trust boundary and usage                                                                   |
| `docs/rm-06-cross-build-telemetry-analysis-plan.md`        | mark only the implemented handoff phase/evidence when proven                                                     |
| `ROADMAP.html`                                             | status, evidence, and next action only after the corresponding gates pass                                        |

No migration, capture payload, native iOS project, player UI, public share route, or deletion API
belongs in the planned first slice.

## 11. Verification Matrix

### 11.1 Worker and contract tests

| Case                                  | Required proof                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| missing/rejected bearer               | `401`; no D1 or R2 access after auth rejection                                 |
| hostile origin/preflight              | existing restricted CORS policy is preserved                                   |
| invalid limit/cursor/range/enum/build | bounded `400`; no SQL interpolation or row leakage                             |
| exact score/wave boundaries           | inclusive minimum and maximum semantics                                        |
| feedback filters                      | each reserved emoji and explicit `none`; no free-text input                    |
| equal received times                  | stable run-ID tie-break and no duplicate/omitted cursor rows                   |
| replay states                         | omitted, expired, missing index, missing object, and available remain distinct |
| replay-status paging                  | requested page fills across skipped rows and continuation is stable            |
| 365/270-day boundaries                | summary/detail and replay use RM-04's exact cutoff semantics                   |
| malformed stored JSON                 | bounded error; no raw row or JSON text in response/log                         |
| retired raw session routes            | `/api/sessions` and `/api/session/:runId` return `404`; no parallel raw access |
| curated detail                        | forbidden private/storage/credential fields absent by key and value            |
| detail/replay split                   | detail never reads or returns R2; replay route reads only when available       |
| cache policy                          | all operator successes/errors are `private, no-store`                          |
| initial operator bundle               | gzip delta is at most 20 KiB; initial graph contains no Pixi/renderer chunk    |

### 11.2 Replay and UI unit tests

- fragment accepts only configured environments and safe run IDs; token is never parsed there;
- stale list/detail/replay responses are ignored after abort or selection change;
- timeline ordering and wave attribution are deterministic at same-tick boundaries;
- shop purchases, actives, the 600-tick terminal lead-in, and arbitrary tick targets clamp
  correctly against the exported 60 Hz timebase;
- time-sliced inspection crosses shop/bonus pauses and always cleans its runner up;
- stored-summary exact integer/upgrade match, 17 ms duration boundary, `1e-9` hit-ratio boundary,
  field mismatch, cancellation, old/new replay version, and missing replay states render
  distinctly;
- bridge rejects wrong origin/source/type, malformed replay, negative/fractional/out-of-range tick,
  and a second message;
- selected-tick launch reaches that tick paused; ordinary launch begins at zero playing;
- pause/resume, previous/next wave, stop, and unreachable/cancelled seeks keep existing behaviour.

### 11.3 Browser E2E

The maintained operator Playwright test should cover one workflow with mocked Worker responses:

1. open a fragment deep link for a run outside the first list page;
2. enter the bearer and load the exact detail;
3. verify only curated metadata appears;
4. inspect derived wave/upgrade history and a matching consistency result;
5. apply filters, paginate, and select another result without losing filter state;
6. launch a wave and an exact tick in the popup;
7. assert the game reports replay mode, the requested tick/wave, paused state, and no page errors;
8. exercise an unavailable replay and an incompatible replay without opening a broken popup.

Add a narrow viewport assertion for control reachability and horizontal overflow. The primary
human workflow remains desktop; responsive correctness prevents the tool from becoming unusable
when opened beside logs or on a small laptop.

### 11.4 Local gates

Run at minimum:

```bash
npx vitest run src/operator-api.test.ts src/operator-inspection.test.ts \
  src/operator-replay-bridge.test.ts src/replay-seek.test.ts \
  scripts/analyze-telemetry.test.mjs
npm run test:worker
npx playwright test e2e/operator.spec.ts
npm test
npm run typecheck
npm run lint
npm run operator:bundle-check
npx prettier --check operator.html src worker scripts docs ROADMAP.html
node .agents/skills/roadmap/scripts/validate-roadmap.mjs
git diff --check
```

### 11.5 Staging and human proof

- exact reviewed Worker/app commit deployed; health/build evidence recorded;
- Production Worker and capture channel unchanged;
- initial operator entry stays within the recorded 20 KiB gzip delta and does not load Pixi or
  renderer code before replay inspection;
- deep-linked candidate opens after bearer entry without appearing in the page request;
- detail values agree with the private RM-06 candidate's build/cohort reason;
- replay-derived summary either matches or reports an explained incompatibility/mismatch;
- wave and exact-tick launch reach the intended evidence within the recorded usability budget;
- browser console contains no token, replay body, private row, or unbounded error;
- private candidate artifact is removed after review;
- human confirms the workflow is ready to use and notes any density/navigation tuning required.

## 12. Risks, Rollback, And Exit Checklist

| Risk                                                           | Mitigation                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| R2 `HEAD` work makes filtered pages slow                       | bound page/scan sizes, cap concurrency, measure Staging, and keep cursors resumable  |
| a stale async response shows the wrong run                     | one abort controller/generation per list, detail, and replay request                 |
| current runtime cannot read an old replay version              | expose compatibility as evidence; never label it missing or silently upgrade it      |
| local re-simulation blocks the UI                              | shared frame-budgeted advancement with progress/cancel and guaranteed cleanup        |
| raw private fields leak through a convenient full-row response | retire raw session reads; allowlisted DTO plus forbidden-key/value tests             |
| candidate run IDs leak through URLs                            | fragment only, private artifact only, no referrer, no token, explicit cleanup        |
| replay consistency is mistaken for score verification          | explicit terminology and no writes to `replay_verified`                              |
| scope expands into a dashboard                                 | keep aggregate comparison, exports, annotations, deletion, and ranking outside RM-08 |

Rollback is straightforward because the first slice adds no D1 schema and mutates no captured
data: redeploy the previous Worker and static site builds, then remove the private candidate
artifact. The old Worker may temporarily restore its raw session reads during rollback; the RM-08
site must roll back with it rather than depend on the new curated endpoints.

RM-08 is complete only when all of the following are true:

- [ ] RM-04 dependency is recorded complete in `ROADMAP.html`;
- [ ] a developer can filter and page retained Staging sessions across every roadmap dimension;
- [ ] an RM-06 private candidate deep link opens the exact run after authentication;
- [ ] curated metadata, upgrades, and per-wave replay evidence are visible without D1/CLI/download;
- [ ] deterministic consistency status is honest and does not imply server verification;
- [ ] wave and arbitrary-moment playback use the existing runtime controls and meet the measured
      usability budget;
- [ ] automated local gates pass;
- [ ] deployed Staging and human feel-check evidence are recorded;
- [ ] private candidate cleanup is proven;
- [ ] RM-08 status/next action and RM-06's handoff gate are reconciled in the canonical roadmap.
