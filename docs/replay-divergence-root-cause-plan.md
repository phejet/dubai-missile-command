# Replay Divergence — Root-Cause Fix Plan

> **Audience:** the implementer (human or model). This is a handoff spec.
> **Status:** planned, not implemented. Line numbers are as of 2026-07-12; re-verify before editing.
> **Revision 2 (2026-07-12):** incorporates the Codex inline review in full. Every review
> claim was independently verified against the code (and by running the cited test) before
> acceptance: `spawnPoisson` RNG-consumption-per-call, bare `--` timers in
> `updateBurjDamageFx`, the red test at `replay.test.ts:513`, input gating on
> `waveComplete`, timer durations, checkpoint field omissions, the missing version field in
> `record.ts`, the unhandled `startReplay` rejection, the 3-substep accumulator cap, and the
> clamped interpolation alpha. All confirmed. The `dt=0` shop-open design from revision 1 is
> **withdrawn** — it standardized on the exact mechanism causing the bug.
> **Revision 3 (2026-07-12):** closes the final execution-readiness gaps found in the
> Revision 2 review: the shared transition now owns `_bonusScreenDone` and is explicitly
> idempotent; same-RAF pause detection happens only after all current-tick bookkeeping;
> module-global deterministic ID counters move into `GameState` before anchor validation;
> compact checkpoints retain their quantized diagnostic signature for useful field diffs;
> and the already-red golden-seed canary is baseline-triaged before Phase 1 verification.
> **Post-implementation correction (2026-07-12):** the iPhone feel-check exposed two
> live inputs still missing from replay v5: persisted objective progression and forced
> draft-family settings. A forced Patriot offer changed the draft RNG stream and caused
> the supplied run to diverge in wave 2, then throw at the shop boundary. Replay v6
> records deterministic initial context (including starting Burj health), applies human
> bonuses in the runner, and keeps fire-charge mutation out of HUD rendering.
> **Supersedes / amends:** `docs/replay-convergence-guard-plan.md` on branch
> `claude/replay-divergence-validation-8ca7s2`. That spec's guard is adopted here as
> **Phase 3**, with amendments. Its comparison methodology (§3.2 there) was independently
> verified by code trace and is correct. Its diagnosis (§1 there) is wrong — see below.

---

## 1. Problem statement and proven root causes

Replays are action-log + seed re-simulation. There are **three** simulation drivers:

| Path                       | Driver                                      | Bonus-screen behavior                                                                   |
| -------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Live play (browser/iPhone) | `game.ts` `startRenderLoop()` accumulator   | **Keeps ticking** while bonus screen is up                                              |
| Headless recording         | `runGame()` in `src/headless/sim-runner.ts` | No bonus screen (`onEvent` null → `_bonusScreenDone` set instantly, `game-sim.ts:2105`) |
| Replay playback            | `createReplayRunner()` in `src/replay.ts`   | **Pauses**, then **jumps the tick counter** over the gap                                |

There are **two distinct root causes**, both at the wave-end boundary:

### Root cause A — the event sink is an implicit simulation mode

`startWaveBonus()` sets `_bonusScreenDone` immediately when `onEvent` is null but waits
when a callback exists (`game-sim.ts:2087-2105`). The iPhone/desktop interactive path and
the watched-replay path pass a callback; headless Node passes null. So the **presence of
an observer changes simulation control flow**: with a callback, the shop opens via a later
extra `update(g, 0)` call (`resumeFromBonusScreen`, `replay.ts:229-235`); without one, it
opens inline inside the same `dt=1` tick.

That extra `update(g, 0)` call is **not a no-op**:

- `updateBurjDamageFx()` (`game-sim.ts:199`) decrements `burjHitFlashTimer` and
  `burjInvulnTimer` with bare `--`, ignoring `dt` entirely — and `burjInvulnTimer` is
  gameplay-relevant.
- `updateWaveCompleteVisuals()` runs, and `updateBurjFireParticles()` →
  `spawnPoisson()` (`game-sim-burj-fire.ts:176-184`) calls `rand(0, 1)` on **every
  invocation, even when `expected` is 0**. With a damaged Burj (the fire path
  early-returns only when pristine), every `update(g, 0)` burns gameplay-RNG draws that
  the null-event path never burns. The subsequent draft pick, spawn schedule, and
  everything downstream diverge.

**Empirical proof (primary):** `replay.test.ts:513` ("replays a recorded draft game
identically when event callbacks are observed") is **red on `main` today**: seed 425 ends
at wave 14, score 180576, tick 14360 without event callbacks, but wave 11, score 89426,
tick 11349 with one. Re-run and confirmed 2026-07-12. The test landed 2026-05-24
(`87f1d6e` "Fix headed replay convergence") and has regressed since — triage note in §8.

**Corroborating probe (Codex, 2026-07-12):** seed 42, wave 4, Burj health 6 — both paths
reached tick 935 with the same `buildReplayCheckpoint` hash (`bd201e8a`) while holding
different RNG states, different draft offers, and different wave-5 schedules. This also
proves the current checkpoint hash cannot serve as a determinism fingerprint (§5).

### Root cause B — live dwell ticks are simulated but never replayed

1. While the bonus screen is up, the live loop (`game.ts:1681`) keeps calling `update()`
   because `state` is still `"playing"`. Each of those dwell ticks (a human dwells 2–30 s
   = 120–1800 ticks) runs the `waveComplete` branch of `update()` (`game-sim.ts:2173`):
   - `updateWaveCompleteVisuals` (`game-sim.ts:2078`) — **full** interceptor / explosion /
     plane simulation. In-flight interceptors detonate; interceptor–F-15 contact costs
     −500 score (`game-sim.ts:2049`).
   - `updateBurjFireParticles` — with a damaged Burj, **consumes seeded RNG every tick**
     via `spawnPoisson` (see root cause A). This is the omnipresent organic trigger: any
     run with a damaged Burj diverges at every wave boundary.
2. The replay runner instead sets `bonusPaused` (`replay.ts:195`) and later jumps
   `tick = Math.max(tick, shopAction.tick)` (`replay.ts:140`) — the dwell ticks are
   **never simulated** on replay. The discard loop at `replay.ts:127` ("Discard non-shop
   input recorded during the wave-summary/shop UI gap") shows the gap was known;
   discarding _actions_ is possible, discarding _state evolution and RNG draws_ is not.

**Trigger-condition correction (verified):** revision 1 blamed late EMP and F-15 return
passes. The timer math rules that out for the normal case: EMP scrub lasts 7 ticks
(`EMP_SCRUB_TICKS`, `game-sim-emp.ts:22`), the F-15 return timer is 110 ticks and is
**armed at cast time** (`fireF15Pair`, `game-sim.ts:2302`), while the pre-overlay
wave-cleared celebration lasts 120 ticks (`game-sim.ts:2212`). Casting is a player action
and player fire/cast input is rejected once `waveComplete` is true, so a legally-armed
return timer always expires within the celebration, before the overlay. EMP scrub cannot
stretch it because EMP and F-15 are mutually exclusive per run. F-15 planes may remain
_visible_ across the boundary (they are simulated by `updateWaveCompleteVisuals`), but
the timer-straddling story is wrong. **Damaged-Burj fire is the reproducible trigger.**

**Stress evidence (secondary):** a scratch harness emulating live-loop semantics with an
injected celebration-window fire + 240-tick dwell, replayed through the real
`createReplayRunner` (seed 42), produced first-diff tick 638, 313 orphan ticks, and
different final scores/game-over ticks. Note the injected fire is **not a legal human
action** — pointer and keyboard input both reject firing once `game.waveComplete` is true
(`game.ts:1449`, `game.ts:1481`). Keep this as evidence that orphan simulation ticks are
dangerous in general; do not use it as the primary player-path regression test (§3).

This class of bug affects everything downstream of human recordings: **death clips,
run-recap wave replays, seek, and saved human replays** — the features actually used on
the iPhone.

### A second, cosmetic bug with the same symptom

Replay playback advances exactly one sim tick per RAF (`game.ts:1663`) and never calls
`snapshotPositions`, and nothing consumes `_timeAccum` (`game.ts:1639`). The renderer
clamps interpolation alpha to `[0, 1]` and falls back to current positions when snapshots
are absent (`clampInterpolationAlpha` / `getRenderPosition`, `pixi-render.ts:1329-1341`),
so this is **not** stale-snapshot lerping: dropped RAFs slow simulation time and the
tick-per-RAF stepping ties sim speed to refresh rate. Wave end is peak particle load, so
the pacing inconsistency and missing interpolation read as hard visual skips even when
the sim is bit-identical. Fixed separately in **Phase 4**.

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
2. **UI pauses consume zero simulated ticks, zero sim mutation, and zero RNG draws.**
   Bonus screen and shop are wall-clock pauses; the sim is frozen during both, in live
   play exactly as in replay.
3. **The shop is opened by one explicit shared transition,
   `completeWaveBonusAndOpenShop(g, onEvent)`, in every driver — and that transition
   never calls `update()`.** It is the shop-opening mutation currently inlined at
   `game-sim.ts:2181-2191` extracted into a sim function: set `_bonusScreenDone = true`,
   set `shopOpened`, record the wave summary, set `state = "shop"`, draw draft offers
   (the single defined RNG-consuming operation at this boundary), and emit `shopOpen`.
   It advances no timers, entities, collisions, or FX. It is idempotent: it ensures the
   done flag first, then returns without emitting or drawing again if `shopOpened` is
   already true. Headless calls it immediately after `startWaveBonus`; live and replay
   call it when the bonus UI completes.
4. **Event sinks are observational.** `startWaveBonus()` no longer uses `onEvent`
   truthiness to decide whether the bonus is complete; whether a bonus UI pause happens
   is the **driver's** decision (headless: none; live/replay: wall-clock pause). Passing
   or omitting an observer must never change simulation state or RNG position.
5. Consequence: the recorded shop-action tick always equals the current tick at the
   boundary — the same value in all three drivers, with no tick consumed by the
   transition. The `Math.max` jump in `resumeFromShop` (`replay.ts:140`) is **deleted**
   and replaced with a strict assertion `shopAction.tick === tick` — legacy support is
   dropped (user decision, 2026-07-12), so a mismatch is a loud contract violation, not
   something to silently resync.
6. **`update()` rejects `dt <= 0`** (throw) once its only production zero-dt caller
   (`resumeFromBonusScreen`, `replay.ts:233`) is removed. This makes the contract
   enforceable by the API instead of relying on every future subsystem to treat zero as
   zero — revision 1's `dt=0` open failed exactly this way (`updateBurjDamageFx` ignores
   `dt`; `spawnPoisson` rolls RNG regardless of `dt`).
7. **All deterministic counters are state-owned.** The module globals
   `_explosionId`, `_empFxId`, `_burjDecalId`, `_burjDamageFxId`, and
   `_buildingDestroyFxId` move into `GameState` as `next*Id` fields, following the
   existing `nextFlareId` pattern. Anchors, causal snapshots, and ordinary state cloning
   then capture them automatically; no deterministic future state remains hidden in the
   process module graph.

Why revision 1's `dt=0` open was wrong (kept for the record): it assumed
`update(g, 0)` was a zero-mutation way to reach the shop-open branch at the same RNG
stream position. It is not — see root cause A. Bit-exactness requires the live-loop
freeze **plus** the shared non-tick transition, not a "zero-dt tick".

---

## 3. Phase 0 — Land the failing tests first

Red → green across Phase 1. Four tiers, in priority order:

**Test-infrastructure prerequisite:** add the first version of
`buildReplayCausalSnapshot(g)` in Phase 0, before writing the boundary assertions. It
must cover RNG state and the directly relevant boundary fields (bonus/shop flags, draft
offers, schedule, tick/wave state) immediately; Phase 2 expands it to the complete sim
contract and production validator. This removes the sequencing ambiguity where Phase 0
depended on a helper otherwise scheduled for Phase 2.

**Baseline triage before implementation:** the focused replay suite currently has two
known failures, not one. In addition to the seed-425 convergence regression, the unrelated
golden-seed canary expects score 24696 but current `runGame(seed=42, maxTicks=5000)` returns
20112 (wave 7, timeout). Re-run that seed twice to prove determinism, inspect the gameplay
changes since its last baseline update, then update the stale expected score in a
test-only commit before the boundary fix. Phase 1 must not inherit an unexplained red
full-suite gate.

1. **Promote the existing red test.** `replay.test.ts:513` already reproduces root
   cause A end-to-end (seed 425: wave 14 / 180576 without events vs wave 11 / 89426
   with). Keep it as the primary regression; parameterize over 2–3 seeds if cheap.
   Land the test promotion and Phase 1 fix in the same PR, with the red test commit first;
   do not mark it skipped or `.fails`.
2. **Add a focused damaged-Burj boundary test** (new, `src/replay-human-path.test.ts`):
   drive a game to a shop boundary with Burj health reduced (e.g. debug start or scripted
   damage), cross the boundary once with `onEvent = null` and once with a non-null
   observer, and assert equality of: RNG state (`rng.getState()` — already exposed by
   `mulberry32`, `src/headless/rng.ts`), draft offers, next-wave spawn schedule, and the
   full causal snapshot (§5). This pins the _mechanism_, not just the downstream score.
3. **Port the scratch harness as a secondary stress test:** emulate current live-loop
   semantics (non-null sink, ≥240-tick dwell, live recording conventions), replay through
   the real `createReplayRunner`, and compare tick-keyed causal snapshots
   (last-write-wins — retain the verified tick alignment from the prior spec, but replace
   its weak compact hash with the Phase 0 causal projector). The
   celebration-fire injection is synthetic (illegal as human input — `game.ts:1449`,
   `game.ts:1481`) and this test documents that: it guards against orphan-tick regressions
   generally, not a specific player path.
4. **Add an anchor-counter regression test** (red until Phase 1 counter migration): run a
   real action stream with explosions, capture an anchor mid-run, then compare the full
   and anchored tails. Assert identical newly-created explosion IDs, retained FX IDs,
   causal snapshots, and RNG state. The verified pre-fix probe from tick 250 to 600
   produced full-tail explosion IDs 10–23 versus anchored-tail IDs 24–37 while score stayed
   equal; the existing compact checkpoint missed it because it omits explosions.

After Phase 1, the "live emulation" in these tests must call the **extracted helpers**
(§4c), not a hand-copied loop, so the tests exercise the real semantics forever.

## 4. Phase 1 — Fix the boundary contract

Changes span `src/game.ts`, `src/game-sim.ts`, `src/replay.ts`, and
`src/headless/sim-runner.ts` so all three drivers share the transition, plus the bounded
counter migration in `src/types.ts`, `src/game-logic.ts`, and `src/game-sim-emp.ts`.
Verify with the Phase 3 guard that bot-path convergence still holds.

### 4a. Freeze the sim while the bonus screen is up

In `startRenderLoop()`, in the `else if (game.state === "playing")` branch
(`game.ts:1681`): when `isBonusUiPauseActive(game)`, do **not** run the accumulator loop
and set `game._timeAccum = 0` (otherwise the accumulator grows during the pause — the
per-frame increment is capped at 3, `game.ts:1639`, but the total is not — and the sim
fast-forwards up to hundreds of ticks on resume). Rendering, HUD sync, and
`tickControllerOnlyTimers` continue as normal. `interpolationAlpha` becomes 0 while
frozen, which renders snapshot positions — static and correct since nothing moves.

**Same-RAF edge (required):** checking only before entering the accumulator loop is
insufficient. A capped slow frame can run up to three substeps in one RAF; if the first
substep starts the bonus, the loop would still execute one or two bonus dwell ticks in
that same RAF. Finish the current tick in the normal order — `simUpdate`, increment
`_replayTick`, record the scheduled cursor action, and call
`maybeRecordReplayCheckpoint` — then check `isBonusUiPauseActive` before the next loop
iteration. On transition, clear `_timeAccum` and `break`. Do not break directly after
`simUpdate`; that would skip post-tick bookkeeping and recreate the boundary off-by-one.

Input is already blocked during the bonus screen (`canvas.style.pointerEvents = "none"`,
`game.ts:1184`), so no fire actions can be recorded during the freeze.

### 4b. Extract and share the shop-open transition

**Do not call `simUpdate(game, 0)` anywhere.** Instead:

- Extract the shop-opening mutation at `game-sim.ts:2181-2191` into
  `completeWaveBonusAndOpenShop(g, onEvent)` in `game-sim.ts` (contract item 3). It
  performs exactly: set `_bonusScreenDone = true`; if `shopOpened` is already true,
  return; otherwise set `shopOpened = true`, call `recordWaveSummary`, set
  `state = "shop"`, call `draftPick3` when in draft mode, and emit `shopOpen`. Nothing
  else. Unit-test the idempotent second call: the done flag remains true with no
  additional RNG draw, draft change, summary, or event.
- `startWaveBonus()` (`game-sim.ts:2087`) stops setting `_bonusScreenDone` based on
  `onEvent` truthiness (contract item 4). The burj-dead path keeps its current behavior
  (no bonus screen, game-over flow).
- `update()`'s `waveComplete` branch no longer opens the shop inline; the **driver**
  calls the transition:
  - `runGame` (headless): call it immediately when the bonus starts — no UI, no pause.
  - `game.ts` live: in the bonus-screen completion callback (`game.ts:1193-1199`), call
    it if `game.waveComplete && !game.shopOpened`; the helper itself owns
    `_bonusScreenDone`. The `shopOpen` sim event drives the existing shop UI path
    unchanged.
  - `createReplayRunner`: `resumeFromBonusScreen` (`replay.ts:229-235`) calls it instead
    of `update(g, 0, onEvent)`.
  - Seek and death-clip pause handling: audit `resumeIfPaused` in
    `src/replay-seek.ts:33-40` and `src/run-recap-death-clip.ts:35-41`; they should trigger
    the runner's resume API, which owns the shared transition, rather than duplicate the
    shop-open mutation.
- After the last zero-dt caller is gone, add the `dt <= 0` rejection to `update()`
  (contract item 6).

### 4c. Extract shared boundary helpers

Create small shared boundary helpers used by **both** `game.ts` and the Phase 0/3 tests:

- `isBonusUiPauseActive(g)` — `!!g._bonusScreenStarted && !g._bonusScreenDone`
  (suggested home: `src/replay-loop.ts`).
- `completeWaveBonusAndOpenShop(g, onEvent)` — the sim transition of 4b (lives in
  `game-sim.ts`; it mutates sim state, so it belongs with the sim).

Additionally, extract or integration-test the **actual accumulator pause/break wiring**
in `startRenderLoop` — a synthetic test loop that merely calls the same predicate will
not catch incorrect wiring in `game.ts`. Minimum: a jsdom/integration test that drives
the real render-loop step function across a bonus transition and asserts no sim ticks
elapse during the pause and no fast-forward happens on resume.

This is the minimal cut of "one recorder": the boundary semantics — the only part that
has actually drifted — live in exactly one place. Full recorder unification is Phase 4.

### 4d. Move deterministic ID counters into `GameState`

Before relying on anchors or exact causal snapshots, remove hidden deterministic state:

- Add `nextExplosionId`, `nextEmpFxId`, `nextBurjDecalId`, `nextBurjDamageFxId`, and
  `nextBuildingDestroyFxId` to `SimState`, initialized in `initGame()` alongside
  `nextFlareId`.
- Replace `_explosionId` in `game-logic.ts`, `_empFxId` in `game-sim-emp.ts`, and the
  three ID globals in `game-sim.ts` with reads/increments on the passed `GameState`.
  Delete their reset helpers and `initGame()` reset calls.
- IDs used only for rendering still belong in state because death clips and anchored
  replays promise visual continuity; explosion IDs are additionally referenced by
  gameplay (`rootExplosionId` / `_hitByExplosions`).
- Extend `replay-anchor.test.ts` with the Phase 0 explosion-tail probe and an EMP/Burj-FX
  case. Assert exact causal snapshots and ID streams, not merely score or the compact
  checkpoint hash.

### 4e. Legacy replays — dropped, not tolerated

The user has approved dropping support for pre-fix replays entirely. Concretely:

- **Centralize the version as `CURRENT_REPLAY_VERSION`** (single exported constant) and
  make `version` **required at the typed producer boundary** (the type used to construct
  recordings, not just the loader). The implemented boundary fix used v5; the device
  correction above supersedes it with v6.
- Fix **all** producers, not just `game.ts:1159`:
  - `runGame` recordings (currently omit the field).
  - `src/headless/record.ts` — manually constructs the saved payload and currently drops
    any version field.
  - Tests and E2E fixtures that construct `ReplayData` literals — most are unversioned
    today, so the revision-1 acceptance criterion "existing tests green without
    modification" is **withdrawn**; mechanical `version: CURRENT_REPLAY_VERSION` additions
    to fixtures are expected and fine.
- `createReplayRunner.init()` **rejects** a missing version or any
  `version !== CURRENT_REPLAY_VERSION` with a clear error (throw), including a distinct
  "newer replay format" message for `version > CURRENT_REPLAY_VERSION`. Delete the
  `replay_version_warning` soft path (`replay.ts:74-79`).
- **Add explicit UI error handling for the throw**: `startReplay()` currently does not
  catch `runner.init()` failures, and both entry points discard the promise
  (`window.__loadReplay = (data) => void this.startReplay(data)`, `game.ts:539`;
  drag-drop at `game.ts:1506`) — without a catch, rejection is an unhandled promise
  rejection, not the promised toast. Wrap `init()` (or the `startReplay` body) and
  surface a toast with the error message.
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

### 4f. Feel-check (hand back to the user before merging)

This is feel-bearing. On iPhone, verify:

- Celebration particles/F-15 flyovers **freeze** behind the bonus overlay — does it read
  as "paused" or as "broken"? (The overlay covers most of the canvas; the render loop
  still runs, so shader/scene-time animation continues.)
- No fast-forward burst after dismissing the bonus screen (the 4a `_timeAccum` reset).
- Shop appears immediately after the bonus screen with correct draft offers.
- A full run → death → death clip: the clip should now match what was played.

### 4g. Acceptance criteria

- [ ] Golden-seed canary baseline triaged before the fix: two identical seed-42 runs,
      relevant intervening gameplay change identified, and stale expected score updated
      in a test-only commit.
- [ ] `replay.test.ts:513` (seed-425 event-callback convergence) green.
- [ ] Phase 0 damaged-Burj boundary test green: null-event and event-observed drivers
      hold identical RNG state, draft offers, and next-wave schedule across the boundary.
- [ ] Phase 0 stress test green: human-semantics recording round-trips bit-exact through
      `createReplayRunner`, parameterized over dwell length and damaged-Burj state.
- [ ] Phase 0 anchor-counter test green: full and anchored tails produce identical IDs,
      RNG state, causal snapshots, and rendered FX identity.
- [ ] Shared completion transition sets `_bonusScreenDone` and is idempotent; a second
      call emits no event and consumes no RNG.
- [ ] Same-RAF integration test proves the boundary tick still performs replay-tick
      increment, cursor logging, and checkpoint recording before the accumulator stops.
- [ ] `update()` throws on `dt <= 0`; no production caller passes it.
- [ ] Strictness tests: missing, older, and newer replay versions are rejected with clear
      errors **and the browser entry points surface them as a toast, not an unhandled
      rejection**; a shop action with a mismatched tick is reported/thrown, not silently
      resynced.
- [ ] Perf fixtures re-recorded at the current replay version and loading in the perf harness; baseline
      recapture scheduled with the user.
- [ ] Bot path: existing round-trip tests in `sim-runner.test.ts` and `replay.test.ts`
      green (mechanical `version` additions to fixtures permitted; no behavioral edits).
- [ ] `npm run typecheck && npm run lint && npm test` green;
      `npx playwright test e2e/smoke.spec.ts` green.
- [ ] User feel-check on device signed off.

## 5. Phase 2 — Consume the flight recorder (embedded checkpoint verification)

Human replays already embed live-recorded checkpoints (`game.ts:1162`,
`maybeRecordReplayCheckpoint` at `game.ts:105`: interval every 60 ticks plus forced ones
with `reason` = `start` / `shopOpen` / `waveStart:N` / `gameover`). **Nothing reads
them.** Fix that — this is the diagnostic that catches "other reasons" from real iPhone
sessions, including anything Phase 1 didn't anticipate and cross-engine drift.

### 5a. Two checkpoint products, not one

`buildReplayCheckpoint()` (`replay-debug.ts:28`) is a semantic sample, not a causal
determinism fingerprint: it omits RNG state, spawn schedule and cursor, draft offers,
explosions, particles, flares, queues, cooldowns, and many timers. The §1 probe produced
**equal hashes after the RNG, draft offers, and future schedule had already diverged** —
a guard built on this hash alone reports the first visible consequence, not the first
cause, and can certify states with different futures. Additionally, the detailed
signature is currently hashed and then discarded, so field diffs cannot explain
entity/RNG mismatches. Split it:

1. **Causal snapshot** (same-engine, CI/hook use): exact, unquantized, includes
   `rng.getState()` (already exposed by `mulberry32`), spawn schedule + cursor, draft
   offers, all state-owned `next*Id` counters, all future-affecting
   timers/cooldowns/queues, and full entity state. Used by Phase 0 tests, the Phase 3
   guard, and anchor validation. Kept as an object (not hash-and-discard) so diffs name
   the first diverging field. Define an explicit projector over `SimState` rather than
   serializing `GameState` blindly: exclude runtime/audio/RAF fields and bot `WeakMap`
   state, encode `Set` values in sorted order, and replace entity object references with
   stable entity IDs or deterministic array indexes. Phase 0 lands the boundary subset;
   Phase 2 completes and freezes this schema with a field-coverage test against
   the runtime keys from `initGame()` and an explicit sim-key include/exclude registry, so
   newly-added state fields require an explicit ownership decision even though the
   TypeScript `SimState` interface is erased at runtime.
2. **Compact embedded checkpoint** (cross-engine, on-device): extend the existing
   quantized `ReplayCheckpoint` (0.1 px `roundCoord`) with a retained `diagnostics`
   object. `diagnostics` is the quantized signature used to compute `hash`, not a second
   independently-maintained shape. It includes the existing encoded entity families and
   defense sites plus: RNG state, schedule index/wave tick and remaining-schedule
   fingerprint, draft offers, explosion and flare fingerprints, particle count/type
   counts, relevant queues, and named gameplay timers/cooldowns. This remains cheap
   enough to embed every 60 ticks, tolerates last-ULP engine drift by design, and lets a
   field diff name the diverging subsystem/value instead of returning an opaque hash.
   Measure and report replay-size growth on a representative late-game recording; if
   entity arrays are too large, store per-subsystem hashes while retaining the named
   scalar/boundary fields and subsystem-level diff.

### 5b. Runner-side verification

In `createReplayRunner`: if `replayData.checkpoints` is present, verify during playback
and report mismatches through the existing `onReplayEvent` channel as a new
`replay_divergence` event `{ tick, reason, expectedHash, actualHash, fieldDiff }`.
Comparison points must match the recording points — specify by `reason`:

- Interval checkpoints (no reason) and `gameover`: recorded at post-update tick counts;
  compare after the `step()` whose post-step `getTick()` equals `checkpoint.tick`.
- `shopOpen`: under the new contract the transition consumes no tick, so **record at the
  current tick** — delete the `tickOverride = _replayTick + 1` at `game.ts:1206-1210`
  (retaining it would drift the recording point again once the shop opens outside
  `update()`). Compare when the runner enters `shopPaused`, before purchases.
- `waveStart:N` (recorded in `closeShop` after purchases, `game.ts:1269`): compare
  immediately after `resumeFromShop()`.
- `start` / `debugStart:*`: verify during `init()`, immediately after game-state
  construction, before any `step()`.
- Anchored runners (`createReplayRunnerFromAnchor`): skip checkpoints recorded before the
  anchor tick; verify all later ones normally.
- Build the `fieldDiff` from full `ReplayCheckpoint` objects, including
  `diagnostics`, only when the hash differs — hash-compare on the hot path. A mismatched
  hash with an empty `fieldDiff` is a test failure: every hashed input must be retained
  directly or represented by a named subsystem fingerprint in `diagnostics`.

Verification must be observation-only — zero mutation of `g`, no early stop.

### 5c. Surfacing

- `game.ts`: on `replay_divergence`, `console.warn` with tick + reason + field diff
  (always), and in dev builds show a small on-canvas banner ("REPLAY DIVERGED @ tick N —
  see console"). Watching a death clip on the iPhone with the banner visible is the
  field-diagnosis workflow.
- Have `runGame` optionally emit checkpoints into its recordings at the same cadence
  (reuse the same interval + boundary reasons) so bot replays are also self-verifying.

### 5d. CLI verification of saved replays

Extend the Phase 3 validator with `--file <replay.json>`: load a saved replay (e.g. one
posted by the iPhone via `/api/save-replay`), run it headless through the runner,
verify embedded checkpoints, print first divergence with field diff, exit non-zero.
This is the "user says a specific run looks wrong → attach the JSON → get the exact
tick and field" tool.

### 5e. Acceptance criteria

- [ ] A vitest that records (headless, with checkpoints), perturbs one checkpoint hash,
      and asserts the runner reports `replay_divergence` at exactly that tick/reason.
- [ ] An unperturbed human-semantics recording verifies clean end-to-end.
- [ ] Both the causal snapshot and revised compact diagnostics catch the §1 probe
      scenario (equal legacy compact hash, diverged RNG/draft/schedule).
- [ ] Causal-snapshot field-coverage test fails when an `initGame()` state key lacks an
      explicit included/excluded ownership decision.
- [ ] Compact checkpoint perturbations for RNG, schedule, explosion/entity state, and a
      timer each produce a non-empty `fieldDiff` naming the changed field or subsystem.
- [ ] Representative late-game replay size before/after retained diagnostics is measured
      and reported; any subsystem-hash fallback preserves non-empty named diffs.
- [ ] `--file` mode works on a real replay saved from the browser.

## 6. Phase 3 — The convergence guard (prior spec, amended)

Adopt `docs/replay-convergence-guard-plan.md` (branch
`claude/replay-divergence-validation-8ca7s2`) — its §3.2 tick-keyed comparison
methodology, §4 implementation steps (the `onTick` hook on `runGame`, the
`validate-replay.ts` validator, npm scripts, `.githooks` wiring, vitest backstop), and
its acceptance criteria — with these amendments. "Comparison methodology" here means
the tick alignment, before-`step()` capture, union-of-keys check, and last-write-wins
handling only; replace the prior spec's `buildReplayCheckpoint().hash` fingerprint with
the exact causal snapshot/projector from §5a for every same-engine pass:

1. **Add a human-path pass.** For each fast/thorough seed, in addition to the
   `runGame` ↔ runner check, run a **live-semantics recording** (via the §4c
   helpers: non-null sink, nonzero bonus dwell) and assert bit-exact round-trip. This is
   the regression guard for Phase 1 — without it, the guard re-certifies only the path
   that never diverged.
2. **Add an observer-invariance pass.** Compare a runner with `onEvent = null` against
   the same runner with a non-null observer — the matrix cell where the currently-red
   `replay.test.ts:513` lives. Ensure at least one guarded seed reaches a shop boundary
   with **damaged Burj health**, so the cosmetic-RNG coupling (root cause A) is
   exercised, not dodged.
3. **Add an anchor round-trip pass** (one seed is enough): during the ground-truth run,
   capture a `createReplayStateAnchor` at a mid-run `waveStart`; replay the tail via
   `createReplayRunnerFromAnchor` and compare tail states using the **causal snapshot
   (§5a), including RNG state** — not only the compact hash, which the §1 probe proved
   can match across diverged futures. Exercise explosions and at least one EMP/Burj FX
   path, and assert the state-owned `next*Id` counters plus newly-created ID streams.
   This guards the death-clip / run-recap seek path
   (`game.ts:1273`, recently patched by "Fix death replay clip loop") which the prior
   spec ignored entirely.
4. **Widen the pre-commit trigger list** with `src/wave-spawner.ts`,
   `src/headless/rng.ts`, `src/game.ts`, and `src/replay-loop.ts` (the §4c home).
   The repro proves recording semantics live in `game.ts`; a convergence guard that
   doesn't run when `game.ts` changes is asleep at its post. Pre-push stays
   unconditional-thorough.
5. **Re-measure timings** on this machine (the prior spec's ~1.7 s fast / ~2.3 s
   thorough numbers came from its environment; the human-path and observer passes add
   seed-runs). If fast mode breaches ~2 s, drop to 2 seeds before dropping any boundary
   coverage — never below stop-wave 3 (≥ 2 shop transitions).
6. Keep the prior spec's requirements verbatim: `onTick` as a strict no-op when unset;
   vacuous-pass hard failure when a seed dies before the stop wave; the injected-
   divergence proof in the PR; `hooks:install` + `--no-verify` documented.

## 7. Phase 4 — Follow-ups (separate PRs, lower priority)

1. **Replay render pacing + interpolation:** drive replay stepping through the same
   `_timeAccum` accumulator as live play (decoupling sim speed from RAF refresh rate),
   call `snapshotPositions` before each replay `step()`, and pass a real alpha. Replays
   then look like live play; wave-end frame drops smooth instead of skipping. (Framing
   note: the current defect is refresh-rate-coupled pacing plus missing interpolation —
   the renderer already clamps alpha and falls back to current positions,
   `pixi-render.ts:1329-1341`; there is no unbounded-alpha stale lerp.)
2. **Full recorder unification:** extract action recording (fire/cursor/shop/wave_plan
   tick conventions) shared by `game.ts` and `sim-runner.ts`. Today they are duplicated
   and manually synchronized (see the "matches how the replay runner…" comment,
   `sim-runner.ts:122`). Section 4c already unified the boundary; this removes the rest.
3. **Separate gameplay and cosmetic RNG streams:** audit particle/decal/texture-only
   `rand()` calls and move them to a dedicated state-owned FX RNG (or stateless seeded
   visual noise). Gameplay RNG must be consumed only by state that can affect gameplay.
   Capture the FX RNG in anchors so death-clip visuals remain exact. This is not required
   for same-code convergence after Phase 1, but prevents a future cosmetic change from
   silently changing draft offers, schedules, or golden-seed outcomes again.
4. **Docs cleanup:** `docs/replay-system.md` + CLAUDE.md — document the new boundary
   contract (observational event sinks, the shared transition, `dt > 0` requirement),
   the current replay-version bump, checkpoint verification, and the guard commands; fix the stale
   "shop shows for 2 seconds" claim (code: 1000 ms, `game.ts:1655`).

## 8. Risks and open questions

- **Red tests on `main` (today).** `replay.test.ts:513` fails right now; the golden-seed
  canary is also stale (expected 24696, actual 20112). Phase 0 baseline-triages the canary,
  then lands the promoted red convergence test and Phase 1 fix in the same PR with the
  test commit first. Leaving either silently red is not an accepted starting state.
- **Feel change (Phase 1)** — frozen celebration behind the bonus overlay. Mitigation:
  feel-check gate 4f; if it reads badly, keep purely-visual layers animating render-side
  (scene-time driven), never sim-side.
- **Legacy replays refuse to load** (4e, user-approved). Anything saved before the fix —
  including old `window.__lastReplay` exports — is gone. Old death clips were divergent
  anyway; that is the bug being fixed. The perf fixtures are the only committed casualty
  and are regenerated as part of Phase 1.
- **Behavioral deltas from the contract change (intentional, verify in Phase 0):**
  removing the extra `update(g, 0)` and the `onEvent` gate changes RNG stream positions
  at boundaries relative to both old paths. All current-version recordings are made and replayed under
  the new contract, so this is invisible going forward — but it is why old replays cannot
  be grandfathered.
- **Counter migration changes absolute render IDs but not intended gameplay.** Version 5
  starts with state-owned counters; old replay/anchor ID streams are intentionally not
  preserved. Phase 0/1 tests establish the new exact full-vs-anchor stream before fixtures
  are regenerated.
- **Cross-engine drift** is explicitly out of scope for the Node guard and covered
  only by on-device checkpoint verification (Phase 2). If it is ever observed, that is a
  new investigation (trig/pow call sites in the sim), not a failure of this plan.
- **Checkpoint hash granularity:** `roundCoord` quantizes to 0.1 px
  (`replay-debug.ts:3-6`), so sub-0.1 drift hides until it crosses a threshold.
  Acceptable for the compact cross-engine product; the causal snapshot (§5a) and the
  exact per-tick causal comparisons in Phase 0/3 catch same-engine drift at its source.

## 9. Sequencing summary

| Phase | Deliverable                                                                                  | Gate                                                              |
| ----- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 0     | Baseline triage + causal-snapshot subset + four red replay/boundary/anchor tests             | Known reds explained; mechanism and hidden-counter failure pinned |
| 1     | Freeze + idempotent transition + observational sinks + state-owned IDs + replay version bump | Phase 0 green; `dt<=0` rejected; **user feel-check on iPhone**    |
| 2     | Complete causal schema + retained compact diagnostics + verification/banner/`--file`         | Non-empty field diffs; probe catch; real-replay verification      |
| 3     | Convergence guard (prior spec + human-path + observer-invariance + anchor passes)            | Timing budgets; injected-divergence proof                         |
| 4     | Replay pacing; recorder unification; FX RNG separation; docs                                 | Separate PRs                                                      |

Phases 0–1 are the fix. Phase 2 is the field diagnostic. Phase 3 is the insurance.
Do them in that order; a guard installed before the fix would certify the wrong thing.
The boundary contract is now defined without `dt=0` and with observational event sinks,
and the causal snapshot lands early enough (Phase 0 assertions, Phase 2 product) that
red/green tests see RNG divergence at its source — the failure mode the review's closing
note warned about ("Phase 3 certifying the wrong thing, only with more ceremony") is
closed by construction.
