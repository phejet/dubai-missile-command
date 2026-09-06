# RM-04 browser playback and lifecycle validation — 2026-09-06

Initiative: [RM-04](../ROADMAP.html#rm-04). This file records evidence; ROADMAP.html owns current status.

## Deployment and isolation

- Latest successful protected Staging deployment: workflow [33952012463](https://github.com/phejet/dubai-missile-command/actions/runs/33952012463), source `3b76192d81ae9a4b39c1c2d73fe83af9fd5a4461`.
- Read-only workflow inspection confirmed preflight and Staging passed, Production skipped.
- Live Staging `/api/health` returned `ok: true`, schema 2, build `staging`.
- This validation targets only `dmc-captures-staging`; no Production mutation.

## Lifecycle

Live read-back matched the repository rules: diagnostics expire after 90 days and replays after 270 days.
The earlier same-key upload-clock, scheduled retention, authenticated deletion, and shared-object preservation proofs remain recorded in the [previous handoff](rm-04-validation-handover-2026-09-04.md).

At 2026-09-06T02:15:49Z, a new recovery manifest was created under the gitignored, mode-limited `operator-results/rm04-lifecycle-live-2026-09-06.json`. The test added one 60-second age rule for a unique `retention-lifecycle-proof/` subprefix, preserving both original rules exactly. A disposable canary and a separate `retention-lifecycle-control/` object were uploaded and retrieved successfully. Neither prefix overlaps genuine replay or diagnostic data.

Lifecycle proof **passed and cleaned** on 2026-09-06:

- At `07:57:54.265Z`, the canary returned **404**, while the independent control returned **200** with its expected payload.
- The script first confirmed that the active rules still matched the original rules plus the isolated canary rule.
- At `07:57:56.622Z`, it restored the original rules and verified exact equality by live read-back.
- By `07:57:58.951Z`, both exact fixture keys had been deleted and verified absent.
- The recovery manifest records `status: passed-and-cleaned` and `lifecycleExpired: true`.

The command was `node operator-results/rm04-lifecycle-check.mjs check`. The initial sandboxed attempt could not access Wrangler authentication/logging; the authorized escalated run completed successfully. Credentials stayed in process memory. Genuine capture prefixes and Production were untouched.

The canary is no longer active, so the lifecycle-proof hold on Staging deployment is lifted. Do not rerun this completed manifest's check: its active-rule/control preconditions intentionally no longer hold after cleanup. Retain the manifest as evidence.

## Authenticated browser playback

On 2026-09-06, the user manually authenticated on the deployed GitHub Pages operator page and confirmed that runs loaded, Play worked, and the replay played correctly. This closes the authenticated browse-to-play proof. No credentials were recorded.

The same manual test identified separate replay transport feedback: wave navigation was difficult to use, and adding “Paused” resized the centred toolbar, moving another button under the pointer. These are UI follow-up issues, not an authentication failure.

## Remaining RM-04 gates outside this validation

Signed TestFlight category 2 remains open. Emoji feedback, corrected upload badge, and privacy surfaces were subsequently proven below. RM-04 remains in progress.

## Local replay follow-up confirmation

On 2026-09-06, after the local operator connection, fixed-size transport, and bonus/shop seek fixes, the user confirmed “all works.” Local browse/play and replay transport feel-check are complete. These follow-up fixes have not been deployed. Automated evidence is in tasks/todo.md under Wave-seek divergence review. This local UI confirmation did not itself close lifecycle or TestFlight gates; lifecycle completion is recorded above.

## TestFlight build 5 UI and signed-fact observation

On 2026-09-06 the user completed the requested phone checks on Staging TestFlight build 1.0 (5): last-run upload status without score overlap, emoji recap submission, and a readable Privacy Policy page. The user confirmed “done.”

The redacted Worker observer received verified session and feedback events at 08:04:06Z and 08:04:26Z, both for build `3b76192`, Staging flavor and Apple production environment. Both reported `validationCategory: null` and `bundleVersion: null`; this is not category-2 proof. Redacted local evidence: `operator-results/rm04-distribution-proof-2026-09-06.jsonl`.

The exact build-5 archive contains the app-owned PrivacyInfo.xcprivacy (tracking false), privacy.html, and a native manifest for Staging / Staging channel / 3b76192. Its CFBundleVersion is 5 and bundle is com.phejet.dubaicmd.staging. This plus the phone policy check closes the privacy-surface proof.

[Apple's WWDC26 App Attest session](https://developer.apple.com/videos/play/wwdc2026/201/) states that launch-category/bundle-version extensions are new in iOS 27. The user confirmed iOS 26.6.1. This device cannot supply the iOS-27-only fields; approval is pending to accept its proven TestFlight/App Attest production path and defer signed category-2 proof to iOS 27. No authentication policy or allowlist was weakened.
