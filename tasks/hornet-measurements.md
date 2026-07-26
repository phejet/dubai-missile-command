# Wild Hornets measurements

All `variants.ts` rows use 20 games. Deltas below roughly 10% are treated as unresolved.
The `average` bot rows are the primary baseline; the `BOT_SKIP`/`BOT_FOCUS_Y` rows are a
reduced-fire scenario, not a human-performance model.

## Phase 0 — pre-change baseline

### Primary (`average`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down/orphan |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ----------------: |
| 70000     | 1 pad            | 10,020 | 5.35 |           56 | 28.9% |  4.1% |             57.4% |
| 70000     | 2 pads           | 13,252 | 6.05 |          102 | 31.0% |  7.7% |             53.2% |
| 70000     | 2 pads + SkyMesh | 16,609 | 6.65 |          117 | 43.8% | 44.3% |              0.0% |
| 91000     | 1 pad            |  9,478 | 5.30 |           54 | 26.9% |  5.2% |             58.4% |
| 91000     | 2 pads           | 13,615 | 6.30 |          107 | 35.0% |  6.4% |             52.0% |
| 91000     | 2 pads + SkyMesh | 16,853 | 6.75 |          118 | 45.0% | 44.1% |              0.0% |

### Reduced-fire scenario (`BOT_SKIP=0.35 BOT_FOCUS_Y=700`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down/orphan |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ----------------: |
| 70000     | 1 pad            |  5,217 | 4.30 |           42 | 44.7% |  6.7% |             39.1% |
| 70000     | 2 pads           | 12,165 | 5.90 |           98 | 44.7% |  9.4% |             38.6% |
| 70000     | 2 pads + SkyMesh | 13,377 | 6.15 |          103 | 52.2% | 37.8% |              0.0% |
| 91000     | 1 pad            |  6,117 | 4.55 |           44 | 43.3% |  6.8% |             39.9% |
| 91000     | 2 pads           | 11,056 | 5.80 |           95 | 43.2% |  8.2% |             41.5% |
| 91000     | 2 pads + SkyMesh | 15,459 | 6.50 |          112 | 51.4% | 37.5% |              0.0% |

### Guardrails

- `src/game-sim.test.ts`: 134 passing.
- Determinism seed `12345`: score 118,618, wave 12, 390 missile kills, 169 drone
  kills, 407 shots; repeated run matched.

## Final narrow-fuze implementation

These rows include distinct death presentations, batch launch assignment, pass-below
relinquishing, the accel-aware preloaded-speed gate, the conditional MIRV-family filter,
SkyMesh loiter, and the uncatchable-case lead clamp. Fuze/blast remain 12/30.

### Primary (`average`)

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down | Loiter peak / mean p95 |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ---------: | ---------------------: |
| 70000     | 1 pad            |  9,340 | 5.25 |           53 | 27.1% |  0.2% |      62.0% |                0 / 0.0 |
| 70000     | 2 pads           | 12,632 | 6.05 |           95 | 35.7% |  0.8% |      55.5% |                0 / 0.0 |
| 70000     | 2 pads + SkyMesh | 17,350 | 6.80 |          113 | 51.6% | 27.6% |       0.0% |                6 / 3.4 |
| 91000     | 1 pad            | 10,685 | 5.35 |           55 | 29.4% |  0.1% |      60.3% |                0 / 0.0 |
| 91000     | 2 pads           | 12,976 | 6.05 |           97 | 34.4% |  0.6% |      57.7% |                0 / 0.0 |
| 91000     | 2 pads + SkyMesh | 15,941 | 6.65 |          111 | 52.6% | 27.4% |       0.0% |                6 / 3.5 |

### Reduced-fire scenario

| Seed base | Loadout          |  Score | Wave | Launches/run |   Hit |  Fuel | Stand-down | Loiter peak / mean p95 |
| --------- | ---------------- | -----: | ---: | -----------: | ----: | ----: | ---------: | ---------------------: |
| 70000     | 1 pad            |  6,046 | 4.45 |           42 | 47.8% |  1.1% |      41.1% |                0 / 0.0 |
| 70000     | 2 pads           | 11,397 | 5.80 |           89 | 47.2% |  0.8% |      44.1% |                0 / 0.0 |
| 70000     | 2 pads + SkyMesh | 14,301 | 6.25 |          101 | 57.7% | 24.6% |       0.0% |                6 / 3.0 |
| 91000     | 1 pad            |  6,086 | 4.55 |           43 | 47.2% |  0.1% |      43.0% |                0 / 0.0 |
| 91000     | 2 pads           | 10,496 | 5.60 |           84 | 48.5% |  1.1% |      42.4% |                0 / 0.0 |
| 91000     | 2 pads + SkyMesh | 14,854 | 6.30 |          103 | 60.0% | 22.9% |       0.0% |                6 / 3.0 |

### Decisions

- The feasibility gate cut ordinary-pad fuel-outs to 0.1–1.1%. Across the two
  primary seed sets, two-pad score stayed within the ±10% unresolved band.
- After the gate, hornets still launched 144 times at MIRV-family targets and killed
  13 (9.0%). The soft filter reduced that to 40 launches and four kills across the
  same 40 games; those launches occur only when no other target exists.
- SkyMesh hit the explicit concurrency cap of six, with mean per-run p95 concurrency
  of 3.0–3.5. The cap is doing real work and remains an obvious tuning lever.
- The plan's `3.0 / 5.6` solver hand-check says 100 ticks, but the continuous crossing
  is 99.47 and therefore rounds to 99. The implementation and test use the computed
  value rather than preserving the table's inconsistent rounding.

## Review follow-up — launch-gate ordering and batch jitter

Two defects found reviewing `dc6cd8f`, both in the launch picker.

1. **The MIRV-family filter ran before the feasibility gate.** `preferredTypes` could be
   non-empty but entirely unreachable, which collapsed `catchable` to empty and held the
   pad — with a catchable MIRV on screen. That inverts the soft filter's stated intent
   ("a pad with nothing else to shoot is not left idle"). Feasibility is now applied
   first and the role preference is applied to what survives it.
2. **Batching silently dropped the top-band random pick.** The pre-batch
   `pickHornetLaunchTarget` chose uniformly among targets within 25 points of the best;
   `pickHornetLaunchBatch` took the deterministic argmax instead, so pads replayed one
   answer. Restored as `HORNET_LAUNCH_SCORE_BAND = 25`, applied across the fullest
   assignments (tolerance scales with pad count).

### Primary (`average`), vs the committed narrow-fuze rows

| Seed base | Loadout          |  Score |      Δ | Wave | Launches/run |   Hit |  Fuel | Stand-down | Loiter peak / p95 |
| --------- | ---------------- | -----: | -----: | ---: | -----------: | ----: | ----: | ---------: | ----------------: |
| 70000     | 1 pad            | 10,659 | +14.1% | 5.45 |           56 | 28.1% |  0.4% |      61.3% |           0 / 0.0 |
| 70000     | 2 pads           | 13,182 |  +4.4% | 6.10 |           94 | 36.0% |  0.5% |      55.2% |           0 / 0.0 |
| 70000     | 2 pads + SkyMesh | 17,673 |  +1.9% | 6.75 |          112 | 52.6% | 27.1% |       0.0% |           6 / 3.6 |
| 91000     | 1 pad            | 10,290 |  -3.7% | 5.35 |           53 | 30.0% |  0.3% |      58.3% |           0 / 0.0 |
| 91000     | 2 pads           | 13,120 |  +1.1% | 6.15 |           98 | 37.5% |  0.7% |      53.7% |           0 / 0.0 |
| 91000     | 2 pads + SkyMesh | 16,337 |  +2.5% | 6.40 |          108 | 52.3% | 28.4% |       0.1% |           6 / 3.6 |

Five of six rows are inside the ±10% unresolved band. The one that is not (1 pad, seed
base 70000, +14.1%) is contradicted by the same loadout on seed base 91000 at -3.7%, so
it is unreplicated and not claimed as a win. Read this as neutral, which is what a
correctness fix should look like.

### Guardrails

- Unit: 469 passing (two added — catchable-MIRV fallback, and band jitter varying the pick).
- Golden-seed canary: 28,798 → 27,102 on seed 42 (single seed, -5.9%, inside noise).
- Determinism seed `12345`: score 127,490, wave 12, 461 missile kills, 169 drone kills,
  461 shots; repeated run matched.
- Fixtures re-recorded at replay v7. Only `perf-wave4-upgrades.json` changed — the one
  fixture whose bootstrap owns hornets. `perf-wave1` and `perf-burj-burning` are
  byte-identical, as expected.
- Browser: 17 smoke and replay tests passing. Typecheck, ESLint, Prettier clean.
- **Not re-run:** device perf baselines. The hornet render path is untouched.

## Review follow-up — the fuel-out death read as a despawn

Reported from play: "hornet just disappearing when running out of fuel looks like a bug."
It was. Two defects, both in the death presentation, neither caught by tests.

1. **The render fade was tied to a magic `18` while the sim's window was
   `HORNET_DYING_TICKS = 42`.** The fade finished at 43% of the death.
2. **`Math.max(0.35, …)` floored the sprite alpha**, so even a correct denominator
   could not reach zero.

Traced frame by frame, a fuel-out was: snap to 0.8 alpha, dim to 0.35 over 10 ticks,
then **24 ticks (0.4 s) of a constant-opacity sprite with no effects at all**, then
deletion at 35% opacity, 175 px below where it died. It never faded out — it was culled
mid-flight.

Fixed:

- The render fade is now derived from `HORNET_DYING_TICKS`, so drift is structurally
  impossible, and the sprite reaches exactly zero alpha on the frame the sim culls it.
- `HORNET_DYING_TRAIL_FRAC = 0.3` keeps the exhaust trail collapsing early (engine dead
  well before the airframe stops), expressed as a fraction rather than a bare number.
- Effects run the whole fall and thin out, instead of stopping a third of the way down.
- `HORNET_DYING_TICKS` 42 → 66 (~1.1 s, a 430 px fall) so the tumble reads as a fall.
- A hornet that reaches `GROUND_Y` now lands there with sparks and a dust burst rather
  than expiring in mid-air.
- `HORNET_IMPACT_PUFF = 5` gives the ending a beat. `standDown` deliberately stays faint
  — the power-loss/fuel-loss distinction Phase 1 built is preserved.

All knobs are in the `game-logic.ts` hornet block.

### Particle budget

`MAX_PARTICLES = 500` is a shared budget explosions draw down, so the extra emission was
measured against it (5 games, 2 pads + SkyMesh):

| Version | mean | p50 | p95 | p99 | max | ticks at budget |
| ------- | ---: | --: | --: | --: | --: | --------------: |
| before  |  165 | 122 | 476 | 493 | 499 |               0 |
| after   |  197 | 174 | 475 | 493 | 499 |               0 |

The tail is unchanged — it is pinned by explosions, which self-limit against the budget.
The change raises the floor (+19% mean), not the ceiling, and the budget is never
exhausted in either version. Peak concurrent dying hornets: 4.

### Guardrails

- Unit: 471 passing (+2: emission across the whole tumble, and ground landing).
- Golden-seed canary: 27,102 → 25,808 on seed 42. **This is RNG-stream reshuffling, not
  balance** — particle spawns draw from the sim RNG, and dying hornets deal no damage,
  reserve no targets and never fuze.
- Determinism seed `12345`: wave 12, 472 missile kills, 172 drone kills, 495 shots;
  repeated run matched.
- Fixtures re-recorded at v7; again only `perf-wave4-upgrades.json` changed.
- Browser: 17 smoke and replay tests passing. Typecheck, ESLint, Prettier clean.
- **Not re-run:** device perf baselines. Worth a look given the higher mean particle
  count, though the tail is flat.

## Optional 45/52 fuze trial — declined

The wide proximity warhead was measured against the final implementation at both seed
bases, then reverted.

| Profile      | Seed base | 1 pad score delta | 2 pads score delta | SkyMesh score delta |
| ------------ | --------: | ----------------: | -----------------: | ------------------: |
| `average`    |     70000 |             +5.8% |              -4.9% |              +20.5% |
| `average`    |     91000 |             -9.9% |              +4.7% |              +15.1% |
| reduced-fire |     70000 |             -3.8% |              +9.0% |              +16.1% |
| reduced-fire |     91000 |             +6.9% |             +24.6% |              +24.4% |

The replicated effect is a strong SkyMesh power increase, not a general consistency
improvement. Ordinary-pad results are mixed and mostly inside noise, so Phase 2b does
not land without a deliberate balance decision and controller feel-check.

## Bot re-tune

The average bot's priority order changed from
`patriot → launcherKit → emp → wildHornets` to
`wildHornets → emp → patriot → launcherKit`. Controlled 20-game seed blocks beat the
old order on both bases; a final independent 100-game sample averaged 24,964 points,
wave 7.3, and 0.875 shot efficiency.

## Final verification and performance

- Unit: 467 passing.
- Static checks: typecheck, ESLint, Prettier, and production build passing.
- Determinism seed `12345`: score 112,346, wave 11, 409 missile kills, 152 drone
  kills, 466 shots; repeated run matched.
- Replays: all three tracked replay-v7 fixtures validated.
- Browser: 17 smoke and replay tests passing.
- Final iPhone production build `3a7c432+4c2779e5` installed on Alex's iPhone 15 Pro.
- Median iPhone p95: 17 ms for both `perf-wave1` and `perf-wave4-upgrades`.
- Matching desktop and device reports:
  `perf-results/baselines/3a7c432+4c2779e5/`.

---

# Replay-driven behaviour fixes (2026-07-26)

Source: instrumented trace of the human replay `dmc-w6-s29898-1785030468297` (87 hornets,
waves 2–6, reproduced bit-exact at score 29,898). Seven findings; plan in
`.claude/plans/crispy-enchanting-spring.md`.

## What changed

| Phase | Change                                                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Commit-on-close lead: uses the solver's `interceptTicks` and ramps `HORNET_LEAD_FRACTION` → 1 as range/fuel fall (`HORNET_COMMIT_RANGE`, `HORNET_COMMIT_FUEL`). Non-zero lead when the solver returns `null`. |
| A     | Proximity fuze detonates on any live threat in range, not only `targetRef`.                                                                                                                                   |
| B     | Loiter replaced by **coasting** — see the revision below. Reacquire no longer passes `allowBelow`, which contradicted the dive-slack relinquish in the flying path and pinned hornets in place.               |
| C     | `dyingMaxTicks` derived per hornet from death altitude (`HORNET_DYING_TICKS_CAP`); render fade derives from it.                                                                                               |
| C     | Dead-man's fuze: running dry inside `blastRadius` of a live threat detonates instead of tumbling.                                                                                                             |
| D     | `updateHornetFlight` / `updateRoadrunnerFlight` / `updatePatriotFlight` split out and called from `updateWaveCompleteVisuals`; hornets retire into `standDown` on wave complete.                              |
| E     | `CURRENT_REPLAY_VERSION` 7 → 8; all three perf fixtures re-recorded.                                                                                                                                          |

## Behaviour metrics (20 games, 2 pads + SkyMesh, seed base 70000)

| Metric                             |           Before |                        After |
| ---------------------------------- | ---------------: | ---------------------------: |
| Longest sustained hornet freeze    |        115 ticks |                        **3** |
| Fuel lost while loitering          |        0.35/tick |                        **0** |
| Longest single hold                |        unbounded |             **60** (the cap) |
| Dying hornets culled mid-air       |          27 / 30 |      **0** (32 reach ground) |
| Ticks parked 12–45px behind target | 5.8s in one game | **0.8%** of live hornet-time |
| Fuel-out tumbles                   |          14 / 87 |                        **0** |

Sub-tick fuze misses were re-measured properly (relative-vector segment closest approach):
**9362 pairs, 0 misses**. The fuze radius was never the bug, so `HORNET_FUZE_RADIUS` stays 12.
`HORNET_PURSUIT_PENALTY` is present but set to **1.0** — the 1.15 originally planned was
calibrated on the _broken_ guidance and double-counted once commit-on-close landed.

## Balance (`variants.ts`, 20 games/config, both seed bases)

| Config |    pre |  post A (70000) |  post B (91000) |
| ------ | -----: | --------------: | --------------: |
| 1 pad  |  9,536 |   9,828 (+3.1%) |   9,877 (+3.6%) |
| 2 pads | 12,978 |  13,861 (+6.8%) |  14,022 (+8.0%) |
| 2+mesh | 19,027 | 21,404 (+12.5%) | 22,418 (+17.8%) |

1-pad and 2-pad deltas are inside the ±5–10% noise floor. The 2+mesh gain replicates on both
seeds and is a real SkyMesh buff — hornets now finish attacks they used to abandon.

> **Caveat on the harness `orphan` column** (0.1% → ~38% at 2+mesh): the vendored classifier
> predates the loiter scuttle and files it under `orphan`. Direct instrumentation shows the
> loiter outcome split is 23 reacquires / 43 scuttles per 20 games — not a regression in
> orphaning. The classifier needs teaching before that column means anything again.

## Verification

- Unit: 479 passing. Determinism seed `12345`: score 98,366, wave 11; repeat matched.
- Browser: 12 smoke + replay tests passing. The 2 `editor.spec.ts` failures are pre-existing
  (verified failing on a stashed clean tree) and unrelated.
- **Not yet done:** device feel-check and the iPhone/desktop perf re-baseline.

---

# Revision after device feel-check (2026-07-26, replay `dmc-w10-s104174`)

Two things came out of playing the deployed build. The replay reproduced bit-exact
(9,434 ticks, 104,174, wave 10, **0 divergences**), and confirmed the wins held in real
play: **0 fuel-out tumbles** (was 14/87), 0 fuel burned holding, hold capped at 60,
1.5% of hornet-time parked behind a target. But:

## 1. Loiter-then-scuttle read as broken (player report)

> "hornet visually stopping, hovering and then self destructing ... it attracts attention
> and raises 'what is it doing???' ... especially odd if there are active targets on the
> screen. Previous behavior looked more intuitive."

Correct, and the fix is better than the original design. An aircraft that **stops** demands
an explanation; one that flies on and scuttles does not. Loiter is replaced by a **coast**:

| Was                                                                        | Now                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Stop, orbit a fixed anchor for up to 60 ticks, then scuttle                | Retain heading with an upward bias, fly on at full speed for 30 ticks (0.5s), then scuttle |
| `phase: "loitering"`, `loiterX/Y/Angle`, cyan holding ring in the renderer | `phase: "coasting"`, `coastTicks` only, no indicator                                       |
| `HORNET_LOITER_*`                                                          | `HORNET_COAST_BURN` / `_MAX_TICKS` / `_CLIMB` / `_MAX_CONCURRENT`                          |

Measured: coasting hornets move **5.70 px/tick** (full speed — they never hover), coast
capped at exactly 30 ticks, 0 fuel burned. Balance is unchanged versus the hover version
and slightly better: hit rate 54.5% → **57.7%**.

## 2. A third instance of the wave-complete freeze

`game-sim.ts` returned early on `gameOverTimer` exactly as it did on `waveComplete`, so the
60-tick death sequence froze every airframe **and stopped the Burj's own explosion from
expanding**. `updateWaveCompleteVisuals` is renamed `updateHaltedSimVisuals` and is now
called from both halted paths.

| Metric                          |  Original | After first pass |     After coast + gameover fix |
| ------------------------------- | --------: | ---------------: | -----------------------------: |
| Longest sustained hornet freeze | 115 ticks |                3 | **1** (state transitions only) |
| Dying hornets culled mid-air    |   27 / 30 |                0 |                          **0** |
| Fuel burned while holding       | 0.35/tick |                0 |                          **0** |

> **Correction to the first pass:** the "16 mid-air culls" reported from the w10 replay were
> a probe artifact. The sim clamps `y` to `GROUND_Y` and removes the hornet in the same tick,
> so the last observable frame is always a few px short. All 30 landed (final observed Y
> 1512–1530, ground = 1530).

## Balance after the coast rework (20 games/config, both seed bases)

| Config |    pre | coast A (70000) | coast B (91000) |
| ------ | -----: | --------------: | --------------: |
| 1 pad  |  9,536 |   9,920 (+4.0%) |   9,964 (+4.5%) |
| 2 pads | 12,978 |  14,064 (+8.4%) |  14,091 (+8.6%) |
| 2+mesh | 19,027 | 22,465 (+18.1%) | 21,555 (+13.3%) |

1-pad and 2-pad remain inside the ±5-10% noise floor. The 2+mesh gain replicates.

`CURRENT_REPLAY_VERSION` 8 → **9**: the deployed build was v8, so v8 captures must be
rejected loudly rather than silently replaying against changed hornet behaviour. The harness
`loiterPeak`/`loiterP95` columns now read 0 for everything — they key off the removed
`"loitering"` phase and need updating before they mean anything again.

---

# Stand-down rework (2026-07-26, replay `dmc-w10-s109838`)

Coast confirmed good in play. Remaining report: hornets **blinking out of existence**
when SkyMesh is not owned.

Replay reproduced bit-exact (9,385 ticks, 109,838, wave 10, **0 divergences**). Cause was
the stand-down presentation, which combined three things into an invisible object:
the trail was cut dead, sprite alpha dropped to 0.55, and the tint was `0x555962` —
near-black against the night sky. It then fell for a median of **82 ticks (1.4s)** unseen.

Scale: **29 of 212 hornets (14%)**. Only 7 were pre-SkyMesh — but that was **78% of all
pre-mesh hornets**, which is why it read as a no-mesh problem. The other 22 were
post-SkyMesh, caused by a vestigial `HORNET_COAST_MAX_CONCURRENT = 6`: a leftover from
when holding was unbounded. Coasting is hard-capped at 0.5s and cannot accumulate, so the
cap only ever forced hornets to drop out of the sky. Removed.

## Change (user decision: coast then self-destruct)

Every hornet that loses its target now coasts and scuttles, with or without SkyMesh.
The upgrade's value is now purely _"yours can go looking for another target first"_ —
`retargetsRemaining` gates the reacquire in both the flying and coasting paths.

`standDown` survives only for wave-end retirement, and its presentation is fixed: cold grey
exhaust instead of no trail, sprite alpha 0.9 instead of 0.55, tint `0x9298a4` instead of
`0x555962`, smoke at 0.85x instead of 0.4x, and a 4-particle impact puff.

## Balance — a real buff, and noisier than the sample resolves

| Config |    pre | scuttle A (70000) | scuttle B (91000) |
| ------ | -----: | ----------------: | ----------------: |
| 1 pad  |  9,536 |    10,333 (+8.4%) |   11,026 (+15.6%) |
| 2 pads | 12,978 |   15,136 (+16.6%) |    13,478 (+3.9%) |
| 2+mesh | 19,027 |   21,181 (+11.3%) |   22,614 (+18.8%) |

Golden seed 42: 28,854 -> 34,214 (+18.6%).

**The two seed bases disagree in sign versus the previous build on 2 of 3 configs**
(2 pads: +7.6% vs -4.4%; 2+mesh: -5.7% vs +4.9%), so the _incremental_ effect of the
scuttle is not resolved at 20 games per seed. Versus the original baseline the direction is
clear and up; the magnitude is not. Needs a larger sample before anyone tunes against it.

The harness `hit%` column also undercounts now — its classifier files a scuttle under
`orphan`, so `hit%` fell (31.0% -> 28.7% at 1 pad) while score rose. Score is the only
column here that means what it says.

`CURRENT_REPLAY_VERSION` 9 -> **10**.
