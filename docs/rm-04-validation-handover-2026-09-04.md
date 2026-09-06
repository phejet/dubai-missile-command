# RM-04 Validation Handover — 2026-09-04

Status updated 2026-09-05: authenticated retention and run/install deletion proofs passed;
the original fixtures are fully cleaned. Live operator playback exposed a CORS preflight bug;
the tested fix and redacted distribution-proof logging await PR #19's checks and main-only Staging
deployment. The user installed TestFlight build 1.0 (3); physical upload/UI proof remains open.

Roadmap initiative: [`RM-04`](../ROADMAP.html#rm-04)

Primary plan: [`rm-04-retention-and-manual-deletion-plan.md`](./rm-04-retention-and-manual-deletion-plan.md)

## Continuation — 2026-09-05

Build 1.0 (5) is now processed and assigned to Internal Testers from main 3b76192.
PR #20 delivered the indicator alignment, exempt-encryption declaration, and release engine.
Protected Staging workflow 33952012463 passed; the release engine verified Production skipped.
API-key signing/upload and automatic group assignment were proven live. The local quiet
launcher and shared staging-release skill subsequently passed focused tests and a live
resume/status check against build 5 without reuploading. The phone update/feel-check remains
the user's next step. Quiet-wrapper/skill follow-up changes are local, not yet merged.

Latest physical evidence: user uploaded build 4 through Xcode, completed export compliance,
added it to the internal tester group, installed it from TestFlight, played a human run,
and confirmed "Last run uploaded". Signed backend category/provenance, emoji feedback,
and privacy-link checks remain open. This supersedes the signing/upload blocker below.
The user observed capture status overlapping the high score; a local shared-row layout fix
passes the 320px browser check but is not yet installed on the phone.

Latest resume check: PR #19 merged; workflow `33940297995` successfully deployed
`3330db43537851d8abfd98164d99d004be879f47` to Staging, including lifecycle apply/read-back.
Production was skipped. Live replay OPTIONS returned 204 with the expected GitHub Pages origin,
Authorization header, and GET/OPTIONS methods. Authenticated browser playback remains unproven.
This supersedes the pending-merge/deployment statements below.

The user supplied the Staging operator bearer through an explicitly authorized clipboard handoff.
Authentication succeeded, the clipboard was cleared, and the token stayed only in the validation
process's memory. It was never printed or written to a file.

Authenticated reads proved all six original age boundaries: replay present for days 89/91/269,
replay expired for days 271/364, day 366 absent, and names/notes absent after day 90. Run deletion
removed the day-91 fixture while preserving and successfully retrieving the day-89 shared replay.
Install deletion then removed the remaining four sessions and four replay objects. Both jobs
returned `verified: true`; inspection confirmed complete state, cleared manifests, and no locks.

The maintained fixture cleanup removed the remaining synthetic residue, including the day-366
orphan object and seeded job. Independent R2 GETs returned 404 for all six original fixture objects.
Read-only D1 verification found zero fixture sessions/reports/seeded jobs and preserved all 21
genuine sessions, 21 replay indexes, and two public mappings (`rows_written=0`). The completed
deletion audits and expiry-bounded tombstones remain by design. Redacted evidence:
`operator-results/rm04-authenticated-validation-2026-09-05.json`.

The deployed operator list loaded successfully, but Play failed because `OPTIONS
/api/session/:runId` returned 404 without CORS headers. The actual authenticated replay GET
returned 200. The CORS wrapper was nested inside GET-only dispatch. The two-file fix and a
regression covering preflight, authenticated retrieval, rejected origins, and unsupported methods
are committed as `4e8491e53026827004af2139a9e9297ea712e563` on `codex/rm04-replay-cors`.
The branch now also contains commit `ed43c4f02825dd50daf696d7ad409aa6ee27bc50`, which logs only
verified distribution facts after successful assertion authentication. This is necessary because
the existing verifier accepts omitted categories as null: narrowing the allowlist cannot by itself
prove a supplied category of 2. Tests preserve null honestly and assert no success event on
rejected assertion reuse. No category-policy change has been made or is needed if a signed 2 is
observed directly.

The isolated worktree is `/private/tmp/dmc-rm04-cors.zJJpm7`; the original worktree retains the
same four-file patch alongside all pre-existing changes. Main has not been updated.

Local verification: 100 Worker tests, one real-HTTP test, typecheck, focused ESLint/Prettier,
and `git diff --check` passed. Protected Staging workflow
[`33939080155`](https://github.com/phejet/dubai-missile-command/actions/runs/33939080155)
was dispatched for the CORS commit. Preflight passed, but GitHub rejected deployment because
Staging permits only `main`. [PR #19](https://github.com/phejet/dubai-missile-command/pull/19)
is ready for review with both fixes. Require successful main deployment and rerun the unmodified
deployed browser before closing browse-to-play. Do not start a lifecycle canary until the
deployment's lifecycle apply step finishes, because it replaces the bucket rule set. A recovery
manifest is prepared at `operator-results/rm04-lifecycle-canary-2026-09-05.json`; status `prepared`
does not mean the canary rule or objects have been created.

The user installed Staging build 1.0 (3) through TestFlight on 2026-09-05. After unlocking the
phone, devicectl independently reported version 1.0 / bundle version 3, but Developer App remained
true. Treat that flag as inconclusive; do not demand an uninstall from it alone. The pending
signed-category success log and backend provenance will establish the distribution proof.
Source inspection found another historical handoff error: build 3 is ad774a0 and predates
f155635's feedback, persistent indicator, privacy page, and app-owned PrivacyInfo.xcprivacy.
It can prove TestFlight capture/category, but a newer Staging TestFlight artifact is required for
RM-04's physical feature/privacy gates. Do not ask the user to find those controls in build 3.

The replacement 1.0 (4) archive is prepared from ed43c4f at
`/private/tmp/dmc-rm04-cors.zJJpm7/ios/App/build-rm04/App-Staging.xcarchive`; its embedded native
manifest is staging/staging/ed43c4f, and its PrivacyInfo.xcprivacy validates. Export options are
at `/private/tmp/dmc-rm04-export-options.plist` (App Store Connect, export only, team 5A2PL567F2,
automatic signing, preserve build number). Xcode export failed with `No Accounts` and no iOS
Distribution certificate. The user was asked to sign into Xcode Settings → Accounts. This is
only an archive, not an exported or uploaded TestFlight IPA. Preserve build 3 on the phone until
the replacement is actually available.

## Historical Fixture State — 2026-09-04 (Cleaned 2026-09-05)

A disposable RM-04 fixture set was live in **Staging** during the original proof. Its retained
manifest is historical evidence; the continuation above records its completed cleanup:

```text
namespace: retention-proof-20260904113436-cdcb2d18
manifest: operator-results/rm04-retention-2026-09-04.json
```

`operator-results/` is gitignored and the manifest is mode-limited evidence containing the exact
synthetic IDs and object keys. Do not copy those values into tracked docs or logs.

Before mutation, a counts-only preflight found zero non-fixture sessions, free-text fields,
reports, shares, or replay indexes eligible for scheduled retention. After the verified local
backup below and explicit approval, the checked-out scheduled handler ran twice through a remote
preview exposing only the `dmc-captures-staging` D1 database and R2 bucket.

Before any scheduled mutation, all 21 non-fixture Staging replay objects and their D1 replay-index
metadata were backed up locally under
`operator-results/staging-replay-backup-20260904120651/`. Wrangler transparently decoded the R2
gzip content encoding, so the backup contains the authoritative raw replay JSON while retaining
the original R2 keys and stored-size metadata in its mode-limited manifest. All 21 payloads passed
raw byte-count, JSON, and SHA-256 verification; the verified raw total is 9,164,501 bytes. The
backup directory is mode `0700` and every file is mode `0600`.

Both scheduled calls returned `200`, and the second produced the same verified state as the first:
five retained fixture sessions, zero diagnostics, three shares, two fixture replay indexes, all
five replay objects still physically present for lifecycle expiry, and all 21 backed-up
non-fixture replay indexes intact. Verification queries wrote zero rows. Redacted evidence is at
`operator-results/rm04-scheduled-retention-2026-09-04.json`.

The exact manifest cleanup command used on 2026-09-05 was:

```bash
npm run operator:retention-fixtures -- \
  cleanup --confirm-staging \
  --manifest operator-results/rm04-retention-2026-09-04.json
```

## Current Source And Deployment

- Worktree `HEAD`, `main`, and `origin/main`: `7cbba3e` (`Implement guarded RM-06 telemetry analysis`).
- Current Staging Worker deployment was produced from full SHA
  `7cbba3e8ee5d6cf4111742d78b54772ca32000b1` by successful GitHub workflow
  `33861916073` on 2026-09-04.
- Workflow preflight, 97 Worker tests, both Staging/Production dry-runs, Staging migrations,
  Staging deployment, and lifecycle apply/read-back passed. The Production job was skipped.
- Current Cloudflare deployment version:
  `a5367314-4806-4e22-a6b9-08f841c85e56` created 2026-09-04T10:19:15Z.
- Live health returned `{ "ok": true, "schema": 2, "build": "staging" }`.
- The roadmap still names `f155635` as the deployed RM-04 commit. That is historical evidence;
  reconcile it only after final proof because Staging now runs `7cbba3e`.

Current Staging GitHub variables were read on 2026-09-04:

- `ENROLLMENT_ENABLED=true` (steady state, not a temporary enrollment window);
- allowed validation categories `2,3`;
- allowed bundle versions `1,2,3`;
- allowed builds include `ad774a0`, `f155635`, and the older rollout builds;
- Apple environments `development,production`;
- Dev, Staging, and Production bundle IDs remain allowlisted against the Staging Worker;
- Production provisioning/deployment was not touched in this session.

## Worktree Changes To Preserve

The tree was already dirty with reviewed planning work before validation began:

```text
M  ROADMAP.html
M  docs/README.md
M  tasks/lessons.md
?? docs/rm-08-replay-inspection-ui-plan.md
```

`tasks/todo.md` is gitignored but contains the active `RM-04 Final Validation — 2026-09-04`
checklist plus the RM-08 planning/review record. No RM-08 implementation code has started.

This handover document is an additional untracked file.

## Completed Local Evidence

The following passed on 2026-09-04:

- focused RM-04 suite: 7 files / 18 tests;
- Worker Miniflare suite: 7 files / 97 tests;
- real-HTTP Worker suite: 1 file / 1 test;
- full repository suite: 71 files / 751 tests;
- `npm run typecheck`;
- `npm run lint`;
- focused Prettier check over Worker, scripts, source, operator/privacy HTML, roadmap, and lessons;
- `e2e/operator.spec.ts`: 1 Chromium browse-to-play test.

The first Worker run failed because sandboxed Wrangler could not write its preferences/registry.
The exact same maintained gate passed outside that sandbox. Do not misreport this as a product
failure.

Cloudflare Wrangler OAuth was refreshed successfully and is stored in Wrangler's normal user
configuration. No Cloudflare API token, account variable, or operator bearer token was written to
the repository or `.env.local`.

## Staging Baseline And Proof Already Collected

Before fixtures, a read-only aggregate query returned:

```text
sessions=21
reports=0
replays=21
shares=2
incomplete_deletions=0
rows_written=0
```

The guarded seeder then created six sessions at 89, 91, 269, 271, 364, and 366 days, one 91-day
diagnostic report, six share mappings, five replay objects/index rows, and one already-complete
fixture deletion job.

Read-only verification after seeding confirmed:

- exactly six fixture sessions, six names, six notes, one >365-day session;
- exactly one fixture report and six fixture shares;
- all queries reported zero writes;
- the 269-day public share returned `200` and its redirect returned `302` to the GitHub Pages
  origin;
- the 271-day public share and redirect both returned `404` before cron cleanup.

This proves the deployed public query-time 270-day boundary. Authenticated private-session
boundaries still require the operator bearer token.

## Scheduled Retention Proof Completed

Cloudflare documents `/__scheduled` for `wrangler dev --test-scheduled`; remote development ran
the checked-out Worker against the explicit Staging environment:

```bash
npx wrangler dev \
  --config worker/wrangler.jsonc \
  --env staging \
  --remote \
  --test-scheduled \
  --port 8790 \
  --show-interactive-dev-session false
```

The binding banner named only `dmc-captures-staging`; the scheduled route was invoked twice:

```bash
curl "http://127.0.0.1:8790/__scheduled?cron=17+3+*+*+*"
```

Both requests and remote logs returned `200`, after which Wrangler was stopped. Official references:

- [Cloudflare scheduled handler testing](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Cloudflare remote-development binding behavior](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)

Manifest-driven verification proved:

- day 366 session is gone; days 89, 91, 269, 271, and 364 remain;
- only day 89 retains display name/free-text note;
- the 91-day diagnostic row and R2 diagnostic object are gone;
- share mappings remain only for days 89, 91, and 269;
- D1 replay indexes remain only for the shared day-89/day-91 replay and day-269 replay;
- replay objects removed from the D1 index may remain physically in R2 until lifecycle deletion;
  the scheduled handler intentionally relies on the 270-day bucket lifecycle for those objects;
- the second scheduled invocation was idempotent.

No direct cleanup SQL was used.

## Original Operator Bearer Blocker (Resolved For The 2026-09-05 Session)

`DMC_CAPTURE_BEARER_TOKEN` is not present in the process environment or `.env.local`, and GitHub
environment secrets cannot be read back. Obtain the Staging operator bearer through the existing
secure secret source; never paste it into chat, a command argument, shell history, tracked files,
or evidence.

Once available in a fresh shell:

```bash
read -rs DMC_CAPTURE_BEARER_TOKEN
export DMC_CAPTURE_BEARER_TOKEN
```

Use it to prove authenticated session status for the retained fixture ages, the deployed operator
browse-to-play flow against a genuine valid replay, and manual deletion.

Recommended deletion proof after scheduled retention:

1. delete the day-91 fixture as `--scope run`; its replay is shared with day 89 and must be listed
   as preserved;
2. delete the fixture install as `--scope install`; it removes the remaining fixture sessions and
   their unique live references;
3. require `verified: true` and retain only the redacted evidence under `operator-results/`;
4. run manifest cleanup afterward to remove any remaining fixture objects/job rows and verify zero
   residue.

Commands:

```bash
npm run operator:delete -- --env staging --scope run --reference <day-91-run-id-from-manifest>
npm run operator:delete -- --env staging --scope install --reference <install-id-from-manifest>
```

The CLI previews and requires the exact interactive confirmation before mutation.

## Same-Key R2 Clock Proven; Lifecycle Canary Still Open

The maintained `operator:r2-clock-probe` command now performs a narrowly guarded Staging-only
same-key proof. It accepts only randomized `replays/retention-clock-proof-*` keys, preserves a
mode-limited recovery manifest while active, and verifies cleanup before discarding that manifest.
The live proof rewrote identical bytes, advanced `uploaded` by 1,679 ms, changed the object
`version`, preserved payload size, deleted the canary, and rechecked absence. Redacted evidence is
at `operator-results/rm04-r2-upload-clock-2026-09-04.json`.

No short-window lifecycle canary has run. Lifecycle configuration read-back is already proven, but
physical lifecycle timing would require a temporary isolated-prefix rule plus exact restoration or
an explicit reviewed deferral.

Read-only device inspection after these proofs still found `Dubai Missile Command Staging 1.0 (1)`
with `builtByDeveloper=true`. It remains the old direct-signed build; the required TestFlight
artifact is still build `1.0 (3)`.

Cloudflare's R2 object metadata exposes `uploaded`, and its object-upload API returns upload time
and version. The completed probe:

1. writes a manifest-namespaced replay canary;
2. records its first `uploaded` timestamp/version;
3. writes the same bytes to the same key again;
4. proves the second timestamp/version advanced;
5. deletes the canary and verifies absence;
6. emits no token, object bytes, genuine replay key, or private capture identifier.

Reference: [Cloudflare R2 Workers API (`R2Object.uploaded`)](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

Do not shorten the real `replays/` lifecycle rule. Any temporary isolated-prefix canary must preserve
and restore the exact repository rules, or remain open rather than conducting archaeology on the
real bucket.

## Physical TestFlight Blocker

The paired `Alex’s iPhone` is available. Read-only device inspection found:

```text
Dubai Missile Command Staging
bundle: com.phejet.dubaicmd.staging
version: 1.0
bundle version: 1
Developer App: true
```

This is the old direct-signed Staging build, not the required TestFlight artifact. The required
artifact is **Dubai Missile Command Staging 1.0 (3)** from source commit `ad774a0`.

Human/device steps:

1. explicitly approve removal of the current direct-signed Staging app because uninstalling may
   delete its local data;
2. install exactly build `1.0 (3)` from TestFlight;
3. re-run `devicectl` and require bundle version `3` with `Developer App=false`;
4. open the app, grant playtest-upload consent, enable automatic uploads, finish one human run,
   and submit one emoji;
5. confirm the persistent indicator reaches `Last run uploaded`;
6. query D1/R2 for build `ad774a0`, Staging flavor/bundle, Apple environment `production`, feedback,
   replay availability, and a new assertion counter;
7. load and play the run through `operator.html`.

Validation category is not stored in D1 or logged by the Worker. With Staging currently allowing
both `2,3`, successful enrollment alone does not prove category `2`. The clean exclusion proof is
to deploy Staging with category `2` only for the fresh TestFlight enrollment, record that protected
workflow, and restore `3` only if direct-development access is still deliberately required. Do not
change this policy silently.

## Roadmap Closure (Remaining After 2026-09-05 Continuation)

Do not mark RM-04 shipped yet. Remaining evidence:

- deploy the CORS fix and prove unmodified operator browse-to-play;
- isolated lifecycle canary or an explicit reviewed deferral;
- proper TestFlight build/category-2 enrollment and human upload;
- physical privacy-policy/manifest visibility and operator replay playback;
- confirm Production remains untouched through the remaining proofs.

When all pass, update `ROADMAP.html` from the live evidence, not from this handover. RM-08 may then
move from planned/gated work into implementation.
