# Wild Hornets — launch, targeting & role analysis

**Date:** 2026-07-25
**Scope:** the hornet block of `updateAutoSystems()` (`src/game-sim.ts` ~960–1101), plus
`pickHornetLaunchTarget` / `pickHornetTarget` / `pickHornetRetargetTarget`.
**Status:** analysis only — no gameplay code was changed by this document. Every counterfactual
below was implemented behind a temporary env flag, measured, and reverted.

This document states the **current conclusions**. The investigation trail — claims that were
measured, overturned, and replaced, plus the negative results worth not repeating — is in
[Appendix C](#appendix-c--investigation-trail-superseded-claims-and-negative-results).

---

## 1. What this analysis is for

**The goal is consistency, not throughput.** Hornets are one role among several auto-defense
systems (Patriot, Roadrunner, Iron Beam, Phalanx). None is meant to be perfect — each has
strengths and weaknesses the player builds a strategy around. So the question is not "how do
we make hornets kill more", it is:

> Can a player form an accurate intuition about what hornets can and cannot do, and does the
> system honour that intuition without odd edge cases?

Two consequences for reading what follows:

- **Score is a diagnostic, not the objective.** A change that is score-neutral but removes a
  confusing edge case is a **win**. A change that raises score by blurring the role is not.
- **Drama is a feature.** "The hornet chased it down and finally got it" is a moment the player
  remembers. Guidance that produces a tail chase is doing its job. The failure is not the
  chase — it is the chase that ends in something the player cannot explain.

---

## 2. Findings, ranked by "does this break player intuition?"

| #      | Finding                                                                                                                                                                | Breaks intuition?                    | Verdict                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| **L1** | **Three different outcomes render identically.** Fuel-out, orphan-suicide and a real kill all call `boom()` in hornet yellow; the first two are _byte-identical_ calls | **Yes — the core problem**           | Fix. No balance impact                                                                       |
| **L2** | Hornet commits to targets it cannot reach with the fuel it has                                                                                                         | **Yes**                              | **Solved** (§5.3) — accel-aware fuel gate takes fuel-outs from ~9% to ~0.3% at no score cost |
| **L3** | 12px proximity fuze under a 30px warhead — the hornet visually overlaps the threat and nothing happens; the blast then teleports onto the target                       | **Yes**                              | Fix (§5.2)                                                                                   |
| **L4** | Hornets launch at MIRVs and go **0-for-33** — a class Roadrunner and Patriot both own outright                                                                         | **Yes**                              | Fix, score-neutral (§5.4)                                                                    |
| **L7** | The engagement rule is "anything unassigned" — not something a player can hold in their head, so the role reads as fuzzy                                               | **Yes**                              | Fix (§5.6): "drones and bombs always; missiles only while still slow". Score-**positive**    |
| **L5** | Left pad silently does 33% more work than the right (iteration order); dry 51% vs 39%                                                                                  | Mildly                               | Fix, free (§5.5)                                                                             |
| **L6** | Hornet climbs _away_ from a target below it (`HORNET_DIVE_SLACK`)                                                                                                      | Rare but yes                         | Fix, cheap (§5.5)                                                                            |
| **P1** | _Proposal:_ SkyMesh hornets loiter on reduced fuel instead of fizzling when out of work                                                                                | Turns L1 into a feature              | **Measured (§6):** +11–30%, fuel-outs halved, 11% of kills come from reactivated loiterers   |
| —      | Tail-chase geometry from 30% under-leading                                                                                                                             | **No — this is the drama**           | **Keep.** Only fix the uncatchable case                                                      |
| —      | Cross-side launches (33% of all)                                                                                                                                       | No                                   | **Keep** — arriving cross-side hornets convert _better_ (§4.4)                               |
| —      | Reaching for missiles when bombs/drones are covered                                                                                                                    | No                                   | **Keep** — forcing role purity is measurably worse (§4.3)                                    |
| —      | 39–53% orphan rate at rank 1                                                                                                                                           | No — it is SkyMesh's reason to exist | Balance call, not a bug                                                                      |
| —      | Slow speed / short range                                                                                                                                               | No — this _is_ the role's weakness   | **Keep**                                                                                     |

**The single highest-value change is L1, and it is not a balance change.** A hornet that runs
out of fuel, a hornet whose target was killed by someone else, and a hornet that scores a kill
are three completely different events the player currently sees as the same yellow puff. No
targeting tuning will build intuition while the feedback channel is this ambiguous.

---

## 3. Method

An instrumented harness mirroring `src/headless/sim-runner.ts`'s loop, which:

- forces an exact hornet loadout via `buyDraftUpgrade` (free, no draft randomness),
- **buys nothing else**, so hornets are the only auto-defense and every effect is attributable,
- snapshots hornet and threat positions _before_ each `update()` and diffs `g.hornets`
  afterwards to classify every hornet's fate.

Three loadouts — 1 pad, 2 pads, 2 pads + SkyMesh — 20 games each, identical seeds across every
variant, and headline results replicated on a second seed base (70000 and 91000).

### 3.1 Two player profiles

The stock headless bot fires interceptors far more accurately and often than a human, and never
adopts the division-of-labour strategy a real 2-pad player uses (ignore the bottom of the
screen, let hornets have it, spend attention on fast movers up top). That inflates the orphan
rate, because the bot keeps killing targets out from under its own hornets.

Results are therefore reported under two profiles:

- **bot-default** — the stock bot.
- **realistic** — 35% of firing opportunities dropped, and threats below y = 700 ignored.

The difference is large:

| 2 pads                     | Hit rate  | Orphaned  |
| -------------------------- | --------- | --------- |
| bot-default                | 31.0%     | 53.2%     |
| drop 40% of shots          | 35.6%     | 47.0%     |
| ignore threats below y=700 | 43.8%     | 41.4%     |
| **realistic (both)**       | **44.7%** | **38.6%** |

**Unless stated otherwise, all numbers below are the realistic profile.**

> **Caveat on 1-pad realistic rows:** ceding everything below y=700 only makes sense with two
> pads. With one pad it leaves half the map undefended, so 1-pad realistic _scores_ (~5,200)
> reflect a strategy mismatch, not hornet quality. Read 1-pad conversion rates, not scores.

### 3.2 A classifier trap worth recording

The first pass reported a **0.2% detonation rate** — a measurement bug, not a game bug.
`updateAutoSystems()` runs _before_ `updateExplosions()` inside `update()`, so a hornet's own
blast kills its target within the same tick. Classifying from post-update state makes every
successful hit look identical to "target died to something else."

The fix, and the reason the numbers here can be trusted: reproduce the sim's own branch
conditions against **pre-update** state. Because `updateAutoSystems` runs first, every branch a
hornet takes this tick is evaluated against positions from the end of the previous tick.

---

## 4. How the system actually behaves

### 4.1 Constants and envelope

| Quantity                 | Value                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Hornet spawn             | left pad x=206, right pad x=622, y = `GAMEPLAY_SUPPORT_SITE_Y - 20` = **1388**                     |
| Speed                    | `rand(4.476, 6.72)` px/tick                                                                        |
| Life                     | **168** ticks                                                                                      |
| Warhead / proximity fuze | 30px / **12px**                                                                                    |
| Magazine                 | `HORNET_SITE_CAPACITY = 2` per pad, **independent**; reload 60 ticks per slot; launch gap 24 ticks |
| Threat eligibility       | `t.y >= 0` — the instant it crosses the top edge                                                   |

**Magazines are per-pad and not shared.** Two pads means two independent 2-round magazines, not
one pooled 4-round one. `reloadTimer` only accumulates while `ammo < capacity` and is **reset to
0 the moment the magazine fills**, so partial progress is never banked; a destroyed pad stops
reloading entirely. Burst 2, then sustain ~1 hornet/second per pad.

**Target assignment _is_ shared** even though ammo is not — `getHornetAssignmentCounts` reads
all of `g.hornets` globally, and `if (unassigned.length === 0) return null` is a global
hold-fire. The pads coordinate on _who to shoot_, not on _how much ammo is left_.

### 4.2 The role map — hornets in context

| System           | Reach                                         | Speed                  | Owns (top scoring priority)                                   |
| ---------------- | --------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| **Phalanx**      | 100–160px bubble                              | hitscan, probabilistic | whatever is nearest — point defense                           |
| **Iron Beam**    | Burj-bound at any range; 219–368px for spares | instant                | _only_ threats predicted to hit the Burj                      |
| **Wild Hornets** | **752–1129px**                                | 4.5–6.7 px/tick        | bomb 400, drone 300, damaged 200, **missile 100**             |
| **Roadrunner**   | life 600 × 10.1–17.6 = **6,000–10,500px**     | 10.1–17.6 px/tick      | **MIRV 1000**, stack3 900, shahed238 850, bomb 700, drone 500 |
| **Patriot**      | long, turn-rate limited                       | guided                 | **MIRV 100**, stack3 88, mirv_warhead 80, missile 60          |

The hornet is the **short-reach, slow, anti-drone/anti-bomb specialist** — exactly what the shop
text says. Its own scoring agrees. Roadrunner has 5–9× the reach and explicitly owns the MIRV
class; Patriot owns it too.

### 4.3 Where the role boundary leaks — and why forcing it is wrong

| 2 pads                               | Share of launches | Hit rate  |
| ------------------------------------ | ----------------- | --------- |
| In-role (bomb / drone)               | 63.6%             | **54.5%** |
| Out-of-role (missile / MIRV / stack) | 36.4%             | **27.5%** |

Out-of-role converts at half the rate — but the hornet is _pushed_ out of role, not choosing
badly. `pickHornetLaunchTarget` only ever considers **unassigned** threats, so once every bomb
and drone is covered the remaining pool is missiles:

| Of the out-of-role launches…                                         |           |
| -------------------------------------------------------------------- | --------- |
| in-role threats on screen but **all already assigned**               | **58.8%** |
| a free in-role threat existed and was passed over (genuine mis-pick) | 9.4%      |
| no in-role threat existed at all                                     | 31.8%     |

**Forcing role purity is measurably worse.** Letting a pad double up on an already-covered bomb
rather than take a missile, both seed sets:

|                           | 2 pads            | 2 pads + SkyMesh | Orphan rate (2 pads) |
| ------------------------- | ----------------- | ---------------- | -------------------- |
| base                      | 12,165 / 11,056   | 13,377 / 15,459  | 38.6%                |
| force in-role (double up) | **9,817 / 9,136** | 15,056 / 13,760  | **51.9%**            |

The second hornet on a covered bomb just gets orphaned when the first connects. A 27.5% shot at
a missile beats a redundant shot at a bomb. **Current behaviour is correct and should stay.**

The one boundary that _should_ be enforced is **MIRVs** — 0 for 33 at 2 pads, against a class
Roadrunner scores at 1000 and Patriot at 100. Excluding them is score-neutral-to-positive
(12,165 → 12,320 at 2 pads; 13,377 → 14,637 at SkyMesh) and removes a visible absurdity.

### 4.4 Cross-side launches are fine — the pads reach across the map, and that is OK

`game-sim.ts:849–853` computes each pad's half-map preference over **unassigned** threats only:

```ts
const localHalf =
  siteKey === "wildHornetsLeft"
    ? unassigned.filter((target) => target.x < BURJ_X) // BURJ_X = 460
    : unassigned.filter((target) => target.x >= BURJ_X);
const spatialPool = localHalf.length > 0 ? localHalf : unassigned; // ← falls back to whole map
```

So the fallback does not mean "my side is clear", it means "my side has nothing left over".
Cross-side launches are **32.6%** (2 pads) / **34.1%** (SkyMesh) of all launches, and **63–64%**
of them fire while the pad's own half still has live threats — all merely spoken for.

**This is not a defect.** Raw hit rates are essentially identical (44.4% cross vs 44.8% same),
and conditioning on hornets that _actually arrived_ reverses the apparent penalty:

| 2 pads     | Arrived (closed <150px) | → Converted | Median CPA |
| ---------- | ----------------------- | ----------- | ---------- |
| same-side  | 61.4%                   | 73.0%       | 10.3px     |
| cross-side | 54.0%                   | **82.2%**   | 9.6px      |

A cross-side hornet that arrives is the **better** intercept — it crosses the threat's track
instead of trailing it, and passes closer. The entire penalty is _arrival_, and the cause is
fuel (cross-side non-arrivals fuel out at 16.3% vs 8.7%), which §5.3 fixes directly.

### 4.5 Guidance: under-leading is the drama, but the uncatchable case is broken

```ts
const hLeadFrames = d / h.speed; // ignores target motion
const hlx = hTarget.x + (hTarget.vx || 0) * hLeadFrames * 0.3; // 30% lead, deliberate
```

The 30% multiplier produces a curved pursuit that arrives slightly behind the target — 36–57% of
close passes end in trailing geometry, converting at 57–60% vs 66–70% head-on. **That is the
chase the player enjoys, and it should stay.**

What is genuinely broken is the uncatchable case. Missiles compound `accel = 1.018` every tick
and late-wave threats can outrun a 4.5–6.7 px/tick hornet. When no intercept solution exists the
time estimate degenerates and the hornet flies off in a near-constant wrong direction. Naively
raising the multiplier to 1.0 is **worse than doing nothing** (1 pad 10,020 → 9,593; SkyMesh
16,609 → 14,867, bot-default). A closed-form solve with a pure-pursuit fallback is the fix.

### 4.6 Throughput is reload-limited

Mean ammo sits at **0.69–1.03 of 2**, and pads are dry **39–51%** of the time:

| Pad   | Launches/run | Mean ammo | Dry       | At cap (no reload progress) |
| ----- | ------------ | --------- | --------- | --------------------------- |
| left  | 58.1         | 0.69 / 2  | **51.0%** | 20.8%                       |
| right | 43.5         | 1.03 / 2  | 39.1%     | 41.1%                       |

The left pad does 33% more work because `getActiveHornetSiteKeys` always returns left before
right and the launch loop iterates in that order — it gets first refusal on every target, every
tick, including the right pad's half.

This constraint explains most negative results in Appendix C: **holding fire generally trades
launch volume for a conversion gain too small to pay for it.** The one exception is a hold whose
condition is rare and provably correct (§5.3).

---

## 5. The fixes

### 5.1 L1 — give the three outcomes three different presentations

A hornet ends its life three ways (`game-sim.ts:1025`, `:1050`, `:1088`):

```ts
// 1025 — ran out of fuel / left the screen
boom(g, h.x, h.y, h.blastRadius * 0.5, COL.hornet, false, onEvent, h.blastRadius * 0.2);
// 1050 — target killed by someone else, self-destructs
boom(g, h.x, h.y, h.blastRadius * 0.5, COL.hornet, false, onEvent, h.blastRadius * 0.2);
// 1088 — actually killed something
boom(g, hTarget.x, hTarget.y, h.blastRadius, COL.hornet, false, onEvent, h.blastRadius * 0.5);
```

The first two are **byte-identical**; the third differs only in radius and position. With the
measured outcome mix (~45% kill, ~9% fuel-out, ~39% orphan at 2 pads), the player watches
near-identical yellow puffs of which **fewer than half mean what they appear to mean**.

| Outcome  | Should read as                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kill     | the current bright detonation — keep                                                                                                                         |
| Fuel-out | engine sputter → tumble → small puff. The sputter particles at `game-sim.ts:1029` already exist; let them finish the story instead of ending in a detonation |
| Orphan   | a visible "stand down" — loses power and falls, not an explosion                                                                                             |

Once these read differently, short reach stops being a mystery and becomes a **learnable
weakness** — which is what the role is supposed to have.

### 5.2 L3 — widen the fuze and detonate at the hornet's own position

The hornet must close to 12px to trigger while carrying a 30px warhead — it is asked to score a
direct hit with an area weapon. The value sitting just outside the trigger:

| Ever closed within | 1 pad → detonated | 2 pads | SkyMesh |
| ------------------ | ----------------- | ------ | ------- |
| 100px              | 74.5%             | 71.2%  | 67.7%   |
| 40px               | 85.7%             | 85.7%  | 80.8%   |
| 25px               | 90.8%             | 89.6%  | 86.5%   |

Near misses (closed inside 100px, never detonated) are **9.9% / 12.5% / 20.9%** of all hornets.

Note `boom()` fires at `hTarget.x, hTarget.y` — **the target's position, not the hornet's**. The
blast is already teleported today; at 12px nobody notices, at 45px it would read as an obvious
lie. The honest version — detonate at the hornet, warhead sized to cover the fuze — performs as
well or better (bot-default):

| Variant                                  | 1 pad      | 2 pads     | SkyMesh    |
| ---------------------------------------- | ---------- | ---------- | ---------- |
| base (fuze 12, blast on target)          | 10,020     | 13,252     | 16,609     |
| fuze 45, blast on target                 | 10,299     | 15,384     | 19,453     |
| **fuze 45, blast at hornet, warhead 52** | **10,682** | **14,453** | **20,246** |

Kills/run for that last row: **18.8 / 43.3 / 70.8** against a baseline of 16.2 / 31.4 / 51.5.

**Needs a feel-check** — hornets will pop slightly early rather than kissing the target.

### 5.3 L2 — accel-aware fuel gate

Missiles compound their velocity every tick (`m.vx *= m.accel ** dt`, `accel = 1.018`). Comparing
straight-line distance to `speed × life` ignores both that the target is descending _toward_ the
pad and that it is speeding up the whole way — over ~120 ticks, `1.018^120 ≈ 8.4×`.

Correct closed form (the sim applies accel _before_ the move, so distance after `n` ticks is
`v0 · a(aⁿ − 1)/(a − 1)`), solved by bisection for the smallest `n` where
`speed · n ≥ |P_threat(n) − P_launch|`:

| Missile v0 | Hornet speed | Accel-aware               | Naive constant-velocity |
| ---------- | ------------ | ------------------------- | ----------------------- |
| 1.3        | 4.476        | **137 ticks — reachable** | 240 — "unreachable"     |
| 2.0        | 4.476        | **120 ticks — reachable** | 214 — "unreachable"     |
| 3.0        | 5.6          | **100 ticks — reachable** | 161                     |

Against 168 ticks of fuel, a top-spawning missile is comfortably reachable in **every** case the
naive model rejected. And the prediction is accurate enough to be a guarantee:

|                                 | 2 pads    | SkyMesh   |
| ------------------------------- | --------- | --------- |
| median actual ÷ predicted ticks | **1.01×** | **1.01×** |
| 90th percentile                 | 1.06×     | 1.10×     |

Pursuit curve and wobble cost ~1% of flight time at the median, so a **10–15% margin makes it a
real guarantee**. It also correctly classifies the failures: **98.9%** of actual 2-pad fuel-outs
were flagged as not catchable.

Gating launch selection on `n ≤ 0.9 × life`, holding the slot when nothing qualifies:

|                  | Fuel-out        | Launches/run | Hit rate | Score (seed A / B)  |
| ---------------- | --------------- | ------------ | -------- | ------------------- |
| **1 pad** base   | 6.7%            | 42           | 44.7%    | 5,217 / 6,117       |
| **1 pad** gated  | **0.5% / 0.2%** | 43           | 47.3%    | **6,786 / 7,393**   |
| **2 pads** base  | 9.4%            | 98           | 44.7%    | 12,165 / 11,056     |
| **2 pads** gated | **0.3% / 0.9%** | 87           | 50.4%    | **12,173 / 12,395** |

**Fuel-outs go from ~9% to ~0.3% and score does not suffer.**

Note this _reverses_ the general "never hold the slot" rule (§4.6). Holding is wrong when the
reason is "my half is busy" — common and arbitrary. It is right when the reason is "nothing on
screen is physically catchable" — rare and provably correct.

### 5.4 L4 — exclude the MIRV class

0-for-33 against a target class two other systems own outright. Score-neutral-to-positive, and it
sharpens the role boundary the player is supposed to learn. See §4.3.

### 5.5 L5 / L6 — two cheap consistency fixes

- **Alternate pad iteration order** so the left pad stops taking first refusal on every target
  every tick (§4.6). Free.
- **Stop the climb-away branch** (`game-sim.ts:1073–1080`): a hornet whose target is more than
  80px _below_ it drifts upward at half speed, away from the thing it should kill. Only 0.2–0.5%
  of hornets, but precisely the kind of edge case that reads as broken.

---

### 5.6 Defining the role by an explicit rule (so the player can learn it)

Separate question from "does it work": **what single rule best lets a player predict what
hornets will and will not engage?** Today the answer is "anything unassigned", which is not a
rule a player can hold in their head — and it is why the role reads as fuzzy.

Three candidate rules were implemented and measured (2 pads, realistic, seed A / seed B):

| Rule                                                                            | Score                          | Launch/run | Hit   | Orphan    | Fuel-out | In-role           | Mean target speed |
| ------------------------------------------------------------------------------- | ------------------------------ | ---------- | ----- | --------- | -------- | ----------------- | ----------------- |
| base — "anything unassigned"                                                    | 12,165 / 11,056                | 98 / 95    | 44.7% | 38.6%     | 9.4%     | 63.6%             | 3.02              |
| **A.** altitude border, engage below y=400                                      | 11,468 / 11,453                | 79 / 76    | 46.9% | **45.1%** | **0.4%** | 64.9%             | **4.17**          |
| **B.** flat speed cap, ignore anything > 3.0 px/tick                            | 12,342                         | 91         | 48.6% | **30.7%** | 14.1%    | **57.6%**         | 2.28              |
| **C.** role-shaped: drones/bombs always, ballistic only while slow (<= 3.5-4.5) | **12,712 / 11,535 ... 13,148** | 92 / 99    | 45.4% | 39.1%     | 10.2%    | **66.8% / 68.5%** | 2.77              |

**C wins, and is the only one that is score-positive on both seeds** (+4.3% to +8% at 2 pads,
+9.8% at SkyMesh: 13,377 -> 14,693). It also raises in-role share and lowers the mean speed of
what hornets engage — it does what the rule says on the tin.

Stated as player-facing intuition, C is one sentence:

> **Hornets take drones and bombs, whatever they are doing. They will take a missile only while
> it is still slow — once it has built up speed, that is the Patriot's and Roadrunner's job.**

That is learnable, matches the shop text ("anti-bomb and anti-drone specialist"), and matches the
physics: a slow hornet genuinely cannot run down an accelerating ballistic threat.

#### Why the altitude border fails its own rationale

The border is the most _visible_ rule — hornets consistently activating at an altitude is
something a player can infer without any UI. But it does not deliver "hornets are not meant for
fast movers". It delivers the **opposite**:

- **Mean engaged target speed goes UP, 3.02 -> 4.17 px/tick.** Missiles accelerate as they
  descend, so waiting for a threat to cross a line means engaging it _faster_, not slower.
- **Orphan rate goes UP, 38.6% -> 45.1%.** Waiting does not dodge the player's interceptors,
  because those are already in flight while the threat descends — the threat is still alive when
  the hornet commits, and dies shortly after.
- Kills happen lower (median kill Y 811 -> 879), i.e. closer to what is being protected.

It does eliminate fuel-outs (9.4% -> 0.4%) and is roughly score-neutral, so it is not a bad
mechanic — it is just a poor expression of _this_ role. §5.3's fuel gate achieves the same
fuel-out result at no score cost.

#### Why a flat speed cap is wrong

It cuts orphans nicely (38.6% -> 30.7%, because the player's interceptors preferentially chase
fast threats, so avoiding those avoids contested targets) — but it also excludes **diving Shaheds
and other fast drones**, which are exactly what an anti-drone specialist should be eating.
In-role share drops to 57.6%, the worst of any variant.

This penalty is **understated above**: these runs end around wave 6, so late-wave diving-Shahed
density is under-represented. In the waves where those dominate, a flat cap would blind hornets
to their primary job.

#### Composition

C is a _targeting_ rule and does not fix fizzle — fuel-outs stay ~10%. It composes with §5.3
(the accel-aware fuel gate, which takes fuel-outs to ~0.3%): **C decides what is our job, the
fuel gate decides whether we can actually get there.** Two rules answering different questions,
and only C needs to be legible to the player.

C also largely subsumes §5.4's MIRV exclusion, since MIRV busses are fast ballistic threats and
fail the speed test on their own once accelerated.

---

## 6. Proposal, measured: SkyMesh loiter

§5.3 leaves one thing unresolved — with the fuel gate in place, the remaining SkyMesh fuel-outs
are hornets that ran out of _work_, not fuel:

| SkyMesh fuel-outs, with gate                                       |           |
| ------------------------------------------------------------------ | --------- |
| had a live target when fuel ran out — genuinely failed to catch it | **4.0%**  |
| had **no target at all** — nothing left to hunt                    | **96.0%** |

`pickHornetRetargetTarget` requires `t.y <= h.y + HORNET_DIVE_SLACK`, so a hornet high on screen
with all remaining threats below it correctly finds nothing, and coasts to a fizzle. That is
reasonable behaviour rendered as a failure — **L1 again**.

The proposal leans into the upgrade's own fantasy: **when nothing is catchable, hold station on
reduced fuel instead of dying, and stay available as a standing mesh.**

### Mechanic as tested

- Reached only from the retarget branch, so it is **SkyMesh-exclusive by construction** —
  verified: 1-pad and 2-pad results are byte-identical to base. It differentiates the upgrade
  rather than buffing hornets generally.
- On finding no valid target, the hornet anchors and flies a slow ellipse around that point.
- **Fuel burn drops to 0.25×**, so 168 ticks of fuel becomes ~670 of station time.
- It re-scans every tick and breaks off the moment a catchable target appears.
- Optional: while loitering, drop the `HORNET_DIVE_SLACK` restriction so it can also engage
  _below_ itself — a mesh defends its patch in all directions.

### It works, and it is the fuel gate's missing half

| SkyMesh                          | Score (seed A / B)  | Hit rate  | Fuel-out          |
| -------------------------------- | ------------------- | --------- | ----------------- |
| base                             | 13,377 / 15,459     | 52.2%     | 37.8%             |
| §5.3 fuel gate alone             | 15,642 / **14,157** | 60.3%     | 29.2%             |
| gate + loiter                    | 16,588 / —          | 63.9%     | 19.4%             |
| **gate + loiter + engage-below** | **17,338 / 17,253** | **64.9%** | **18.2% / 19.1%** |

Note the middle row: **the fuel gate alone is a wash-to-negative for SkyMesh** — it _loses_ on
seed B. Refusing uncatchable targets only pays if the hornet has something useful to do instead.
Loiter is what makes the gate safe here; together they are +11% to +30% and halve fuel-outs.

### The reactivation window

| Loiter behaviour (gate + loiter + engage-below) |                        |
| ----------------------------------------------- | ---------------------- |
| hornets that entered loiter at least once       | 33.0%                  |
| …of those, **reactivated by a new threat**      | **52.9%**              |
| median wait before reactivation                 | **31 ticks (0.52s)**   |
| reactivated within 60 ticks (1s)                | **78.3%**              |
| reactivated within 120 ticks (2s)               | 93.6%                  |
| reactivated within 300 ticks (5s)               | 100.0%                 |
| **kills that happened after a loiter**          | **11.4% of all kills** |

A new customer arrives in about half a second at the median. But a **1s grace would cut off ~22%
of reactivations that do eventually happen** — prefer **2s (120 ticks)**, or simply "loiter until
fuel expires at the reduced burn", which is what was tested and needs no extra timer. The reduced
burn is the natural limiter; a separate grace timer is arguably redundant.

### Why this is the right shape of fix

It converts L1 into a feature rather than papering over it. Today a hornet with no work fizzles
indistinguishably from a failed intercept; under this proposal it visibly **holds station** —
legible, on-theme for "Sky Hunter **Mesh**", and readable at a glance: hornets orbiting overhead
means the sky is covered right now. The 11.4% of kills from reactivated loiterers are exactly the
"the mesh was already there waiting" moments the upgrade should be selling.

**Caveats:** this is a power increase (+11–30%), so it is a balance decision, not a pure
consistency fix — though it arrives alongside a halved fuel-out rate, and the upgrade costs 2,500.
And the loiter visuals are entirely a feel question: an ellipse at radius 22 with a 0.06 rad/tick
orbit was arbitrary. Whether hornets holding station read as "protective mesh" or "confused
insects" depends on orbit rate, radius, and whether they visibly spread or cluster.

---

## 7. Recommendations, in order

### Tier 1 — fix the feedback channel (no balance impact)

1. **Give fuel-out, orphan-suicide and kill three distinct presentations** (§5.1). Highest-value
   change in the document; changes no numbers at all.

### Tier 2 — remove the edge cases that look like bugs

2. **Widen the proximity fuze to ~40–45px and detonate at the hornet's own position**, warhead
   sized to cover it (~50px) (§5.2). Removing the blast teleport is a correctness win; the score
   gain is a side effect. **Needs a feel-check.**
3. **Gate launches on accel-aware intercept time; hold the slot when nothing is catchable**
   (§5.3). Fuel-outs ~9% → ~0.3% at no score cost.
4. **Adopt the role-shaped engagement rule** (§5.6): drones and bombs always; ballistic threats
   only while still slow (~3.5-4.5 px/tick). The only candidate rule that is score-**positive**
   on both seed sets (+4-8% at 2 pads, +10% at SkyMesh), it raises in-role share, and it gives
   the player one sentence they can actually learn. Largely subsumes item 5. Keep drones
   eligible at _any_ speed — diving Shaheds are the job, and they dominate later waves.
5. **Exclude the MIRV class from hornet launch selection** (§5.4). Score-neutral; mostly
   redundant once item 4 lands.
6. **Alternate pad iteration order** (§5.5). Free.
7. **Stop the climb-away branch** (§5.5). Cheap.

### Tier 2b — the SkyMesh proposal (balance decision, measured)

8. **Give SkyMesh hornets a loiter state** (§6): hold station on 0.25× fuel burn when nothing is
   catchable. SkyMesh-exclusive by construction. Worth +11–30% and halves fuel-outs — but only
   works _paired with_ item 3, which is a wash-to-negative for SkyMesh on its own. Prefer "loiter
   until fuel expires" over a fixed grace; if a timer is used, 2s not 1s. Also let a loitering
   hornet engage targets _below_ it — a further ~4% and truer to "mesh".

### Tier 3 — correctness without changing the feel

9. **Fix only the uncatchable case in the lead calculation** (§4.5). Keep the 30% under-lead —
   the tail chase is the drama. Clamp lead time to remaining fuel and fall back to pure pursuit
   when no intercept solution exists. Do **not** raise the multiplier; that is measurably worse
   than doing nothing.

### Explicitly not recommended

- **Raise hornet speed ~30%** (+19–25% score) — short reach is the role's intended weakness;
  erasing it makes hornets a worse-differentiated Roadrunner.
- **Shorten the reload** (+12–18% score) — a power buff, not a consistency fix. Keep in the back
  pocket for a future balance pass.
- **Block cross-side launches** — they are the better intercept (§4.4).
- **Force hornets to stay in-role** — measurably worse (§4.3).
- **A swept-collision fuze test** — tunnelling does not happen (Appendix C).
- **An altitude activation border** (§5.6) — score-neutral and it does kill fuel-outs, but it
  makes hornets engage _faster_ targets and raises the orphan rate, so it expresses the opposite
  of the intended role. The role-shaped rule (item 4) and the fuel gate (item 3) each do the job
  it was reaching for, better.
- **The rank-1 orphan rate is a design decision**, not a bug. Only its presentation needs fixing.

**Everything here still needs a feel-check in the real game.** These are throughput numbers from
a headless bot against a strategy profile approximating a human; whether the result _plays_ right
is a judgement only the controller-holder can make.

---

## Appendix A — Reproducing this

The harness was temporary and has been removed; the tree is unmodified. To rebuild it:

1. Copy `src/headless/sim-runner.ts`'s main loop into a scratch script. Replace the shop block
   with a bare `closeShop(g)` so nothing but hornets is purchased, and force the loadout up front
   with `buyDraftUpgrade(g, id)` (free) followed by `prepareWaveStart(g)`.
2. Each tick, before `update()`, snapshot `{x, y, life}` for every hornet and `{x, y, alive}` for
   every missile and drone.
3. After `update()`, register newly-appeared hornets, track per-tick distance to `targetRef`, and
   classify any hornet missing from `g.hornets` **using the pre-update snapshot**, in the sim's
   own branch order: `life - dt <= 0` → fuel · out of bounds → bounds · target dead → orphan ·
   `d < 12` → detonate · otherwise → wave-reset despawn (`game-sim-shop.ts:407` clears
   `g.hornets` between waves).
4. For counterfactuals, gate each mechanism behind a `process.env` read (fuze radius,
   self-detonation, lead mode, reachability, half-map fallback, `reloadPerSlot`, loiter), run
   identical seed sets per variant, and revert.
5. For player-profile realism, post-filter `botDecideAction`'s result: drop a fixed fraction of
   firing opportunities via a third seeded RNG, and/or null the action when `action.targetRef.y`
   exceeds a focus threshold. Pad identity is recoverable from spawn x (left 206 ± 12, right
   622 ± 12).

Two independent seed bases (70000, 91000), 20 games each, were used for headline comparisons; all
replicated within ~5% unless noted.

---

## Appendix B — Key code locations

| Concern                                         | Location                          |
| ----------------------------------------------- | --------------------------------- |
| Launch target selection (no reachability term)  | `src/game-sim.ts:836–870`         |
| Half-map fallback (cross-side launches)         | `src/game-sim.ts:849–853`         |
| Target scoring (type priorities swamp altitude) | `src/game-sim.ts:790–801`         |
| Retarget selection (SkyMesh only)               | `src/game-sim.ts:874–904`         |
| Per-pad magazine, reload, launch gap            | `src/game-sim.ts:963–1017`        |
| Fuel expiry / bounds / orphan suicide           | `src/game-sim.ts:1020–1071`       |
| Climb-away branch                               | `src/game-sim.ts:1073–1080`       |
| Fuze check + blast-on-target                    | `src/game-sim.ts:1086–1090`       |
| Lead calculation                                | `src/game-sim.ts:1093–1099`       |
| Missile acceleration                            | `src/game-sim.ts:1341–1343`       |
| Threat visibility gate (`y >= 0`)               | `src/game-sim.ts:2229–2231`       |
| `HORNET_SITE_CAPACITY`, site state creation     | `src/game-sim-shop.ts:30,138–148` |
| Pad iteration order (left always first)         | `src/game-sim-shop.ts:131–136`    |
| Hornet wipe between waves                       | `src/game-sim-shop.ts:407`        |
| Pad placements                                  | `src/game-logic.ts:213–216`       |

---

## Appendix C — Investigation trail: superseded claims and negative results

Kept so the same ground is not re-covered. Each of these was measured.

### Claims that were wrong and are now corrected

**"A hornet physically cannot reach the top quarter of the screen."** True against a _stationary_
target only. The original reachability model used constant velocity and ignored `accel = 1.018`
compounding while the missile descends toward the pad. Corrected in §5.3: descending missiles are
comfortably reachable. The genuinely unreachable set is much smaller — mostly high-altitude
_horizontal_ movers (cruising drones) that never descend. Any "unreachable at launch" figure from
the old metric (51.7% / 61.6% / 65.8%) means only "straight-line distance exceeds max range",
which turns out to signify very little.

**"Cross-side launches convert far worse (24.4% vs 34.1%)."** Measured under the stock bot — the
profile §3.1 warns about. Under the realistic profile the gap vanishes (44.4% vs 44.8%), and the
residual is a _selection effect_: cross-side hornets fly ~100px further so more die en route.
Conditioned on arrival they convert **better**. Corrected in §4.4.

**"A held slot is a slot thrown away."** Overstated. There is a real mechanic — `reloadTimer`
resets to 0 at full magazine, and the right pad already idles at cap 41% of the time — but
holding fire added only **+3.3pp** of production idling. The actual cost is the trade:
**−7 launches/run bought +0.6pp of conversion** (98 → 91 launches, 44.7% → 45.3% hit, net kills
43.8 → 41.0). Targets are perishable; waiting produces fewer shots, not better ones.

### Negative results — do not repeat

| Tried                                                                     | Result                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swept-collision fuze test** (suspected tunnelling between ticks)        | Not a real phenomenon: 0.4–1.3% of hornets, median hidden approach **0.0px**. Guidance converges smoothly enough that the sampled minimum is the true minimum                                                             |
| **Raising the lead multiplier 0.3 → 1.0**                                 | Worse everywhere (1 pad 10,020 → 9,593; SkyMesh 16,609 → 14,867). Uncatchable targets make the naive time estimate diverge into a garbage aim point                                                                       |
| **Hard-gating unreachable launches** (constant-velocity model, hold fire) | 56 → 46 launches/run, score flat-to-worse (2 pads 13,252 → 11,871)                                                                                                                                                        |
| **Soft reachability score penalty**                                       | Within noise at every weight tested (±2%)                                                                                                                                                                                 |
| **Blocking cross-side launches** (hold when own half is busy)             | 12,165 → 10,618 at 2 pads; 13,377 → 12,918 at SkyMesh. Becomes _positive_ only once reload is fast enough to afford holding (15,763 → 16,575)                                                                             |
| **Forcing hornets to stay in-role** (double up on covered bombs)          | 12,165 → 9,817; orphan rate 38.6% → 51.9%                                                                                                                                                                                 |
| **Fuel/life buff** (168 → 220, +31%)                                      | Eliminates fuel-outs (9.4% → 0.6%) and lifts hit rate ~10pp, but **barely moves score**; life 260 moves it _backwards_. Long-lived hornets keep targets reserved and suppress the next launch (launches/run 98 → 96 → 94) |
| **Fuel-aware retargeting** for SkyMesh                                    | No effect at all (29.2% vs 29.3% fuel-out) — the remaining fuel-outs are hornets out of _work_, not hornets chasing the uncatchable. Led to §6                                                                            |

### The latency-over-endurance result

Two ways to fix arrival — fly longer or fly faster — are not close. Both seed sets, realistic:

| Variant                | 2 pads              | SkyMesh             | Fuel-outs (2 pads) |
| ---------------------- | ------------------- | ------------------- | ------------------ |
| base                   | 12,165 / 11,056     | 13,377 / 15,459     | 9.4%               |
| life +31%              | 12,244 / 11,888     | — / 16,003          | 0.6%               |
| **speed × 1.3 (+30%)** | **14,571 / 13,203** | **19,554 / 19,327** | 2.0%               |

Speed fixes arrival _and_ shortens the target reservation, so it compounds instead of cancelling —
launches/run go _up_ (98 → 107 at 2 pads, 112 → 129 at SkyMesh). **In an assignment-limited
system, latency beats endurance.** Not recommended regardless (§7), because it erases the role's
intended weakness — but it explains the reload result and why hold-fire variants lose.
