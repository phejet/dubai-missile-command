# iPhone Wave 1 Perf Push Investigation

Date: 2026-04-21

Goal: run the maintained iPhone perf harness against `perf-wave1`, keep the existing push-based architecture, and understand why the report either failed to start or failed to persist.

## Executive Summary

The launch side is no longer the primary problem.

The biggest concrete bug we found was that `xcrun devicectl --payload-url` did not deliver the deep link through `launchOptions` on cold launch for this app shell. It arrived in process arguments instead. Extending the native bridge to forward a URL from `argv` made `App.getLaunchUrl()` start returning the expected `dubaimissile://perf?...` URL and finally allowed the replay to start.

After that, the failure moved downstream into the report-save path. We tried three broad fixes:

1. make the dev server reachable from the phone on the expected host/port,
2. make the save endpoint accept cross-origin requests,
3. switch the installed app to a LAN dev-server shell so replay fetches and `/api/save-perf` are same-origin.

Those changes improved things materially:

- title-screen cold launches became replay launches,
- the replay ran to completion at least once,
- the user eventually reported the top-right banner turned green instead of erroring.

What we do **not** have yet is the actual saved artifact for the final run. No file matching the run ids used during this investigation was found under `perf-results/runs/` or `perf-results/latest/` after the green-banner report.

## Relevant Code Paths

These are the files that mattered during the investigation.

- Perf harness contract and workflow:
  [`README.md`](../README.md) lines 71-124
- Bench launcher:
  [`scripts/bench.sh`](../scripts/bench.sh) lines 62-128
- Perf save endpoint:
  [`vite-perf-plugin.ts`](../vite-perf-plugin.ts) lines 8-114
- Native URL ingress:
  [`src/main.ts`](../src/main.ts) lines 10-22
- Perf request boot path:
  [`src/boot-game.ts`](../src/boot-game.ts) lines 250-324
- Sink behavior:
  [`src/perf-sinks.ts`](../src/perf-sinks.ts) lines 9-36
- Recorder completion path:
  [`src/perf-recorder.ts`](../src/perf-recorder.ts) lines 233-279
- iOS app delegate bridge:
  [`ios/App/App/AppDelegate.swift`](../ios/App/App/AppDelegate.swift) lines 9-58
- Capacitor live-reload server config:
  [`capacitor.config.ts`](../capacitor.config.ts) lines 1-37
- Manual scheme-link probe page:
  [`public/perf-test.html`](../public/perf-test.html) lines 1-12
- Report wait helper that hit `EMFILE`:
  [`scripts/perf-wait.mjs`](../scripts/perf-wait.mjs) lines 162-170

## Initial State

Before the investigation, the repo already had the intended push architecture:

- `PerfRecorder` emits a schema-v1 report and awaits `sink.emit()` on replay finish.
- `HttpSink` posts the report JSON.
- the Vite middleware at `/api/save-perf` stamps the report with a build id and writes it to `perf-results/runs/<buildId>/...` and `perf-results/latest/...`.
- `scripts/bench.sh` launches the installed iPhone app via `xcrun devicectl` and waits for a matching report.

That architecture is coherent on paper. Reality, as ever, preferred a different hobby.

## Current Uncommitted Files

At the time this report was written, the worktree had these relevant uncommitted changes:

- `ios/App/App/AppDelegate.swift`
- `scripts/bench.sh`
- `src/boot-game.ts`
- `vite-perf-plugin.ts`
- `public/perf-test.html`

There was also a project-process update in `tasks/lessons.md`, but it is not part of the runtime fix.

## Environment and Device Facts

What we confirmed during the session:

- `npm run dev:lan` is the expected server mode for iPhone perf runs.
- `.env.local` was present with `MAC_HOSTNAME`, `IPHONE_UDID`, and `BUNDLE_ID`.
- `xcrun devicectl list devices` showed a connected iPhone 15 Pro.
- `xcodebuild` did **not** want the same identifier that `devicectl` used. The CoreDevice id from `devicectl` was not accepted as a build destination; `xcodebuild` required the classic iOS destination id instead.

That mismatch is worth remembering because it wasted time for reasons only Apple could explain with a straight face.

## Chronology

### 1. Baseline harness run failed at launch behavior

The initial ask was simply: start the dev server, then capture Wave 1 on iPhone using the existing push path.

Observed behavior:

- the app launched,
- it restarted,
- but it stayed on the title screen instead of entering replay/perf mode.

Implication:

- `devicectl --payload-url` was affecting launch, but the game runtime was not receiving the URL in the shape it expected.

Relevant files:

- [`src/main.ts`](../src/main.ts)
- [`src/boot-game.ts`](../src/boot-game.ts)
- [`ios/App/App/AppDelegate.swift`](../ios/App/App/AppDelegate.swift)

### 2. Static shell vs LAN server mismatch surfaced immediately

The bench harness assumes a LAN-reachable dev server:

- it probes `http://<host>:5173/api/save-perf`,
- it passes an absolute `perfSink` URL to the app,
- and it expects the phone to reach that server directly.

However, the first manually started `npm run dev` was the normal local-only Vite server, not `npm run dev:lan`.

What we did:

- restarted Vite with `npm run dev:lan`,
- confirmed it bound to `http://localhost:5173/` and a LAN address,
- verified that the harness expects exactly that shape.

Relevant files:

- [`README.md`](../README.md) lines 73-114
- [`scripts/bench.sh`](../scripts/bench.sh) lines 62-73 and 101-123

### 3. `scripts/perf-wait.mjs` was not reliable on this machine

The bench flow did not just have runtime issues. The local wait helper also broke.

Observed failure:

- `node scripts/perf-wait.mjs --run-id ...` threw `EMFILE: too many open files, watch`.

Why:

- `scripts/perf-wait.mjs` uses `fs.watch(root, { recursive: true })` and also polls.
- on this machine/session, the watch call hit the file descriptor limit.

Consequence:

- we had to stop trusting the official wait helper during debugging,
- and fall back to manual file polling with `rg`/`find`.

Relevant file:

- [`scripts/perf-wait.mjs`](../scripts/perf-wait.mjs) lines 162-170

Status:

- This did **not** fix the underlying iPhone issue.
- It only removed one local observer failure from the pile.

### 4. The cold-start URL was not arriving through `launchOptions`

This was the first real root cause.

We attached to the device console and instrumented the app delegate.

Observed console evidence after instrumentation:

- `didFinishLaunching launchOptions=nil`
- `argv=... | --payload-url | dubaimissile://perf?...`

That means:

- `devicectl` was indeed passing the payload URL,
- but not through `UIApplication.LaunchOptionsKey.url`,
- and the current native bridge was therefore blind on cold launch.

Fix applied:

- add a helper to forward a launch URL into `ApplicationDelegateProxy`,
- first prefer `launchOptions[.url]`,
- otherwise scan `CommandLine.arguments` for a `://` argument and forward that.

Relevant file:

- [`ios/App/App/AppDelegate.swift`](../ios/App/App/AppDelegate.swift) lines 9-29

Status:

- **Worked.**

Once this patch was rebuilt and reinstalled, a console-attached launch showed:

- the native app forwarding the URL from `argv`,
- `App.getLaunchUrl()` returning the expected `dubaimissile://perf?...` payload to JS.

That was the turning point. Before this, the app just started. After this, it knew _why_ it started.

### 5. Rebuild/reinstall was required repeatedly

Several early launches were misleading because the phone was still running an older installed shell.

What we had to do repeatedly:

- `npm run build:ios`
- `npm run cap:sync`
- `xcodebuild ... build`
- `xcrun devicectl device install app ...`

Why:

- JavaScript changes only help if the installed shell actually contains the updated bundle,
- native changes only help if the device app is rebuilt and reinstalled.

Relevant files:

- [`capacitor.config.ts`](../capacitor.config.ts)
- generated [`ios/App/App/capacitor.config.json`](../ios/App/App/capacitor.config.json)

Status:

- **Necessary and worked as expected.**
- Not a bug by itself, just the usual tax for working in this swamp.

### 6. After launch was fixed, the replay could start

After the native `argv` fix:

- the user confirmed that the replay eventually started,
- console-attached runs showed JS receiving the launch URL,
- the app could be driven into replay mode instead of title mode.

Relevant files:

- [`src/main.ts`](../src/main.ts) lines 10-22
- [`src/boot-game.ts`](../src/boot-game.ts) lines 287-322

Status:

- **Worked.**

This narrows the remaining problem to the persistence path rather than launch ingress.

### 7. The next failure moved to report persistence

Once replay start worked, the top-right perf banner started reporting failure states instead:

- at one point it showed a red failure message,
- later, after more fixes, the user reported it became green.

The likely failure point is this code path:

- `Game` calls `onReplayFinished`,
- `boot-game.ts` awaits `recorder.onReplayFinish()`,
- `PerfRecorder.onReplayFinish()` awaits `sink.emit(report)`,
- the banner becomes green only after that promise resolves.

Relevant files:

- [`src/game.ts`](../src/game.ts) replay finish path
- [`src/boot-game.ts`](../src/boot-game.ts) lines 256-269
- [`src/perf-recorder.ts`](../src/perf-recorder.ts) lines 260-279
- [`src/perf-sinks.ts`](../src/perf-sinks.ts) lines 15-36

Status:

- **Partially worked from the user’s perspective, but not fully verified on disk.**

### 8. Cross-origin save path looked suspicious, so CORS was added

The static Capacitor build uses `capacitor://localhost` as origin.

The bench harness intentionally passes an absolute `perfSink`, for example:

- `http://MacBook-Pro-75.local:5173/api/save-perf`

That creates a cross-origin POST from the app shell to the Mac dev server.

The original save middleware set:

- `Allow`,
- `Content-Type`,

but it did **not** set any CORS response headers.

Fix applied:

- add `Access-Control-Allow-Origin: *`
- add `Access-Control-Allow-Methods: POST, OPTIONS, HEAD`
- add `Access-Control-Allow-Headers: Content-Type`

Relevant file:

- [`vite-perf-plugin.ts`](../vite-perf-plugin.ts) lines 8-13

Status:

- **Reasonable fix and probably necessary.**
- It removed one obvious flaw in the save endpoint.
- It did **not** immediately produce a discoverable artifact on disk.

### 9. Raw IP vs `.local` hostname was tested

We also suspected ATS / local-network behavior could differ between:

- `http://192.168.x.x:5173/...`
- `http://MacBook-Pro-75.local:5173/...`

What we found:

- the `.local` endpoint responded correctly to a probe with `204 No Content`,
- the bench harness was already designed to prefer `MAC_HOSTNAME.local` when given a simple host name.

Relevant files:

- [`scripts/bench.sh`](../scripts/bench.sh) lines 63-73 and 107-119

Status:

- **Worked as a connectivity probe.**
- Did **not** by itself prove that the phone completed the save.

### 10. JS-side perf logs were added to distinguish fetch/start/finish failures

To stop guessing, we added explicit logs around:

- perf request start,
- replay fetch,
- replay start,
- replay finish success,
- replay finish failure.

Relevant file:

- [`src/boot-game.ts`](../src/boot-game.ts) lines 256-307

Status:

- **Helpful instrumentation.**
- This made the state machine easier to reason about.
- It did not, on its own, solve the missing-artifact problem.

### 11. A manual deep-link test page was added

We also created a tiny page with a `dubaimissile://perf?...` anchor to validate URL-scheme behavior without invoking the whole bench harness.

Relevant file:

- [`public/perf-test.html`](../public/perf-test.html)

Status:

- **Useful for manual ingress probing.**
- Not a final benchmark path.

### 12. The app was switched to a LAN dev-server shell for same-origin behavior

Because static Capacitor plus absolute `perfSink` was still suspicious, we switched tactics:

- set `CAP_DEV_SERVER=http://MacBook-Pro-75.local:5173`
- ran `npm run cap:sync`
- verified generated `ios/App/App/capacitor.config.json` now contains a `server.url`
- rebuilt and reinstalled the app

This means the installed shell should load the app from the LAN dev server directly instead of from `capacitor://localhost`.

That matters because:

- replay assets come from the same dev server,
- `/api/save-perf` should now also be same-origin,
- one entire class of cross-origin nonsense should disappear.

Relevant files:

- [`capacitor.config.ts`](../capacitor.config.ts) lines 1-18
- generated [`ios/App/App/capacitor.config.json`](../ios/App/App/capacitor.config.json)

Status:

- **Worked as configuration.**
- The generated config clearly switched to LAN mode.
- The user later reported the banner became green while using this general path.

### 13. Final observed user state: green banner, but no matching artifact found locally

The last meaningful user-facing update was:

- the top-right error was gone,
- the banner was green.

That strongly suggests the app believed the perf flow completed successfully.

However, immediately after that:

- no file matching `iphone-wave1-1776692618` was found under `perf-results/runs/`,
- no file matching that run id was found under `perf-results/latest/`,
- no new JSON files appeared under the repo after midnight except generated Capacitor config and existing replay fixtures.

Status:

- **User-visible success, host-visible artifact still unresolved.**

That is the key contradiction Opus should focus on.

## What Definitely Worked

These results were directly observed and are trustworthy.

1. `xcrun devicectl list devices` saw the phone and launches reached the device.
2. `npm run dev:lan` brought up a reachable host on port `5173`.
3. The `.local` save endpoint responded with `204` to a probe.
4. `devicectl --payload-url` did pass the deep link, but in process arguments.
5. Forwarding a URL from `argv` in `AppDelegate.swift` made `App.getLaunchUrl()` return the deep link in JS.
6. After rebuild/reinstall, the replay could start from a cold `devicectl` launch.
7. The top-right banner eventually turned green in a later run, which means at least one code path reached a success-looking terminal state.

## What Definitely Did Not Work

These paths failed clearly.

1. Relying only on `launchOptions[.url]` for cold-start `devicectl` launches.
2. Using the existing harness end-to-end without extra diagnosis; the app stayed on the title screen at first.
3. Trusting `scripts/perf-wait.mjs` during the session; it hit `EMFILE`.
4. Assuming a rebuilt local worktree meant the installed phone app was also updated.
5. Assuming the absence of CORS headers was harmless for `capacitor://localhost` to `http://.../api/save-perf`.

## What Is Still Ambiguous

This is the part worth handing to a heavier model.

1. Did the final green-banner run actually call `/api/save-perf`, or did it succeed through a different path than expected?
2. If it did call `/api/save-perf`, why is there no matching artifact under `perf-results/runs/` or `perf-results/latest/`?
3. Is the app shell definitely running the latest JS bundle when the user reports the banner state, or can an older shell still be in play?
4. Is there a mismatch between the run id we launched and the run id eventually emitted?
5. Is there a silent failure between `PerfRecorder.onReplayFinish()` and the Vite middleware write, despite the user-visible success state?

## Best Current Hypothesis

The launch problem was real and is now fixed.

The remaining bug is somewhere in the write/discovery leg, not the deep-link leg.

The most plausible buckets are:

1. `HttpSink.emit()` is resolving against the dev server in a way that does not actually write a report where we expect.
2. The app is emitting a report with a different `runId` or path than the one we searched for.
3. The user’s green banner came from a shell/config combination we did not correlate correctly with the host-side search.

Given the current evidence, I would have Opus focus on proving or disproving those three possibilities in that order.

## Suggested Next Steps For Opus

1. Add server-side request logging inside [`vite-perf-plugin.ts`](../vite-perf-plugin.ts) around:
   - request method,
   - parsed `runId`,
   - chosen `runPath`,
   - chosen `latestPath`,
   - write success / caught error.
2. Add an explicit `console.log` inside [`src/perf-sinks.ts`](../src/perf-sinks.ts) before and after the `fetch()` call in `HttpSink.emit()`.
3. Consider adding a temporary query-controlled dual sink in [`src/boot-game.ts`](../src/boot-game.ts):
   - still POST to `/api/save-perf`,
   - also `console.log("PERF_REPORT_V1", ...)` for the same run id.
4. If push still lies to us, add a file-based fallback sink and pull the report from the app sandbox with `devicectl`.

## Useful Commands We Ran

These are the commands that materially informed the investigation.

```bash
# Start the LAN dev server expected by the harness
npm run dev:lan

# Verify the connected phone exists
xcrun devicectl list devices

# Inspect launch semantics
xcrun devicectl help device process launch

# Probe the save endpoint over .local
curl -sS -I --max-time 5 http://MacBook-Pro-75.local:5173/api/save-perf

# Build static iOS web assets
npm run build:ios

# Sync Capacitor assets/config
npm run cap:sync

# Switch the installed app to LAN dev-server mode
CAP_DEV_SERVER=http://MacBook-Pro-75.local:5173 npm run cap:sync

# Build for the connected iPhone
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination id=<xcodebuild-ios-destination-id> \
  -derivedDataPath /tmp/dmc-ios-build-wave1 build

# Install the rebuilt app
xcrun devicectl device install app --device <devicectl-device-id> \
  /tmp/dmc-ios-build-wave1/Build/Products/Debug-iphoneos/App.app

# Launch a cold-start perf run
xcrun devicectl device process launch --device <devicectl-device-id> \
  com.phejet.dubaicmd --terminate-existing \
  --payload-url 'dubaimissile://perf?replay=perf-wave1&autoquit=1&runId=<runId>'
```

## Bottom Line

The investigation did produce hard progress.

The payload URL ingress bug is understood and patched. The phone can now start the replay from a cold `devicectl` launch, which it could not reliably do at the start of the session.

The remaining issue is narrower but still unresolved: the final host-side perf artifact either is not being written, is being written somewhere unexpected, or is being written under a run id/path we have not yet captured.

That is the real handoff point.
