---
name: ios-iphone-deploy
description: Build the Dubai Missile Command Capacitor iOS app and deploy it to a connected iPhone using the repo's npm scripts, Xcode, and devicectl.
user_invocable: true
---

# iOS iPhone Deploy

Builds and installs the production Capacitor iOS app onto the user's connected iPhone.

## Use when

- The user asks to build, install, deploy, or update the iOS app on their iPhone.
- The user asks whether the current code is on the phone.
- The user wants a production-device check rather than a local browser or simulator run.

## Default deploy path

Use the repo script unless there is a specific reason not to:

```bash
npm run ios:deploy
```

That runs:

1. `npm run build:ios` - Vite production build with `CAPACITOR=1`.
2. `npm run cap:sync` - copies `dist/` into the Capacitor iOS project.
3. `npm run ios:install` - builds the iOS release app and installs it with `xcrun devicectl`.

## Preconditions

Before deploying, check:

- `.env.local` exists.
- `.env.local` defines `IPHONE_UDID`.
- The iPhone is connected, trusted, and unlocked.
- Xcode command-line tools are available.

Useful checks:

```bash
test -f .env.local
xcrun devicectl list devices
```

If `.env.local` is missing, tell the user to copy `.env.local.example` and fill in `IPHONE_UDID`. Do not guess the UDID.

## Verification

Treat a zero exit from `npm run ios:deploy` as successful install. If the user wants the app launched too, use:

```bash
set -a && . ./.env.local && set +a
xcrun devicectl device process launch --device "$IPHONE_UDID" "$BUNDLE_ID"
```

If `BUNDLE_ID` is missing from `.env.local`, use the project default from the repo docs: `com.phejet.dubaicmd`.

## Failure triage

- Missing `.env.local`: ask the user to create it from `.env.local.example`.
- `IPHONE_UDID is required`: ask the user for the `devicectl` device UUID, or have them connect/unlock the phone and run `xcrun devicectl list devices`.
- Provisioning or signing failure: report the exact Xcode signing error and ask the user to fix the Apple account/team/device trust issue in Xcode.
- Build failure in Vite or TypeScript: fix the app build first; do not keep retrying the iPhone install.
- Device not found: ask the user to unlock/trust the iPhone, reconnect the cable, then rerun `xcrun devicectl list devices`.

## Notes

- `ios:deploy` is the production install path and does not require `npm run dev`.
- For live-reload device work, use `npm run dev:lan -- --port 5173 --strictPort`, then sync/open with `CAP_DEV_SERVER` pointing at the Mac's LAN URL.
- The iPhone perf workflow depends on Vite CORS allowing `capacitor://localhost`; do not remove `server.cors: { origin: true }` from `vite.config.ts`.
