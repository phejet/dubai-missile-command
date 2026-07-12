# Replay Divergence — Root-Cause Fix Plan

> **Audience:** the implementer (human or model). This is a handoff spec.
> **Status:** planned, not implemented. Line numbers are as of 2026-07-12; re-verify before editing.
> **Supersedes / amends:** `docs/replay-convergence-guard-plan.md` on branch
> `claude/replay-divergence-validation-8ca7s2`. That spec's guard is adopted here as
> **Phase 3**, with amendments. Its comparison methodology (§3.2 there) was independently
> verified by code trace and is correct. Its diagnosis (§1 there) is wrong — see below.

---

## 1. Problem statement and proven root cause

Replays are action-log + seed re-simulation. There are **three** simulation drivers:

| Path                       | Driver                                      | Bonus-screen behavior                                                                   |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Live play (browser/iPhone) | `game.ts` `startRenderLoop()` accumulator   | **Keeps ticking** while bonus screen is up                                              |
| Headless recording         | `runGame()` in `src/headless/sim-runner.ts` | No bonus screen (`onEvent` null → `_bonusScreenDone` set instantly, `game-sim.ts:2105`) |
| Replay playback            | `createReplayRunner()` in `src/replay.ts`   | **Pauses**, then **jumps the tick counter** over the gap                                |

The user-reported divergence ("skipped frames at wave end / shop interaction, sometimes
other reasons") is **not** in the `runGame` ↔ runner pair — that pair converges bit-exactly
(measured in the prior spec, and re-verified). It is in the **live/human path**:

1. While the bonus screen is up, the live loop (`game.ts:1681`) keeps calling `update()`
   because `state` is still `"playing"`. Each of those dwell ticks (a human dwells 2–30 s
   = 120–1800 ticks) runs the `waveComplete` branch of `update()` (`game-sim.ts:2173`):
   - `updateWaveCompleteVisuals` (`game-sim.ts:2078`) — **full** interceptor / explosion /
     plane simulation. In-flight interceptors detonate; interceptor–F-15 contact costs
     −500 score (`game-sim.ts:2049`).
   - `updateEmpVisualFx` decays `empScrubTicks` (`game-sim-emp.ts:60`), which scales
     `simDt` of subsequent ticks (`game-sim.ts:2112`).
   - `f15ReturnTimer` decrements (`game-sim.ts:2165`) and can fire `spawnF15Formation`,
     which **consumes seeded RNG** — desyncing the entire stream afterward.
2. The replay runner instead sets `bonusPaused` (`replay.ts:195`) and later jumps
   `tick = Math.max(tick, shopAction.tick)` (`replay.ts:140`) — the dwell ticks are
   **never simulated** on replay. The discard loop at `replay.ts:127` ("Discard non-shop
   input recorded during the wave-summary/shop UI gap") shows the gap was known;
   discarding _actions_ is possible, discarding _state evolution and RNG draws_ is not.

**Empirical proof** (scratch harness emulating exact live-loop semantics — celebration
fire + 240-tick bonus dwell — replayed through the real `createReplayRunner`, seed 42):

```
firstDiffTick: 638      orphan ticks (simulated on one side only): 313
first post-shop tick where both sides simulated but hashes differ: 903
live final: score=290   replay final: score=250   (different game-over ticks)
```

The trigger conditions — something in flight at bonus start, EMP fired late in a wave,
an F-15 return pass straddling the boundary — explain why divergence is intermittent,
boundary-anchored, and worse with active upgrades. This class of bug affects everything
downstream of human recordings: **death clips, run-recap wave replays, seek, and saved
human replays** — the features actually used on the iPhone.

### A second, cosmetic bug with the same symptom

Replay playback renders without interpolation: the replay branch of the render loop steps
the runner once per RAF (`game.ts:1663`) and never calls `snapshotPositions`, and nothing
consumes `_timeAccum` (`game.ts:1639`), so `getRenderPosition` lerps stale/absent
snapshots. Wave end is peak particle load; every dropped RAF frame shows as a hard visual
skip in replays even when the sim is bit-identical. Fixed separately in **Phase 4**.

### Scope note (cross-engine)

All validation in this plan runs record and replay **in the same JS engine**. iPhone
records in JavaScriptCore; Node validates in V8. `Math.sin`/`Math.pow` may differ in
last-ULPs across engines, so V8-side guards cannot certify an iPhone-recorded replay
played on desktop. On-device record + on-device replay (the death-clip case) is
same-engine and unaffected. Phase 2's embedded-checkpoint verification is the only tool
that catches cross-engine drift, because it verifies on the playback device itself.

---

## 2. Target invariant (the "one boundary contract")

After this plan, all three paths obey the same contract:

1. Every simulated tick is `update(g, 1, …)` and ticks are numbered identically:
   action application → `update()` → tick counter increments.
2. **UI pauses consume zero simulated ticks.** Bonus screen and shop are wall-clock
   pauses; the sim is frozen during both, in live play exactly as in replay.
3. The shop is opened by a **`dt=0` update** in every path (this is already how the
   runner does it — `resumeFromBonusScreen`, `replay.ts:233-235` — and net-equivalent to
   how `runGame` does it, where the shop opens inside the same tick that starts the
   bonus).
4. Consequence: the recorded shop-action tick always equals `B+1`, where `B` is the tick
   whose `update()` started the bonus screen; the first tick of the next wave is `B+1`.
   The `Math.max` jump in `resumeFromShop` (`replay.ts:140`) is **deleted** and replaced
   with a strict assertion `shopAction.tick === tick` — legacy support is dropped
   (user decision, 2026-07-12), so a mismatch is a loud contract violation, not
   something to silently resync.

Why the `dt=0` open matters (subtle, easy to get wrong): freezing the live accumulator
alone still leaves live opening the shop with a **dt=1** tick while replay opens it with
**dt=0** and jumps the counter — one tick of `updateWaveCompleteVisuals`/`empScrubTicks`/
`f15ReturnTimer` drift per wave boundary. Bit-exactness requires both the freeze **and**
the `dt=0` open.

---

## 3. Phase 0 — Land the failing test first

Add `src/replay-human-path.test.ts` reproducing the divergence before fixing it
(red → green across Phase 1):

- Port the scratch harness: emulate **current** live-loop semantics in a loop
  (non-null event sink so the bonus screen engages; fire one interceptor during the
  wave-1 celebration window; dwell ≥ 240 ticks before setting `_bonusScreenDone`;
  record `fire`/`shop` actions with live conventions), then replay through the real
  `createReplayRunner` and compare per-tick `buildReplayCheckpoint(...).hash` maps
  (tick-keyed, last-write-wins — the verified methodology from the prior spec).
- Assert convergence (this fails today with first post-shop divergence ≈ tick 903,
  seed 42). Mark it `.fails` or skip until Phase 1 lands if the repo policy is
  green-main; preferred: land test + fix in the same PR, test committed first.
- After Phase 1, the "live emulation" in this test must call the **extracted helpers**
  (below), not a hand-copied loop, so the test exercises the real semantics forever.

## 4. Phase 1 — Fix the live-loop boundary contract

All changes in `src/game.ts` plus one small extraction. The runner and `runGame` are
**unchanged** (verify with the Phase 3 guard that bot-path convergence still holds).

### 4a. Freeze the sim while the bonus screen is up

In `startRenderLoop()`, in the `else if (game.state === "playing")` branch
(`game.ts:1681`): when `game._bonusScreenStarted && !game._bonusScreenDone`, do **not**
run the accumulator loop and set `game._timeAccum = 0` (otherwise the accumulator grows
during the pause — the per-frame increment is capped at 3 but the total is not — and the
sim fast-forwards up to hundreds of ticks on resume). Rendering, HUD sync, and
`tickControllerOnlyTimers` continue as normal. `interpolationAlpha` becomes 0 while
frozen, which renders snapshot positions — static and correct since nothing moves.

Input is already blocked during the bonus screen (`canvas.style.pointerEvents = "none"`,
`game.ts:1184`), so no fire actions can be recorded during the freeze.

### 4b. Open the shop with a `dt=0` update on bonus completion

In the bonus-screen completion callback (`game.ts:1193-1199`, the one that sets
`game._bonusScreenDone = true`): after setting the flag, mirror the runner's
`resumeFromBonusScreen` — if `game.waveComplete && !game.shopOpened`, call
`simUpdate(game, 0, handler)`. This opens the shop (and draws the draft offers,
consuming RNG at the same stream position as the runner) without consuming a tick.
The subsequent `shopOpen` sim event drives the existing shop UI path unchanged.

### 4c. Extract shared boundary helpers

Create small pure helpers (suggested home: `src/replay-loop.ts`, or `game-sim.ts` if
preferred) used by **both** `game.ts` and the Phase 0/3 tests:

- `isBonusUiPauseActive(g)` — `!!g._bonusScreenStarted && !g._bonusScreenDone`
- `completeBonusScreen(g, onEvent)` — sets `_bonusScreenDone` and performs the `dt=0`
  shop-open update when applicable (the exact body of 4b; `resumeFromBonusScreen` in
  `replay.ts` should delegate to it too).

This is the minimal cut of "one recorder": the boundary semantics — the only part that
has actually drifted — live in exactly one place. Full recorder unification is Phase 4.

### 4d. Legacy replays — dropped, not tolerated

The user has approved dropping support for pre-fix replays entirely. Concretely:

- Bump `ReplayData.version` to 5 for all new recordings (`game.ts:1159`, and add the
  field to `runGame` recordings, which currently omit it).
- `createReplayRunner.init()` **rejects** `version < 5` with a clear error (throw; the
  drag-drop/`__loadReplay` path in `game.ts` surfaces it as a toast instead of crashing).
  Delete the `replay_version_warning` soft path (`replay.ts:74-79`).
- Delete the `Math.max` tick jump (`replay.ts:140`); assert strict equality and report
  via the Phase 2 `replay_divergence` event (or throw headless) on mismatch.
- The gap-discard loop (`replay.ts:127-130`) exists to absorb input recorded during the
  wave-summary gap in legacy recordings. Under the new contract only `wave_plan` (and
  possibly a same-tick `cursor`) may legitimately appear there; discarding anything else
  becomes a reported contract violation rather than a silent skip.
- **Re-record the committed perf fixtures** — `public/replays/perf-wave1.json`,
  `perf-wave4-upgrades.json`, `perf-burj-burning.json` are version 2–3 and will be
  rejected. They are bot/debug recordings; regenerate with `src/headless/record.ts` (or
  the equivalent bootstrap for `perf-burj-burning`), then recapture desktop and iPhone
  perf baselines per the CLAUDE.md workflow (the regenerated action streams differ from
  the v2/v3-era sim, so old baselines are not comparable anyway). This step needs the
  user (iPhone capture).

### 4e. Feel-check (hand back to the user before merging)

This is feel-bearing. On iPhone, verify:

- Celebration particles/F-15 flyovers **freeze** behind the bonus overlay — does it read
  as "paused" or as "broken"? (The overlay covers most of the canvas; the render loop
  still runs, so shader/scene-time animation continues.)
- No fast-forward burst after dismissing the bonus screen (the 4a `_timeAccum` reset).
- Shop appears immediately after the bonus screen with correct draft offers.
- A full run → death → death clip: the clip should now match what was played.

### 4f. Acceptance criteria

- [ ] Phase 0 test passes: human-semantics recording round-trips bit-exact through
      `createReplayRunner`, including with celebration fire + dwell + late-wave EMP/F-15
      usage (parameterize the test over these triggers).
- [ ] Strictness tests: a `version < 5` replay is rejected with a clear error; a shop
      action with a mismatched tick is reported/thrown, not silently resynced.
- [ ] Perf fixtures re-recorded as v5 and loading in the perf harness; baseline
      recapture scheduled with the user.
- [ ] Bot path unchanged: existing round-trip tests in `sim-runner.test.ts` and
      `replay.test.ts` green without modification.
- [ ] `npm run typecheck && npm run lint && npm test` green;
      `npx playwright test e2e/smoke.spec.ts` green.
- [ ] User feel-check on device signed off.

## 5. Phase 2 — Consume the flight recorder (embedded checkpoint verification)

Human replays already embed live-recorded checkpoints (`game.ts:1162`,
`maybeRecordReplayCheckpoint` at `game.ts:105`: interval every 60 ticks plus forced ones
with `reason` = `start` / `shopOpen` / `waveStart:N` / `gameover`). **Nothing reads
them.** Fix that — this is the diagnostic that catches "other reasons" from real iPhone
sessions, including anything Phase 1 didn't anticipate and cross-engine drift.

### 5a. Runner-side verification

In `createReplayRunner`: if `replayData.checkpoints` is present, verify during playback
and report mismatches through the existing `onReplayEvent` channel as a new
`replay_divergence` event `{ tick, reason, expectedHash, actualHash, fieldDiff }`.
Comparison points must match the recording points — specify by `reason`:

- Interval checkpoints (no reason) and `gameover`: recorded at post-update tick counts;
  compare after the `step()` whose post-step `getTick()` equals `checkpoint.tick`.
- `shopOpen` (recorded with `tickOverride = _replayTick + 1` when the event fires,
  `game.ts:1206-1210`): compare when the runner enters `shopPaused`, before purchases.
- `waveStart:N` (recorded in `closeShop` after purchases, `game.ts:1269`): compare
  immediately after `resumeFromShop()`.
- Build the `fieldDiff` from full `ReplayCheckpoint` objects (state, wave, score,
  burjHealth, ammo, launcherHP, fireChargeState, upgrades, stats, counts) only when the
  hash differs — hash-compare on the hot path.

Verification must be observation-only — zero mutation of `g`, no early stop.

### 5b. Surfacing

- `game.ts`: on `replay_divergence`, `console.warn` with tick + reason + field diff
  (always), and in dev builds show a small on-canvas banner ("REPLAY DIVERGED @ tick N —
  see console"). Watching a death clip on the iPhone with the banner visible is the
  field-diagnosis workflow.
- Have `runGame` optionally emit checkpoints into its recordings at the same cadence
  (reuse the same interval + boundary reasons) so bot replays are also self-verifying.

### 5c. CLI verification of saved replays

Extend the Phase 3 validator with `--file <replay.json>`: load a saved replay (e.g. one
posted by the iPhone via `/api/save-replay`), run it headless through the runner,
verify embedded checkpoints, print first divergence with field diff, exit non-zero.
This is the "user says a specific run looks wrong → attach the JSON → get the exact
tick and field" tool.

### 5d. Acceptance criteria

- [ ] A vitest that records (headless, with checkpoints), perturbs one checkpoint hash,
      and asserts the runner reports `replay_divergence` at exactly that tick/reason.
- [ ] An unperturbed human-semantics recording verifies clean end-to-end.
- [ ] `--file` mode works on a real replay saved from the browser.

## 6. Phase 3 — The convergence guard (prior spec, amended)

Adopt `docs/replay-convergence-guard-plan.md` (branch
`claude/replay-divergence-validation-8ca7s2`) — its §3.2 tick-keyed comparison
methodology, §4 implementation steps (the `onTick` hook on `runGame`, the
`validate-replay.ts` validator, npm scripts, `.githooks` wiring, vitest backstop), and
its acceptance criteria — with these amendments:

1. **Add a human-path pass.** For each fast/thorough seed, in addition to the
   `runGame` ↔ runner check, run a **live-semantics recording** (via the Phase 4c
   helpers: non-null sink, nonzero bonus dwell, celebration-window bot fire allowed)
   and assert bit-exact round-trip. This is the regression guard for Phase 1 — without
   it, the guard re-certifies only the path that never diverged.
2. **Add an anchor round-trip pass** (one seed is enough): during the ground-truth run,
   capture a `createReplayStateAnchor` at a mid-run `waveStart`; replay the tail via
   `createReplayRunnerFromAnchor` and compare tail hashes. This guards the death-clip /
   run-recap seek path (`game.ts:1273`, recently patched by "Fix death replay clip
   loop") which the prior spec ignored entirely.
3. **Widen the pre-commit trigger list** with `src/wave-spawner.ts`,
   `src/headless/rng.ts`, `src/game.ts`, and `src/replay-loop.ts` (the Phase 4c home).
   My repro proves recording semantics live in `game.ts`; a convergence guard that
   doesn't run when `game.ts` changes is asleep at its post. Pre-push stays
   unconditional-thorough.
4. **Re-measure timings** on this machine (the prior spec's ~1.7 s fast / ~2.3 s
   thorough numbers came from its environment; the human-path pass adds a seed-run
   each). If fast mode breaches ~2 s, drop to 2 seeds before dropping any boundary
   coverage — never below stop-wave 3 (≥ 2 shop transitions).
5. Keep the prior spec's requirements verbatim: `onTick` as a strict no-op when unset;
   vacuous-pass hard failure when a seed dies before the stop wave; the injected-
   divergence proof in the PR; `hooks:install` + `--no-verify` documented.

## 7. Phase 4 — Follow-ups (separate PRs, lower priority)

1. **Replay render interpolation:** drive replay stepping through the same
   `_timeAccum` accumulator as live play (fixes ≠60 Hz RAF pacing too), call
   `snapshotPositions` before each replay `step()`, and pass a real alpha. Replays then
   look like live play; wave-end frame drops smooth instead of skipping.
2. **Full recorder unification:** extract action recording (fire/cursor/shop/wave_plan
   tick conventions) shared by `game.ts` and `sim-runner.ts`. Today they are duplicated
   and manually synchronized (see the "matches how the replay runner…" comment,
   `sim-runner.ts:122`). Phase 4c already unified the boundary; this removes the rest.
3. **Docs cleanup:** `docs/replay-system.md` + CLAUDE.md — document the new boundary
   contract, the version-5 bump, checkpoint verification, and the guard commands; fix
   the stale "shop shows for 2 seconds" claim (code: 1000 ms, `game.ts:1655`).

## 8. Risks and open questions

- **Feel change (Phase 1)** — frozen celebration behind the bonus overlay. Mitigation:
  feel-check gate 4e; if it reads badly, keep purely-visual layers animating render-side
  (scene-time driven), never sim-side.
- **Legacy replays refuse to load** (4d, user-approved). Anything saved before the fix —
  including old `window.__lastReplay` exports — is gone. Old death clips were divergent
  anyway; that is the bug being fixed. The perf fixtures are the only committed casualty
  and are regenerated as part of Phase 1.
- **Cross-engine drift** is explicitly out of scope for the Node guard and covered
  only by on-device checkpoint verification (Phase 2). If it is ever observed, that is a
  new investigation (trig/pow call sites in the sim), not a failure of this plan.
- **Checkpoint hash granularity:** `roundCoord` quantizes to 0.1 px
  (`replay-debug.ts:3-6`), so sub-0.1 drift hides until it crosses a threshold.
  Acceptable for a guard; the per-tick full-run hashes in Phase 0/3 catch drift the
  moment it rounds visibly.

## 9. Sequencing summary

| Phase | Deliverable                                                                   | Gate                                                             |
| ----- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0     | Failing human-path round-trip test                                            | Red on main's semantics                                          |
| 1     | Live-loop freeze + `dt=0` shop-open + shared boundary helpers + version 5     | Phase 0 green; bot path untouched; **user feel-check on iPhone** |
| 2     | Embedded checkpoint verification (runner event, console/banner, `--file` CLI) | Perturbation test; real-replay verification                      |
| 3     | Convergence guard (prior spec + human-path + anchor + wider triggers)         | Timing budgets; injected-divergence proof                        |
| 4     | Replay render interpolation; recorder unification; docs                       | Separate PRs                                                     |

Phases 0–1 are the fix. Phase 2 is the field diagnostic. Phase 3 is the insurance.
Do them in that order; a guard installed before the fix would certify the wrong thing.
