# iPhone Death-Clip Investigation & Fix Strategy

**Status:** investigation complete; instrumentation landed; fix not yet implemented.
**Date:** 2026-05-31
**Symptom (reported):** On iPhone the end-of-game "last 5 seconds before death" clip
sometimes doesn't play, or gets stuck on "Preparing final seconds…". Web version is fine.

---

## 1. What the death clip actually is

`mountRunRecapDeathClip` (`src/run-recap-death-clip.ts`) is **not a recording**. It is a
live re-simulation. To show the final five seconds it:

1. Builds a fresh replay runner via `createReplayRunner(replay, …)` and calls `init()`
   (runner is now at tick 0).
2. Calls `seekRunnerToTick(runner, startTick, …)` where `startTick = finalTick - 300`
   — i.e. it **re-simulates the entire run from tick 0** up to 300 ticks before death.
3. Plays the final 300 ticks (5 s @ 60 fps) by stepping the seeked runner one tick per
   animation frame.
4. On completion, waits 900 ms and **loops** by calling `restartClip()` — which throws
   the runner away and returns to step 1.

The seek is deliberately throttled so it doesn't freeze the UI: each animation frame it
runs `min(240 steps, 7 ms)` worth of sim, whichever limit hits first
(`src/replay-seek.ts:58-64`).

```
restartClip() ──► createRunnerAtTick(replay, startTick)   [Phase 1: SEEK from tick 0]
                    └─ createReplayRunner + init()  (tick 0)
                    └─ seekRunnerToTick → startTick  (throttled 240 steps / 7ms per frame)
                 ──► render loop                          [Phase 2: PLAY 300 ticks]
                    └─ one step() per animation frame
                 ──► complete → wait 900ms → restartClip() [LOOP: back to Phase 1]
```

---

## 2. Root cause: seek throughput is budget-bound, and the iPhone CPU loses the budget

The seek inner loop stops on whichever comes first: 240 steps **or** 7 ms of wall time
per animation frame.

- **Desktop:** 240 sim steps fit comfortably inside 7 ms, so you get ~240 steps/frame.
  A full run's seek finishes in a handful of frames — sub-perceptible.
- **iPhone:** a single sim step (spawning, physics, collisions) is far heavier on the
  mobile CPU. You might fit only ~10–20 steps inside the 7 ms window before the budget
  trips. So effective seek throughput is roughly **10–20× slower** than desktop.

For a deep run (tens of thousands of ticks) that turns "Preparing final seconds…" into a
multi-second — sometimes tens-of-seconds — grind. To a player that is indistinguishable
from "stuck". Intermittency tracks **run depth**: short runs seek fast, deep runs stall.

### Why the loop makes it worse

`restartClip()` rebuilds from tick 0 **every loop iteration** (`run-recap-death-clip.ts`,
the `restartTimer` → `restartClip()` path). So after each 5-second playback the clip drops
_back_ to "Preparing…" for another full re-simulation. The stall isn't a one-time cost; it
recurs on every loop. (To be precise: this is _between_ playbacks, not during them —
playback itself is one cheap `step()` per frame and never re-seeks.)

### Two symptoms, one cause

- **"Stuck on preparing replay"** = deep run, first seek (or a loop-restart seek) takes
  long enough to look frozen.
- **"Last 5 seconds don't play"** = the clip is still seeking when the player looks / moves
  on, or is mid-loop-restart.

---

## 3. What was ruled out

- **Hung renderer promise.** `PixiRenderer.initialize()` _catches its own error_ and
  resolves anyway (`src/pixi-render.ts:1610`). `readyPromise` therefore always resolves —
  a rejected/never-resolving renderer promise is **not** the cause of the stuck spinner.
  (On init failure you'd get a blank clip with status hidden, not a permanent "Preparing".)
- **Short-replay edge case.** Already handled: a replay that _ends early_ exits the seek
  and renders the best reached state (`src/run-recap-death-clip.test.ts:112`).
- **No watchdog.** The only "don't get stuck" protection is for replays that end early.
  A seek that is merely _slow_ has **no timeout** — it grinds through every tick. This is a
  gap, not the root cause, but it converts "slow" into "looks permanently stuck".

---

## 4. Why it re-simulates from zero instead of rewinding

This is the crux question. The answer is architectural, not negligence:

### 4a. The runner is forward-only

`createReplayRunner` (`src/replay.ts`) exposes exactly two relevant moves:

- `init()` → resets to tick 0
- `step()` → advance one tick

There is **no** `rewind`, `seekTo`, or snapshot/restore. So when the loop needs the runner
back at `startTick`, re-running from tick 0 is _the only rewind mechanism that exists_.
It's brute force, but it's the only force available.

### 4b. The RNG state lives in a module global, not in GameState

The seeded RNG is a module-level closure, not part of `GameState`:

```ts
// src/game-logic.ts
let _rng: RNG = Math.random; // line 245
export function setRng(fn: RNG) {
  _rng = fn;
}
export function getRng(): RNG {
  return _rng;
}
```

`init()` does `setRng(mulberry32(seed))` (`src/replay.ts:56`). Every spawn / explosion /
target pick draws from that global closure (`game-logic.ts:268, 282, 501, …`).

Consequence: even a naive `structuredClone(state)` snapshot at `startTick`, restored each
loop, would **diverge** — the next `step()` would pull randomness from wherever the global
mulberry32 cursor happens to be, not from where it was when the snapshot was taken. A
correct snapshot must also capture the RNG's internal position, which the current code does
not surface.

### 4c. So: is there a good reason?

- **Defensible:** re-sim-from-seed is the simplest thing that is _provably, deterministically
  correct_ with zero extra cloning code. For a desktop-first game where the seek is
  sub-frame, "simplest correct thing" is a reasonable engineering call. Nobody paid the
  cost until a slower CPU sent the invoice.
- **But still wrong for iPhone:** the cost is real, recurring, and was invisible only
  because no one profiled on device.

### 4d. The enabling fact for the fix

`mulberry32`'s entire state is a **single 32-bit integer**. So the RNG _is_ trivially
snapshottable — the engine simply doesn't expose `getState()/setState()` today. Adding that
is the keystone primitive both fix tiers depend on.

---

## 5. Instrumentation added (this session)

Chosen log-collection channel: **POST to the dev server**, reusing the existing perf
plumbing (`/api/save-perf`, `/api/perf-command`). The live-reload iOS shell loads the page
from the LAN dev server, so a relative URL resolves there and logs stream into the
`npm run dev:lan` terminal.

**Files touched:**

- `vite-perf-plugin.ts` — new `/api/save-device-log` endpoint. CORS identical to
  `/api/save-perf`; appends JSONL to `perf-results/device-logs/<YYYY-MM-DD>.jsonl`; prints a
  compact `[device-log] <channel>/<event> k=v …` line to the dev console.
- `src/client-log.ts` — fire-and-forget `clientLog(channel, event, data)` + `clientLogEnabled()`.
  Dev-only; silent in tests (`import.meta.env.MODE === "test"`) and production. Force on/off
  with `localStorage["dmc:clientLog"] = "1" | "0"` or `?clientLog=1`. Swallows all errors so
  diagnostics can never break a run.
- `src/run-recap-death-clip.ts` — lifecycle events:
  `mount` (finalTick, run depth, UA) · `renderer-create` · `renderer-ready`
  (sinceCreateMs) · `seek-start` (loop #, startTick) · throttled `seek-progress`
  (**ticksPerSec** — the number that proves the hypothesis) · `seek-end` / `seek-abandoned`
  (durationMs, reachedTick, reason) · `play-complete` (durationMs, lastTick) · `cleanup` ·
  plus `window.error` / `unhandledrejection`.
- `.gitignore` — ignore `perf-results/device-logs/`.

**Local verification done:** `curl` POST → `{"ok":true}`, file appended, console line
printed; `tsc --noEmit` clean; `run-recap-death-clip.test.ts` + `run-recap-replay-events.test.ts`
green.

**To capture on device:**

1. `npm run dev:lan -- --port 5173 --strictPort`
2. `npm run ios:dev`, Run from Xcode
3. Play to death; watch the `dev:lan` terminal for `[device-log] death-clip/…`
4. Compare iPhone `seek-progress.ticksPerSec` vs a desktop run (`?clientLog=1`). If iPhone
   shows a few hundred ticks/sec where desktop shows thousands → hypothesis confirmed.

---

## 6. Fix strategy (two tiers, shared keystone)

Both tiers need the same two primitives: a **sanitized `GameState` clone** + **RNG-state
capture/restore**.

### Tier 1 — Minimal: snapshot at startTick, restore on loop

When the first seek completes, capture `{ clonedState, rngState }`. Each loop restores that
instead of re-simulating from zero.

- Kills the **loop** waste (every restart after the first is instant).
- Leaves the **first** seek cost intact (still re-sims from tick 0 once).

### Tier 2 — Full: wave-start anchor (preferred; see anchor plan)

Snapshot sim state at each wave start. On game over, build the clip runner from the latest
wave-start anchor and replay only the current wave up to `finalTick - 300`.

- Kills **both** the first seek and the loop restarts: you replay one wave, not the whole run.
- Detailed design lives in `tasks/todo.md` ("iPhone Death-Clip Anchor Snapshot Plan").

### Regardless of tier — add a watchdog

No unbounded waiting on `Promise.all([rendererReady, seekPromise])`. After ~1500 ms, fall
back to the best available / static final frame so "Preparing final seconds…" can never
remain visible indefinitely.

### Keystone work item (blocks both tiers)

1. Expose `getState()/setState()` (or equivalent) on the `mulberry32` RNG so its 32-bit
   cursor can be snapshotted and restored.
2. Add a sanitized `GameState` clone helper that strips non-cloneable runtime handles
   (`_laserHandle`, `_browserLaserHandle`, bot/weak refs), preserves `Set` fields
   (`ownedUpgradeNodes`) and entity `targetRef` identity.

---

## 7. Key references

| Concern                             | Location                                       |
| ----------------------------------- | ---------------------------------------------- |
| Death clip mount / seek / loop      | `src/run-recap-death-clip.ts`                  |
| Seek throttle (240 steps / 7 ms)    | `src/replay-seek.ts:23,58-64`                  |
| Forward-only runner (`init`/`step`) | `src/replay.ts:36,47,56`                       |
| RNG global closure + `setRng`       | `src/game-logic.ts:245-250`                    |
| `mulberry32` (single-int state)     | `src/headless/rng.ts`                          |
| Renderer init swallows error        | `src/pixi-render.ts:1579-1616`                 |
| Device-log endpoint                 | `vite-perf-plugin.ts` (`/api/save-device-log`) |
| Client logger                       | `src/client-log.ts`                            |
| Anchor fix plan                     | `tasks/todo.md`                                |
