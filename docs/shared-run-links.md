# Shared Run Links

Status: deployed to Staging and locally verified; physical share proof pending. Production
remains disabled.

## Contract

A completed session is private by default, including when automatic upload is enabled.
Only an explicit Run Recap **Share Run** action can publish it. The action is authorized
with the same App Attest credential and serialized assertion coordinator used for capture
ingest; the Worker verifies that the credential owns the immutable session and that its
content-addressed replay still exists before creating a link.

`shared_runs` maps one stable 16-character HMAC-derived slug to one `sessions.run_id`.
The HMAC secret is server-only, and the mapping survives secret rotation after creation.
The existing `sessions.shared` field is set to `1`; the original `source` remains unchanged
so automatic-versus-manual submission provenance is not rewritten by a later share.

## Routes

- `POST /api/share` — native, App-Attest-authorized owner mutation. Body is exactly
  `{ runId, buildId }` and is covered by the assertion's decoded-body SHA-256. Repeated
  owner calls return the same link.
- `GET /r/:shareId` — verifies the mapping and redirects to the reviewed public game URL
  with `?r=<shareId>&share=<staging|production>`.
- `GET /api/shared/:shareId` — public, read-only replay plus the minimal score/wave/build/
  outcome summary. It never returns install IDs, credential IDs, notes, provenance, or
  other private session columns.

The web client maps `share=staging|production` only through build-time reviewed Worker
origins. Query parameters cannot inject an arbitrary API origin. A valid shared replay
auto-plays; completion presents a score/wave **Your Turn** action that starts a clean run.

## Existing automatic uploads

Automatic completed-run uploads and the bounded offline queue predate this feature. The
share action first checks for an existing owned session, so an automatically uploaded run
is not uploaded twice. If no session exists, it uploads once and retries link creation.
An ambiguous earlier network result is safe: a successful owner lookup reuses the stored
session; a `404` proves the Worker has no session before the one-time manual upload.

## Retention and failure behavior

Session retention removes orphaned `shared_runs` rows before replay cleanup. A shared row
whose R2 evidence is missing returns `410`; an unknown or unshared slug returns `404`.
Public responses allow cross-origin reads and use a short 60-second cache. Ingest and
operator retrieval routes retain their existing stricter CORS and bearer policies.

## Remaining rollout gates

1. Complete the proper Staging TestFlight App Attest category `2` submission and retire
   category `3` only after its evidence is verified.
2. Create one link from a physical consented run, open it in a clean browser, watch the
   replay through completion, and start a new run from the CTA.
3. Keep Production capture closed until the deletion contract and product management UI
   required by the authenticated-ingestion plan exist.
