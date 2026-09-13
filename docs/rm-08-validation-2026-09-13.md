# RM-08 implementation evidence — 2026-09-13

[RM-08](../ROADMAP.html#rm-08) owns current status. This records implementation and verification.

## Local evidence

- Full unit suite: 783 tests / 75 files passed before final projection/UI refinements; focused follow-up gates cover those changes.
- Worker suite: 105 tests / 8 files passed; separate actual HTTP-wire test passed (3.53 seconds) after allowing Wrangler's local registry access.
- Maintained browser workflow: exact candidate outside page one → curated detail → real three-wave human replay consistency → wave popup → selected tick paused → filters/paging → unavailable and incompatible replay states. Passed in 3.9 seconds in the working checkout, 5.4 seconds including build/startup in the isolated release checkout.
- Typecheck, lint and scoped formatting passed. Roadmap validator reports eight stable initiatives.
- Initial operator baseline: 3,209 gzip bytes. Initial implementation: 8,856 gzip bytes, +5,647 bytes (20 KiB maximum growth). No simulation/Pixi/renderer in the static initial graph. Lazy inspection dependency graph: 67,259 gzip bytes including shared assets already loaded. The maintained bundle command records final build sizes.
- Migrated D1 `EXPLAIN QUERY PLAN` for exact build plus score filtering uses `idx_sessions_recent`; no migration added.
- R2 status work is bounded to 500 candidates per request and eight concurrent HEADs. Cursor tracks the last inspected ordering boundary.
- Same-origin opener-only launch rejects malformed versions/initial state, hostile ticks and extra messages. Human bonus/shop stepping reuses `seekRunnerToTick`.
- Private candidate URLs are added after analytical digest calculation. URL equality, repeated artifacts, public JSON/raw-Markdown exclusion and existing cleanup are tested; operator deletion coverage includes URLs.

## Review decisions

The original plan simultaneously required D1-only detail and actual object availability. Detail now explicitly labels an indexed replay as eligible to fetch; list HEAD and replay GET establish actual existence. This preserves the no-R2 detail contract without pretending SQL can observe an object store.

Secondary provenance/totals use a disclosure; primary summary and replay actions remain prominent. Desktop results stay visible while scrolling the inspector. Purchase timeline wave labels follow normalized upgrade history at shared boundary ticks.

## External acceptance still required

Exact reviewed Staging deployment, genuine unusual-run UI investigation, longest retained candidate seek timing, private RM-06 candidate cleanup after review, and human usefulness confirmation. Mocked browser proof does not satisfy these gates. Production capture remains disabled.

## Direct main delivery verification

User requested local tests and direct main delivery without a PR. Verified the isolated implementation based on `433799b`:

- Full unit suite: 777 tests across 73 files passed.
- Worker suite: 105 tests across 8 files, plus the actual HTTP-wire test, passed.
- Operator and gameplay smoke browser suites: all 16 tests passed (25.5 seconds); operator workflow took 2.5 seconds.
- Typecheck, lint, changed-file formatting, roadmap validation, and diff whitespace checks passed.
- Operator initial graph: 9,021 gzip bytes, +5,812 over baseline; lazy inspection graph: 67,486 gzip bytes. Bundle budget passed.
- Replaced the roadmap link to ignored local `tasks/todo.md` with this tracked evidence document so clean-checkout validation succeeds.

Deployed Staging investigation and human usefulness acceptance remain open.

## Deployed Staging proof — 2026-09-13

- Source: `8bff209bd1d9630494369d9252766cc65b165164` (RM-08 implementation plus local verification).
- Initial GitHub Actions runs failed before creating jobs with GitHub's internal-error annotation. One retry recovered both deployments.
- [Pages run 34749429922, attempt 2](https://github.com/phejet/dubai-missile-command/actions/runs/34749429922/attempts/2): build and deployment succeeded.
- [Capture Worker run 34749429867, attempt 2](https://github.com/phejet/dubai-missile-command/actions/runs/34749429867/attempts/2): preflight and Staging deployment succeeded; Production skipped.
- Live Staging `/api/health`: `ok: true`, schema 2, build `staging`. This health label identifies environment, not source SHA; the workflow records source provenance.
- Playwright loaded the deployed Pages operator and verified filter and inspector regions. Initial JavaScript resources included `operator-ah4tkfTd.js` and the matching bridge/helpers; no simulation, Pixi, or renderer loaded.
- Live browser-origin rejected-token request returned HTTP 401, `Access-Control-Allow-Origin: https://phejet.github.io`, `Cache-Control: private, no-store`, and visible `Bearer token rejected`. No page errors.
- Authenticated real-run investigation, longest-retained-candidate seek timing, RM-06 candidate handoff/cleanup, and human usefulness acceptance remain unproven. The prior session deliberately cleared its in-memory operator token; a fresh secure handoff is pending. No private candidate artifact was created during this proof.

## Authenticated real-run browser proof — 2026-09-13

The supplied Staging operator bearer was read from the authorized clipboard into the temporary test process, the clipboard was cleared, and the browser/process were closed after this proof. No token or private run ID was logged or persisted.

- Deployed UI loaded all 23 retained sessions; all 23 had available replays. No further page cursor remained. Every detail was selected through the UI; no direct D1 query or replay download was used for the investigation.
- Longest retained run by stored duration: 172,517 ms, wave 10, score 119,848, build `c89807a+45c4574e`, final tick 10,351. The inspector produced ten wave cards and **matches summary**, including upgrades and replay-derived totals.
- First list response: 1,039 ms (budget <2,000); first selected detail: 97 ms (budget <2,000); longest-run inspection: 965 ms.
- Last-wave launch reached wave 10 in 3,525 ms. Far selected-tick launch reached tick 10,291 in 1,346 ms (budget <5,000), showed the paused transport label, and remained at that exact tick after 250 ms. These are review-machine browser timings, not iPhone benchmarks.
- At 390 × 844 the inspected layout had no horizontal overflow. The full authenticated workflow emitted zero page or console errors; observed operator requests were GET-only and responses used `private, no-store`.
- Separate maintained RM-06 exporter regenerated the existing reviewed Staging smoke comparison after one transient failure. Query reported 0 changes, 0 rows written, 39 rows read; four private candidates were generated. Public calculation digest remained `d55e22468851e0253b10e1b975b7ac8a3a11937dedb28820980382c671804716`. Cohorts remain 13 sessions/1 install and 4 sessions/1 install, so this is smoke-only evidence.
- The real generated-candidate link check/cleanup awaits a fresh authenticated browser session. Human usefulness confirmation remains open.
