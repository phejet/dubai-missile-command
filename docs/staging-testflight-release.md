# Staging TestFlight releases

Run `npm run ios:release:staging` from this checkout while it is clean and equal to remote
`main`. The quiet launcher fetches, stops before touching dependencies if either condition
fails, then runs `npm ci` in place (restart a running dev server afterwards). It never
creates a worktree or temporary checkout. Detailed output stays in the printed log file.
The command archives the Staging app, adds its exact source/build number to Staging's
existing allowlists, waits for the protected Staging deployment, uploads through Xcode,
waits for Apple processing, and assigns/verifies the existing internal tester group.
The phone only needs TestFlight and an internet connection; tap Update when ready.
This does not install a development build or deploy Production.

## One-time setup

In App Store Connect → Users and Access → Integrations → App Store Connect API,
create a team API key with the Developer role for build upload and internal testing.
Keep its downloaded `.p8` outside the repository. Xcode signing also needs access to
Certificates, Identifiers & Profiles; if Apple rejects signing permissions, resolve the
specific team permission instead of automatically escalating to Admin.

Add the following to gitignored `.env.local` (or supply environment variables):

```dotenv
ASC_KEY_PATH=/absolute/path/outside/repository/AuthKey_KEYID.p8
ASC_KEY_ID=KEYID
ASC_ISSUER_ID=issuer-uuid-from-apple
# Only needed if Staging has multiple internal groups:
ASC_INTERNAL_GROUP_ID=existing-group-id
```

Never paste the private key into chat or commit it. The command keeps API tokens in
memory and sends them only to Apple's API. It uses Xcode's supported API-key signing
arguments instead of relying on the GUI account session. GitHub CLI must already be
authenticated with permission to update Staging variables and dispatch its workflow.
An Apple Distribution certificate and Xcode must be available on the release Mac.

Run `npm run ios:release:staging -- --check` to verify API access, Staging app/group
selection, GitHub variable access, and Xcode availability without making a release.
It does not prove signing/upload permissions until a real archive/export runs.

## Recovery and boundaries

Use `npm run ios:release:staging -- --status` for a small JSON summary and
`npm run ios:release:staging -- --resume` to continue the last attempt. The launcher saves
its pointer in gitignored `operator-results/staging-deploy.json` and its log under
`operator-results/staging-deploy/`, and prevents simultaneous invocations from this checkout.
Its engine keeps the detailed release record and archive under gitignored
`operator-results/staging-releases/`. Keep those files until the release completes.
Use only one release Mac/checkout at a time; the local lock does not coordinate other Macs.

Polling stops after 30 minutes and can be resumed. Apple processing can take longer;
timeout is not evidence of failure. An upload attempt is recorded before export begins
to avoid blindly uploading the same build twice after a dropped connection. If export
definitely failed before delivery, an operator must inspect the export error and Apple
build list before resetting `uploadRequested` in the local record to retry.
Likewise, if workflow dispatch failed before GitHub received it, inspect the run list
before clearing `dispatchId` to redispatch. A failed deployment can be rerun in GitHub;
resume then checks its result.

The release adds allowlist entries; it never removes existing entries or rolls them back
after a later failure. It requires the exact source on remote main and successful Staging
deployment with Production skipped before attempting upload. A fresh archive requires a
clean checkout; Capacitor sync can leave generated tracked changes afterward. Preserve or
review them normally; the command never resets the checkout. When working changes are
present, ask the user how to handle them before releasing.

The app declares `ITSAppUsesNonExemptEncryption=false` for its exempt platform security,
authentication, and hashing. Reassess this declaration if encryption dependencies change.
Apple agreement changes and account issues may still need a human; TestFlight assignment
does not prove the phone installed the build or that physical capture validation passed.

References: [Apple API authentication](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests),
[API-key signing](https://developer.apple.com/videos/play/wwdc2021/10204/),
[internal group build assignment](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-builds).
