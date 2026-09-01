# iOS Flavors, TestFlight, And App Icon Handoff

Status captured 2026-08-23 in Australia/Sydney. This document records the exact state
before the iPhone went out of range. Do not infer that a phone install or TestFlight
promotion happened after this point.

## Decisions

The native app now has three explicit identities:

| Flavor     | Bundle ID                     | Display name                    | Icon catalog     | Capture channel                          |
| ---------- | ----------------------------- | ------------------------------- | ---------------- | ---------------------------------------- |
| Dev        | `com.phejet.dubaicmd.dev`     | `DMC Dev`                       | `AppIconDev`     | `off`                                    |
| Staging    | `com.phejet.dubaicmd.staging` | `Dubai Missile Command Staging` | `AppIconStaging` | `staging`                                |
| Production | `com.phejet.dubaicmd`         | `Dubai Missile Command`         | `AppIcon`        | `off` locally or `production` explicitly |

TestFlight is a distribution channel, not an environment. Promote a reviewed commit to
the Staging app first, then build the Production flavor from that same commit. The exact
Production TestFlight build is the artifact eventually selected for App Store release.

Enrollment is automatic after explicit consent and valid App Attest verification. There
is no per-tester operator approval. `ENROLLMENT_ENABLED` is a global emergency/new-
enrollment switch, not an onboarding ritual.

## Repository State

Remote `main` was `cc57f78` when this handoff was started. Local `main` contains these
unpublished implementation commits plus the commit(s) carrying this handoff; inspect
`git log` for the current documentation tip:

- `2aab924` — canonical Staging product name;
- `ac90bdd` — selected production icon plus Dev/Staging icon variants.

The core three-flavor implementation is pushed as `092058d`. All eight hosted workflows
passed on that commit, including the Staging Worker deployment.

The icon direction is screen-printed modernism derived from the title screen:

- matte midnight/sand/turquoise/red palette;
- turquoise defense sweep travels outward;
- red threat arrow travels inward toward the Burj;
- production has no label;
- Dev has a magenta pixel `DEV` tab;
- Staging has an amber pixel `STAGING` tab.

Final tracked sources:

- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- `ios/App/App/Assets.xcassets/AppIconDev.appiconset/AppIconDev-512@2x.png`
- `ios/App/App/Assets.xcassets/AppIconStaging.appiconset/AppIconStaging-512@2x.png`

Rejected concept boards are intentionally ignored under `tasks/app-icon-*` and are not
part of the application artifact.

## Verification Completed

For the three-flavor implementation:

- 685 app tests passed.
- 58 workerd tests and the real-HTTP Worker test passed.
- 21 maintained E2E tests passed with two intentional skips.
- Three capture E2E tests passed.
- Typecheck, ESLint, Prettier, web build, and both Worker dry-runs passed.
- Dev, Staging, and Production native configurations compiled.
- Xcode rejected a deliberately stale Dev sync built under the Staging scheme.
- A browser Staging build showed the amber in-app `STAGING` badge with no page errors.
- All three bundle identities were installed simultaneously and the user confirmed the
  Dev/Staging in-app banners.

For the icon change:

- All master PNGs are 1024×1024 with no alpha.
- Xcode resolves `AppIconDev`, `AppIconStaging`, and `AppIcon` for the intended schemes.
- Focused flavor tests, typecheck, ESLint, and Prettier passed.
- Xcode compiled and signed a clean Dev app from `ac90bdd`.
- The compiled app points at `AppIconDev`; its reverted 120px icon was visually checked
  and the `DEV` tab remains legible.
- No phone install was attempted after the final icon build.

## Prepared Dev Build

Signed artifact:

`ios/App/build-dev/Build/Products/Debug-iphoneos/App.app`

Verified properties:

- build ID `ac90bdd`;
- flavor `dev`;
- capture channel `off`;
- bundle ID `com.phejet.dubaicmd.dev`;
- display name `DMC Dev`;
- App Attest environment `development`;
- valid deep code signature;
- provisioning profile for the Dev App ID.

Installed successfully on the paired iPhone on 2026-08-23. The first install attempt hit
Apple's transient remote install-coordination service; one retry succeeded. An automated
launch was denied because the phone locked immediately afterward, so the new Home Screen
icon still needs a human feel-check.

## Prepared Staging Build

Signed artifact:

`ios/App/build-staging/Build/Products/Staging-iphoneos/App.app`

Verified properties:

- build ID `5542373`;
- flavor `staging`;
- capture channel `staging`;
- bundle ID `com.phejet.dubaicmd.staging`;
- display name `Dubai Missile Command Staging`;
- App Attest environment `production`;
- valid deep code signature;
- provisioning profile for the Staging App ID;
- compiled 120px icon uses the amber pixel `STAGING` tab and passed visual inspection.

This is a direct development-signed build for Home Screen/icon verification. It is not
the replacement TestFlight archive. It installed successfully on the paired iPhone on
2026-08-23; launch/visual confirmation remains pending because the phone locked.

## App Store Connect State

### Production record

- App name: `Dubai Missile Command`
- Apple app ID: `6767986852`
- Bundle ID: `com.phejet.dubaicmd`
- An earlier hybrid Staging-endpoint upload exists as `1.0 (2)`.
- Delivery: `1827f1d9-bf1e-4f47-bb3f-fd60f21db41f`.
- Do not distribute that hybrid build. It uses the Production identity.

### Staging record

- App name: `Dubai Missile Command Staging`
- Apple app ID: `6804336333`
- SKU: `dubai-missile-command-staging`
- Bundle ID: `com.phejet.dubaicmd.staging`
- Uploaded build: `1.0 (1)` from commit `092058d`
- Delivery: `613dd1af-2165-4990-81f9-ceebabe1392a`
- Export compliance was completed.
- Build 1 predates the canonical full display name and selected icon. Do not add it to a
  tester group; upload build `1.0 (2)` from the final clean commit instead.

### Staging recovery upload — 2026-08-31

The planned build-2 evidence could not prove that a replacement reached the Staging record,
and the paired tester saw only the Production app in TestFlight. A fresh archive was built
from clean commit `ad774a0` as `Dubai Missile Command Staging 1.0 (3)` and uploaded directly
to the Staging record:

- Apple app ID: `6804336333`
- bundle ID: `com.phejet.dubaicmd.staging`
- delivery UUID: `43da0821-7dee-44b3-a228-44da9fc28217`
- IPA SHA-256: `d2b2aa65e5abf5fe1cb600597a363ec5fda9d1493e709f6941c2eba9c773ff4d`
- IPA size: `14,552,846` bytes
- embedded native manifest: build `ad774a0`, flavor/channel `staging` / `staging`
- App Store distribution profile: `beta-reports-active=true`, `get-task-allow=false`
- signed App Attest environment: `production`

Xcode's App Store Connect lookup resolved the signed bundle to app `6804336333`, the upload
completed successfully, and Apple reported the package processing with no processing errors
at handoff. Protected Staging deployment run `33393391346` added build `ad774a0` and bundle
version `3`, passed preflight/Worker tests/dry-runs/migrations/deploy/lifecycle, and kept
enrollment closed. Once processing completes, assign build 3 to the Staging internal group
and invite the tester; do not substitute the visible Production app.

The tester later installed build `1.0 (3)`. Protected run `33398913514` then set
`ENROLLMENT_ENABLED=true`, passed preflight/Worker tests/dry-runs/migrations/deploy/lifecycle,
and left Staging enrollment enabled as steady state. The switch is now an emergency pause,
not a registration window. Production was not deployed.

## Staging Worker State

Health returns `{"ok":true,"schema":2,"build":"staging"}`.

GitHub Staging environment variables when captured:

- `ALLOWED_BUILDS=c89807a+45c4574e,f593052,092058d`
- `APPLE_BUNDLE_IDS=com.phejet.dubaicmd,com.phejet.dubaicmd.staging`
- `APPLE_BUNDLE_VERSIONS=1,2`
- `APPLE_VALIDATION_CATEGORIES=2,3`
- `APPLE_ATTEST_ENVIRONMENTS=development,production`
- `ENROLLMENT_ENABLED=false` (historical snapshot; Staging is now steady-state `true`)

Repository switches:

- `CAPTURE_STAGING_PROVISIONED=true`
- `CAPTURE_PRODUCTION_PROVISIONED=false`

Production remains untouched and disabled.

## Resume Checklist

1. Inspect Git before doing anything:

   ```bash
   git status --short --branch
   git log -5 --oneline --decorate
   ```

2. Push the unpublished local commits when ready:

   ```bash
   git push origin main
   ```

3. Monitor all exact-SHA GitHub workflows. The docs-only handoff commit may become the
   new `HEAD`; use the clean commit actually embedded by the next native build.

4. Both prepared direct builds are installed. Unlock the phone and open `DMC Dev` and
   `Dubai Missile Command Staging` manually. Feel-check the icons and in-app banners. If
   either must be reinstalled, use the already prepared artifacts without rebuilding:

   ```bash
   set -a
   . ./.env.local
   set +a
   xcrun devicectl device install app \
     --device "$IPHONE_UDID" \
     ios/App/build-dev/Build/Products/Debug-iphoneos/App.app
   xcrun devicectl device process launch \
     --device "$IPHONE_UDID" \
     com.phejet.dubaicmd.dev \
     --terminate-existing
   xcrun devicectl device install app \
     --device "$IPHONE_UDID" \
     ios/App/build-staging/Build/Products/Staging-iphoneos/App.app
   xcrun devicectl device process launch \
     --device "$IPHONE_UDID" \
     com.phejet.dubaicmd.staging \
     --terminate-existing
   ```

5. Feel-check both Home Screen icons at real size. Confirm the magenta `DEV` and amber
   `STAGING` tabs are legible and the red arrow reads as an inbound threat. Do not tune
   against the 1024px source.

6. Add the clean commit used for the new Staging build to Staging `ALLOWED_BUILDS`, retain
   old builds until the replacement is proven, then dispatch the protected Staging Worker
   workflow.

7. Build and sync Staging from a clean worktree:

   ```bash
   npm run build:ios:staging
   npm run cap:sync:staging
   ```

8. Archive `App-Staging` as version `1.0`, build number `3`, export with
   `method=app-store-connect`, and upload to Apple app `6804336333`.

9. Complete compliance if Apple asks again, create/select the Staging internal testing
   group with automatic distribution off, add build `1.0 (3)`, and invite the developer.

10. Installing TestFlight build 3 may replace the direct `Dubai Missile Command Staging`
    install. That is correct. It must not replace `DMC Dev` or Production.

11. Once TestFlight Staging is installed, set `ENROLLMENT_ENABLED=true` for Staging and
    redeploy through the protected workflow. Consent + valid App Attest should activate
    the credential automatically. Leave enrollment enabled as Staging's steady state; set
    it to `false` only as an emergency pause. Run one completed session and verify D1/R2
    evidence.

12. After the replacement is proven, remove the legacy Production bundle ID and retired
    build IDs from the Staging allowlists. Keep Production provisioning false.
