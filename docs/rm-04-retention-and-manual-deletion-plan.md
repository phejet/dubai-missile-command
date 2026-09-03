# RM-04 Retention And Manual Operator Deletion Plan

Status: implementation plan; not completion evidence

Roadmap initiative: [`RM-04`](../ROADMAP.html#rm-04)
Last reviewed: 2026-09-02

This document turns the approved RM-04 retention decisions into an implementation and
verification sequence. `ROADMAP.html` remains the authority for priority, status, gates, and
the next action. This plan owns the engineering detail and the evidence required to close the
retention and manual-deletion gate.

## Current Worktree Snapshot

This is a completion plan, not a greenfield build order. The uncommitted 2026-09-02 worktree
already contains a substantial RM-04 implementation, and those changes belong to the active
implementation effort rather than this documentation task.

| Surface               | Present in the working tree                                                                                                                             | Remaining before the gate is credible                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Logical retention     | `worker/src/retention.ts`; 365/270/90 cutoffs; D1 scrub/GC; query-time gates on session, report, replay, list, operator-list, share, and redirect paths | complete boundary/missed-cron coverage; explain retained replay SHA metadata                                                      |
| R2 lifecycle          | committed-shape 90-day `diagnostics/` and 270-day `replays/` rules plus a config test                                                                   | deployed lifecycle read-back assertion and physical Staging proof                                                                 |
| Replay refresh        | `writeReplay` unconditionally `PUT`s on new references and exact retries; one test repairs an absent object                                             | direct test that an already-present dedup hit still performs the `PUT`; Staging proof that the object's upload/expiry clock moves |
| Deletion coordination | migration tables, ingest reservations, durable deletion jobs, lock acquisition, plan digest, resume, and post-verification                              | stale-reservation recovery, failure/race tests, guarded operator CLI, and Staging exercise                                        |
| Operator browser      | `operator.html`, browser/bridge modules, Worker listing route, and replay launch path                                                                   | focused browser verification and deployed browse-to-play proof                                                                    |
| Feedback              | emoji-only client/Worker path and bounded enum                                                                                                          | retention contract assertion that this route cannot accept free text                                                              |
| Staging fixtures      | none                                                                                                                                                    | guarded backdated D1/R2/share seeder and cleanup command                                                                          |
| Credential retention  | revocation/audit behaviour exists in the auth design                                                                                                    | explicit privacy declaration and manual-deletion handling                                                                         |

Current baseline evidence: `npm run test:worker` passes 73 workerd tests and the one real-HTTP
test when Wrangler can write its local logs and registry. That is useful implementation
evidence, not completion: the missing race, recovery, lifecycle read-back, and Staging tests are
not made real by the existing green count.

The implementation decision is to **finish the reservation/job/lock protocol**, not remove it.
Both sides now exist and are exercised by the basic deletion path. Removing the tables and
ingest coordination would discard working safety machinery while leaving the original
cross-store race to be solved again with fewer tests and worse language.

## 1. Outcome

Deliver a retention system whose behaviour remains correct when the scheduled sweep is late,
an R2 lifecycle deletion is asynchronous, a replay is content-deduplicated, or an operator
deletion fails halfway through.

The completed slice must prove all of the following:

- compact gameplay summaries remain usable for cross-build analysis for 365 days;
- full replay access and public share access stop after 270 days;
- diagnostic rows, diagnostic objects, and free-text fields stop being available after 90 days;
- a trained operator can preview, confirm, execute, retry, and verify run- or install-scoped
  deletion across D1 and R2;
- a replay object shared by data outside the deletion scope is never removed;
- Production capture remains disabled until the exact Staging-tested commit passes the other
  RM-04 gates.

## 2. Fixed Policy Contract

### 2.1 Retention clock

Use the Worker's server-controlled `received_at`, never client `captured_at`, object reads, or
share-link visits, as the logical clock.

- An item is available while `received_at >= now - window`.
- It becomes logically expired once `received_at < now - window`.
- A late nightly cron may delay physical D1 cleanup, but it must not extend API availability.
- R2 deletion may occur after the logical boundary because lifecycle processing is
  asynchronous. APIs must stop serving the object at the logical boundary regardless.
- Re-sharing a run does not restart its 270-day clock. A share minted on day 200 has at most 70
  days of life.

Use injected `now` values in retention and share helpers so boundary tests do not depend on the
wall clock. Keep the three windows as exported named constants in one Worker module.

### 2.2 Data classification

| Data                             |                                            Logical window | Clock                        | Physical cleanup                        | Availability after expiry                            |
| -------------------------------- | --------------------------------------------------------: | ---------------------------- | --------------------------------------- | ---------------------------------------------------- |
| `sessions` gameplay/stat columns |                                                  365 days | session `received_at`        | nightly D1 sweep                        | operator/session lookup returns not found            |
| `sessions.feedback_note`         |                                                   90 days | session `received_at`        | set to `NULL` by D1 sweep               | never returned                                       |
| `sessions.display_name`          |                                                   90 days | session `received_at`        | set to `NULL` by D1 sweep               | never returned; friendly names remain deferred       |
| `sessions.feedback_emoji`        |                                                  365 days | session `received_at`        | deleted with summary                    | retained because it is a bounded enum, not free text |
| `diagnostic_reports` rows        |                                                   90 days | report `received_at`         | nightly D1 sweep                        | report lookup returns not found                      |
| `diagnostics/` R2 objects        |                                                   90 days | object creation              | R2 lifecycle                            | never served without a live report row               |
| per-session replay access        |                                                  270 days | session `received_at`        | query-time gate plus D1 replay-index GC | summary remains; `replayStatus: "expired"`           |
| `replays/` R2 objects            | 270 days after the last valid reference writes the object | R2 object age                | R2 lifecycle                            | never served through an expired session or share     |
| `shared_runs` mappings           |                                                  270 days | owning session `received_at` | query-time gate plus nightly D1 sweep   | public lookup and redirect return not found          |
| deletion recovery manifests      |      until completion; 30 days if blocked before mutation | job `updated_at`             | completion or safe-abort sweep          | operator-only; hashed audit/counts remain            |

`app_attest_credentials` are security records, not gameplay summaries. The
[`authenticated-capture-ingestion`](./authenticated-capture-ingestion.md) contract requires a
revoked key to remain rejected on re-enrollment, so an install-scoped data deletion does not
silently erase that deny-list record. Active credentials remain while active; revoked
credentials retain the minimum key hash, status, and revocation/audit material for the life of
the capture service. The privacy policy must disclose that pseudonymous security record and its
purpose. A verified install-wide request may separately revoke the credential to stop future
capture, but gameplay-data deletion and credential revocation remain two explicit operator
actions.

`/api/feedback` accepts only the bounded `feedback_emoji` enum, which follows the 365-day
session-summary window. It neither accepts nor creates free text, so a 90-day feedback gate
would be the wrong fix. If free-text feedback is ever reintroduced, it needs its own
server-controlled write timestamp and 90-day policy rather than borrowing the session's age.

### 2.3 Replay references and deduplication

Replay objects are content-addressed by SHA-256 and may be referenced by more than one session
or diagnostic report. The logical entitlement belongs to each referring row, not to the shared
object:

- an expired session cannot retrieve a replay merely because a newer session references the
  same SHA;
- a recent diagnostic report may retrieve its replay even when an older session with the same
  SHA has expired;
- an R2 object may remain physically present while any in-policy session or report needs the
  same content;
- public share expiry is always based on the owning session, never on another deduplicated
  reference;
- ingest unconditionally re-uploads the content-addressed replay on **every** valid reference
  and exact retry, including a dedup hit. That `PUT` refreshes the R2 upload/lifecycle clock; it
  is retention machinery, not redundant bandwidth to be optimized away.

Cloudflare defines an Age lifecycle from an object's age and exposes an `uploaded` timestamp on
each `R2Object`, but does not clearly document the same-key overwrite case as a retention
protocol. Treat “re-PUT moves the clock” as a deployment assumption that must be physically
proved in Staging, not merely inferred from the local emulator. See Cloudflare's
[`R2Object` reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [object lifecycle behaviour](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

### 2.4 Non-goals

- No player-facing upload history, delete-one, delete-all, or data-management UI.
- No friendly names or new free-text feedback.
- No leaderboard retention or score-verification policy.
- No Production rollout in this slice.
- No claim that a local test proves Cloudflare applied the real lifecycle rules.

## 3. Invariants

Implementation and tests must preserve these invariants:

1. A summary can outlive its replay, but an expired summary cannot make the replay reachable.
2. A public URL cannot outlive the owning session's replay window.
3. Missing cron execution cannot extend logical retention.
4. R2 lifecycle is the replay-object deletion mechanism and the diagnostic backstop. The cron
   deletes and verifies expired diagnostic objects before dropping their D1 locator row, so an
   asynchronous lifecycle pass cannot make a manual deletion target undiscoverable.
5. Manual deletion may remove an R2 replay immediately only when no non-target, in-policy row
   references it.
6. A partial deletion is resumable from durable operator state; retrying is idempotent.
7. An ingest racing with manual deletion cannot commit a new row that points to an object the
   deletion job has removed.
8. Preview and execute operate on the same target set. If the set changes, execute fails closed
   and requires a fresh preview.
9. Deletion responses and logs contain identifiers, counts, and object keys only where needed;
   they never contain replay bodies, diagnostic text, credentials, or bearer tokens.
10. Every accepted replay reference performs an unconditional R2 `PUT`, even when the SHA and
    object already exist. Skipping that write is a retention-contract change and requires a
    replacement clock protocol before it can merge.
11. Sessions aged 270–365 days intentionally retain `replay_sha256` as integrity metadata after
    the replay index/object entitlement expires. No foreign key or cascade may turn replay GC
    into premature summary deletion.

## 4. Implementation Plan

### Phase A — Reconcile and lock the existing contract with missing tests

1. Preserve the current uncommitted implementation and review it as one coherent RM-04 change;
   do not replay the phases below as if the files were absent.
2. Keep the current green Worker baseline while adding a table-driven retention classification
   test covering every persisted D1 field and R2 prefix. This is the tripwire against a future
   text field quietly acquiring a 365-day life.
3. Add boundary tests at 89/90, 269/270, and 364/365 days, including exact-boundary behaviour.
4. Add tests proving that an expired public share and expired private replay are blocked even
   when the cron has not run and the D1/R2 records still exist.
5. Extend replay-deduplication coverage: old session plus recent session, old share plus recent
   private reference, and recent diagnostic report plus old session.
6. Instrument the R2 binding or a narrow replay-writer seam and prove that a second valid
   reference to an already-present SHA still calls `put`. The existing “restore a missing
   object” test does not catch an optimization that skips a healthy dedup hit.
7. Add deletion tests for preview drift, partial R2 failure, resume, stale reservation recovery,
   and concurrent reservation-versus-lock acquisition.

Land each missing test with the implementation it guards; the active tree is already too far
through the feature for ceremonial red-test archaeology. A green test that merely calls the
sweep and observes empty tables does not prove query-time expiry.

### Phase B — Finish the existing retention policy and D1 cleanup

Keep `worker/src/retention.ts` as the one source for retention constants, cutoff calculation,
logical availability helpers, and `runRetention`. `worker/src/index.ts` should continue routing
scheduled events to this module rather than owning privacy policy among HTTP plumbing like a
sock hidden in a cutlery drawer.

The daily D1 batch should perform, in this order:

1. clear `sessions.feedback_note` and `sessions.display_name` older than 90 days;
2. delete `diagnostic_reports` older than 90 days;
3. delete `shared_runs` whose owning session is older than 270 days, and clear the corresponding
   current-share flag if that flag remains in the schema;
4. delete `replays` index rows only when no session inside 270 days and no live diagnostic report
   references the SHA;
5. delete `sessions` older than 365 days.

Step 4 deliberately leaves `sessions.replay_sha256` populated on 270–365-day summaries while
the corresponding `replays` index row may be gone. The SHA remains integrity/provenance
metadata; it is not a live foreign-key entitlement. Document and test this before someone
“repairs” it with a cascade and throws away 95 days of useful summaries.

Keep the sweep idempotent. Run it twice in tests and assert the second pass changes nothing and
does not throw. Ensure the existing `received_at` and replay-reference indexes support every
predicate; use `EXPLAIN QUERY PLAN` against the migrated test database before adding an index
on vibes alone.

### Phase C — Enforce logical expiry on every serving path

Update all paths that can expose replay or share data:

- `retrieveSession`: return the summary inside 365 days, but do not resolve R2 after 270 days;
  report `replayStatus: "expired"`.
- operator session listing/browser: calculate replay status from session age before issuing an
  R2 `HEAD`.
- `shareSession`: reject creation or re-creation once the owning session is outside 270 days.
- `retrieveSharedRun`: require the owning session to be inside 270 days before reading the replay
  row or R2 object.
- `redirectSharedRun`: apply the same age predicate before redirecting to the game.
- report retrieval: require a live report row; no orphaned diagnostic object is directly
  addressable.
- `/api/sessions` and `/api/reports`: retain their current query-time cutoff before filtering or
  pagination.
- `/api/feedback`: keep the schema emoji-only and reject unknown/free-text fields; the enum may
  be written throughout the session's 365-day life.

Prefer one shared SQL predicate/helper over five hand-copied interpretations of “270 days.”
Return public `404` after logical expiry so a stale share ID does not disclose whether a run once
existed. Return `410` only when the mapping/session is still in-policy but the replay row or R2
object is unexpectedly gone; that is an availability failure, not expiry. Cover both responses.

For authenticated session retrieval, use these exact meanings:

- `omitted`: the session never supplied a replay SHA;
- `expired`: the session is outside its 270-day replay window;
- `missing`: the session is still in-policy but its expected replay index row or R2 object is
  absent;
- `available`: an in-policy replay row and object were retrieved.

The current `replayValue` treats a missing replay-index row as `expired` even for a fresh
session. Change that case to `missing`; age, not database optimism, is what proves expiry.

### Phase D — Apply and verify R2 lifecycle policy

Change `worker/lifecycle.json` to exactly two enabled prefix rules:

- `diagnostics/`: 90 days (`7,776,000` seconds);
- `replays/`: 270 days (`23,328,000` seconds).

Keep `worker/lifecycle-config.test.ts` as the repository guard. Add
`scripts/verify-r2-lifecycle.mjs` and explicit
`worker:lifecycle:verify:staging`/`worker:lifecycle:verify:production` npm scripts. Each script
must read the applied bucket lifecycle configuration and compare normalized rule IDs, prefixes,
enabled state, condition type, and durations with `worker/lifecycle.json`. Run the matching
verification script immediately after each existing lifecycle `set` step in
`.github/workflows/deploy-worker.yml`. Merely printing `wrangler ... lifecycle list` creates
lovely green logs and proves nothing.

The physical R2 proof has two parts:

1. CI proves the committed configuration and reads the applied Staging configuration back from
   Cloudflare.
2. A disposable Staging replay key is uploaded twice. Its second `R2Object.uploaded` value (and
   expiration metadata when exposed) must move forward, proving the unconditional dedup `PUT`
   actually refreshes the lifecycle clock on real R2.
3. A disposable Staging canary prefix/rule proves lifecycle deletion on a short window without
   shortening either real rule. Remove the canary rule and object after the observation period.

Do not temporarily change the real `replays/` rule to one day. That is how a verification task
turns into an archaeological event.

### Phase E — Manual deletion API and durable job protocol

Keep the API operator-only, bearer-authenticated, `POST`-only, non-CORS, and `Cache-Control:
no-store`.

Supported scopes:

- `run`: the matching session, reports linked to that run, its share mapping, unique diagnostic
  objects, and any replay object left unreferenced;
- `install`: all sessions and reports with the exact install ID, all shares for those sessions,
  unique diagnostic objects, and replay objects left unreferenced.

The install ID locates data; it does not authenticate the requester. Human request verification
belongs in the runbook.

The current worktree already has an unapplied `0005_retention_deletion_jobs.sql` migration plus
both protocol sides: ingest reservations in `worker/src/ingest.ts` and job/lock execution in
`worker/src/deletion.ts`. Finish and test that design. Do not leave reservation overhead backed
by locks that no path acquires, and do not rip out the protocol now that both sides exist.

The migration owns durable deletion jobs, replay-write reservations, and temporary replay
locks:

- `operator_deletions`: job ID, scope, hashed reference for the durable audit trail, plan digest,
  state, target counts, temporary object manifest, timestamps, and last error;
- `replay_write_reservations`: unique request ID, replay SHA, owner kind/ID, state, and timestamps;
- `replay_deletion_locks`: replay SHA, job ID, and acquisition time.

Because migration `0005` is still uncommitted/unapplied in this snapshot, add reservation state
and update timestamps there before first deployment. If deployment happens first, preserve
`0005` and add a forward `0006`; do not rewrite applied history because archaeology already has
enough jump scares.

Preview must:

1. validate the scope and bounded safe reference;
2. resolve exact session, report, share, diagnostic-object, and candidate replay targets;
3. classify replay candidates as `delete` or `preserve` based on non-target, in-policy
   references;
4. return sorted IDs/keys, counts, a deterministic plan digest, and an exact confirmation string;
5. perform no writes.

Execute must recompute the plan and reject with `409` if its digest differs from preview. A
survivor crossing a retention boundary can legitimately change that digest; the runbook describes
this as policy-clock drift, not tampering. It then creates a durable job and acquires a temporary
run/install scope lock plus locks for every candidate replay before deleting anything.

Every ingest path acquires a short-lived scope reservation, including replay-less reports, and
every replay write acquires its replay reservation **before** its R2 `PUT`. The corresponding
scope-lock and replay-lock statement pairs are the serialization points: either ingest reserves
first and finishes before deletion locks, or deletion locks first and ingest receives a retryable
response without writing R2. Replay locks cover preview-preserved candidates too; execution
re-evaluates every candidate after row deletion. A simple “check lock, then PUT” is insufficient
because the lock can arrive between those operations, leaving a freshly recreated orphan after
the operator's final `HEAD`.

Ingest releases its reservation only after the R2 write and D1 referring-row commit finish. Add
structured acquire/release logs carrying the request ID, owner kind/ID, and replay SHA, but no
payload or credential material.

Do **not** automatically reap a reservation after ten minutes merely because the default Worker
CPU budget is 30 seconds. Cloudflare documents CPU time separately from HTTP duration and places
no hard wall-time limit on a connected HTTP request; waiting on I/O does not consume CPU time.
See the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Instead, add a fail-closed stale-reservation recovery command:

1. list the reservation, age, owner, replay SHA, expected R2 key, matching owner row, and any
   deletion lock/job;
2. use the structured Worker invocation outcome to prove the reserving request completed or was
   terminated;
3. if the owner row committed, remove only the stale reservation and preserve the replay;
4. if no owner row committed, atomically replace the reservation with a recovery deletion lock,
   re-check all live references, delete an orphan object/index only when safe, verify, then clear
   the lock;
5. if request termination cannot be proven, leave the reservation in place and keep deletion
   blocked.

Exercise both committed-owner and orphan-owner recovery cases in workerd. Existing clients
already queue retryable capture failures, so a short operator lock must not lose a completed
run.

Execute the durable job in resumable stages:

1. delete target diagnostic objects and verify each with R2 `HEAD`;
2. delete target shares, diagnostic rows, and session rows in one D1 batch;
3. re-query all references for each locked replay SHA;
4. delete only now-orphaned replay objects, verify absence, then delete their `replays` rows;
5. verify no target D1 rows, public mappings, or deletable R2 objects remain;
6. mark the job complete and release replay locks;
7. retain only the minimal hashed audit record and counts; purge the temporary manifest on the
   short operator-job schedule.

On failure after mutation, keep the job, manifest, and locks, return the job ID and failed stage,
and make retry resume from that stage. This recovery manifest is an explicit retention exception:
it remains until deletion completes because purging it would make safe completion impossible. A
failure before mutation releases partial locks; after 30 untouched days its manifest is purged
and the minimal audit row becomes `aborted`. The operator CLI must list, inspect, recover, and
resume blocked jobs as well as recover stale write reservations; never silently time out a
post-mutation lock and let ingest race an unfinished deletion.

### Phase F — Operator CLI and runbook

Add a small repository script rather than asking an operator to handcraft destructive JSON in a
terminal at two in the morning. The script must:

- accept an explicit environment (`staging` or `production`), scope, and reference;
- refuse Production unless a separate `--production` acknowledgement is present;
- call preview first and print the exact affected IDs, counts, preserved shared replays, and plan
  digest;
- require the exact confirmation returned by preview;
- execute, poll/resume the job, and run post-deletion verification;
- list/inspect/resume blocked jobs and run the explicit stale-reservation recovery flow;
- never print the bearer token or store it in shell history;
- emit a redacted evidence file under a gitignored operator-results directory.

The human runbook must record:

1. how the requester was verified through the small known tester cohort;
2. whether the request is run-scoped, install-scoped, or also requires credential revocation;
3. the preview digest and target counts;
4. the approver and absolute execution date;
5. the completed job ID and post-verification result;
6. the escalation path for a partial job or a replay preserved because another valid reference
   exists.

### Phase G — Build the guarded Staging fixture harness

Add `scripts/seed-retention-fixtures.mjs` because ordinary ingest correctly owns
`received_at` and therefore cannot manufacture 89/91/269/271/364/366-day boundary rows.

The script must:

- accept only the explicit Staging D1 database and R2 bucket names;
- reject local, Production, empty, wildcard, and environment-derived ambiguous targets;
- create a unique `retention-proof-<timestamp>-<nonce>` namespace;
- seed complete session, diagnostic, replay-index, share, deletion-job, and R2 object shapes
  through reviewed fixtures rather than partial fantasy rows;
- include two sessions sharing one replay SHA and one report referencing that SHA;
- emit a manifest containing every inserted row ID and object key;
- support a separate `--cleanup <manifest>` mode that deletes exactly those targets and verifies
  absence;
- refuse cleanup without the matching Staging namespace and manifest digest.

Keep this as a dedicated operator/test script, not a deployed public endpoint.

## 5. Completion Change Map

| File                                                                                                              | Completion responsibility                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `worker/src/retention.ts`                                                                                         | retain as the single policy source; finish boundary/idempotency/index proof               |
| `worker/src/index.ts`                                                                                             | finish serving/list status semantics for session, report, replay, and operator routes     |
| `worker/src/share.ts`                                                                                             | retain late-share/query-time gates; specify/test expiry `404` versus in-policy loss `410` |
| `worker/src/ingest.ts`                                                                                            | preserve unconditional replay `PUT`; finish reservation logging/recovery and race tests   |
| `worker/src/projection.ts`                                                                                        | verify every text/emoji/replay field maps to the documented retention class               |
| `worker/src/feedback.ts`                                                                                          | preserve emoji-only mutation; explicitly reject free-text/unknown fields                  |
| `worker/src/deletion.ts`                                                                                          | finish durable job/lock failure, resume, stale-reservation recovery, and verification     |
| `worker/migrations/0005_retention_deletion_jobs.sql`                                                              | finish job, write-reservation, replay-lock state/timestamps and indexes before apply      |
| `worker/lifecycle.json`                                                                                           | keep 90-day diagnostics and 270-day replay physical cleanup                               |
| `worker/lifecycle-config.test.ts`                                                                                 | exact repository lifecycle guard                                                          |
| `worker/test/worker.test.ts`                                                                                      | add boundary, healthy-dedup PUT, drift, failure, race, recovery, and response semantics   |
| `worker/test/http-wire.test.ts`                                                                                   | real-HTTP auth, cache headers, status codes, and bounded request behaviour                |
| `src/run-feedback.ts` and `src/run-feedback.test.ts`                                                              | owner-authorized emoji client path and retry semantics                                    |
| `operator.html`, `src/operator-browser.ts`, `src/operator-replay-bridge.ts`, `src/operator-replay-bridge.test.ts` | read-only browse-to-play surface and focused browser bridge proof                         |
| `scripts/operator-delete-capture.mjs`                                                                             | guarded preview/confirm/execute/resume/recover/verify workflow                            |
| `scripts/seed-retention-fixtures.mjs`                                                                             | refuse non-Staging targets; seed and exactly clean backdated proof data                   |
| `scripts/verify-r2-lifecycle.mjs`                                                                                 | compare applied bucket rules with `worker/lifecycle.json`                                 |
| `package.json`                                                                                                    | lifecycle verification and guarded operator script entry points                           |
| `.github/workflows/deploy-worker.yml`                                                                             | run lifecycle read-back after set; Production remains manual/gated                        |
| `docs/shared-run-links.md`                                                                                        | final public-expiry and `404`/`410` contract with deployed evidence                       |
| `docs/authenticated-capture-ingestion.md`                                                                         | own the retained revoked-credential deny-list/audit contract                              |
| privacy policy/runbook document                                                                                   | publish windows, security-record exception, deletion contact, and operator procedure      |

The files already present in the worktree must be reconciled and completed rather than
overwritten. “Planned responsibility” here means the remaining contract for review, not evidence
that the file still needs to be invented.

## 6. Verification Matrix

### 6.1 Focused automated coverage

| Scenario                                       | Required assertion                                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 89-day session with note/name                  | summary and free text remain                                                             |
| 90-day boundary                                | exact documented inclusive behaviour                                                     |
| 91-day session                                 | summary/emoji remain; note/name are `NULL`                                               |
| emoji feedback on an old retained session      | accepted through day 365; request schema cannot carry free text                          |
| 91-day report                                  | D1 row gone; API cannot address its R2 object                                            |
| 269-day session/share                          | private replay, public lookup, and redirect work                                         |
| 271-day session before cron                    | summary works; private replay says expired; public routes return `404`                   |
| in-policy share with missing object            | public replay lookup returns `410`; redirect contract is documented                      |
| fresh session with missing replay-index row    | authenticated status is `missing`, not `expired`                                         |
| 271–365-day session after replay-index GC      | summary and `replay_sha256` remain; replay status is `expired`                           |
| 366-day session                                | authenticated summary lookup returns not found even before cleanup                       |
| missed cron                                    | query-time gates still enforce every window                                              |
| cron rerun                                     | no error and no further mutation                                                         |
| healthy second reference to existing SHA       | R2 `put` is called again and object upload time advances                                 |
| old and new sessions share one SHA             | old replay blocked; new replay available; object/index retained                          |
| old share and recent diagnostic share one SHA  | public share blocked; report replay available                                            |
| lifecycle config                               | exactly the two expected prefixes and durations                                          |
| applied lifecycle config                       | Staging read-back exactly matches the repository file                                    |
| deletion without bearer                        | `401`, no D1 or R2 mutation                                                              |
| preview                                        | complete deterministic target list; no mutation                                          |
| changed target after preview                   | execute `409`; fresh preview required                                                    |
| wrong confirmation                             | execute `409`; no mutation                                                               |
| run deletion                                   | target summary/report/share gone; unique objects gone                                    |
| install deletion                               | every exact-install target gone; unrelated install and credential audit record untouched |
| shared replay                                  | target rows gone; replay object and index retained for survivor                          |
| R2 delete failure                              | durable job remains retryable; D1/object state is explainable                            |
| retry after partial failure                    | converges to complete without deleting survivor data                                     |
| concurrent ingest reservation vs deletion lock | exactly one wins; no post-verification R2 recreation or dangling row                     |
| committed stale reservation recovery           | reservation clears and valid replay remains                                              |
| orphan stale reservation recovery              | recovery lock, orphan cleanup, and verification complete before unlock                   |
| unproven active reservation                    | recovery refuses and deletion remains blocked                                            |
| Staging seeder target guard                    | local/Production/ambiguous bindings fail before mutation                                 |
| logs/responses                                 | no replay body, diagnostic text, credential, or token leakage                            |

Use the migrated Miniflare D1/R2 bindings for storage assertions and the real-HTTP Worker suite
for wire behaviour. Do not mock the database for cross-store tests; a mock will cheerfully
certify SQL it has never met.

### 6.2 Local gates

Run, at minimum:

```bash
npx vitest run worker/lifecycle-config.test.ts
npm run test:worker
npm run typecheck
npm run lint
npx prettier --check worker docs scripts .github/workflows/deploy-worker.yml
```

Also run focused tests for the lifecycle verifier, guarded Staging seeder, operator CLI, feedback
client, and operator replay bridge. Run `npm test` because the current worktree changes shared
capture contracts and client retry semantics. Run the focused operator-browser Playwright path
because the browse-to-play surface already exists in this implementation. Gameplay itself does
not need a feel-check for this backend slice.

### 6.3 Staging proof

Use a dedicated `retention-proof-*` fixture namespace and Staging resources only.

1. Record pre-deploy D1 counts, current Worker build, and `wrangler r2 bucket lifecycle list`
   output.
2. Deploy the exact reviewed commit through the protected Staging workflow.
3. Confirm migrations, Worker deployment, cron registration, lifecycle apply, and lifecycle
   read-back all passed.
4. Use `scripts/seed-retention-fixtures.mjs` to seed disposable 89/91-, 269/271-, and
   364/366-day rows plus replay, diagnostic, and share objects. Capture its manifest. The script
   must refuse any non-Staging database or bucket name.
5. Prove query-time behaviour through the deployed HTTP routes before invoking cleanup.
6. Trigger or await the scheduled handler, then verify the expected D1 rows directly.
7. Preview and execute one run deletion and one install deletion. Include a deduplicated replay
   with a survivor outside the deletion scope.
8. Verify D1 absence, R2 absence/preservation, expired public-link behaviour, completed job
   state, and redacted logs.
9. Re-PUT the same Staging replay canary and prove its `uploaded`/expiration clock advances.
10. Remove every canary row, object, temporary lifecycle rule, and operator artifact through the
    manifest cleanup mode; verify the cleanup itself.
11. Attach workflow run IDs, commands, redacted outputs, and the tested commit to the execution
    review in `tasks/todo.md`.

The 270-day production rule cannot be proven by waiting 270 days before merging. The accepted
evidence is boundary-tested Worker logic, read-back of the real lifecycle configuration, and a
short-lived isolated R2 lifecycle canary. Continue a periodic lifecycle audit after rollout.

## 7. Rollout And Rollback

Roll out in this order:

1. tests and migration;
2. retention/query-time code with deletion routes inaccessible unless the migration exists;
3. Staging Worker;
4. Staging lifecycle configuration and read-back;
5. Staging canary and manual-deletion proof;
6. privacy/runbook review;
7. roadmap evidence update;
8. Production only through its existing manual, protected workflow after every RM-04 gate is
   complete.

Before Staging deployment, save the current lifecycle configuration and Worker version. If
query-time expiry is wrong, roll back the Worker immediately. If a sweep predicate is wrong,
disable the cron in a reviewed deployment before retrying; do not repeatedly run a suspect
deleter. Prefer temporarily lengthening an R2 rule over shortening it during recovery because
retention overrun is recoverable while deleted bytes are not.

Schema rollback is forward-only: unused job/lock tables may remain while code rolls back. Never
drop them during an incident. A completed physical deletion is intentionally irreversible, so
the Staging canary and preview digest are the rollback plan's load-bearing parts.

## 8. Exit Evidence For The RM-04 Gate

The retention/manual-deletion gate is complete only when all of these exist:

- focused boundary, missed-cron, deduplication, race, retry, and lifecycle tests are green;
- the full Worker, type, lint, and formatting gates are green;
- Staging reports the exact 90/270-day R2 rules after deployment;
- deployed Staging HTTP routes prove 365/270/90 logical availability and public share expiry;
- one run deletion and one install deletion complete against disposable Staging data;
- the survivor-reference case proves shared replay content is preserved;
- forced stale-reservation recovery proves both committed and orphan cases without an age-only
  reaper;
- the applied lifecycle rules and same-key R2 re-PUT clock are physically proven in Staging;
- the privacy/runbook text discloses retained App Attest revocation/audit records and separates
  deletion from credential revocation;
- the operator runbook and redacted evidence artifact have been reviewed;
- the exact commit and workflow runs are recorded in `tasks/todo.md`;
- `ROADMAP.html` is updated only after that evidence exists.

Passing local tests means the implementation is ready for Staging proof. It does not mean the
Cloudflare configuration is applied, the cron has fired, or the deletion procedure is safe in
the environment where the data actually lives. Computers are marvellous that way: they obey
precisely the system we deployed, not the one described in an especially confident pull
request.
