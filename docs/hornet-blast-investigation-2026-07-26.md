# Hornet and explosion investigation — 2026-07-26

> **Audience:** whoever picks this up next. This is an investigation log, not a design spec.
> It records what was measured, what was believed and turned out to be wrong, and why the
> code ended up the way it did. The measured numbers live in
> [`tasks/hornet-measurements.md`](../tasks/hornet-measurements.md); the reusable process
> lessons live in [`tasks/lessons.md`](../tasks/lessons.md).

**Trigger:** "review this replay, focus on wild hornets — I see a lot of odd behaviours."

**Outcome:** three commits. Seven hornet behaviours fixed, then two rounds of device
feel-check that overturned part of the design, then a blast-damage bug that turned out to
be systemic and explained a long-standing "buggy F-15" complaint.

---

## 1. Method

Every claim in this investigation came from replaying a **human** replay with per-tick
instrumentation, not from reading code and reasoning. The replays reproduced bit-exact
(same final tick, score, wave, 0 divergences), which is what makes the traces trustworthy.

Three tools, in decreasing order of trust:

| Tool                                             | What it is good for                       | What it cannot tell you                             |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| Instrumented replay of a human run               | Per-hornet lifecycle, exact failure cases | Balance — it is one run                             |
| `docs/analysis-harness/wild-hornets/variants.ts` | Balance with a **forced** loadout         | Anything the forced loadout excludes (e.g. Patriot) |
| Batch of full bot games (40+ seeds)              | Aggregate balance                         | Attribution — builds diverge per seed               |

**The single most important methodological fact learned here:** any sim change reshuffles
draft RNG, so the bot buys a _different build_, so **single-seed before/after comparisons
are meaningless**. This burned the investigation once (see §5.3) and is why the golden-seed
canary now carries an explicit warning comment.

---

## 2. The seven original findings

From `dmc-w6-s29898` (87 hornets, waves 2–6, score 29,898, 4,699 ticks).

| #   | Finding                                                                                                                                                                                                                      | Evidence                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Airframes freeze at wave clear.** `update()` returns on `g.waveComplete` before `updateAutoSystems`, so hornets, roadrunners and Patriots hang mid-arc for the cleared timer plus the bonus screen, then are deleted cold. | **1,096 frozen hornet-ticks (18.3 s)**; one hornet froze mid-tumble for 115 consecutive ticks                                    |
| 2   | **Base hornets drop dead when the player kills their target.**                                                                                                                                                               | 16 stand-downs, all pre-SkyMesh; **12 of 15 hornets in wave 3**; median 62 ticks alive with 105/168 fuel left                    |
| 3   | **Loiter was a one-way trap.** Loitering burned fuel, so the reacquire gate `interceptTicks <= life * 0.9` tightened every tick a hornet waited — once gated out, permanently gated out.                                     | 1,631 loiter ticks (27 s); reachable threat existed in 1,222 of them and **98 % were refused**                                   |
| 4   | **Loiter happened too low.** Orbit anchored wherever the hornet stalled.                                                                                                                                                     | 58 % of loiter time below y=900; max y=1204, _below_ the Burj roofline                                                           |
| 5   | **The intercept solver's answer was computed and discarded.** `hornetInterceptTicks()` ran every tick, then guidance flew `d / speed` at a fixed 0.3 under-lead.                                                             | **42 of 54** successful hits took longer than predicted, p90 **2.27×**, max 3.71×. On `null` solution lead collapsed to **zero** |
| 6   | **The launch gate had no margin.**                                                                                                                                                                                           | predicted intercept median 124, p90 148, **max 151 against a gate of 151**; 51/87 launched at targets >1000 px away              |
| 7   | **Dying hornets were deleted in mid-air.** Fixed 66-tick tumble covers ~400 px of fall.                                                                                                                                      | **27 of 30** culled mid-air, typically 300–500 px up                                                                             |

---

## 3. Decisions taken (by the controller-holder, not the analysis)

| Question             | Decision                                                                                           | Note                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Solver vs guidance   | Commit-on-close hybrid — keep the lazy chase far out, tighten to true intercept as range/fuel fall | preserves the character the code comment calls deliberate |
| Stand-down frequency | **No sim change** — presentation only                                                              | keeps the SkyMesh incentive intact                        |
| Loiter               | No fuel cost, then **1 s cap, then self-destruct**                                                 | later overturned, see §5.1                                |
| Freeze scope         | Fix hornets, roadrunners **and** Patriots                                                          | same root cause                                           |

---

## 4. Hypotheses — validated

| Hypothesis                                                             | Verdict                                                                                                              | Evidence                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update()` early-returns starve the auto-systems                       | **CONFIRMED**, and in **three** places: `waveComplete`, `gameOverTimer`, and (by design, correctly) the bonus screen | freeze 115 ticks → 1                                                                                                                                           |
| Loiter's fuel burn causes an unrecoverable gate spiral                 | **CONFIRMED**                                                                                                        | 98 % refusal rate; fixed by `HORNET_COAST_BURN = 0`                                                                                                            |
| Guidance ignores the solver and under-leads into a stable stern offset | **CONFIRMED**                                                                                                        | p90 2.27× overrun; 347 hornet-ticks (5.8 s) parked 12–45 px behind a target                                                                                    |
| A fixed tumble length cannot serve all altitudes                       | **CONFIRMED**                                                                                                        | 27/30 → 0 after deriving `dyingMaxTicks` from death altitude                                                                                                   |
| Explosions are slower than the threats they must kill                  | **CONFIRMED**                                                                                                        | blast front 120 px/s vs threats up to 890 px/s; **1 of 59** hornet fuzes leaked its own trigger                                                                |
| The F-15's blast is broken                                             | **CONFIRMED, worse than expected**                                                                                   | `initialRadius 0` ⇒ **2 px** lethal disc on the first sample; scenario test showed it killed only near-stationary targets and fast threats _tunnelled through_ |

---

## 5. Hypotheses — disproved, corrected, or overturned

This section is the point of the document. Most of the work was here.

### 5.1 The 1-second hover was "solved" by every metric and still read as broken

After capping loiter at 1 s: 0 fuel burned, hold bounded, freeze gone, score up. Every
number said solved. On device it read as a malfunction — the hornet visibly **stopped**,
hovered, then exploded, which pulls the eye and asks "what is that doing?", worst of all
next to threats it was ignoring.

The controller-holder's fix was better than the measured one: **keep flying, then scuttle**.
It cost nothing (balance unchanged, hit rate 54.5 % → 57.7 %) and the elaborate
"drifting patrol anchor" idea was dropped as over-engineering.

> **Lesson:** the metric measured whether the hornet was _stuck_. The complaint was that it
> looked like it was _deciding_. A full stop reads as malfunction regardless of duration.
> The metric that would have caught it — px moved per tick while in the state — did not
> exist until after the report.

### 5.2 "Fuze tunneling" — right answer, invalid first measurement

Initial claim: no sub-tick tunneling, 0 skips. **The measurement was wrong** — it compared
_post-update_ hornet/target positions, which is not what the fuze reads. Re-measured with
the fuze's real semantics (relative-vector closest approach on the segment between tick
samples): **9,362 pairs, 0 true misses.** The conclusion survived, but only by luck; the
first check could not have detected the thing it claimed to rule out.

### 5.3 Single-seed score deltas are build divergence, not balance

Golden seed 42 moved −24 % after the explosion change. Investigated as a balance
regression. It was not: the two runs bought **completely different builds**
(`flare + skyHunterMesh` vs `launcherRapidReload + a second hornet pad`) because the RNG
shift reshuffled draft offers. Aggregate effect over 40 games was **−2.7 %**.

A wrong theory was pursued first — that the combo multiplier was collapsing because
auto-defenses were stealing the player's kills (`processRootExplosionCombo` only counts
`playerCaused` explosions, and a player shot with 0 kills resets combo to 1). Plausible,
mechanically real, and **not what happened**: combo resets were 11 vs 12, mean combo 2.55
in both.

### 5.4 "Decoupling is a buff, biggest for Patriot" — wrong

Predicted a large buff from blast **area** (Patriot 6.25×). Measured: **−2.7 % over 40
games**, and a consistent small _nerf_ in the hornet-only harness. The reasoning error: the
blast always reached full radius eventually, so the only threats affected are those that
escape _during_ inflation — a small population. And Patriot detonates _on_ its target, so
its primary kill was never at risk.

> **Lesson:** area is the wrong unit. The right question is "who escapes during the growth
> window", which depends on relative motion, not on how big the disc eventually gets.

### 5.5 "The player's interceptor starts at radius 0" — wrong, and the correction mattered

Claimed the player's own interceptor was more exposed than the hornet. False: that line is
the **F-15's** interceptor. The player's uses `initialRadius = INTERCEPTOR_PLAYER_BLAST_RADIUS`
— created at full radius, instant. This correction reframed the whole fix: instant-damage
was not a new model, it was **already the model for the weapon the player fires most**, and
that is precisely why the bug never showed up on player shots.

### 5.6 `HORNET_PURSUIT_PENALTY = 1.15` — a constant that encoded the bug

Derived from the measured 2.27× flight-time overrun, then applied _on top of_ the guidance
fix that removed the overrun. It rejected reachable targets twice over and broke four tests
immediately. Left in the codebase at a documented **1.0** as a knob rather than deleted.

### 5.7 Two probe artifacts reported as findings

- **"16 mid-air culls"** in `dmc-w10-s104174`: the sim clamps `y` to `GROUND_Y` and removes
  the hornet in the _same tick_, so the last observable frame is always a few px short. All
  30 landed (final observed Y 1512–1530, ground = 1530).
- **"orphan 0.1 % → 38 %"** in the harness: the vendored classifier predates the coast
  scuttle and files it under `orphan`. Not a regression. That column, plus `hit%` and
  `loiterPeak`, still need teaching before they mean anything.

### 5.8 Aggregate frozen-tick counts hid the real freeze

A post-fix probe reported 180 "frozen hornet-ticks" — nearly attributed to a benign
transition cost. Tracking the **longest consecutive run** instead surfaced a real 72-tick
freeze: loiter reacquire passed `allowBelow: true`, the flying path relinquished
below-targets on the very next statement, and the hornet oscillated in place every tick,
resetting its own hold counter so the scuttle cap could never fire.

> **Lesson:** when the complaint is "it hangs", measure the longest run, not the total. And
> when two code paths disagree about what is a valid target, expect an **oscillation**, not
> a stall.

---

## 6. What the code looks like now

**Guidance** — lead ramps from `HORNET_LEAD_FRACTION` to a true intercept as range or fuel
falls (`HORNET_COMMIT_RANGE`, `HORNET_COMMIT_FUEL`); a `null` solution gets best-effort
pursuit lead instead of zero. The proximity fuze detonates on **any** live threat in range,
not only `targetRef`.

**Coasting** — a hornet that loses its target keeps its heading with an upward bias, flies
on for `HORNET_COAST_MAX_TICKS` (0.5 s) at full speed, then **scuttles with a live
warhead**. Free of fuel cost. No concurrency cap — coasting cannot accumulate, so the old
cap only ever forced hornets out of the sky. Sky Hunter Mesh's value is now purely _"yours
can go looking for another target first"_.

**Deaths** — `dyingMaxTicks` derives from death altitude. Running dry inside blast radius
detonates. `standDown` survives only for wave-end retirement, and is legible (cold grey
exhaust, alpha 0.9, findable tint, heavy smoke, impact puff).

**Halted-sim visuals** — `updateHaltedSimVisuals()` is called from both `waveComplete` and
`gameOverTimer`, so airframes and explosions keep animating instead of freezing.

**Explosions** — damage resolves against `ex.maxRadius` from creation; `ex.radius` is
animation only, scaled by `EXPLOSION_GROWTH_TICKS`.

---

## 7. Results

| Metric                            |                    Before |                After |
| --------------------------------- | ------------------------: | -------------------: |
| Longest sustained airframe freeze |                 115 ticks |                **1** |
| Fuel-out tumbles                  |                   14 / 87 |                **0** |
| Dying hornets culled mid-air      |                   27 / 30 |                **0** |
| Fuel burned while holding station |               0.35 / tick |                **0** |
| Stand-downs without SkyMesh       |  78 % of pre-mesh hornets |            **2.9 %** |
| Hit rate, 2 pads + mesh           |                    52.3 % |           **57.6 %** |
| F-15 blast vs a moving target     | kills only if ≈stationary | kills at every speed |

Balance across the whole investigation: **+4 % to +19 %** depending on config and seed,
with 1-pad and 2-pad inside the ±5–10 % noise floor and the 2+mesh gain replicating on both
seed bases. The explosion decoupling on its own was neutral (−2.7 %).

---

## 8. Known-open

- **Perf re-baseline.** The sim changed repeatedly; everything under `perf-results/baselines/`
  is stale and the replay fixtures were re-recorded four times.
- **Harness classifier.** `hit%`, `orphan` and `loiterPeak` in
  `docs/analysis-harness/wild-hornets/variants.ts` key off states that no longer exist or
  misfile the scuttle. Score is the only column there currently telling the truth.
- **CI has 2 red checks, both pre-existing.** Four Pixi suites fail to load under CI with
  `ReferenceError: navigator is not defined` (pixi.js in a node test environment) — which
  means **CI silently runs ~31 fewer tests than local**. Plus 1 replay test and 5 E2E.
- **`EXPLOSION_GROWTH_TICKS = 6` is feel-bearing and unvalidated on device.** It changes how
  every explosion in the game opens; Patriot most of all (660 ms → ~140 ms).
- **Replay version churn.** 7 → 11 across this work. Any archived replay below 11 is
  rejected by design rather than silently diverging.
