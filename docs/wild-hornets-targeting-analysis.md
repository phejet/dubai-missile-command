# Wild Hornets — launch, targeting & role analysis

**Date:** 2026-07-25
**Scope:** the hornet block of `updateAutoSystems()` (`src/game-sim.ts` ~960–1101), plus
`pickHornetLaunchTarget` / `pickHornetTarget` / `pickHornetRetargetTarget`.
**Status:** analysis only — no gameplay code was changed by this document. Every counterfactual
below was implemented behind a temporary env flag, measured, and reverted.

**This document has two parts.**

- **Part I — Findings.** Written to be read. What hornets do, what is wrong with it, what to
  change, and why. Skip Part II entirely unless you are checking the work.
- **Part II — Evidence & reproduction.** Written for a reviewing agent (or a future session
  re-deriving this). Full methodology, the complete experiment inventory with raw numbers,
  threats to validity, and the runnable harness. Every claim in Part I is traceable to a
  numbered experiment in Appendix D.

The harness is vendored at
[`docs/analysis-harness/wild-hornets/`](./analysis-harness/wild-hornets/) — it is analysis-only,
not imported by `src/`, and its README documents the exact `src/game-sim.ts` patch each
counterfactual required.

This document states the **current conclusions**. The investigation trail — claims that were
measured, overturned, and replaced, plus the negative results worth not repeating — is in
[Appendix C](#appendix-c--investigation-trail-superseded-claims-and-negative-results).

---

# Part I — Findings

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

| #      | Finding                                                                                                                                                                                                                                                   | Breaks intuition?                    | Verdict                                                                                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| **L1** | **Three different outcomes render identically.** Fuel-out, orphan-suicide and a real kill all call `boom()` in hornet yellow; the first two are _byte-identical_ calls                                                                                    | **Yes — the core problem**           | Fix. No balance impact                                                                       |
| **L2** | Hornet commits to targets it cannot reach with the fuel it has                                                                                                                                                                                            | **Yes**                              | **Solved** (§5.3) — accel-aware fuel gate takes fuel-outs from ~9% to ~0.3% at no score cost |
| **L3** | 12px proximity fuze under a 30px warhead — the hornet visually overlaps the threat and nothing happens; the blast then teleports onto the target                                                                                                          | **Yes**                              | Fix (§5.2)                                                                                   |
| **L4** | Hornets launch at MIRVs and go **0-for-33** — a class Roadrunner and Patriot both own outright                                                                                                                                                            | **Yes**                              | Fix, score-neutral (§5.4)                                                                    |
| **L7** | The engagement rule is "anything unassigned" — not something a player can hold in their head, so the role reads as fuzzy                                                                                                                                  | **Yes**                              | Fix (§5.6): "drones and bombs always; missiles only while still slow". Score-**positive**    |
| **L5** | Left pad silently does 33% more work than the right (iteration order); dry 51% vs 39%                                                                                                                                                                     | Mildly                               | Fix, free (§5.5)                                                                             |
| **L6** | Hornet climbs _away_ from a target below it (`HORNET_DIVE_SLACK`)                                                                                                                                                                                         | Rare but yes                         | Fix, cheap (§5.5)                                                                            |
| **P1** | _Proposal:_ SkyMesh hornets loiter on reduced fuel instead of fizzling when out of work                                                                                                                                                                   | Turns L1 into a feature              | **Measured (§6):** +11–30%, fuel-outs halved, 11% of kills come from reactivated loiterers   |
| —      | Tail-chase geometry from 30% under-leading                                                                                                                                                                                                                | **No — this is the drama**           | **Keep.** Only fix the uncatchable case                                                      |
| —      | Cross-side launches (33% of all)                                                                                                                                                                                                                          | No                                   | **Keep** — arriving cross-side hornets convert _better_ (§4.4)                               |
| —      | Reaching for missiles when bombs/drones are covered                                                                                                                                                                                                       | No                                   | **Keep** — forcing role purity is measurably worse (§4.3)                                    |
| **V1** | Hornets are **superlinear** (+28% / +84% / +149%) — a discoverable synergy, and good design. But a lone pad orphans **69%** of its hornets, and identical feedback (L1) means the player learns "hornets are bad" instead of "hornets are under-invested" | Yes — it blocks the discovery        | Fix L1; do **not** spell the synergy out in shop text (§4.7)                                 |
| —      | 39–53% orphan rate at rank 1                                                                                                                                                                                                                              | No — it is SkyMesh's reason to exist | Balance call, not a bug                                                                      |
| —      | Slow speed / short range                                                                                                                                                                                                                                  | No — this _is_ the role's weakness   | **Keep**                                                                                     |

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

### 4.7 What one pad is actually worth (and why hornets are an all-in upgrade)

Every measurement above isolates hornets by buying nothing else. That answers "how well do
hornets work", but not the question a drafting player actually faces: **is one pad, taken as a
complement to an already-built defense, doing anything useful?**

Ablation against a built core (Roadrunner + Patriot + Phalanx), player covering the whole
screen, 24 games:

| Loadout                      | Score  | Δ vs core   | Hornet hits/run | Share of all kills | Hornet hit rate | Orphan    |
| ---------------------------- | ------ | ----------- | --------------- | ------------------ | --------------- | --------- |
| core only                    | 11,144 | —           | —               | —                  | —               | —         |
| **core + 1 pad**             | 14,315 | **+28.5%**  | 13.0            | **11.9%**          | **19.3%**       | **69.4%** |
| core + Iron Beam (same slot) | 14,536 | +30.4%      | —               | —                  | —               | —         |
| **core + 1 pad + SkyMesh**   | 17,121 | **+53.6%**  | 26.1            | 19.7%              | **36.4%**       | **0.0%**  |
| core + 2 pads                | 20,544 | **+84.4%**  | 31.4            | 20.5%              | 23.6%           | 66.5%     |
| core + 2 pads + SkyMesh      | 27,769 | **+149.2%** | 57.1            | 28.4%              | 37.0%           | 0.0%      |

**A single pad is contributing real work — about an eighth of all kills and a ~28% score lift —
but it is the least efficient way to own hornets.** Alongside a built core, **69% of its hornets
are orphaned** and its hit rate collapses from 44.7% (hornets alone) to **19.3%**, because
Roadrunner, Patriot and Phalanx keep killing its targets first. Roughly seven of every ten
hornets it launches are wasted motion.

Against Iron Beam in the same draft slot it is a statistical tie (+28.5% vs +30.4%). So "take a
pad when nothing better is offered" is a defensible pick — it is just not a _good_ one.

#### 1 pad + SkyMesh — the efficient compact build

SkyMesh only requires `anyOf: [left, right]`, so **1 pad + SkyMesh is a legal build**, and it
costs the same _two draft picks_ as a second pad. They are not equivalent:

| Two picks       | Score      | Launches/run | Hornet hits/run | Hit rate  | Orphan   |
| --------------- | ---------- | ------------ | --------------- | --------- | -------- |
| 1 pad + SkyMesh | 17,121     | 72           | 26.1            | **36.4%** | **0.0%** |
| 2 pads          | **20,544** | **133**      | **31.4**        | 23.6%     | 66.5%    |

**Two pads win on output; 1 pad + SkyMesh wins on efficiency.** Mesh nearly doubles a lone pad's
hit rate (19.3% → 36.4%) and eliminates orphaning entirely — it is precisely the fix for the
lone pad's core weakness. But raw volume still beats it: two pads launch 85% more hornets and
land 20% more kills.

**Draft ordering heuristic: take the second pad before SkyMesh.** Both routes converge on the
same endpoint, but the intermediate state does not:

| Route            | after pick 1 | after pick 2 | after pick 3 |
| ---------------- | ------------ | ------------ | ------------ |
| pad → pad → mesh | +28.5%       | **+84.4%**   | +149.2%      |
| pad → mesh → pad | +28.5%       | +53.6%       | +149.2%      |

If there is any chance of not completing the set — which in draft mode there always is —
pads-first is the safer line by a wide margin.

#### The upgrade is superlinear, which is unusual

Marginal value of each successive hornet purchase: **pad 1 = +28.5pp, pad 2 = +55.9pp more,
SkyMesh = +64.8pp more.** Each purchase is worth more than the one before it.

The synergy is genuinely multiplicative rather than additive, and the 1-pad-mesh data pins it
down: **SkyMesh is worth +25.1pp on one pad but +64.8pp on two.** The same upgrade is worth
two and a half times more depending on what it is paired with. Hit rate climbs
(19.3% → 23.6% → 37.0%) and orphaning collapses (69.4% → 66.5% → 0%) as investment deepens.

This validates the two play patterns players converge on — go all-in, or use a pad as filler —
and explains why the middle feels unsatisfying.

**Treat the superlinearity as a feature, not a defect.** An upgrade family that compounds with
itself is a synergy the player gets to _discover_, and discovery is worth more than a flat
value curve. Spelling it out in shop text would spend that discovery to buy nothing.

The risk is not that the player is uninformed — it is that they may never get the chance to
learn it. A lone pad orphans 69% of its hornets, and **all three hornet outcomes currently
render identically** (§5.1). So a player who drafts one pad sees a stream of near-meaningless
yellow puffs and a 19% hit rate, and the conclusion available to them is _"hornets are bad"_
rather than _"hornets are under-invested"_. Those are opposite lessons, and the game currently
cannot tell them apart on the player's behalf.

This makes §5.1 more than cosmetic. With distinct feedback, a lone pad reads as _"my hornet
stood down because you shot its target first"_ — 69% of the time. That is a legible,
self-explaining pointer toward SkyMesh, delivered by the game showing its work rather than by a
tooltip. **The legibility fix is the discovery mechanism for the synergy.**

#### On ceding the bottom half — the model cannot settle it

Same loadouts, comparing a player who spreads attention across the screen against one who cedes
everything below y = 700 to hornets and concentrates up top, at a **constant attention budget**:

| Loadout                 | spread (skip 35%) | concentrated (skip 0%, ignore below y=700) |
| ----------------------- | ----------------- | ------------------------------------------ |
| core + 1 pad            | **14,315**        | 11,072                                     |
| core + 2 pads           | **20,544**        | 19,174                                     |
| core + 2 pads + SkyMesh | **27,769**        | 26,953                                     |

Ceding never wins here, but the penalty shrinks sharply with hornet investment (−23% → −7% →
−3%), converging on break-even exactly where the strategy is meant to be used. And it
demonstrably does make hornets better at their job: hit rate 19.3% → 24.4%, orphan 69.4% →
64.3%.

**This is the one result in the document I would not trust as guidance.** The baseline it loses
to is a bot with perfect information and instant reaction covering the entire screen — a
standard no human meets. The real value of ceding is reduced cognitive load and reaction
demand, which a bot does not pay for and this harness cannot measure. Read the shrinking penalty
and the improved hornet efficiency as supportive; do not read the raw score comparison as a
verdict on the strategy.

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

# Part II — Evidence & reproduction

> Everything below is for verification, not for reading end to end. Appendix D is the raw
> experiment inventory; Appendix E lists what would most plausibly overturn these conclusions.

## Appendix A — The harness

Vendored, runnable, and unmodified from what produced these numbers:
[`docs/analysis-harness/wild-hornets/`](./analysis-harness/wild-hornets/).
Its [README](./analysis-harness/wild-hornets/README.md) is the authoritative reference for
running it and for the exact `src/game-sim.ts` patch behind every env flag.

```bash
# outcome mix across the three hornet loadouts (realistic profile, 20 games, seed base 70000)
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 label

# marginal value on a built Roadrunner+Patriot+Phalanx core
BOT_SKIP=0.35 npx tsx docs/analysis-harness/wild-hornets/marginal.ts
```

**Design in three points:**

1. Mirrors `src/headless/sim-runner.ts`'s loop; forces an exact loadout with `buyDraftUpgrade`
   (free — `game-sim-shop.ts:344`) + `prepareWaveStart(g)`; **buys nothing in the shop**, so in
   isolation runs hornets are the only auto-defense and every effect is attributable.
2. Classifies each hornet's fate by reproducing the sim's own branch order against a
   **pre-update snapshot**. This is mandatory, not stylistic: `updateAutoSystems()` runs before
   `updateExplosions()` (`game-sim.ts:2231` vs `:2234`), so a hornet's blast kills its target in
   the same tick, and post-update classification makes every hit look like "died to something
   else". The first version of this harness reported a 0.2% detonation rate for exactly that
   reason — see Appendix C.
3. Player realism via two env knobs, `BOT_SKIP` (drop a fraction of firing opportunities, third
   seeded RNG) and `BOT_FOCUS_Y` (ignore threats below a y, ceding the lower screen).

**Profile definitions used throughout:**

| Name          | Flags                           | Used for                                           |
| ------------- | ------------------------------- | -------------------------------------------------- |
| bot-default   | none                            | E1–E6, E9(a)                                       |
| **realistic** | `BOT_SKIP=0.35 BOT_FOCUS_Y=700` | most of the analysis; the full-hornet-build player |
| complement    | `BOT_SKIP=0.35` only            | E24–E25; the player who did _not_ cede the bottom  |

**Counterfactuals require patching `src/game-sim.ts`.** Every one was applied behind an env
flag, measured, then reverted with `git checkout src/game-sim.ts`. The patch table is in the
harness README. `src/` is currently unmodified — verify with `git diff --stat src/` (empty) and
`npx vitest run src/game-sim.test.ts` (134 passing).

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

---

## Appendix D — Experiment inventory (raw)

Every run behind this document. Unless a row says otherwise: **20 games, seed base 70000
("A"), 24 games for E24–E25.** Seed base 91000 is "B". Scores are means. Configs within an
experiment share seeds, so paired comparisons are like-for-like.

### E1 — Baseline outcome mix · bot-default

| Loadout | Score  | Wave | Launch/run | Detonate | Fuel  | Orphan | Bounds | WaveReset | Kills/run |
| ------- | ------ | ---- | ---------- | -------- | ----- | ------ | ------ | --------- | --------- |
| 1 pad   | 10,020 | 5.35 | 56         | 28.9%    | 4.1%  | 57.4%  | 0.0%   | 9.6%      | 16.2      |
| 2 pads  | 13,252 | 6.05 | 102        | 31.0%    | 7.7%  | 53.2%  | 0.0%   | 8.1%      | 31.4      |
| 2+mesh  | 16,609 | 6.65 | 117        | 43.8%    | 44.3% | 0.0%   | 0.0%   | 11.9%     | 51.5      |

### E1b — Baseline · realistic profile

| Loadout | Score A / B     | Launch/run | Detonate      | Fuel          | Orphan        |
| ------- | --------------- | ---------- | ------------- | ------------- | ------------- |
| 1 pad   | 5,217 / 6,117   | 42         | 44.7%         | 6.7%          | 39.1%         |
| 2 pads  | 12,165 / 11,056 | 98 / 95    | 44.7% / 43.2% | 9.4% / 8.2%   | 38.6% / 41.5% |
| 2+mesh  | 13,377 / 15,459 | 103 / 112  | 52.2% / 51.4% | 37.8% / 37.5% | 0.0%          |

### E2 — Terminal funnel · bot-default · % of hornets reaching each band that then detonated

| Ever within | 1 pad | 2 pads | 2+mesh |
| ----------- | ----- | ------ | ------ |
| 200px       | 59.8% | 59.0%  | 56.7%  |
| 150px       | 65.9% | 64.2%  | 61.1%  |
| 100px       | 74.5% | 71.2%  | 67.7%  |
| 60px        | 82.4% | 79.6%  | 75.1%  |
| 40px        | 85.7% | 85.7%  | 80.8%  |
| 25px        | 90.8% | 89.6%  | 86.5%  |

Near misses (closed <100px, never detonated): **9.9% / 12.5% / 20.9%** of all hornets.

### E3 — Fuze tunnelling (swept CPA vs tick-start sample) · bot-default

Passed within 12px continuously but never detonated: **0.4% / 1.2% / 1.3%**.
Median (sampled minDist − swept CPA) for hornets closing <100px: **0.0px**. Hypothesis rejected.

### E4 — Terminal geometry · bot-default

Trailing at closest approach: 36.4% / 52.9% / 57.0%.
Conversion when trailing 58.1% / 59.5% / 57.1%, vs head-on/crossing 70.3% / 69.6% / 66.4%.

### E5 — Fuze counterfactuals · bot-default · score

| Variant                             | 1 pad          | 2 pads          | 2+mesh          |
| ----------------------------------- | -------------- | --------------- | --------------- |
| base (fuze 12, blast on target)     | 10,020         | 13,252          | 16,609          |
| fuze 30, blast on target            | 9,333          | 14,497          | 19,882          |
| fuze 45, blast on target            | 10,299         | 15,384          | 19,453          |
| fuze 30, blast at hornet (r=35)     | 9,291          | 12,754          | 18,965          |
| **fuze 45, blast at hornet (r=52)** | **10,682**     | **14,453**      | **20,246**      |
| lead-solve + fuze 40 + selfboom     | 10,900         | 12,783          | 17,918          |
| lead-solve + fuze 45 (on target)    | 9,439 / 10,401 | 14,172 / 13,122 | 20,087 / 20,222 |

Kills/run for `fuze 45 @ hornet`: 18.8 / 43.3 / 70.8 (baseline 16.2 / 31.4 / 51.5).

### E6 — Lead calculation · score

| Variant                              | Profile     | 1 pad  | 2 pads | 2+mesh |
| ------------------------------------ | ----------- | ------ | ------ | ------ |
| base (0.3 multiplier)                | bot-default | 10,020 | 13,252 | 16,609 |
| naive full lead (×1.0, iterative t)  | bot-default | 9,593  | 12,505 | 14,867 |
| closed-form solve + pursuit fallback | bot-default | 8,750  | 13,903 | 18,751 |
| closed-form solve                    | realistic   | 5,934  | 12,346 | 16,144 |

### E7 — Player profile sensitivity · 2 pads

| Profile           | Hit rate | Orphan |
| ----------------- | -------- | ------ |
| bot-default       | 31.0%    | 53.2%  |
| `BOT_SKIP=0.4`    | 35.6%    | 47.0%  |
| `BOT_FOCUS_Y=700` | 43.8%    | 41.4%  |
| realistic (both)  | 44.7%    | 38.6%  |

### E8 — Magazine telemetry · 2 pads

| Pad                 | Launch/run | Mean ammo | Dry (ammo=0) | At cap (no reload progress) |
| ------------------- | ---------- | --------- | ------------ | --------------------------- |
| left (bot-default)  | 58.1       | 0.69 / 2  | 51.0%        | —                           |
| right (bot-default) | 43.5       | 1.03 / 2  | 39.1%        | —                           |
| left (realistic)    | 55.4       | 0.70 / 2  | 50.7%        | 20.8%                       |
| right (realistic)   | 42.6       | 1.02 / 2  | 38.6%        | 41.1%                       |

### E9 — Cross-side launches

(a) **bot-default**: cross-side share 32.6% (2 pads) / 34.1% (mesh); fired while own half had
live threats 63.0% / 64.0%, of which own-half _unassigned_ count was 0 in 100% of cases.
Hit rate same 34.1% vs cross 24.4% (2 pads); 48.8% vs 34.3% (mesh).

(b) **realistic, all launches**: same 44.8% (n=1252) vs cross 44.4% (n=709) — 2 pads;
mesh same 53.8% vs cross 49.4%.

(c) **realistic, conditioned on arrival (closed <150px)** — the decisive cut:

|                   | Arrived | → Converted | Median CPA |
| ----------------- | ------- | ----------- | ---------- |
| 2 pads same-side  | 61.4%   | 73.0%       | 10.3px     |
| 2 pads cross-side | 54.0%   | **82.2%**   | 9.6px      |
| mesh same-side    | 78.5%   | 68.5%       | 10.3px     |
| mesh cross-side   | 68.8%   | **71.8%**   | 10.1px     |

(d) **non-arrivals, 2 pads**: same-side fuel-out 8.7%, cross-side 16.3%.

### E10 — Hold-fire cost (block cross-side when own half busy) · realistic · 2 pads

|           | Launch/run | Hit   | At-cap (left) | Score  |
| --------- | ---------- | ----- | ------------- | ------ |
| base      | 98         | 44.7% | 20.8%         | 12,165 |
| hold fire | 91         | 45.3% | 24.1%         | 10,618 |

### E11 — Reload buff (`reloadPerSlot` 60→40) · realistic · score

1 pad 8,496 · 2 pads 13,589 · mesh 15,763. With cross-side hold-fire added: mesh 16,575.

### E12 — Endurance vs latency · realistic · score

| Variant        | 1 pad         | 2 pads A / B        | mesh A / B          | Fuel-out (2 pads) |
| -------------- | ------------- | ------------------- | ------------------- | ----------------- |
| base           | 5,217 / 6,117 | 12,165 / 11,056     | 13,377 / 15,459     | 9.4%              |
| life 168→220   | — / 5,969     | 12,244 / 11,888     | — / 16,003          | 0.6%              |
| life 168→260   | —             | 12,103              | —                   | 0.0%              |
| **speed ×1.3** | — / 5,823     | **14,571 / 13,203** | **19,554 / 19,327** | 2.0% / 2.4%       |

Launches/run under speed ×1.3: 107 (2 pads, base 98), 129 (mesh, base 112).

### E13 — Role fit · realistic

|                             | Share of launches | Hit rate |
| --------------------------- | ----------------- | -------- |
| 2 pads in-role (bomb/drone) | 63.6% (n=1247)    | 54.5%    |
| 2 pads out-of-role          | 36.4% (n=714)     | 27.5%    |
| mesh in-role                | 62.9%             | 62.0%    |
| mesh out-of-role            | 37.1%             | 35.6%    |

Of out-of-role launches (2 pads): in-role threat on screen 68.2%; free and passed over 9.4%;
in-role present but **all assigned 58.8%**; no in-role threat existed 31.8%.

### E14 — Forcing role purity (double up on covered bombs) · realistic

|               | 1 pad A / B   | 2 pads A / B      | mesh A / B      | Orphan (2 pads) |
| ------------- | ------------- | ----------------- | --------------- | --------------- |
| base          | 5,217 / 6,117 | 12,165 / 11,056   | 13,377 / 15,459 | 38.6%           |
| force in-role | 5,427 / 4,984 | **9,817 / 9,136** | 15,056 / 13,760 | **51.9%**       |

### E15/E16 — MIRV exclusion and never-hold reachability · realistic

| Variant                                         | 1 pad             | 2 pads | mesh   |
| ----------------------------------------------- | ----------------- | ------ | ------ |
| `HORNET_NOMIRV=1`                               | 5,217             | 12,320 | 14,637 |
| `HORNET_REACH=1.0` (const-velocity, never hold) | 5,590 (fuel 3.4%) | 13,169 | 14,408 |
| both, seed B                                    | 7,119             | 12,262 | 14,486 |

### E17 — Accel-aware intercept prediction · realistic

Closed form: threat displacement after `n` ticks = `v0·a(aⁿ−1)/(a−1)` (accel applied before the
move); solve `speed·n ≥ |P_threat(n) − P_launch|` by bisection.

|                                             | 2 pads    | mesh      |
| ------------------------------------------- | --------- | --------- |
| solvable at all (within 400 ticks)          | 65.4%     | 64.1%     |
| predicted interceptable within 168 ticks    | 46.9%     | 45.9%     |
| median predicted ticks                      | 127       | 129       |
| **median actual ÷ predicted**               | **1.01×** | **1.01×** |
| 90th percentile ratio                       | 1.06×     | 1.10×     |
| fuel-outs the model had flagged uncatchable | **98.9%** | 43.4%     |

Hand-check of the model against a top-spawning missile (hornet spawn y=1388, life 168):

| Missile v0 | Hornet speed | Accel-aware | Constant-velocity |
| ---------- | ------------ | ----------- | ----------------- |
| 1.3        | 4.476        | 137 ticks   | 240               |
| 1.3        | 6.72         | 122         | 173               |
| 2.0        | 4.476        | 120         | 214               |
| 2.0        | 6.72         | 108         | 159               |
| 3.0        | 5.6          | 100         | 161               |

### E18 — Accel-aware fuel gate · realistic · score / fuel-out

| Variant                          | 1 pad                         | 2 pads                          | mesh                                  |
| -------------------------------- | ----------------------------- | ------------------------------- | ------------------------------------- |
| base                             | 5,217 / 6.7%                  | 12,165 / 9.4%                   | 13,377 / 37.8%                        |
| gate 1.0, fall back to full pool | 6,746 / 3.8%                  | 12,821 / 8.3%                   | 15,018 / 37.0%                        |
| gate 0.9, fall back              | 6,565 / 3.5%                  | 13,174 / 8.4%                   | 15,552 / 37.9%                        |
| **gate 0.9 + hold**              | **6,786 / 0.5%**              | **12,173 / 0.3%**               | 13,802 / 29.3%                        |
| gate 0.9 + hold + retarget-fuel  | 6,786 / 0.5% (B 7,393 / 0.2%) | 12,173 / 0.3% (B 12,395 / 0.9%) | **15,642 / 29.2%** (B 14,157 / 29.4%) |

Launches/run for the last row: 43 / 87 / 99.

> **Nuance a reviewer should note:** fuel-aware _retargeting_ leaves the mesh fuel-out rate
> unchanged (29.3% → 29.2%) but does move mesh **score** 13,802 → 15,642. §6's claim that it
> "does not move it" refers strictly to the fuel-out rate.

### E19 — SkyMesh remaining fuel-outs (with gate)

Had a live target when fuel expired: **4.0%**. Had no target at all: **96.0%**.
Mean retargets before dying 0.87; median closest approach ever 76px.

### E20 — SkyMesh loiter

Score / hit / fuel-out, realistic:

| Variant                              | mesh A / B          | Hit       | Fuel-out          |
| ------------------------------------ | ------------------- | --------- | ----------------- |
| base                                 | 13,377 / 15,459     | 52.2%     | 37.8%             |
| fuel gate only                       | 15,642 / **14,157** | 60.3%     | 29.2%             |
| gate + loiter (grace 600, burn 0.25) | 16,588              | 63.9%     | 19.4%             |
| **gate + loiter + engage-below**     | **17,338 / 17,253** | **64.9%** | **18.2% / 19.1%** |

Loiter without the gate (grace sweep): 60t → 13,976 · 180t → 15,242 · 600t → 15,242 ·
600t+engage-below → 14,928.

Loiter behaviour:

|                                      | without gate         | with gate + engage-below |
| ------------------------------------ | -------------------- | ------------------------ |
| entered loiter at least once         | 5.3%                 | **33.0%**                |
| of those, reactivated                | 93.0%                | 52.9%                    |
| median wait to reactivation          | 25t (0.42s)          | 31t (0.52s)              |
| reactivated within 60t / 120t / 300t | 85.8% / 94.3% / 100% | 78.3% / 93.6% / 100%     |
| mean loiter stints per hornet        | 1.07                 | 1.28                     |
| median total ticks loitering         | 28                   | 108                      |
| **kills occurring after a loiter**   | 1.3%                 | **11.4%**                |

Control: with loiter enabled, 1-pad and 2-pad results are **identical to base** (5,217 /
12,165), confirming SkyMesh-exclusivity by construction.

### E21 — Activation border (launch only at `t.y >= Y`) · realistic

| Config               | Score  | Launch/run | Hit   | Orphan | Fuel  | In-role | Mean target speed | Median kill Y |
| -------------------- | ------ | ---------- | ----- | ------ | ----- | ------- | ----------------- | ------------- |
| 2 pads Y=0           | 12,165 | 98         | 44.7% | 38.6%  | 9.4%  | 63.6%   | 3.02              | 811           |
| 2 pads Y=200         | 10,975 | 85         | 46.1% | 44.5%  | 2.4%  | 64.6%   | 3.53              | 846           |
| 2 pads Y=400         | 11,468 | 79         | 46.9% | 45.1%  | 0.4%  | 64.9%   | 4.17              | 879           |
| 2 pads Y=600         | 9,550  | 60         | 51.3% | 41.3%  | 0.2%  | 68.2%   | 4.28              | 917           |
| 2 pads Y=800         | 4,609  | 23         | 71.5% | 20.8%  | 0.0%  | 79.4%   | 3.59              | 956           |
| 2 pads Y=0, seed B   | 11,056 | 95         | 43.2% | 41.5%  | 8.2%  | 63.3%   | 2.98              | 827           |
| 2 pads Y=400, seed B | 11,453 | 76         | 46.2% | 46.7%  | 0.4%  | 67.3%   | 4.08              | 890           |
| mesh Y=0             | 13,377 | 103        | 52.2% | 0.0%   | 37.8% | 62.9%   | 3.02              | 775           |
| mesh Y=400           | 13,808 | 79         | 60.8% | 0.0%   | 28.1% | 64.4%   | 4.19              | 836           |
| mesh Y=600           | 11,894 | 57         | 66.4% | 0.0%   | 22.2% | 70.1%   | 4.59              | 875           |

### E22/E23 — Speed-based engagement rules · realistic · 2 pads

| Config                   | Score      | Launch/run | Hit   | Orphan    | Fuel  | In-role   | Mean target speed |
| ------------------------ | ---------- | ---------- | ----- | --------- | ----- | --------- | ----------------- |
| flat cap ≤3.0            | 12,342     | 91         | 48.6% | **30.7%** | 14.1% | **57.6%** | 2.28              |
| flat cap ≤4.0            | 11,348     | 91         | 46.9% | 33.6%     | 11.8% | 63.3%     | 2.39              |
| flat cap ≤5.0            | 12,093     | 94         | 46.2% | 34.9%     | 11.5% | 62.4%     | 2.43              |
| Y=300 + cap ≤4.0         | 10,096     | 56         | 57.8% | 34.1%     | 0.9%  | 70.8%     | 2.72              |
| Y=300 + cap ≤4.0, seed B | 10,317     | 57         | 59.6% | 32.2%     | 1.0%  | 73.3%     | 2.72              |
| **role-shaped ≤2.5**     | 10,217     | 84         | 47.4% | 34.6%     | 10.8% | **72.7%** | 2.74              |
| **role-shaped ≤3.5**     | **12,712** | 92         | 43.7% | 39.1%     | 10.2% | 66.8%     | 2.77              |
| **role-shaped ≤4.5**     | **13,148** | 99         | 45.4% | 37.4%     | 10.1% | 66.3%     | 2.80              |
| role-shaped ≤3.5, seed B | 11,535     | 91         | 45.8% | 38.3%     | 9.3%  | 68.5%     | 2.82              |
| role-shaped ≤3.5, mesh   | 14,693     | 104        | 54.0% | 0.0%      | 37.3% | 67.4%     | 2.81              |

"Role-shaped" = drones and bombs always eligible; other types only while `hypot(vx,vy) <= cap`.

### E24 — Marginal ablation · core = Roadrunner + Patriot + Phalanx · `BOT_SKIP=0.35` · 24 games

| Loadout              | Score  | Δ       | Wave | Total kills/run | Hornet hits/run | Share of kills | Launch/run | Hit   | Orphan |
| -------------------- | ------ | ------- | ---- | --------------- | --------------- | -------------- | ---------- | ----- | ------ |
| core only            | 11,144 | —       | 5.63 | 82              | —               | —              | —          | —     | —      |
| core + 1 pad         | 14,315 | +28.5%  | 6.29 | 109             | 13.0            | 11.9%          | 67         | 19.3% | 69.4%  |
| core + Iron Beam     | 14,536 | +30.4%  | 6.21 | 109             | —               | —              | —          | —     | —      |
| core + 1 pad + mesh  | 17,121 | +53.6%  | 6.63 | 133             | 26.1            | 19.7%          | 72         | 36.4% | 0.0%   |
| core + 2 pads        | 20,544 | +84.4%  | 7.13 | 153             | 31.4            | 20.5%          | 133        | 23.6% | 66.5%  |
| core + 2 pads + mesh | 27,769 | +149.2% | 8.13 | 201             | 57.1            | 28.4%          | 154        | 37.0% | 0.0%   |

### E25 — Cede-the-bottom strategy · same core · 24 games

| Loadout              | spread (skip 35%) | cede (skip 35%, y>700) | cede (skip 15%) | cede (skip 0%) |
| -------------------- | ----------------- | ---------------------- | --------------- | -------------- |
| core + 1 pad         | **14,315**        | 9,680                  | 9,957           | 11,072         |
| core + 2 pads        | **20,544**        | 16,310                 | 19,995          | 19,174         |
| core + 2 pads + mesh | **27,769**        | 25,200                 | 24,994          | 26,953         |

Hornet efficiency when ceding (1 pad): hit 19.3% → 24.0% / 24.4% / 21.0%; orphan 69.4% →
64.0% / 64.3% / 67.8%. See §4.7 for why this comparison should not be read as a verdict.

---

## Appendix E — Threats to validity

Ordered by how likely each is to change a conclusion.

1. **The bot is not a human.** Every number comes from a scripted player. The two profiles
   (§3.1) bracket the gap but neither _is_ a human — the bot has perfect information, uniform
   reaction time, and no attention cost. This most affects E25 (cede-the-bottom), whose baseline
   is whole-screen play no human achieves, and it inflates orphan rates generally. Findings that
   depend on _hornet-internal_ mechanics (E2, E3, E17, E19) are largely immune.
2. **No significance testing.** n = 20–24 games per config, 1–2 seed bases. Run-to-run spread on
   an unchanged config is roughly ±5–10% (compare E1b seed A vs B: 12,165 vs 11,056 on identical
   settings). **Treat any delta under ~10% as unresolved.** This directly weakens: the
   role-shaped cap being "+4–8%" (E23), the fuel gate being "score-neutral" (E18), and the
   Iron-Beam-vs-pad tie (E24). It does not threaten the large effects (E5 fuze, E12 speed, E14
   role purity, E20 loiter, E24 superlinearity).
3. **Shallow wave depth.** Runs end around wave 5.5–8.1, so late-wave threat composition —
   diving Shahed density, MIRV frequency — is under-sampled. This _understates_ the cost of the
   flat speed cap (E22), which excludes fast drones, and makes E13's role mix unrepresentative
   of the waves where hornets matter most.
4. **Isolation runs are unrealistic by construction.** E1–E23 buy nothing but hornets. That buys
   clean attribution at the cost of realism; E24 is the only experiment against a built defense,
   and only against _one_ core (Roadrunner + Patriot + Phalanx). Conclusions about orphan rates
   in particular differ sharply between the two settings (38.6% isolated vs 69.4% on a core).
5. **Counterfactual patches are minimal, not production implementations.** Each is the smallest
   edit that tests the idea. A real implementation may interact with replay determinism, the
   editor overrides, or perf in ways not measured here. None of the patches were run against the
   replay or perf suites.
6. **Kill attribution is approximate; detonation counts are exact.** `outcome === "detonate"`
   reproduces the sim's own branch and is reliable. The `killed` flag uses a 12-tick window after
   detonation and can false-positive when other systems are firing, so E24 reports hornet
   _detonations_, not attributed kills. Do not treat "share of all kills" as strict causal
   attribution.
7. **Score is a proxy.** The stated rubric is consistency and legibility (§1), which score does
   not measure. Score is used to check that a legibility fix does not cost capability — it is
   evidence of _no harm_, not evidence of _benefit_.
8. **Determinism assumed, spot-checked.** The harness sets a seeded RNG and `sim-runner.ts` has
   its own determinism check, but this analysis did not re-verify determinism after each patch.
   A patch that consumed RNG differently would shift results without being a real effect. The
   patches were written to avoid RNG use; this was not proven.

### What would most efficiently falsify the main claims

| Claim                                    | Cheapest disconfirming test                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 is the highest-value fix              | Implement the three distinct presentations, then have a human play a lone pad and report whether hornets still read as "broken"                 |
| Wider fuze is right (§5.2)               | A human feel-check: do hornets popping ~45px out read as premature?                                                                             |
| Role-shaped cap is score-positive (§5.6) | Re-run E23 at 60+ games across ≥4 seed bases; the current +4–8% is inside the noise floor                                                       |
| Loiter is worth it (§6)                  | Re-run E20 with 40+ games and a second core; and a human check that orbiting hornets read as "mesh" not "confused"                              |
| Hornets are superlinear (§4.7)           | Re-run E24 against a different core (e.g. Iron Beam + Flare + Launcher Kit) — if superlinearity is core-specific it is much weaker than claimed |
