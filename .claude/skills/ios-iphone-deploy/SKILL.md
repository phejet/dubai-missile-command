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

Run the deterministic deployer. It does preflight checks, then build -> sync -> install, and exits with a category code telling you exactly what failed:

```bash
python3 scripts/ios_deploy.py          # add --launch to start the app after install
```

Pipeline (mirrors `npm run ios:deploy`):

1. Preflight: `.env.local` + `IPHONE_UDID` present, iPhone visible to `devicectl`.
2. `CAPACITOR=1 vite build` - production web build.
3. `npx cap sync ios` - copies `dist/` into the Capacitor iOS project.
4. `xcodebuild` release build + `xcrun devicectl device install app`.

### Exit codes — when to engage vs. just report

| Code | Meaning          | What you do                                                                                  |
| ---- | ---------------- | -------------------------------------------------------------------------------------------- |
| 0    | success          | Done. Report installed (and launched, if `--launch`).                                        |
| 2    | bad config       | `.env.local`/`IPHONE_UDID` missing. Ask the user to fix; do not guess the UDID.              |
| 3    | no device        | Ask the user to unlock/trust/reconnect the iPhone, then rerun.                               |
| 4    | app build failed | **Engage.** Read the Vite/TS error, fix the code, rerun. The one case that needs your brain. |
| 5    | cap sync failed  | Report the sync error; usually a stale/native-project issue.                                 |
| 6    | install failed   | Signing/provisioning/devicectl. Report the exact Xcode error to the user.                    |
| 7    | launch failed    | Install already succeeded; only the post-install launch failed.                              |

`npm run ios:deploy` remains a valid fallback if you need the raw npm chain, but it has no preflight and no categorized exits.

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

Treat exit code 0 from `scripts/ios_deploy.py` as a successful install. To launch the app on the device too, pass `--launch`:

```bash
python3 scripts/ios_deploy.py --launch
```

The script reads `BUNDLE_ID` from `.env.local`, falling back to the project default `com.phejet.dubaicmd`.

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
