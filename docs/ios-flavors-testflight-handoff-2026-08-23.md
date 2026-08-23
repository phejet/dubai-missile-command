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

Remote `main` is `cc57f78`. Local `main` has two unpublished commits:

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

The phone is expected to be unavailable. Do not diagnose `devicectl` until the user is
back, the phone is unlocked, and wireless pairing or a cable is available.

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

## Staging Worker State

Health returns `{"ok":true,"schema":2,"build":"staging"}`.

GitHub Staging environment variables when captured:

- `ALLOWED_BUILDS=c89807a+45c4574e,f593052,092058d`
- `APPLE_BUNDLE_IDS=com.phejet.dubaicmd,com.phejet.dubaicmd.staging`
- `APPLE_BUNDLE_VERSIONS=1,2`
- `APPLE_VALIDATION_CATEGORIES=2,3`
- `APPLE_ATTEST_ENVIRONMENTS=development,production`
- `ENROLLMENT_ENABLED=false`

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

4. When the phone returns, install the already prepared Dev build without rebuilding:

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
   ```

5. Feel-check the Home Screen icon at real size. Confirm the magenta `DEV` tab is legible
   and the red arrow reads as an inbound threat. Do not tune against the 1024px source.

6. Add the clean commit used for the new Staging build to Staging `ALLOWED_BUILDS`, retain
   old builds until the replacement is proven, then dispatch the protected Staging Worker
   workflow.

7. Build and sync Staging from a clean worktree:

   ```bash
   npm run build:ios:staging
   npm run cap:sync:staging
   ```

8. Archive `App-Staging` as version `1.0`, build number `2`, export with
   `method=app-store-connect`, and upload to Apple app `6804336333`.

9. Complete compliance if Apple asks again, create/select the Staging internal testing
   group with automatic distribution off, add build `1.0 (2)`, and invite the developer.

10. Installing TestFlight build 2 may replace the direct `Dubai Missile Command Staging`
    install. That is correct. It must not replace `DMC Dev` or Production.

11. Once TestFlight Staging is installed, set `ENROLLMENT_ENABLED=true` for Staging and
    redeploy through the protected workflow. Consent + valid App Attest should activate
    the credential automatically. Run one completed session and verify D1/R2 evidence.

12. After the replacement is proven, remove the legacy Production bundle ID and retired
    build IDs from the Staging allowlists. Keep Production provisioning false.
