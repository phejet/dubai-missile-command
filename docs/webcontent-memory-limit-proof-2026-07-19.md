# WebContent 2 GB Memory-Limit Kill: Direct iOS Proof (2026-07-19)

Status: **termination cause proven; dominant memory baseline identified; no retained
per-repetition application resource reproduced locally**.

This report records the July 19 iPhone failure in which the infinite five-second
death-window player completed 22 repetitions and then returned to the title screen during
repetition 23. It correlates the game's exported JSONL diagnostics with the iPhone's unified
system log.

The result is no longer an inference from application behavior: the iOS kernel explicitly
recorded that the game's `com.apple.WebKit.WebContent` process exceeded its 2,048 MB hard
limit and killed it with reason `per-process-limit`.

This report supersedes any wording that treats the cause of this specific failure as
uncertain. A follow-up deep dive also corrects the initial interpretation of the final
65.9-second interval: it does **not** prove that each repetition leaked 49 MB. That interval
crossed a background memory-relief and foreground-resume boundary. Controlled Chromium and
WebKit probes now show the cached-anchor loop's JavaScript objects, canvases, WebGL resources,
and local WebKit process memory reaching a plateau. The strongest remaining explanation is
extreme baseline pressure from retained canvas raster sources plus ordinary collector/allocator
high-water growth, with only about 389 MB of headroom left at wave 6.

Related history:

- [`death-clip-webcontent-kill-handover.md`](./death-clip-webcontent-kill-handover.md) — the
  original application-level termination proof and earlier 1,978 MB Jetsam evidence.
- [`webcontent-leak-instrumented-findings-2026-07-12.md`](./webcontent-leak-instrumented-findings-2026-07-12.md)
  — the original sky-texture leak, its fix, and the remaining bounded renderer risks.

## Executive conclusion

At `2026-07-19 12:02:14.192 AEST`, the iOS kernel logged:

```text
memorystatus: com.apple.WebKit.WebContent [2752] exceeded mem limit:
ActiveHard 2048 MB (fatal)
```

Seven milliseconds later it classified the kill and recorded the footprint:

```text
memorystatus: killing_specific_process pid 2752 [com.apple.WebKit.WebContent]
(per-process-limit 100 65s rf:- type:app) 2097202KB
```

`2,097,202 KB / 1,024 = 2,048.05 MiB`, matching the configured 2,048 MB active hard limit.

The native Capacitor app process, PID 2750, remained alive. RunningBoard removed only
WebContent PID 2752 and launched replacement WebContent PID 2775 29–36 ms after the kernel
kill. Capacitor then reloaded the page in the replacement process. The game's new JavaScript
boot started 158 ms after the kernel kill and naturally initialized the title screen.

The same unified log contains WebKit footprint evidence:

| Time (AEST)         | WebContent evidence                                              |
| ------------------- | ---------------------------------------------------------------- |
| 11:53:42.080        | `phys_footprint_mb: 1659`                                        |
| 12:00:07.520        | post-relief `res+swap = 1,940,047,848` bytes = about 1,850.2 MiB |
| 12:02:14.192–14.199 | hard-limit kill at 2,048 MB / 2,097,202 KB                       |

The app resumed at 12:01:08 and the kill occurred about 65.9 active seconds later. Using
the last post-relief sample as the lower bound, WebContent retained approximately 198 MiB
over that final active interval:

```text
2,048.05 MiB - 1,850.17 MiB = 197.88 MiB
197.88 MiB / 65.94 s = 3.00 MiB/s
3.00 MiB/s × 16.25 s per normal repetition = about 48.8 MiB/repetition
```

The measurements are not sampled at identical semantic boundaries. The arithmetic is valid
for the two endpoints, but `48.8 MiB/repetition` is **not** a valid steady-state leak rate:
the lower endpoint was captured after background relief, and there is no footprint sample at
the actual resume boundary. The interval proves only that the process moved from the
post-relief value to the hard limit while foreground work resumed. It cannot divide that
movement cleanly among page re-faulting, allocator high-water, garbage-collection timing, and
the four partial/full repetitions in the interval.

## Reproduction and environment

### Device and build

- Device: Alex's iPhone 15 Pro (`iPhone16,1`, 8 GB physical RAM).
- Device OS reported by CoreDevice: iOS 26.5.2, build `23F84`.
- App bundle: `com.phejet.dubaicmd`.
- Game build: `e1a2c53+e2d2b631`.
- Diagnostics export:
  `/Users/phejet/Downloads/dmc-diagnostics-1784426623565.jsonl`.
- App boot containing the failure: `mrr5444k-3v3dzj`.
- Replacement app boot after reload: `mrr5hhvy-qt89gc`.
- Native app PID: 2750.
- Original WebContent PID: 2752.
- WebKit Networking PID: 2751.
- WebKit GPU PID: 2753.
- Replacement WebContent PID: 2775.

The JavaScript user-agent string reported `iPhone OS 18_7`; the connected device's
CoreDevice record is the authoritative OS version for this report.

### Player-visible sequence

1. Infinite replay was enabled from Options.
2. A human run reached wave 10 and ended at simulation tick 9250.
3. The game mounted an auto-looping 300-tick death window from tick 8951 through tick 9251.
4. Repetitions 1–18 completed normally.
5. Repetition 19 was interrupted by the app going into the background, then completed
   after resume.
6. Repetitions 20–22 completed normally.
7. Repetition 23 completed its cached-anchor seek in 6 ms and began playback.
8. About 9.2 seconds into repetition 23, the screen reset to the title.

The five-second label describes 300 simulation ticks at 60 Hz. The clip intentionally
plays in slow motion: most ticks advance at 30 frames per second and the final 60 ticks at
15 frames per second. Normal measured wall time was 16.13–16.36 seconds, averaging 16.25
seconds. The 22 completed repetitions therefore represent roughly six minutes of active
death-window playback, not 110 wall-clock seconds.

## Application diagnostics timeline

All timestamps below are AEST on July 19, 2026.

| Time         | Boot / sequence | Event                                                                  |
| ------------ | --------------- | ---------------------------------------------------------------------- |
| 11:51:49.989 | old seq 0       | JavaScript `session-start`, build `e1a2c53+e2d2b631`                   |
| 11:51:58.718 | old seq 5       | `game:start-request` from title                                        |
| 11:51:58.733 | old seq 6       | screen `title -> playing`                                              |
| 11:55:05.614 | old seq 16      | wave-10 `resources:snapshot`, reason `gameOver`, tick 9250             |
| 11:55:05.624 | old seq 17      | primary gameplay scene released                                        |
| 11:55:05.624 | old seq 18      | screen `playing -> gameover`                                           |
| 11:55:05.626 | old seq 19      | auto-loop death clip mounted, ticks 8951–9251                          |
| 11:55:05.630 | old seq 20      | death-clip renderer created once                                       |
| 11:55:05.642 | old seq 22      | death-clip renderer ready                                              |
| 11:55:21.959 | old seq 24      | repetition 1 complete                                                  |
| 12:00:04.843 | old seq 78      | app became inactive during repetition 19                               |
| 12:00:06.355 | old seq 82      | document hidden                                                        |
| 12:01:08.249 | old seq 83      | document visible                                                       |
| 12:01:08.276 | old seq 84      | native resume                                                          |
| 12:01:16.175 | old seq 86      | repetition 19 complete after the background interruption               |
| 12:01:32.395 | old seq 89      | repetition 20 complete                                                 |
| 12:01:48.765 | old seq 92      | repetition 21 complete                                                 |
| 12:02:05.001 | old seq 95      | repetition 22 complete                                                 |
| 12:02:05.002 | old seq 96      | repetition 23 cached seek started                                      |
| 12:02:05.007 | old seq 97      | repetition 23 seek finished at tick 8951 in 6 ms; final old-boot event |
| 12:02:14.350 | new seq 0       | fresh JavaScript `session-start`, same app build                       |
| 12:02:14.350 | new seq 1       | `unclean-shutdown`, previous boot `mrr5444k-3v3dzj`                    |
| 12:02:14.425 | new seq 2       | fresh initialization records `title -> title`                          |
| 12:02:14.640 | new seq 3       | `pageshow` on title                                                    |

No old-boot event exists between repetition 23's `seek-end` and the new boot. In
particular, there is no:

- screen transition out of game over;
- `pagehide` or clean session marker;
- app background or inactive transition near the kill;
- death-clip cleanup;
- replay abort or divergence;
- JavaScript `window-error`;
- unhandled promise rejection;
- WebGL context-loss event;
- return-to-title action.

The app log therefore correctly established an abrupt JavaScript process boundary, but it
could not name the native termination reason because the logger lived inside the process
being killed.

## Direct iOS system proof

### WebContent process creation and hard limit

The original WebContent process started at 11:51:49.698. RunningBoard assigned PID 2752
and recorded both active and inactive limits as 2,048 MB:

```text
2026-07-19 11:51:49.698 runningboardd ...
[com.apple.WebKit.WebContent ... :2752] Memory Limits: active 2048 inactive 2048

2026-07-19 11:51:49.701 runningboardd ...
[com.apple.WebKit.WebContent ... :2752] set Memory Limits to Hard Inactive (2048)
```

### Early high footprint and unsuccessful relief

At 11:53:42, less than two minutes after gameplay started and between the wave-6 and
wave-7 snapshots, WebKit received a process memory-pressure notification. System-wide VM
pressure was not critical, but WebContent already reported a 1,659 MB physical footprint:

```text
2026-07-19 11:53:42.079 App ... [com.apple.WebKit:MemoryPressure]
WebContent[2752] Received memory pressure event: 16, system vm pressure critical: 0

2026-07-19 11:53:42.080 App ... [com.apple.WebKit:MemoryPressure]
WebContent[2752] phys_footprint_mb: 1659
```

The same warning emitted a rare allocation-category snapshot. This is the most useful
ownership evidence in the system archive:

| WebKit / VM statistic             |   Value |
| --------------------------------- | ------: |
| JavaScript GC heap capacity       |  506 MB |
| JavaScript GC heap size           |  469 MB |
| JavaScript GC `extra_memory_size` |  457 MB |
| JavaScript GC object count        | 146,044 |
| WebKit `internal_mb`              |  356 MB |
| dirty `CG raster data`            |  232 MB |
| dirty unclassified tag 0          |  243 MB |
| dirty `bmalloc`                   |  133 MB |
| dirty `Gigacage`                  |   16 MB |
| compressed memory                 |    9 MB |

These categories overlap in their accounting and must not be summed into a second footprint.
Their diagnostic value is composition: the process had hundreds of megabytes in JavaScriptCore
external-memory accounting and CoreGraphics raster backing before the death clip even existed.

The adjacent `res+swap` total was 1,739,998,992 bytes, or about 1,659.4 MiB, agreeing with
the explicit footprint line. WebKit attempted repeated relief passes, but their before and
after totals were generally flat or only slightly reduced. This is consistent with a large
amount of retained or allocator-owned memory that ordinary pressure relief could not
return.

### Background relief and final active growth

When the app went into the background around 12:00:06, WebKit made a more material relief
pass:

```text
2026-07-19 12:00:06.420 App ... [com.apple.WebKit:MemoryPressure]
Memory pressure relief: ... res+swap = 1992706024/1962985448/-29720576

2026-07-19 12:00:07.520 App ... [com.apple.WebKit:MemoryPressure]
Memory pressure relief: ... res+swap = 1940047848/1940047848/0
```

The last value is about 1,850.2 MiB. The document became visible again at 12:01:08.249.
WebContent then executed the remainder of repetition 19, all of repetitions 20–22, and
about 9.2 seconds of repetition 23.

At 12:02:14.192, 65.943 seconds after visibility resumed, the kernel applied the hard
limit:

```text
2026-07-19 12:02:14.192 kernel ... [com.apple.xnu:memorystatus]
memorystatus: com.apple.WebKit.WebContent [2752] exceeded mem limit:
ActiveHard 2048 MB (fatal)

2026-07-19 12:02:14.192 kernel ... [com.apple.xnu:memorystatus]
memorystatus: killing process 2752 [com.apple.WebKit.WebContent]
in high band FOREGROUND (100) - memorystatus_available_pages: 97835

2026-07-19 12:02:14.199 kernel ... [com.apple.xnu:memorystatus]
memorystatus: killing_specific_process pid 2752 [com.apple.WebKit.WebContent]
(per-process-limit 100 65s rf:- type:app) 2097202KB
```

The kernel named the process, configured limit, fatal disposition, foreground priority,
termination reason, and final footprint. This is direct proof of a private per-process
limit, not an inference from general system pressure.

### Native shell survival and immediate replacement

RunningBoard reported the old WebContent process's death, then started replacement PID
2775:

```text
2026-07-19 12:02:14.202 runningboardd ...
WebContent ... :2752 termination reported by launchd (1, 7, 9)

2026-07-19 12:02:14.228 runningboardd ...
start succeeded, info=running, pid=2775

2026-07-19 12:02:14.230 runningboardd ...
[com.apple.WebKit.WebContent ... :2775] Memory Limits: active 2048 inactive 2048
```

The host app remained PID 2750 throughout. Only its WebContent child changed from PID 2752
to PID 2775. This rules out a native app crash or a complete app relaunch. Capacitor's
standard `webViewWebContentProcessDidTerminate` handler resets its bridge and reloads the
existing `WKWebView`, which explains the fresh JavaScript boot and title initialization.

### Cross-log timing correlation

| Relative to kernel kill | Evidence                                                       |
| ----------------------- | -------------------------------------------------------------- |
| -9,185 ms               | repetition 23 `seek-end`, final event from old JavaScript boot |
| 0 ms                    | kernel: PID 2752 exceeded `ActiveHard 2048 MB (fatal)`         |
| +7 ms                   | kernel: `per-process-limit`, footprint 2,097,202 KB            |
| +10 ms                  | RunningBoard: PID 2752 termination reported                    |
| +36 ms                  | replacement WebContent PID 2775 started                        |
| +158 ms                 | new JavaScript `session-start` and `unclean-shutdown`          |
| +233 ms                 | new boot initializes title                                     |
| +448 ms                 | new boot records `pageshow` on title                           |

The two independent clocks align to the millisecond-scale sequence expected from a
WebContent hard-limit kill followed by Capacitor reload.

## Why there is no July 19 Jetsam `.ips`

Apple's CoreDevice `systemCrashLogs` domain was listed recursively over the wired device
connection. It contained 110 files. The newest stored Jetsam report was:

```text
JetsamEvent-2026-07-18-035045.ips
```

There was no July 19 crash report, Jetsam report, or `SystemMemoryReset` report matching
the 12:02 failure.

The absence of an `.ips` file does not mean the kill was not memory-related. In this case,
the retained unified log supplies the stronger evidence: the kernel's `memorystatus`
subsystem explicitly classified the kill as `per-process-limit`. A WebKit child-process
hard-limit termination may be recorded in unified logging without producing a standalone
Jetsam report in the user-accessible crash-report domain.

This distinction explains the earlier uncertainty:

- The game diagnostics could prove only an abrupt WebContent-style reload.
- The stored crash-report directory had no matching artifact.
- The retained unified system log still held the definitive kernel event.

## Renderer and replay evidence from the app log

The application counters do not show the retained memory owner.

### Primary gameplay release worked

At game over, the primary renderer reported:

```text
before release: activeRenderers=1, entityNodes=19, pools populated
after release:  activeRenderers=1, entityNodes=0, pools=null
```

The original Pixi application and WebGL context remained alive, as required by the
iPhone-proven context-lifecycle constraint, but its gameplay display objects and pools were
released before the death clip mounted.

### Death-clip renderer was created once

The clip mounted at 11:55:05.626. `renderer-create` occurred once, 4 ms later, and
`renderer-ready` occurred 13 ms after creation. No later `renderer-create` exists for the
22 completed repetitions or the incomplete repetition 23.

This rules out one new Pixi renderer or WebGL context per repetition.

### Cached replay seek worked

Repetition 1 sought from the wave-10 anchor and cached an exact clip-start anchor at tick 8951. Every subsequent repetition reused that cached anchor. Repetition seeks took 3–8 ms,
including 6 ms immediately before the kill.

This rules out re-simulating the complete run on every repetition. It does not rule out
allocation churn from cloning the cached anchor into a new runner state.

### All completed renderer snapshots were identical

Every `death-clip:play-complete` event from repetition 1 through repetition 22 reported the
same logical resource snapshot:

| Counter                   |         Value |
| ------------------------- | ------------: |
| active renderers          |             2 |
| death renderer mode       | gameplay-only |
| context lost              |         false |
| gameplay scene generation |             1 |
| entity nodes              |            19 |
| particle Graphics objects |             1 |
| particle instructions     |           243 |
| fire flames               |            81 |
| fire cores                |            81 |
| fire embers               |           188 |
| fire smoke                |           114 |

EMP, laser, and Phalanx pools stayed at zero in the clip renderer. There was no growth in
the counted scene generation, display entities, or effect pools.

The flat counters and rising process footprint are not contradictory. These counters
describe logical application objects. They do not measure:

- JavaScriptCore heap arenas retained after objects become unreachable;
- repeated `structuredClone` backing allocations;
- canvas pixel backing stores;
- decoded image or texture-source memory;
- WebGL and WebKit graphics bookkeeping charged to WebContent;
- Pixi-managed resources not exposed by `getResourceStats()`;
- allocator fragmentation or pages not returned to the operating system.

The kernel charged the final 2 GB footprint specifically to WebContent PID 2752, not the
separate WebKit GPU process PID 2753. That narrows the accounting boundary but does not, by
itself, distinguish JavaScript heap from canvas/texture source memory or WebKit internal
allocations.

## Follow-up deep dive: allocation owner and boundedness

The first version of this report stopped at the kernel proof and treated the final active
interval as evidence for an approximately 49 MiB-per-repetition residual leak. The follow-up
investigation tested that hypothesis directly. Result: the kill is unquestionable, but a
retained application resource growing by 49 MiB every repetition is not supported.

### One cached-anchor repetition, from first principles

The loop has four ownership boundaries:

1. `mountRunRecapDeathClip()` creates one gameplay-only `PixiRenderer`. It is not recreated
   between repetitions.
2. The first seek reaches the clip start and caches one sanitized `ReplayStateAnchor`.
3. Every later repetition calls `createReplayRunnerFromAnchor()`. Its `init()` performs one
   `structuredClone` of the cached game state.
4. At the next restart, the previous runner is dereferenced and the renderer remains alive.

`ReplayRunner.cleanup()` currently resets the module-global RNG but does not explicitly set
its closed-over `GameState` to `null`. That is worth tightening defensively, but it is not a
retaining root by itself: after `runner` and `seekingRunner` are replaced, no live callback,
promise, or collection points back to the old closure. Forced garbage collection confirmed
that those states are collectible.

The replay's event sink is also narrower than the live game event sink. The death-window
handler only auto-completes `waveBonusStart`; it does not call `SFX`. Repeated Web Audio node
creation is therefore not part of this workload.

The renderer-side audit found:

- one gameplay scene generation for all repetitions;
- entity maps that delete and destroy nodes no longer present in the current state;
- stable pools for particles and Burj fire;
- one particle `Graphics` object cleared and rebuilt each frame;
- content-keyed gameplay sky caching, so cloned-but-identical `stars` arrays reuse the same
  baked source canvases;
- no render-path call into the simulation RNG;
- no new renderer, canvas, audio context, or scene per repetition.

### The browser probe had to be repaired before its result was trustworthy

The existing `scripts/death-clip-leak-probe.ts` had drifted behind the product in four ways:

1. The clip now auto-loops by default, while the probe expected a stable `complete` boundary
   and a click to begin the next sample.
2. Its old perf fixture did not contain an explicit death `finalTick`; deriving the boundary
   from the last action could begin the supposed death window after replay termination.
3. current headless Chromium selected Pixi's `CanvasRenderer` unless SwiftShader WebGL was
   explicitly enabled. A trace reporting zero WebGL objects was therefore measuring no
   WebGL at all.
4. Mounting a deep replay without the nearby wave anchor hit the 1.5-second seek timeout.
   The apparent repetition boundaries were static fallbacks at 240-tick seek chunks, not
   completed 300-tick death windows.

The repaired probe now:

- generates a current seed-114 full replay and reconstructs its actual terminal tick;
- constructs a browser-side anchor at tick 11,435;
- plays the real 300-tick interval through tick 11,735;
- sets `autoLoop:false` only to create stable sampling boundaries;
- asserts and prints the Pixi backend;
- instruments live WebGL allocations, source canvases, JS/DOM metrics, and local browser
  process RSS;
- supports forced-GC and natural-GC modes;
- runs against both Chromium and Playwright WebKit.

This matters because every one of the stale-probe failure modes could produce a clean-looking
but irrelevant result. The corrected runs below exercise the same cached-anchor lifecycle as
the phone.

### Chromium, forced garbage collection

Five complete WebGL repetitions were sampled after an explicit collection at each boundary:

| Boundary    | JS heap | live GL textures | estimated GL texture bytes |
| ----------- | ------: | ---------------: | -------------------------: |
| after mount | 16.1 MB |              167 |                    76.3 MB |
| loop 1      | 13.9 MB |              252 |                   134.6 MB |
| loop 2      | 15.7 MB |              252 |                   134.6 MB |
| loop 3      | 15.8 MB |              252 |                   134.6 MB |
| loop 4      | 15.9 MB |              252 |                   134.6 MB |
| loop 5      | 15.9 MB |              252 |                   134.6 MB |

The first loop lazily uploads assets used by the terminal scene. After that, buffer count,
texture count, texture bytes, framebuffers, programs, vertex arrays, source canvases, DOM
listeners, and logical renderer pools all plateau. The old replay states return to a roughly
14–16 MB heap after collection. This rules against a reachable JavaScript runner/anchor leak
and against live WebGL object growth in the corrected path.

### Chromium, natural garbage collection

Forced collection can hide allocator high-water behavior, so the same path ran for eight
repetitions without requesting GC:

| Boundary | JS heap |
| -------- | ------: |
| loop 1   | 17.6 MB |
| loop 2   | 27.5 MB |
| loop 3   | 30.6 MB |
| loop 4   | 23.3 MB |
| loop 5   | 16.7 MB |
| loop 6   | 22.4 MB |
| loop 7   | 23.4 MB |
| loop 8   | 16.7 MB |

This exposes the real allocation pattern. Each repetition creates garbage, the heap expands,
and the collector periodically returns it to the earlier live size. WebGL stayed fixed at 252
textures / 134.6 MB for every sampled repetition. There is churn and heap high-water, but no
monotonic live-object slope in Chromium.

### Local WebKit, including OS process RSS

Playwright WebKit 26.0 then ran eight anchored repetitions without a forced collector. WebKit
does not expose Chromium's CDP heap metrics, so the probe sampled the actual macOS RSS of its
WebContent and GPU child processes in addition to the instrumented WebGL objects:

| Boundary    | WebContent RSS |  GPU RSS | live GL textures | GL texture bytes |
| ----------- | -------------: | -------: | ---------------: | ---------------: |
| after mount |       546.7 MB | 272.4 MB |              131 |          72.5 MB |
| loop 1      |       556.7 MB | 360.9 MB |              251 |         129.1 MB |
| loop 2      |       567.7 MB | 373.0 MB |              252 |         134.6 MB |
| loop 3      |       568.8 MB | 373.4 MB |              252 |         134.6 MB |
| loop 4      |       569.0 MB | 374.0 MB |              252 |         134.6 MB |
| loop 5      |       569.2 MB | 373.8 MB |              252 |         134.6 MB |
| loop 6      |       569.5 MB | 373.9 MB |              252 |         134.6 MB |
| loop 7      |       571.2 MB | 374.0 MB |              252 |         134.6 MB |
| loop 8      |       496.8 MB | 374.1 MB |              252 |         134.6 MB |

WebKit shows the same pattern more dramatically:

- first-use GPU uploads are front-loaded into loops 1–2;
- live WebGL resources are exactly flat after loop 2;
- WebContent RSS rises only about 14.5 MB from loop 1 through loop 7;
- a natural collection/reclamation before the loop-8 sample drops WebContent RSS by about
  74.4 MB, below its after-mount value;
- the GPU process plateaus near 374 MB rather than growing once per repetition.

Local WebKit is not iOS WebKit and does not reproduce iPhone memory accounting perfectly.
It is nevertheless strong negative evidence for a normal JavaScript/Pixi ownership leak in
this code path. The same engine family can collect the temporary runner/render allocations,
and its native process family reaches a plateau.

### The dominant baseline: 556 live canvases / 381.6 MiB of raster backing

The corrected WebKit probe found 556 live source canvases whose logical RGBA backing totals
381.6 MiB. They are flat across every repetition and remain referenced after the death-clip
renderer is destroyed because the shared prebake caches are process-lifetime caches.

Largest families:

| Canvas family     | Count | Logical RGBA bytes |
| ----------------- | ----: | -----------------: |
| gameplay skies    |    16 |           87.9 MiB |
| title sky         |     8 |           43.9 MiB |
| threat sprites    |    99 |          180.5 MiB |
| Burj assets       |    39 |           31.4 MiB |
| building assets   |   270 |           12.4 MiB |
| death-clip canvas |     1 |            5.5 MiB |
| all canvases      |   556 |          381.6 MiB |

The logical byte calculation is simply `width × height × 4`; it is not a claim that every
page is simultaneously resident. Its correspondence with the device warning is the important
part:

- local live source canvases: 381.6 MiB;
- device JavaScriptCore `extra_memory_size`: 457 MB;
- device dirty `CG raster data`: 232 MB;
- device WebContent footprint by wave 6: 1,659 MB.

JavaScriptCore uses external-memory accounting for large host objects such as canvas backing.
The numbers are close enough, and the allocation stacks specific enough, to identify prebaked
canvas sources as a dominant permanent owner. They do not explain every byte of the 1,659 MB
footprint, but they explain why a seemingly small JS application enters the death window with
very little private-process headroom.

### Why the 48.8 MiB/repetition estimate is not a leak measurement

The exact timeline is:

1. WebContent was 1,659 MB during wave 6 at 11:53:42.
2. Game over occurred at 11:55:05.
3. The clip completed 18 repetitions and entered repetition 19 before backgrounding.
4. Immediately before background relief, `res+swap` was about 1,900.4 MiB.
5. Background relief reduced it to about 1,850.2 MiB.
6. The app remained hidden for about 62 seconds.
7. After resume it completed the remainder of loop 19, loops 20–22, and part of loop 23.
8. The kernel killed WebContent at 2,048.0 MiB.

Subtracting step 5 from step 8 and dividing by foreground loop time mixes background purging,
page re-faulting, foreground restoration, normal heap high-water, and loop allocation. The
calculation describes an interval average, not one repeated allocation. Across the much longer
wave-6-to-kill interval, total growth was about 389 MiB and included four more gameplay waves,
death-clip renderer warm-up, background/foreground transitions, and 22 completed loops.

The system archive contains only one detailed VM-tag snapshot, at wave 6. It therefore cannot
say which category supplied the last 389 MiB. It can say that the process was already
dangerously large before the alleged loop leak began.

### Current cause assessment

Confidence-ranked conclusions:

1. **Certain:** the title reset was WebContent's 2,048 MB hard-limit kill and Capacitor reload.
2. **High confidence:** the app had a severe permanent memory-baseline problem. Hundreds of
   retained prebaked canvas sources are the largest application-controlled owner directly
   correlated with JavaScriptCore external memory and CoreGraphics raster tags.
3. **High confidence:** the corrected cached-anchor loop does not retain a new JS runner,
   source canvas, WebGL texture, renderer, scene, listener, or audio graph each repetition in
   Chromium or local WebKit.
4. **Medium confidence:** death-window churn and WebKit allocator/collector high-water supplied
   the final trigger. Local WebKit temporarily grows WebContent RSS before reclaiming it; iOS
   began from 1.66–1.90 GB, where one delayed collection or re-fault burst can cross 2 GB.
5. **Medium confidence:** the second renderer's warm-up is a large bounded spike, not a loop
   leak. Local WebKit GPU RSS rose about 101.5 MB by loop 2 and then stayed flat.
6. **Unknown:** the exact VM category responsible for the final post-resume 198 MiB, because no
   second VM-tag snapshot exists at resume or kill.

In plain language: this looks less like a dripping pipe and more like a laboratory bench
already loaded to 90% of its rated mass. Replaying the explosion supplies allocation churn;
eventually WebKit fails to shed enough weight before the kernel's very humorless scale reaches
2,048 MB.

## What is proven

The following statements are direct facts from the two logs:

1. The game did not intentionally navigate to title.
2. No JavaScript exception, rejection, replay divergence, or context-loss event preceded
   the failure.
3. The native Capacitor app process survived.
4. iOS killed only `com.apple.WebKit.WebContent` PID 2752.
5. The kill reason was `per-process-limit`.
6. The enforced active hard limit was 2,048 MB.
7. The final recorded footprint was 2,097,202 KB, effectively exactly that limit.
8. WebContent had already reached 1,659 MB during wave 6/7.
9. The last post-relief total before resume was about 1,850 MiB.
10. The replacement WebContent process started immediately and Capacitor reloaded the page.
11. The game's next JavaScript boot detected the prior boot as unclean and initialized
    title.
12. Twenty-two death-window repetitions completed with identical logical renderer
    counters and one reused clip renderer.

## What is strongly supported but not byte-perfect proof

The final active interval proves that WebContent moved from a post-relief state to the hard
limit while foreground work resumed:

- last lower-bound footprint: about 1,850.2 MiB;
- final footprint: about 2,048.0 MiB;
- elapsed active time after resume: about 65.9 seconds;
- endpoint difference: about 197.9 MiB.

There is no exact footprint sample at resume. The 1,850.2 MiB value followed a background
relief pass, and local WebKit demonstrates that this workload can expand and later reclaim
tens of megabytes without retaining new live resources. Dividing the endpoints by loop count
therefore overstates what the data says.

What is strongly supported is a headroom failure: the 1,659 MB wave-6 footprint, 457 MB of
JavaScriptCore external-memory accounting, 232 MB of dirty CoreGraphics raster data, and the
381.6 MiB local canvas inventory all point to a very large permanent raster baseline. Bounded
death-window warm-up and ordinary allocation high-water then operate inside the remaining
small margin.

## What remains unknown

The logs do not provide a second VM-tag snapshot near the kill. Open questions are:

1. How much of the 1,659 MB device footprint is charged canvas backing versus other WebKit
   internal or IOSurface accounting?
2. Which VM category grew between the wave-6 warning and the final kill?
3. Did the post-resume interval primarily re-fault previously purged canvas pages, expand JSC
   arenas, or retain iOS-specific graphics bookkeeping?
4. How much would WebContent footprint fall if canvas sources were released after texture
   upload and regenerated only for context restoration?
5. How much of the bounded second-renderer warm-up is charged back to WebContent on iOS rather
   than solely to the GPU process?

The previously fixed sky-asset cache bug was real and severe. Its removal materially raised
the failure threshold from roughly 2–3 loops in comparable deep runs to 22 loops here. This
new evidence shows that fix removed the unbounded live-resource slope. It did not remove the
roughly 382 MiB canvas-source baseline or guarantee enough iOS headroom for bounded warm-up and
collector high-water.

## Most discriminating next experiments

The broad loop-retention hypothesis is now tested locally. The next experiments should attack
the dominant baseline and measure bounded warm-up separately.

### 1. Canvas-source release prototype

In a diagnostic branch, release or downsize prebaked source-canvas backing after Pixi confirms
texture upload. On context restoration, regenerate the source rather than keeping all 381.6
MiB resident for the process lifetime.

Measure:

- live canvas logical bytes;
- local WebKit WebContent RSS;
- first render and context-restore correctness;
- death-window renderer warm-up;
- visual equality for sky, threats, buildings, and Burj assets.

This is the highest-leverage experiment because it targets the only application-controlled
owner directly matching the device's JSC-extra and CG-raster categories.

### 2. Separate the second renderer's bounded cost

Add a pre-mount sample to the probe, then compare:

- title/main renderer only;
- clip renderer constructed but no frame rendered;
- first clip frame;
- loop 1 completion;
- loop 2 completion;
- clip cleanup.

The existing local WebKit trace says GPU warm-up is roughly 101.5 MB and plateaus. A precise
boundary trace will show whether sharing Pixi resource descriptors, reusing the primary
renderer, or lowering the clip's asset surface can reduce that spike.

### 3. Future iOS validation only as an explicit test run

No conclusion in this report depends on the phone's current foreground state. If a future
device test is explicitly authorized, capture WebContent footprint and VM categories at exact
semantic boundaries: wave start, game over, clip mount, first frame, loops 1/2/5/10/20, and
after a controlled background/resume. Without those boundaries, another endpoint division
will merely manufacture a handsome but fictional per-loop rate.

The in-app `MemoryProbePlugin` cannot read the separate WebContent task. Suitable external
sources are DVT/Instruments process monitoring, Safari Web Inspector, and a retained unified
logarchive with WebKit `MemoryPressure` category output.

### 4. Persist the native WebContent termination callback

Add a native breadcrumb when Capacitor receives
`webViewWebContentProcessDidTerminate`. Persist it outside WebContent and import it into the
next diagnostics boot. This will make future exports explicitly say that WebContent died,
although the callback alone still does not provide Apple's memory reason. The unified log
or a Jetsam report remains necessary to prove `per-process-limit`.

## Acceptance criteria for the eventual fix

A candidate is not complete merely because one deep run survives longer. It must satisfy:

1. WebContent footprint reaches a stable plateau across at least 50 cached-anchor
   death-window repetitions after a wave-10 run.
2. Per-repetition memory deltas converge toward zero after warm-up.
3. The same clip renderer and primary WebGL context remain visually valid on iPhone.
4. No fresh JavaScript boot or title reload occurs.
5. The kernel log contains no `ActiveHard` or `per-process-limit` event for the game's
   WebContent process.
6. A normal human run, full replay, retry, Run Recap, and death-window loop still render
   correctly.
7. Existing renderer resource counters remain bounded, and the direct WebContent footprint
   agrees rather than hiding another unmeasured slope.

## Evidence acquisition procedure

The phone was connected by USB, unlocked, paired, and in Developer Mode. CoreDevice
reported a wired transport and available Developer Disk Image services.

### Enumerate stored crash reports

```bash
xcrun devicectl device info files \
  --device 6C19BA9A-F629-5B20-889F-CC800E832A43 \
  --domain-type systemCrashLogs \
  --recurse \
  --columns '*'
```

This proved that no matching July 19 `.ips` existed.

### Pull retained unified logs

Apple's full `devicectl device sysdiagnose` path requested the Mac administrator password.
No password was entered into automation. Instead, `pymobiledevice3` 9.36.0 was installed in
a temporary `/tmp` virtual environment and used its no-admin iOS userspace tunnel:

```bash
/tmp/dmc-pymobiledevice3-venv/bin/pymobiledevice3 syslog collect \
  /tmp/dmc-iphone-logs.SQuc2Y/system_logs.logarchive \
  --userspace \
  --mobdev2 \
  --start-time 1784425500 \
  --size-limit 268435456
```

The resulting archive occupied about 273 MB on disk.

### Query the kill window

```bash
/usr/bin/log show \
  --archive /tmp/dmc-iphone-logs.SQuc2Y/system_logs.logarchive \
  --start '2026-07-19 12:01:55' \
  --end '2026-07-19 12:02:25' \
  --info \
  --debug \
  --style compact \
  --predicate 'eventMessage CONTAINS[c] "WebView process terminated" OR
    (process == "runningboardd" AND
      (eventMessage CONTAINS "2752" OR eventMessage CONTAINS "2775")) OR
    (process == "kernel" AND subsystem == "com.apple.xnu" AND
      category == "memorystatus")'
```

A second query covered 11:50–12:02 and filtered PID 2752 memory-pressure and footprint
events to reconstruct the trajectory.

### Re-run the corrected local probe

With the Vite server running on port 5173:

```bash
# Chromium WebGL, forced collection at each repetition boundary
GAME_URL=http://127.0.0.1:5173/dubai-missile-command/ \
  PROBE_RECORDED_SEED=114 \
  npx tsx scripts/death-clip-leak-probe.ts 5

# Chromium WebGL, natural collector/high-water behavior
GAME_URL=http://127.0.0.1:5173/dubai-missile-command/ \
  PROBE_RECORDED_SEED=114 \
  PROBE_FORCE_GC=0 \
  npx tsx scripts/death-clip-leak-probe.ts 8

# Local WebKit, natural collection plus WebKit process RSS
GAME_URL=http://127.0.0.1:5173/dubai-missile-command/ \
  PROBE_RECORDED_SEED=114 \
  PROBE_BROWSER=webkit \
  PROBE_FORCE_GC=0 \
  npx tsx scripts/death-clip-leak-probe.ts 8
```

The WebKit run requires `npx playwright install webkit` once. Each run overwrites the ignored
`leak-probe-results.json` artifact with full allocation stacks and process rows.

## Artifact handling and privacy

Local evidence at the time of writing:

- App diagnostics:
  `/Users/phejet/Downloads/dmc-diagnostics-1784426623565.jsonl` (~599 KB).
- Unified iPhone logarchive:
  `/tmp/dmc-iphone-logs.SQuc2Y/system_logs.logarchive` (~273 MB).
- Compact extracted proof:
  `/tmp/dmc-iphone-logs.SQuc2Y/webcontent-memory-kill-proof.txt`.
- Temporary USB tooling:
  `/tmp/dmc-pymobiledevice3-venv`.
- Last local browser-probe result:
  `/Users/phejet/projects/dubai-missile-command/leak-probe-results.json` (ignored, overwritten
  per run).

The raw unified archive can contain device names, account-related metadata, network
information, and other private system activity. It must not be committed. This report
retains only the narrow process, timestamp, memory, and lifecycle evidence required for the
engineering investigation.

The `/tmp` artifacts are ephemeral and may disappear after cleanup or reboot. This Markdown
report is the committed, privacy-minimized forensic record.
