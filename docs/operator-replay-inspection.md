# Operator replay inspection

Developer-only, read-only Staging workflow for [RM-08](../ROADMAP.html#rm-08).

Open `operator.html`, enter the operator bearer token, and load runs. Apply exact build,
score/wave ranges, outcome, feedback, or replay-state filters; Load more follows a stable cursor.
Select Inspect to retain the result set while opening the run summary. Inspect replay performs a
cancellable, time-sliced local consistency check and derives wave cards and a sparse event timeline.
Play wave opens at its start; Play from here and timeline events open paused at the selected tick.
The terminal shortcut starts up to ten seconds before the final moment, within the final wave.

Candidate URLs use `#environment=staging&run=…`. They contain private run identifiers and belong
only in the short-lived private RM-06 artifact. The fragment is not sent to the static host.
The bearer stays in the password input and request headers; never put it in a URL or saved artifact.

## Session APIs

All routes require the existing bearer, restricted operator CORS, and `private, no-store`.

- `GET /api/operator/sessions`: default 50, maximum 100 results; strict `limit`, `cursor`, `build`,
  `minScore`, `maxScore`, `minWave`, `maxWave`, `outcome`, `feedback`, and `replay` parameters.
- `GET /api/operator/sessions/:runId`: curated D1-only summary, upgrade history and provenance.
  `available` here means indexed/eligible to request; it cannot prove object existence without R2.
- `GET /api/operator/sessions/:runId/replay`: separate replay fetch; reports actual availability.
- Former `GET /api/sessions` and `GET /api/session/:runId` return 404. Diagnostic report tooling is unchanged.

List results order by received time then run ID, descending. Up to 500 candidates are inspected per
request with at most eight simultaneous R2 HEADs. A cursor can accompany an empty page when a bounded
scan finds no matching objects; Load more continues without discarding skipped boundaries.
The existing recent-session index is used by the migrated D1 query plan; no migration was added.

365-day summary and 270-day replay windows are inclusive at their cutoff. Detail never reads R2;
list performs HEAD only for eligible indexed objects. Malformed stored upgrade/destroyed-type JSON
returns a bounded error; no stored contents are included. Session projections omit install/name/note,
storage locator/hash, credential, bundle-ID and diagnostic fields.

## Limits

This is local replay consistency, not server score verification. Incompatible formats, checkpoint
errors, absent objects and differing summary fields remain visible limitations. No replay is mutated.
First far seeks re-simulate from zero; no speculative anchor cache is added. Inspection without a
recorded final tick is capped at one simulated hour. Production and deletion controls are unavailable.
