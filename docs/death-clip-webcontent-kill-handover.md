# Handover: Death-Clip "Kick to Title" Root Cause + Memory Leak Hunt

Date: 2026-07-12. Status: root cause **confirmed**; fix (the memory leak hunt) **not started**.
Diagnostics infrastructure shipped in commit `9bc20d7`.

## TL;DR

The iPhone bug where tapping the death clip kicks the player back to the title screen is
**not a navigation bug**. iOS terminates the game's WKWebView content process at a native
level, and Capacitor's controller reloads the page — a fresh JS boot that lands on title.
The trigger is memory: the game's WebContent process was measured at **1,978 MB resident**,
54× the largest WebView of a commercial app running eight of them. The next task is finding
and fixing that leak.

## Evidence 1: on-device diagnostics log (the smoking gun)

Repro captured 2026-07-12 with the new Diagnostics logging feature
(`dmc-diagnostics-1783835910072.jsonl`, exported from device). Boot `mrhdqnon-9vyuca`:
play session, death at wave 7, death clip looping.

| t (rel) | event                                                                 |
| ------- | --------------------------------------------------------------------- |
| 0ms     | `death-clip:replay-click` seq 19, status `complete`, loop 3 — the tap |
| +178ms  | `session-start` with a brand-new bootId (`mrhdualg-8zcu3t`)           |
| +224ms  | `screen:change title→title` (fresh boot initializing)                 |
| +359ms  | `app:pageshow` on title                                               |

That is exactly the pattern defined for "WebView restarted": tap → new boot → title.
The new boot reported `unclean-shutdown` for the previous session and recovered all 8
critical ring entries. Before death there was **no pagehide, no returnToTitle, no
screen:change out of gameover, and no JS error**. Boot 1's JavaScript ceased to exist
mid-thought: it logged the tap and never reached the `seek-start` it emits 1ms later on
every previous restart (loops 2 and 3 show `replay-click` → `seek-start` in the same
millisecond).

A JS exception would have hit the global `window-error` handler; there is nothing. The app
process did not relaunch (no springboard transition) — only the WebView content process
died, and Capacitor reloaded the page. The kill landed on the **4th** clip restart, after
three full 300-tick loops of end-of-run particle carnage — the classic shape of memory
ratcheting up per loop until WebKit executes its child.

## Evidence 2: jetsam forensics (the memory scale)

Pulled from the device via `pymobiledevice3 crash pull` (USB cable + unlocked phone
required; `devicectl` Wi-Fi visibility is not enough). `JetsamEvent-2026-07-11-112751.ips`,
iPhone 15 Pro (8GB), the day before the instrumented repro:

| process                             | coalition | resident                                                             |
| ----------------------------------- | --------- | -------------------------------------------------------------------- |
| `App` (our Capacitor shell)         | **8906**  | 12 MB                                                                |
| `com.apple.WebKit.WebContent` 30839 | **8906**  | **1,978 MB** (lifetimeMax ~1,995 MB, 45k pages swapped, purgeable 0) |
| realestate.com.au (8 WebViews)      | 9080      | largest WebContent: 36 MB                                            |

Same coalition ID = that WebContent belongs to the game. It was the largest process on the
entire phone while _suspended in the background_. `lifetimeMax ≈ rpages` means it grew and
stayed (not a transient spike), and `purgeable: 0` means none of it was reclaimable caches.

Important: the day-of-repro kill wrote **no JetsamEvent and no crash log**. Per-process
WebKit memory-limit kills are silent — absence of a jetsam file does not acquit memory.
The host app only observes `webViewWebContentProcessDidTerminate` (which Capacitor handles
by reloading).

## Ruled out

- Navigation misfire (`returnToTitle`, stray `screen:change`) — no such events pre-death.
- JS exception — global `error`/`unhandledrejection` handlers logged nothing.
- Full app crash / jetsam of the app process — app stayed alive; only the WebView reloaded.
- System-wide memory pressure at repro time — no JetsamEvent that day; this was a
  per-process limit kill.

## Next task: the leak hunt

Goal: find why the WebContent process grows to ~2GB during a session (wave 7 reached in
the repro run; the log's death clip is 300 ticks starting at tick 5028).

Prime suspects, in suggested audit order:

1. **Pixi render caching** (`src/pixi-render.ts`, `src/art-render.ts`) — render-time asset
   caches, textures, and render targets that may never be destroyed or grow per
   wave/entity/effect.
2. **Replay anchor snapshots** (`src/replay-anchor.ts`, replay bookkeeping in `GameState`)
   — anchors serialize sim state per wave; check retention and per-run growth.
3. **Death-clip loop state** (`src/run-recap-death-clip.ts`) — each tap re-seeks a
   `ReplayRunner`; the kill happened on the 4th restart. The renderer is created once per
   mount (log shows no `renderer-create` after restarts), so suspicion falls on sim-state
   and particle accumulation per loop rather than renderer duplication.

Measurement tools:

- **Safari Web Inspector memory timeline** against the device build —
  `webContentsDebuggingEnabled: true` is already set in `capacitor.config.ts`. Mac Safari →
  Develop → the iPhone → the game → Timelines → Memory. Play a wave or two, watch the
  slope; heap snapshots before/after a death-clip loop and before/after a wave.
- **Diagnostics logging** (Options → Diagnostics, `src/diagnostics-log.ts`) — every
  `clientLog` call site now lands in an on-device JSONL with bootId/seq envelope; Share
  Diagnostics exports via the share sheet. Note WebKit exposes no `performance.memory`, so
  JS-side heap numbers are not available; a native memory sampler would need a small
  Capacitor plugin (not built).
- Deploy with `python3 scripts/ios_deploy.py --launch`; verify the build marker at the
  bottom of the Options menu (git sha + dirty hash) before trusting device behavior.

Acceptance for the fix: WebContent resident memory stays bounded across a multi-wave run
plus repeated death-clip loops (measure via Web Inspector), and the on-device repro (play →
die → loop the clip → tap restarts repeatedly) no longer produces a new bootId in the
diagnostics log.

## Artifacts

- Diagnostics export: `~/Downloads/dmc-diagnostics-1783835910072.jsonl` (local, not committed)
- Jetsam log: `JetsamEvent-2026-07-11-112751.ips` (on device; pull via `pymobiledevice3`)
- Diagnostics feature: `src/diagnostics-log.ts`, `src/diagnostics-store.ts`,
  `src/diagnostics-ring.ts`, dispatcher in `src/client-log.ts` (commit `9bc20d7`)
