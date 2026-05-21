# Plan: Two-Launcher Refactor + Difficulty Rebalance

## Design intent

Two coupled changes to fix a mobile-first prediction problem and reduce
late-wave screen saturation.

**Change A — Geometry.** Remove the center launcher. Keep only left
(x=60) and right (x=860). **Firing rule stays "closest primed
launcher"** — with two launchers symmetric across the canvas, this
degenerates to "side under the tap" most of the time, which gives the
predictable mental model we wanted, while preserving the existing
fallback behavior when the natural side is reloading (the player asked
for a shot, they get a shot — no dead-tap on mobile). The 3-launcher
prediction problem was caused by the center launcher's off-axis x=560
geometry, not by the closest-primed rule itself.

**Burst cap: hardcoded floor of 3.** The natural
`activeLauncherCount * multiplier` math would drop the base burst from
3 → 2 with two launchers; we floor it at 3 (and 6 with Double Mag) so
burst feel is preserved. Burst is a shared pool across both launchers.

**Change B — Difficulty rebalance.** Flatten the late-wave quadratic
budget so late waves stop relying on "throw a lot of stuff." Shift
difficulty into geometric precision (the new arc-only firing model) and
threat quality.

---

## Phase 0 — Discovery & invariants

### 0.1 `LAUNCHERS` source of truth
- `src/game-logic.ts:177-181` — the array literal we're collapsing.
  Three entries today: `{60, GROUND_Y-5}`, `{560, GROUND_Y-5}`,
  `{860, GROUND_Y-5}`.
- `src/game-logic.ts:183-185` — `getGameplayLauncherPosition(index)`.
  Pure function; no length assumption. Safe.

### 0.2 Hard length assumption: tuple typing in state
- `src/types.ts:534-537` — `GameState` declares `ammo`, `launcherHP`,
  `launcherFireTick`, `launcherReloadUntilTick` as
  `[number, number, number]`. TypeScript hard-pin. All consumers below
  depend on it.

### 0.3 Hardcoded length-3 init arrays
- `src/game-sim.ts:377-380` — `initGame()` defaults.
- `src/game-sim-shop.ts:328-333` — `prepareWaveStart`: ammo refill cast
  and `[0, 0, 0]` reload literal.
- `src/editor-scene.ts:27, 28, 369, 370` — editor fake state.
- `src/game.ts:112-114` — HUD zero-state default.

### 0.4 `LAUNCHERS.forEach` loops (length-agnostic; verify)
- `src/game-sim.ts:477-480` — `missileTargetCandidates`.
- `src/game-sim.ts:696-701` — `getSplitCandidateTargets` (MIRV).
- `src/game-sim.ts:2101-2115` — missile-vs-launcher collision.
- `src/game-sim.ts:2336-2347` — drone-vs-launcher collision.
- `src/game-sim.ts:2835-2837` — flare salvo L2 refill.
- `src/game-sim.ts:2860-2881` — EMP rank 2 per-launcher rings + ammo.
- `src/game-logic.ts:269-271, 290-299, 577-582` — `pickTarget`,
  `fireInterceptor` autopick, `getLauncherReadiness`.
- `src/pixi-render.ts:1703-1724, 1945-1980, 2199-2211, 2686,
  2976-2985, 3047-3051` — render. All `LAUNCHERS.map/forEach`.

### 0.5 The "closest primed launcher" autopick to replace
- `src/game-logic.ts:281-330` — `fireInterceptor`. Lines 288-299 are the
  autopick loop. **Single chokepoint for the rule change.**
- Callers pass a target point (no launcher index): `src/game.ts:907`,
  `src/replay.ts:111`, `src/headless/sim-runner.ts:178`,
  `src/headless/bench-draft.ts:93`, `src/headless/shot-audit.ts:143`.
  All inherit the new rule automatically.

### 0.6 Player input → fire pipeline
- `src/game.ts:904-913` — `launchPlayerShot`.
- `src/game.ts:924-944` — `requestPlayerFire` (burst limiter).
- `src/game.ts:946-958` — `releaseBufferedPlayerFire`.
- `src/game.ts:960-980` — `handlePointerDown`.

Push the deterministic side-by-tap rule **down into `fireInterceptor`**
(uses `targetX` vs `CANVAS_W/2`). Bot, replay, and headless bench all
call `fireInterceptor` directly — they get it for free.

### 0.7 Bot brain
- `src/headless/bot-brain.ts:1` — imports `LAUNCHERS`.
- `src/headless/bot-brain.ts:319-333` — `pickLauncher(tx, ty, g)`: bot's
  own closest-alive pick for lead computation. **Must mirror the new
  sim rule** or the bot will lead off the wrong origin.
- `src/headless/bot-brain.ts:682-718` — `botDecideUpgrades` iterates
  `g.launcherHP.length`. Length-agnostic.

### 0.8 Tests with 3-launcher assumptions
- `src/game-logic.test.ts:34-47` — `makeGameState` defaults.
- `src/game-logic.test.ts:160-202` — `pickTarget` cases; line 197
  ("closest launcher is #1 (x=550)") references the center launcher.
- `src/game-logic.test.ts:204-272` — `fireInterceptor` "closest primed"
  suite; full rewrite.
- `src/game-sim.test.ts:852-870` — flare salvo L2
  (`launcherHP: [1, 0, 1]`).
- `src/game-sim.test.ts:1505-1557` — EMP rank 2; asserts
  `empRings.length === 12` for 3 alive launchers. Recount under
  2 launchers (verify against `pushEmpRingBurst`).
- `src/headless/bot-brain.test.ts:9-10, 164-165` —
  `[1,1,1]`/`[10,10,10]`.
- `src/replay.test.ts:227` — `repair_launcher_0` action; still valid.
- `src/replay.test.ts:461-462` — checkpoint shape; length-agnostic.
- `src/ui.test.ts:17-19` — `[0,0,0]` defaults.
- `e2e/smoke.spec.ts:64, 74` — `expect(state.launcherCount).toBe(3)`.
- `e2e/manual-bot-replay-convergence.spec.ts:16-20, 46-59` — duplicate
  `LAUNCHERS` array with center at x=**550** (note: not 560 — pre-existing
  drift, harmless once collapsed) and its own `leadTarget`.

### 0.9 Replay/save format
- `FireAction` (`src/types.ts:671-677`) carries `x, y,
  ignoreLauncherReload` — no launcher index. **Shape unchanged.**
- Replay `version: 2` set at `src/game.ts:763`.
- But replays recorded under the 3-launcher rule will **desync**: many
  fires aimed at center-of-screen used to fire the center launcher;
  under the new rule, tap.x near 450 fires from x=60 or x=860 — different
  muzzle origin → different lead angle → different intercept point.
- Action log doesn't carry which launcher actually fired; cannot
  translate.
- **Bump to `version: 3`.** Treat `version < 3` as "best-effort,
  expect divergence; do not enforce checkpoint hash equality." See
  `ReplayCheckpoint.hash` at `src/types.ts:753-768`.
- `src/replay-debug.ts:77-79, 111-113` — checkpoint serializer dumps
  `[...g.X]`; length-agnostic but cross-version comparisons will see
  length 2 vs 3.

### 0.10 Editor / sprites / catalog
- Editor fake state: covered in 0.3.
- `src/sprite-catalog.ts:159-171` — launcher sprite by variant
  (title/gameplay/damaged), not by slot. Safe.
- `src/pixi-textures.ts:134-200` — texture cache by variant key. Safe.

### 0.11 HUD / per-launcher ammo
- `src/game.ts:112-114, 135-137` — HUD snapshot copies arrays.
- `src/ui.ts:40-42` — `HudSnapshot` uses `number[]`. Length-agnostic.
- No inline `ammo[0]`/`ammo[1]`/`ammo[2]` accesses found in `ui.ts`.
  Verify visually during smoke.

### 0.12 Defense-site positions
- `src/game-logic.ts:187-204` — `patriot:334`, `wildHornets:206`,
  `roadrunner:678`, `phalanx:553` (Burj rooftop), `launcherKit:772`,
  `ironBeam:BURJ_X (460)`. **None at x=560.** None move.
- `src/game-logic.ts:512-517` — `getPhalanxTurrets`: T1 at `(553, 1498)`
  (Burj roof), T2 adds `(860, 1504)` (right launcher roof), T3 adds
  `(59, GROUND_Y-30)` (left launcher ground). T2/T3 co-locate with
  surviving launchers — intentional cover, retain.

### 0.13 Overhead defensive gap (intended)
- With center gone, band x≈460-720 has no ground launcher under it.
  Burj proximity / Iron Beam at x=460 cover the left side of that
  band; right side leans on Iron Beam range only. This is the design.
- No code assumes a launcher sits at center for coverage; collisions
  are checked per-launcher (see 0.4).

### 0.14 Wave-spawner tuning surface
- `src/wave-spawner.ts:163-243` — `WAVE_TABLE[1..8]` (set-piece curve).
- `src/wave-spawner.ts:245-248` — `threatValueCapForBudget` ratios
  (0.92/0.88/0.82).
- `src/wave-spawner.ts:392-409` — `getWaveConfig` w1–w8 (table).
- `src/wave-spawner.ts:410-428` — `getWaveConfig` w9+; quadratic on
  line 412.
- `src/wave-spawner.ts:635-648` — `addGroupLulls`; `lullBase` on 643.
- `src/wave-spawner.ts:973-980` — SATURATION tactic re-cap
  (`concurrentCap * 1.18`).

### 0.15 Perf-baseline replays
- `perf-results/baselines/{b8fff9c, 1782cd2+3dabf711, 56c4ddf+8bce7f9f}
  /perf-wave{1,4-upgrades}-{iphone,desktop}.json` — six baselines, all
  recorded under 3-launcher rules. Must rerecord (CLAUDE.md notes this
  is the workflow when sim changes).

---

## Phase 1 — Geometry change (Change A)

Order matters: lift the tuple typing first so the rest type-checks.

### Step 1.1 — Tuple types
- `src/types.ts:534-537` — each `[number, number, number]` →
  `[number, number]`.
- Invariant: arrays stay positionally aligned (0 = left, 1 = right).

### Step 1.2 — `LAUNCHERS` constant
- `src/game-logic.ts:177-181` — drop the middle entry. Keep x=60 and
  x=860.

### Step 1.3 — Initializer arrays
- `src/game-sim.ts:377-380` → `[11, 11]`, `[1, 1]`, `[0, 0]`, `[0, 0]`.
- `src/game-sim-shop.ts:328-333` → fix tuple cast and `[0, 0, 0]`.
- `src/editor-scene.ts:27, 28, 369, 370` → length-2 values.
- `src/game.ts:112-114` → HUD default `[0, 0]`.

### Step 1.4 — Burst-cap floor
- `src/game-logic.ts:556-562`. `getLauncherBurstChargeCap` currently
  returns `Math.ceil(activeLauncherCount * multiplier)`. With 2
  launchers alive, base cap would drop to 2 (default multiplier=1) or
  4 (Double Mag multiplier=2). We don't want that.
- Change to:
  ```ts
  const naturalCap = Math.ceil(activeLauncherCount * multiplier);
  const floor = hasDoubleMag(g) ? 6 : 3;
  return Math.max(floor, naturalCap);
  ```
  Or equivalently apply a different multiplier when launcher count
  drops. The intent is: base burst stays at 3, Double Mag stays at 6,
  regardless of how many launchers are alive.
- The closest-primed rule at `fireInterceptor:288-299` stays as-is and
  inherits the geometry change automatically (it now picks between 2
  launchers instead of 3). No rule swap needed.

### Step 1.5 — Bot-brain `pickLauncher`
- `src/headless/bot-brain.ts:319-333`. **No change needed.** The
  existing closest-distance loop continues to mirror the sim's
  closest-primed rule. Both sides now select between 2 launchers
  instead of 3 — the logic is identical.

### Step 1.6 — Tests in `game-logic.test.ts`
- 34-47: length-2 tuple defaults.
- 160-202: rewrite `pickTarget` cases referencing `LAUNCHERS[1]`/[2]
  (the center entry no longer exists).
- 204-272: `fireInterceptor` "closest primed" suite **mostly stays as
  written** — the rule is unchanged, only the launcher count differs.
  Specific touch-ups:
  - The case at ~line 250 ("picks closer launcher when both ready"):
    update expected coordinates from x=60/560/860 to x=60/860.
  - "skips destroyed launchers even if another has zero ammo" — still
    valid; verify expected fallback target with 2-launcher pool.
  - "allows a short burst across ready launchers" — burst cap stays at
    3 due to the floor in step 1.4; assertion math should *not* need
    to change. Verify.
  - "skips launchers that are still reloading" — still valid.

### Step 1.7 — Other test files
- `src/game-sim.test.ts:852-870, 1505-1557` — length-2; recount EMP
  ring magic numbers (line 1514 expects 12, line 1526 expects 9 — both
  depend on alive-launcher count, recompute against
  `pushEmpRingBurst`).
- `src/headless/bot-brain.test.ts:9-10, 164-165` → `[10, 10]`, `[1, 1]`.
- `src/replay.test.ts:227` — `repair_launcher_0` still valid. Any
  `repair_launcher_2` in stored replays becomes a no-op (out-of-range
  guarded by `repairLauncher` at `game-sim-shop.ts:287-297`).
- `src/ui.test.ts:17-19` → length-2.
- `e2e/smoke.spec.ts:74` → `toBe(2)`.
- `e2e/manual-bot-replay-convergence.spec.ts:16-20, 46-59` — drop
  center entry; replace `leadTarget`'s closest-launcher loop with the
  same deterministic side pick used by sim+bot.

### Step 1.8 — Replay version bump
- `src/game.ts:763` — bump `version: 2` → `version: 3`.
- `src/replay.ts` — early-log if `replayData.version < 3`; do not throw,
  so manual debug playback still works. Checkpoint hash mismatch will
  surface naturally during re-execution.
- Update `docs/replay-system.md` documenting the breakage (format shape
  unchanged; sim rule changed).

---

## Phase 2 — Difficulty rebalance (Change B)

### Step 2.1 — Quadratic flatten past w8
- `src/wave-spawner.ts:412`. Change:
  ```ts
  const budget = 105 + w * 40 + w * w * 8;
  ```
  to:
  ```ts
  const cappedQuad = Math.min(w, 4); // caps at w=12 (since w = wave - 8)
  const budget = 105 + w * 40 + cappedQuad * cappedQuad * 8;
  ```
  Quadratic component plateaus at 128 past wave 12; linear `w*40`
  continues. Starting point; verify against bot.

### Step 2.2 — `concurrentCap` ratio
- `src/wave-spawner.ts:245-248`. Lower `threatValueCapForBudget` ratios
  from 0.92 / 0.88 / 0.82 to roughly 0.78 / 0.72 / 0.65.
- Watch `Math.max(...)` on lines 405 and 424 — the floor formulas may
  swallow the new lower ratio. Reduce line 424 floor (e.g.
  `35 + w * 8 + w * w * 1.2`).
- Consider reducing per-wave `cap` column in `WAVE_TABLE` by ~10–15%
  on lines 165, 175, 185, 195, 205, 215, 225, 235.

### Step 2.3 — `lullBase` floor
- `src/wave-spawner.ts:643`. Change
  `Math.max(90, 150 - Math.min(45, wave * 5))` to
  `Math.max(110, 165 - Math.min(45, wave * 5))`.

### Step 2.4 — `WAVE_TABLE` w1–w8 audit
- Lines 163-243. Hand-tuned; budget+cap auto-drop via 2.2. Don't touch
  in v1 unless smoke shows w1–w8 feels wrong.

### Step 2.5 — SATURATION re-cap multiplier
- `src/wave-spawner.ts:974`. Leave 1.18× as-is; with the lower base cap
  it still produces a meaningful saturation event. Revisit if SAT
  waves feel weak.

---

## Phase 3 — Coupled rebalance

### Step 3.1 — Launcher Kit / Armor Kit (decided: base HP=1)
- **Decision:** ship with base HP=1, Armor Kit unchanged (1→2). Sharper
  stakes, Armor stays meaningful from day one. Reasoning: HP 1→2 is an
  easy live tuning bump if playtest shows runs are too brittle; the
  reverse feels like a nerf.
- No code changes required for base HP — the existing
  `getLauncherMaxHp` at `src/game-logic.ts:552-554` and initializer at
  `src/game-sim.ts:378` already produce `[1, 1]` once the tuple is
  collapsed in Step 1.3.
- Watch in playtest: if a launcher dies wave 3-4 in a typical bot run
  and the run never recovers, bump base to 2 and shift Armor to 2→3.
- **Repair-cost re-tune likely.** `repairCost(wave)` at
  `src/game-sim-shop.ts:289-297` is currently tuned for "lose 1 of 3
  launchers" frequency. With 2 launchers + HP=1, repair becomes a more
  common shop choice. May need a small cost reduction; flag for
  post-bot-benchmark tuning.

### Step 3.2 — `pickTarget` tuning
- `src/game-logic.ts:261-279`. Knobs:
  - Line 263: `_rng() < 0.3` (Burj-direct chance). Effective Burj
    pressure shifts up automatically because each launcher is now 1/2
    of pool instead of 1/3. Leave at 0.3 initially; watch bot results.
  - Line 277: `_rng() < 0.7 ? 0 : 1` (closest vs second-closest). The
    `Math.min(all.length - 1, ...)` already handles small lists.
- No code change required for v1. Add a comment near 269 documenting
  that the launcher count halved and 0.3 may need recalibration.

### Step 3.3 — Phalanx / Iron Beam / Patriot positions
- Verified in 0.12: no site at x=560. Phalanx at x=553 is on the Burj
  roof, visually decoupled. **No change needed.**

### Step 3.4 — Bot config retuning (`bot-config.json`)
- `targeting.maxInFlightBase` (6 → ~4) and `maxInFlightHigh`
  (10 → ~7): fewer launchers means fewer in flight before reload.
- `targeting.cooldownNormal` (18 → 22-26): bot must respect side-locked
  reloads or waste clicks on a reloading side.
- `targeting.cooldownLowAmmo`: revisit; per-launcher ammo unchanged but
  total ammo halved.
- `upgradePriority`: bump `launcherKit` higher in `default`/`perfect`/
  `good`/`average`. In `perfect`, move to slot 2.
- Final values: come from `node src/headless/train.js` post-impl.
  These are seeds.

### Step 3.5 — Active-launcher count in burst-charge math
- Resolved in Step 1.4. Burst cap is hardcoded to a floor of 3 (and 6
  with Double Mag) so it doesn't sag with the launcher count drop.

---

## Phase 4 — Verification

### 4.1 Tests that will fail before update
- `src/game-logic.test.ts` — `pickTarget` and `fireInterceptor` blocks
  (158-272).
- `src/game-sim.test.ts` — flare L2 (852-870), EMP rank 2 (1505-1557).
- `src/headless/bot-brain.test.ts` — fixtures (9-10, 164-165).
- `src/replay.test.ts` — any test relying on checkpoint hashes (search
  for `cp.hash`).
- `src/ui.test.ts` — fixtures (17-19).
- `e2e/smoke.spec.ts` — launcher count (74).
- `e2e/manual-bot-replay-convergence.spec.ts` — duplicate `LAUNCHERS`.

### 4.2 New tests to add
In `src/game-logic.test.ts`:
- "tap on the left half fires from left launcher (closest)":
  `fireInterceptor(g, 200, 300)` → expect interceptor at
  `LAUNCHERS[0].x` (x=60).
- "tap on the right half fires from right launcher (closest)":
  `fireInterceptor(g, 700, 300)` → expect interceptor at
  `LAUNCHERS[1].x` (x=860).
- "tap near center falls through to whichever side is primed":
  `launcherReloadUntilTick[0] = 50` (left reloading), tap at x=400
  (closer to left), `tick=10` without `ignoreLauncherReload` → expect
  fire from right (x=860) because left is busy. Documents the fallback
  feature.
- "burst cap remains 3 with two launchers": query
  `getLauncherBurstChargeCap(g)` with `launcherHP=[1,1]` → expect 3
  (regression test for the floor).
- "burst cap is 6 with Double Mag and two launchers": same setup
  with Double Mag node owned → expect 6.

In `e2e/smoke.spec.ts`: click at x<450 → assert interceptor.x === 60;
click at x>=450 → assert interceptor.x === 860 (after canvas-coord
scaling). Note: this assumes both launchers are ready, which is the
typical state at the moment of first click.

### 4.3 Headless sim plan
- Before any code: `node src/headless/sim-runner.js 12345`. Save
  wave-reached and score.
- After Phase 1+2+3: same seed. Expect deterministic but different
  outcome (both geometry and rule changed). Goal: run completes
  without crash/assert.
- `node src/headless/train.js`: get wave-distribution histogram. Median
  wave-reached target: similar or +0.5 (rebalance should ease total
  saturation despite halved firepower).

### 4.4 Manual smoke
- `npm run dev`. Waves 1-3 desktop:
  - Tap left half → left fires; tap right half → right fires.
  - Tapping a reloading side feels like a missed input (no queue).
  - Muzzle flash on correct launcher only.
  - No phantom center launcher render.
- iOS: `npm run ios:deploy`. Repeat on hardware. Touch-side determinism
  should *increase* tactile satisfaction.

### 4.5 Playwright assertions to update
- `e2e/smoke.spec.ts:74` — `toBe(2)`.
- `e2e/smoke.spec.ts:80+` — click test at 0.5/0.3 of canvas (x=450)
  picks right (x=860). Tighten to `assert interceptors[0].x === 860`.

---

## Phase 5 — Risk register

1. **Replay/checkpoint hash divergence.** Old replays in
   `perf-results/baselines/` will fail hash checks. Mitigation: bump
   to v3, gate strict hash equality by `version >= 3`, rerecord
   baselines. Document in `docs/replay-system.md`.

2. **Perf baseline re-record.** Six files invalidated under
   `perf-results/baselines/`. Workflow: implement Phase 1+2+3, run
   perf harness, capture new medians, commit new buildId directory.

3. **Bot retraining required.** Current bot priorities and timings
   tuned for 3 launchers + steeper quadratic. Without retuning, bot
   under-performs; bot-replay fixtures deviate. Workflow: run
   `/train-bot` skill or `node src/headless/train.js` repeatedly,
   adjust `bot-config.json` per 3.4 until median wave-reached returns
   to or exceeds baseline.

4. **`game-sim.test.ts` EMP ring magic numbers.** Lines 1514 (`toBe(12)`)
   and 1526 (`toBe(9)`) bake in 3-launcher arithmetic. Careful recount
   against `pushEmpRingBurst`, not blind decrement.

5. **Boundary tap UX edge case.** Resolved by retaining closest-primed
   rule — there is no hard boundary; ties at x=450 are decided by the
   first launcher in `LAUNCHERS` order, and reload state naturally
   smooths the experience. No special handling required.

6. **Manual-bot-replay-convergence spec drift.** Spec at line 16-19
   already had `x: 550` not 560 — pre-existing minor divergence.
   Collapsing to 2 gives a clean slate. Document in commit body.

7. **Iron Beam coverage shift.** Iron Beam fires from BURJ_X=460 — the
   new overhead-gap center. Already covers that band by design
   (`game-sim.ts:1735-1759`), but leans harder without center launcher.
   Watch ironBeam kill-share in bot data; possibly buff T1 cooldown.
   Flag, don't fix in v1.

8. **`isMissileAnglePlayable` candidate filtering.** `game-sim.ts:
   471-514` selects approach angles using alive launchers. Smaller
   candidate set → more missiles forced into synthesized-startX path
   (510-513). Low risk; verify early waves still feel right.

9. **Center-of-screen tactical habit.** Players accustomed to firing
   through center will need to retrain. This is the intended demand
   but a "first 30 seconds feel" risk. The brief acknowledges no new
   visual feedback; reconsider only if smoke testing strongly suggests
   a one-time hint is needed.

10. **Burst-charge cap drop hidden in active-launcher math.** Resolved
    in Step 1.4: cap is floored at 3 (and 6 with Double Mag) so it
    doesn't sag with the launcher count drop.

11. **Repair-cost may need a small reduction.** `repairCost(wave)` at
    `game-sim-shop.ts:289-297` was tuned for 1-of-3 loss frequency.
    With 2 launchers + HP=1, launcher repairs become more common.
    Watch bot/playtest data; reduce by ~15-25% if repair shop choice
    starves the upgrade economy.

12. **Base HP=1 sensitivity.** Starting at HP=1 is the sharper choice
    (Armor Kit meaningful from day one). If playtest shows runs
    routinely die wave 3-5 to a single early launcher loss, bump base
    to 2 and shift Armor to 2→3 — a small `getLauncherMaxHp` change
    plus initializer update. Document this as a live-tunable.

---

## Critical files for implementation
- `src/game-logic.ts` — LAUNCHERS array, fireInterceptor rule,
  pickTarget tuning, `getLauncherMaxHp`, burst-cap.
- `src/game-sim.ts` — initGame defaults, collision loops, EMP/flare
  per-launcher refill.
- `src/wave-spawner.ts` — budget formula, threatValueCapForBudget
  ratios, `lullBase`, `WAVE_TABLE`.
- `src/types.ts` — tuple types.
- `src/headless/bot-brain.ts` — `pickLauncher` rule must mirror sim.
- `src/headless/bot-config.json` — retune.
