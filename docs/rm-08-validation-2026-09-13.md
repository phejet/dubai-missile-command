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
