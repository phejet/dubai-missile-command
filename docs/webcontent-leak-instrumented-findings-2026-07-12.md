# WebContent Leak: Instrumented Findings (2026-07-12)

Follow-up to [`death-clip-webcontent-kill-handover.md`](./death-clip-webcontent-kill-handover.md).
Status: kill pattern **quantified**, native memory probe **shipped and validated on device**,
leak **located to two distinct rates** (steady per-wave + violent per-clip-loop). The leak
itself is still unfixed.

Evidence: two diagnostics exports from the same iPhone 15 Pro (8GB), one day of play:

- `dmc-diagnostics-1783862364788.jsonl` — pre-probe, 18 boots, includes a wave-12 run
- `dmc-diagnostics-1783864490039.jsonl` — first run on the probe build (`869cc60+eb5d58dd`)

Both are local (`~/Downloads/`), not committed.

## Finding 1: the deeper the run, the earlier in the death-clip flow the kill lands

Every session that reached game over eventually lost its WebContent process. What varies
with run depth is _when_. From the pre-probe export (build sha per boot in the log):

| Time  | Wave reached | Kill point                                                          |
| ----- | ------------ | ------------------------------------------------------------------- |
| 20:03 | 2            | never killed during clip — 7 full replay loops survived             |
| 22:00 | 6            | replay-click starting loop 3                                        |
| 15:57 | 7            | 178ms after replay-click on loop 3 (original repro in the handover) |
| 19:11 | 7            | mid-playback of loop 1, ~8s after seek-end                          |
| 16:57 | 8            | between `mount` and `renderer-create` (a ~5ms window)               |
| 19:24 | 9            | 288ms after mount, despite `reuseCanvas`/`reuseRenderer: true`      |
| 23:19 | 12           | 323ms after mount, before `renderer-create`                         |

The wave-12 case is the extreme: `death-clip:mount` logged at 23:19:17.767, no
`renderer-create` (normally 3–8ms later), fresh `session-start` 323ms after mount with
`unclean-shutdown` recovery. The player experiences this as "game terminated on completion
instead of showing the death clip."

Two implications:

- Baseline memory grows with run length; the death-clip is only the final allocation spike.
  At wave 2 the clip loops indefinitely; at wave 12 the mount itself is fatal.
- The renderer-reuse experiment (build `971ccfe+36704e77`) did **not** save a wave-9 run,
  so the mount-time spike is not primarily the second Pixi renderer.

## Finding 2: the sim/renderer/audio counters do not see the leak

The wave-12 game-over snapshot looked innocent: 491 particles, 28 entity nodes, modest
pools. Whatever holds the ~2GB is not counted by any existing JS-side counter. (One
outlier worth remembering: audio `transientNodes: 348` at that game over, vs ~30–60 during
normal waves.)

## The instrument: native memory probe

Built 2026-07-12 in response: `ios/App/App/MemoryProbePlugin.swift` (registered via
`MainViewController` — Capacitor 8 has no plugin auto-scan) + JS bridge
`src/memory-probe.ts`.

Design constraints, learned from the kill anatomy:

- **The WebContent process is not inspectable** from the app process (no task port, no
  public API) and WebKit exposes no `performance.memory`. The probe reports **host-wide**
  free/inactive/compressed memory — where WebContent's growth is visible as draining free
  pages and a rising compressor — plus the app process's own footprint/headroom as a
  control line (jetsam forensics had the app at 12 MB vs WebContent at 1,978 MB).
- **Critical log lines cannot wait on a bridge round-trip** — the wave-12 kill landed
  323ms after mount. A background interval samples every 2s while diagnostics is enabled;
  `resources:snapshot`, `death-clip:mount`, and `death-clip:replay-click` embed the last
  cached sample synchronously as `memory: {..., ageMs}`.

Also fixed: the crash-recovery ring buffer (`src/diagnostics-ring.ts`) truncated entries
at 512 bytes, which clipped exactly the renderer/pool tail off recovered resources
snapshots. Now 2048.

## Finding 3 (instrumented run): two leak rates

First capture on the probe build, 23:51–23:54, death at wave 10, one full clip loop, then
a replay tap that killed WebContent 201ms later. `appFootprintMB` stayed at 11 the whole
run — the Capacitor shell is innocent. Host-wide picture:

| Point            | hostFreeMB | hostCompressedMB |
| ---------------- | ---------- | ---------------- |
| wave 1           | 391        | 503              |
| wave 4           | 144        | 500              |
| wave 6           | 100        | 499              |
| wave 7           | 72         | 551              |
| wave 8           | 224 ⁽¹⁾    | 589              |
| wave 10 gameOver | 233        | 624              |
| replay tap ⁽²⁾   | **43**     | **680**          |

⁽¹⁾ The wave-8 "recovery" is iOS purging page cache / background apps under pressure
(inactive dropped 2839→2722 MB at the same moment) — the system fighting to keep the game
alive, not the game releasing memory.
⁽²⁾ Sample age 314ms; kill 201ms after the line was written.

Two distinct rates:

1. **Steady play leak, ~50 MB/wave**: free drains 391→72 across waves 1–7 with the
   compressor flat; from wave 7 the compressor climbs (+125 MB by game over), meaning the
   growth is cold, un-reclaimable pages — consistent with the jetsam capture's
   `purgeable: 0`.
2. **Clip playback leak, ~15 MB/s**: between the game-over snapshot and the replay tap
   16s later, one 14-second clip loop burned ~190 MB of free memory and pushed 56 MB into
   the compressor (~250 MB per loop). This retroactively explains the original repro:
   three loops survived from a lower baseline, the fourth tap died.

## Next steps

1. **Hunt the clip-playback leak first** (~15 MB/s, reproducible on demand, small code
   surface): the death-clip render loop (`src/run-recap-death-clip.ts`), replay runner
   ticking, the gameplay-only second renderer, and SFX fired during replay. The
   `transientNodes: 348` outlier puts un-reclaimed WebAudio nodes on the suspect list
   alongside per-frame Pixi allocations.
2. Optionally sharpen the instrument: embed `memory` in `death-clip:play-complete`,
   `seek-end`, and `cleanup` to get exact per-loop deltas in the next export.
3. Steady per-wave leak second; Safari Web Inspector heap snapshots per wave
   (`webContentsDebuggingEnabled` is already on) once the clip leak is fixed or ruled out
   as the same root cause.

Acceptance criteria unchanged from the handover: bounded memory across a multi-wave run
plus repeated clip loops, and no fresh bootId after death-clip taps in the diagnostics log.
