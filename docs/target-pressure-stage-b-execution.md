# RM-10 Stage B — implementation and handoff

2026-09-22. Stage B is implemented; review follow-up addressed below. Not committed or released; Dev installed on the configured iPhone on 2026-09-22.
Canonical status: [RM-10](../ROADMAP.html#rm-10). Stage C now implemented with current missile angles by user instruction; see [Stage C evidence](target-pressure-stage-c-execution.md).
This is an intermediate missile slice, not a claim that combined enemy pressure is balanced.

## Accepted rules

- Request 30% tower / 50% ordinary buildings / 20% infrastructure. This is an allocation
  request, not the delivered mix. Sites and launchers
  share a policy category but retain separate destination IDs.
- Count one terminal body. Reserve all MIRV/stack descendants at carrier spawn; transfer
  those units at splitting. The original stack body keeps its original unit.
- Intercepting a carrier cancels its unlaunched descendants without refunding allocation.
  Committed attacks also receive no refund. Never compensate for successful defense.
- Keep entry sides, enemy speed/acceleration, schedules, concurrent caps, rewards and damage.
  Choose destination and entry together; allow steep and vertical routes.
- Prefer 60 visible simulation ticks. Descendants inherit visible carrier time once.
  When no eligible 60-tick route is found, preserve speeds and record warning shortfalls.
- Redistribute unavailable non-tower categories to reachable non-tower assets first.
  If only the Burj survives, label the tower-only endgame explicitly.
- If a flank has no reachable non-tower route and the sky is empty, allow a same-flank
  tower attack labeled `empty-flank-tower`. Otherwise defer an impossible entry.
- Freeze destinations and routes at commitment, including child plans. Target loss can
  waste an attack; it does not redirect it to the Burj.

The warning and empty-flank exceptions were explicitly accepted during implementation.
The counterexamples and reproduction scripts are retained below.

## Files and state

- `src/target-pressure.ts`: central tuning, category choice and serializable terminal ledger.
- `src/missile-routing.ts`: asset geometry, continuous tower clearance, discrete first-impact
  prediction and bounded left/right/top entry candidates.
- `src/pressure-missiles.ts`: transactional carrier planning, persistent pending spawn samples,
  split ownership transfer and terminal/cancelled lifecycle settlement.
- `src/game-sim.ts`: spawn/split integration and visible carrier-time accumulation.
- `src/wave-spawner.ts`: only an explicit `false` spawn result defers an entry; legacy void
  callbacks remain valid. Failed same-cell bypasses are retained too.
- `src/game-sim-shop.ts`: fresh per-wave accounting, including replay bootstrap.
- `src/types.ts`: `targetPressure`, `pendingMissileSpawn`, and each missile's `pressure`.
- `src/replay-debug.ts`: checkpoint hashes include ledger, pending spawn and entity ownership.
  Replay anchors already clone all three as part of full simulation state.

Allocation uses B/T/I/B/B/T/B/I/T/B, reset each wave. Every uninterrupted ten requested units
contain exactly 3/5/2, with no adjacent tower requests. Category exceptions never create debt.
Real commitments can differ when carriers are intercepted or split later; report both.

A carrier plan is transactional: all descendants must have eligible routes before anything
is reserved. Candidate work is finite, with nine regular entry samples plus preferred/target
positions and a 1,200-tick route horizon. Failed attempts retain speed, side, offsets and RNG
samples, retry at most every 30 simulation ticks, and consume no schedule entry or quota.
Normal top entries remain at y=-10; MIRVs at -20; side entries stay within y=20–722.

The route classifier uses the shared piecewise tower silhouette and current building/site/
launcher bounds. It rejects intervening geometry even if fast point samples would tunnel.
Non-tower rays also clear the Burj beyond their destination, so losing that target does not
uncover a tower crossing. Discrete proof reproduces acceleration-before-movement and live
collision ordering. Floating-point comparison epsilon is 1e-7; gameplay hitboxes are unchanged.

Children aim from their actual offset origins, correcting the old parent-origin/child-offset
mismatch. Nominal routes are planned at fixed dt=1; the controlled sweep also tests EMP's
fractional movement. These finite checks are not a proof over every possible intervention.

## Lifecycle

| Event                      | Ledger result                                                |
| -------------------------- | ------------------------------------------------------------ |
| Scheduled / deferred       | No reservation or observed attack                            |
| Ordinary missile           | One reserved and immediately committed unit                  |
| MIRV carrier               | 5–8 reserved units; carrier itself is not another quota unit |
| Stack carrier              | 2–3 units; original body commits immediately                 |
| Split                      | Transfer children; original stack unit is not recommitted    |
| Carrier intercepted        | Unlaunched units become cancelled; allocation remains spent  |
| Committed body removed     | Unit ends; no refund                                         |
| Target destroyed           | Fixed aim retained                                           |
| Run ends with reservations | They remain distinguishable from committed attacks           |

`warningTicks` and `warningShortfall` are planned warning evidence, not measurements of actual
flight after player intervention. The entity's `visibleTicks` tracks inherited/elapsed time.
Exceptions distinguish non-tower redistribution, unavailable tower, tower-only endgame and
empty-flank tower fallback. `deferredAttempts` and `lastConflict` expose failed planning.

## Verification evidence

- Full unit suite: **80 files, 864 tests passed** (confirmed by the independent review before this follow-up).
- Browser smoke and replay suites: **21 passed**, including wave seek, shop pauses, input,
  portrait HUD/shop and deterministic repeated playback. Their production build passed.
- Typecheck, changed-file ESLint/format checks, diff check and roadmap validator passed.
- `node --import tsx scripts/target-pressure/verify-stage-b.ts`: **1,113 controlled cases**,
  waves 1/5/10/20/30/50, seeds 7/42/114, applicable entry sides, all missile families,
  intact/upgraded/upgraded-cleared-city/no-building/no-infrastructure/tower-only/
  single-far-building layouts. Zero failed
  spawns and zero non-tower geometric crossings during executed flights. EMP is exercised.
- Three 5,000-tick bot recordings reproduce their scores and checkpoints. The saved report
  distinguishes per-wave reservations, commitments, cancellations, category exceptions and
  ten-commitment windows. Those windows contain 2–4 tower commitments where measurable;
  all three runs have zero warning shortfalls and zero deferred attempts.
- The final pooled controlled sweep recorded median 0.145 ms, p95 1.022 ms and max 8.569 ms.
  These pooled numbers do not characterize an individual threat family. See the isolated
  MIRV measurements below; neither result measures iPhone cost.

Raw evidence: `scripts/target-pressure/stage-b-verification.json`. The finite matrix is not
proof of all unbounded late-wave states. The stage-D reviewer must inspect the integrated
missile/drone policy, especially ordering, impossible pools and intervention edge cases.

## Replay migration

Replay version is **15**. Changed destinations and RNG consumption deliberately change
outcomes, so v14 recordings are rejected rather than relabeled as faithful playback.
All three maintained perf fixtures were re-recorded from their seed/bootstrap/stop templates.
The old inputs and matching simulator are preserved and replayed successfully under:

`operator-results/target-pressure-stage-b/baseline-cc4a3d78a06328f7abd65edb17f767f1f1dd1983/`

Reproduction: `node scripts/target-pressure/archive-baseline.mjs` archives the current HEAD
without modifying the shared checkout. The existing archive is immutable on repeat calls.
Seed-42's 5,000-tick golden changes from 33,892 to 25,416, still wave 7/time limit. This is a
determinism canary, not evidence of improved balance. Existing perf timing baselines are stale.

A newly exposed headless recorder boundary bug was fixed: interval checkpoints now precede
bonus-screen completion, matching the replay runner. Human bonus awards occur on the same
side of that boundary. The existing checkpoint-verification test reproduced the failure.

## Design counterexamples

`node --import tsx scripts/target-pressure/check-warning-feasibility.ts` checks a generous
full-play-area distance bound against real spawn speeds/acceleration and an independent
geometric-series calculation. Wave-20 minimum-speed MIRV children exceed that bound within
52 ticks; ordinary missiles do so within 51 ticks at wave 50. A fixed 60-tick floor cannot
coexist with unchanged unbounded speed progression. Carrier inheritance and reported warning
shortfalls are the accepted resolutions; no speed caps were added.

With only building 6 alive (x=660–706, y=1202–1404), every straight left-entry ray from the
allowed altitude band crosses the tower. The accepted empty-sky same-flank fallback prevents
that case from stalling the wave; its occupied-sky deferral is regression-tested.

## Review follow-up — 2026-09-22

The measurements below were supplied in the independent review, not re-measured in this
follow-up. They supersede any implication that passing the route proof established good feel,
delivered 30/50/20 allocation, or uniformly cheap planning.

**Angle feel comes first.** Across 120 seeds × 12 spawns per wave, the reviewer measured:

| Wave | Below the old 0.42 slope floor | Median horizontal/vertical slope |
| ---- | ------------------------------ | -------------------------------- |
| 1    | 98%                            | 0.09                             |
| 5    | 84%                            | 0.13                             |
| 20   | 86%                            | 0.12                             |

About 30% of top entries were exact vertical drops. Origin ordering tries the preferred
position, then a vertical position, then sampled positions. Intervening buildings reject many
slanted candidates, making vertical routes dominant. Sixty visible ticks protect read time;
they do not prove an acceptable interception margin. The first iPhone feel-check must judge
these trajectories before route-angle constraints are chosen. No angle tuning was made here.

**Requested versus committed mix.** Requested slots are 30/50/20. The reviewer measured
approximately **32/54/14 committed tower/building/infrastructure pressure** in their sample.
Buildings can shield sites and launchers, so unavailable infrastructure slots redistribute to
reachable non-tower assets. The figure is sample-specific, not a universal distribution or a
combined missile/drone balance result. Our controlled sweep includes 96 site destinations
and 538 launcher destinations; installed sites become reachable after city blockers disappear.

**Per-family cost.** The review isolated MIRV planning over 200 seeds at each wave:

| Wave | p50 (ms) | p95 (ms) | Maximum (ms) |
| ---- | -------- | -------- | ------------ |
| 10   | 0.45     | 1.02     | 3.71         |
| 30   | 0.39     | 1.39     | 3.75         |
| 50   | 2.94     | 3.15     | 5.03         |

The parent × child × asset search continues until it finds a zero-shortfall plan or exhausts
candidate parents. This explains why a pooled median understates high-wave MIRV cost. iPhone
cost is **unmeasured**; the review's 15–40 ms projection is a risk estimate, not evidence.
Run the maintained on-device benchmark before release. No benchmark has been performed;
the Dev app was installed on the configured iPhone on 2026-09-22 for the feel-check.

**Defensive changes.** Empty eligible/final route pools now return no choice. `commitPressure`
refuses invalid/duplicate commits without throwing; it records `invariantFailures` and
`lastInvariantFailure`. Splits validate all child ownership before transferring anything. A
corrupt carrier retires without replacement children; known owned reservations are settled
without refunds. Missing or stale ownership is preserved as a diagnostic failure, not repaired
by inventing allocation. Normal spawn/split behavior, RNG draws and replay fixtures are unchanged.
Follow-up verification: 199 focused simulation/accounting/replay tests, typecheck, changed-file
ESLint/format checks, roadmap validator and diff check pass. Corruption regressions cover absent
plans, invalid child IDs, duplicate child IDs and stale wave ownership.

**Other feel changes retained for review.** Missile side entries currently have no former
70 px separation sampling; fallback candidates use nine altitude bands. Tower aim is fixed
at `BASE_Y - BURJ_H * 0.8` instead of randomized over the old trunk interval. Watch overlapping
entries, visible banding and repetitive tower convergence during the same feel-check.

## Stage C handoff and human check (historical)

Superseded by [Stage C implementation evidence](target-pressure-stage-c-execution.md).

Drones and bombs still use their existing targeting and movement. They are **not yet counted**
in this ledger: Stage B must not be reported as achieving combined 30/50/20 pressure.
Stage C should reuse category selection/reservation/commitment, add cruise/commit/dive geometry
and visible tells, and specify bomb reservation/cancellation and cruise-carrier exposure.
Do not count a non-attacking carrier as a terminal attack. Keep all tuning in the central config.
After C, Stage D audits combined planned/committed windows, all spawn/split/drop paths,
replay/seek, CPU cost and fallbacks; Stage E is the combined human feel-check.

Stage B is ready to feel-check locally: watch whether flank entries stay recognizable,
building saves are legible, steep paths offer useful reaction time and splits feel predictable.
DMC Dev (`com.phejet.dubaicmd.dev`) was built and installed on the configured iPhone on
2026-09-22. The initial connection reset; an install-only retry succeeded. No commit, push,
release or device benchmark was performed.
