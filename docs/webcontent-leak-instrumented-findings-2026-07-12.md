# WebContent Leak: Instrumented Findings (2026-07-12)

Follow-up to [`death-clip-webcontent-kill-handover.md`](./death-clip-webcontent-kill-handover.md).
Status: kill pattern **quantified**, native memory probe **shipped and validated on device**,
leak **located to two distinct rates** (steady per-wave + violent per-clip-loop).

> **Update, 2026-07-12 (latest): clip-loop leak root-caused and fixed.** See
> [Root cause: sky-asset rebuild per GameState](#root-cause-sky-asset-rebuild-per-gamestate)
> at the bottom. Needs on-device re-validation against the acceptance criteria.

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

## Root cause: sky-asset rebuild per GameState

Found with a new browser-side probe (`scripts/death-clip-leak-probe.ts`) that mounts the
real death clip in Chromium with an instrumented WebGL context and diffs live GL
resources + live 2d canvases (by creation stack) across clip loops. Per-loop growth
pointed at one stack: `buildSkyAssets` via `getGameplaySkyAssets`.

The mechanism:

1. `buildSkyAssets` (`src/art-render.ts`) bakes **8 full-screen 900×1600 canvases**
   (~46 MB of canvas backing; another ~46 MB once uploaded as GL textures ≈ **92 MB per
   rebuild**).
2. The cache in `src/canvas-render-resources.ts` was keyed on the **identity of
   `game.stars`** — and every fresh `GameState` allocates a new stars array. Each
   death-clip loop creates a fresh runner state (`createReplayRunner` /
   `cloneReplayStateAnchor`), so **every loop re-baked the entire sky set**. Same for
   every new run, and the game-over scene's `getGameplaySkyAssets([], …)` call thrashed
   the single cache slot from the other side.
3. The replaced Pixi textures were never destroyed. Pixi's texture system keeps managed
   sources alive, so both the superseded GL textures and their source canvases were
   retained — invisible to every JS-side counter, exactly matching the "counters look
   innocent while the compressor fills" signature on device.

The fix (same commit as this update):

- `src/canvas-render-resources.ts` — gameplay sky cache is now one slot **per groundY**,
  keyed by **star content** (fast path: array identity). Re-created-but-identical stars
  (every clip loop; every re-watch of the same replay, which reuses the run's seed) now
  hit the cache instead of re-baking.
- `src/pixi-textures.ts` — when a sky source genuinely changes (a new run's stars), the
  superseded frame textures are destroyed (`destroy(true)`), releasing GL memory and the
  canvas references.

Probe numbers (4 clip loops, `perf-wave4-upgrades` fixture): before — GL texture memory
93→124→140→151 MB, +2 canvases/loop, unbounded. After — 93→113→118→118 MB (plateau =
lazy first-bind uploads of the shared 8-frame set), live canvases flat at every sample.

Re-run it with:

```bash
npm run dev   # terminal 1
npx tsx scripts/death-clip-leak-probe.ts 5   # terminal 2
```

## Codebase sweep for the same bug class (2026-07-12)

The sky bug is a compound of two patterns: (a) a cache keyed on **object identity** fed
by per-`GameState` objects, and (b) **replaced GPU/canvas resources never destroyed**.
After the fix, the rest of the runtime was swept for both patterns. Result: **no other
instance of the leak class exists**; two bounded structural risks were identified.

Checked and clean:

- **All other `PixiTextureResources` / `canvas-render-resources` getters** (burj,
  launchers, threats, interceptors, upgrade projectiles, buildings, defense sites,
  planes, effects): every call site in `pixi-render.ts` passes compile-time-constant
  keys (fixed scales / groundY / baseY) and runs at scene-build time, not per frame.
  Their sources never change identity, so the (still-present) destroy-on-replace gap in
  `pixi-textures.ts` can never fire for them. The sky getter was the only one fed a
  per-`GameState` object on a per-frame path.
- **`COLOR_HEX_CACHE`** (`pixi-render.ts`, string-keyed, fed by `particle.color` /
  `explosion.color` every frame): every color the sim generates is a static literal or
  `COL.*` constant — no interpolated strings, cache is bounded.
- **Water band sub-textures** (`createPixiWaterSurface`): explicitly destroyed via a
  `container.once("destroyed")` hook.
- **Burj decal / damage-FX / entity node maps**: mark-and-sweep with `destroy()` on
  removal; backing sim arrays are capped (`MAX_PARTICLES = 500`, trails shift at 12–21
  points, decals bounded by Burj HP + repair consumption).
- **Replay anchors** (`game.ts`): sanitized clones (`_actionLog`/checkpoints stripped),
  capped at 24.
- **Audio**: the `transientNodes: 348` game-over outlier from Finding 2 is a burst, not
  a leak — `audio-node-lifecycle.ts` disconnects every transient node after a 3 s TTL;
  348 is one death-carnage SFX volley inside a single TTL window.
- **PNG / smoke-particle bundles**: loaded through Pixi `Assets`, cached by alias across
  renderer instances.
- **Death-clip mount/unmount cycle**: probed 4 mount→cleanup cycles in Chromium — JS
  heap, DOM nodes, and event listeners all flat. The cleanup path genuinely releases.

Two structural risks (bounded — no unbounded growth, but they consume the same
WebContent headroom the leak used to exhaust):

1. **Every death-clip mount builds a full second texture set.** The clip's
   `PixiRenderer` constructs its own `PixiTextureResources`, so every gameover — and
   every run-recap / progression toggle, since `closeRunRecap()` remounts the clip —
   re-creates and re-uploads the whole gameplay sprite set into a fresh GL context
   (~70–90 MB transient spike, freed on cleanup). That spike lands exactly where the
   deep-run kills did (Finding 1: dead between `mount` and `renderer-create`). Cheapest
   mitigation: pass the main renderer's `textures` instance into the clip renderer.
2. **Prebake baseline: ~550 sprite canvases ≈ 380 MB of logical RGBA kept forever.**
   Every prebaked canvas stays alive as a Pixi texture source after GPU upload (needed
   today only for WebGL context restore). Against a ~2 GB per-process kill line that is
   ~20% of the budget spent at boot. Releasing canvas backing after upload (accepting a
   re-bake on context restore) is the biggest single lever for device headroom.

## Second root cause: destroy({ children: true }) leaks Graphics GPU geometry (2026-07-15)

On-device testing of the sky fix (deployed to the iPhone) reproduced a kill once more:
several death-clip loops (now cheap) followed by several **full replay watches**, with the
WebContent kill landing during the last watch. The full-replay path is effectively a live
game (primary renderer + SFX + 30 tps sim) — the path of the still-open steady per-wave
leak, which the death-clip probe never exercised.

A new probe (`scripts/replay-leak-probe.ts`) watches a replay repeatedly via
`__loadReplay` and samples GL resources per wave and per watch. Post-sky-fix it showed
canvases, textures, and heap flat — but **GL buffers climbing steadily during playback**
(26 → 58 buffers, 1.9 → 6.4 MB across three watches of the single-wave
`perf-wave4-upgrades` fixture), created via `GlGeometrySystem.initGeometryVao` and never
deleted. Buffer-creation-stack attribution put the growth on `GlGraphicsAdaptor.execute`:
render-data batcher geometries for **non-batchable Graphics** (≥400 vertices — e.g.
per-entity trail-dot Graphics, whose ~430-vertex circles cross the threshold).

The mechanism, in Pixi 8.18.1's `Graphics.destroy(options)`:

```js
destroy(options) {
  if (this._ownedContext && !options) {          // only when options is FALSY
    this._ownedContext.destroy(options);
  } else if (options === true || options?.context === true) {
    this._context.destroy(options);
  }
  ...
}
```

Calling `destroy({ children: true })` — which every entity-node teardown in
`pixi-render.ts` did — hits **neither branch**: the owned `GraphicsContext` is never
destroyed, its pooled `GraphicsContextRenderData` (a `DefaultBatcher` owning a
`BatchGeometry`) is never returned, and Pixi's GC-managed hashes keep the GL buffers +
VAO alive forever. One geometry pair leaks per destroyed non-batchable Graphics — i.e.
per enemy killed with a long trail. That is the steady, playtime-proportional leak.
(A bare `graphics.destroy()` is fine — micro-repro of create/render/destroy ×60 returned
everything; only the options-object form leaks.)

Fix: `DESTROY_NODE_OPTIONS = { children: true, context: true }` used at all 11 destroy
sites in `pixi-render.ts` (entity node maps, `destroyChildren`, `clearGameplayScene`).
`context: true` is ignored by non-Graphics children and does not touch shared textures.

Verified with pool accounting (patching `BigPool` in-page): pre-fix the
`GraphicsContextRenderData` pool ratcheted monotonically (outstanding 1→7 over 160 ticks,
zero free entries, watch-over-watch buffer growth); post-fix returned entries appear and
get reused (pool stabilizes at live concurrency, e.g. count 4 with free/reuse cycling).

## Third root cause: Pixi's idle GC leaks GL objects instead of freeing them (2026-07-15)

After the destroy-options fix, per-context probing showed GL buffers *still* growing in
the main renderer's context (+12/watch) with the render-data pool provably static
(0 new `GraphicsContextRenderData` constructions; boundary accounting `outstanding: 0`,
full reuse). A geometry-uid probe closed the case: **8 REINITs of already-known
`BatchGeometry` uids per watch, zero new geometry objects, zero GL deletes ever** — the
same geometries kept losing their per-renderer GPU data and re-creating VAOs + buffers.

The bug, in Pixi 8.18.1's `GCSystem` (enabled by default: sweep every 30 s, unload
resources idle > 60 s):

```js
// GCSystem.runOnHash — sweep of each GCManagedHash's items
hashValue[key] = null;      // slot nulled FIRST
...
resource.unload();          // then unload → emits "unload"
```

```js
// GCManagedHash.remove — the "unload" listener that does the real GL free
remove(item) {
  if (!this.items[item.uid]) return;   // ← slot already null → early return
  this._onUnload?.(item);              //   gl.deleteBuffer / deleteVertexArray /
  ...                                  //   deleteTexture never runs
}
```

`Buffer.unload()` / `Geometry.unload()` / `TextureSource.unload()` then wipe their own
`_gpuData`, so the next bind re-creates a fresh GL object. Net effect: **every resource
the idle GC sweeps is a permanent GPU-memory leak** — buffers, VAOs, and GL textures
alike. On the phone this is a multiplier on everything measured before: during
death-clip loops on the game-over screen the entire gameplay texture set idles past
60 s, gets swept-and-leaked, and is fully re-uploaded on the next run or replay watch;
pooled graphics geometries cycle the same way during play.

Fix: `gcActive: false` at renderer init in `pixi-render.ts`. The game's GPU population
is bounded (prebaked sprite sets + capped entity pools) and the app's destroy paths now
free explicitly, so the idle sweep provided nothing but the leak.

## Still open

- On-device validation against the acceptance criteria above (multi-wave run + repeated
  clip loops + repeated full-replay watches, watching `hostFreeMB`/`hostCompressedMB`).
- The two structural risks above, in that order, if deep-run mount kills persist.
- Report upstream to PixiJS: (a) the `GCSystem.runOnHash` null-before-unload GL leak,
  (b) the `Graphics.destroy({ children: true })` owned-context leak. Re-check both on
  any Pixi upgrade — and re-evaluate `gcActive: false` if (a) is fixed upstream.
