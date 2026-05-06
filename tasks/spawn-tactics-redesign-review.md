# Spawn Tactics Redesign — Review & Recommendation

Review of `tasks/spawn-tactics-redesign-plan.md` against current `src/wave-spawner.ts`.

User context: replay invalidation is acceptable. Bot retraining is acceptable. Optimize for design correctness, not migration safety.

## Verdict

Phase 1 is unambiguously good — ship it as its own PR.
Phase 2 is conceptually right but architecturally heavier than the plan implies. Three load-bearing questions need answers before kickoff.
Phase 4 (count reduction) should not be sequenced yet.

## What the plan gets right

- **The classification bug is real.** Six call sites in `wave-spawner.ts:533–759` use `entryType.startsWith("drone")`, which silently excludes all four `shahed-136*` variants from `LEFT_FLANK`, `RIGHT_FLANK`, `PINCER`, `LOW_APPROACH`, `HIGH_APPROACH`, and the `MIXED_AXIS` directional fan-out. `isShahed136SpawnType` already exists at `wave-spawner.ts:35` and is just unused in `buildTacticOverrides`. Tactics have been quietly lying for an entire family of threats.
- **Phased rollout is sensibly layered.** Classification → internal cell representation → tactic-by-tactic → count reduction. Each phase is independently shippable.
- **"Cells over counts" is the correct framing.** Anchor / disruptor / punisher / screen is a recognizable encounter-design idiom and gives the analysis script something to assert against beyond vibes.
- **Metrics are concrete.** Side entropy, same-lane streak, mixed-axis windows, repetition score — all reducible to numbers from a deterministic schedule.
- **Set-pieces preserved.** Wave 5 MIRV and wave 1 baseline are explicitly carved out as exemptions.
- **Honest about budget tuning.** "Don't reduce counts in the first patch" is right. One knob at a time.

## What the plan understates or hand-waves

### 1. Concurrent cap interaction is the load-bearing question being deferred

`advanceSpawnSchedule` at `wave-spawner.ts:813` hard-breaks the moment the next entry would exceed cap. Cells are _defined_ by overlap — anchor + disruptor arriving together is the whole point. If the cap stalls a disruptor behind a heavy anchor, the cell collapses into the same trickle the redesign exists to eliminate.

"Possible future fix" is not a plan; it is the actual bug. Pick one before Phase 2 ships:

- Reserve cap headroom per cell at planning time, or
- Allow low-TV disruptors to bypass a blocked anchor, or
- Accept cells as a planning hint and measure _realized_ overlap, not scheduled overlap.

### 2. Pool-to-cell consumption is unspecified

"Convert counts into a pool, pick cell templates, consume threats" — what happens when a template wants `{anchor: missile, disruptor: slow shahed, punisher: fast missile}` and the pool has 4 mirvs and 9 shahed-bombers? Greedy first-fit, constraint solver, and backtracking all have wildly different failure modes. Needs at least:

- Template eligibility check against pool
- Fallback ordering when no template matches
- What happens to pool remainders — the proposed "old spacing for leftovers" can re-introduce the exact homogeneous trickles cells were meant to fix.

### 3. PINCER's "fix" without cells is relabeling

Lines 550–552 already alternate side by entry index across drones and missiles. Saying PINCER should "create paired threats from opposite sides within a short timing window" _requires_ cell-level scheduling — you can't do paired timing from a per-entry override hook. PINCER's redesign is fully blocked on Phase 2; the phasing makes it look more incremental than it is.

### 4. MIXED_AXIS is already partially custom

Lines 750–769 already do directional fan-out manually, outside `buildTacticOverrides`. The plan's MIXED_AXIS redesign doesn't acknowledge the existing custom path. Merge into one mechanism rather than grow a second exception.

### 5. Speed-contrast cells overlap with existing fast-variant logic

`buildTacticOverrides` lines 569–593 already assign `variant: "fast"` probabilistically based on wave, group pressure, and type. "Slow Screen, Fast Needle" needs to either compose with or replace that system, otherwise random fast threats land inside cells that didn't ask for them. Open Question 3 ("deliberate speed by cell role") is the right question and needs an answer _before_ Phase 2.

### 6. Anti-repetition thresholds are pulled from thin air

"≤3 same-side streak" — why 3? Wave 1 is the stated gold standard; calibrate against wave 1's actual realized streaks first, then set the cap at "wave-1 + small slack." Otherwise the constraint either trips on the baseline or never fires.

### 7. "Mixed-axis windows" needs a time constant

"Alive or scheduled close together" is gerrymanderable. Pick a concrete window (e.g., 60 ticks) before measuring, or the metric will drift to whatever makes the new system look good.

### 8. Wave 1 hardcoding is a trap

`getShahed136Ranges` and the dive-shahed offset both special-case `wave === 1`. The cell layer must either explicitly bypass wave 1 or reproduce that pattern as a fixed cell template. "Preserve wave 1 feel" is not a mechanism.

## Concerns dropped given user constraints

The original review flagged replay invalidation and bot-config retuning as hidden costs. User has accepted both. Net effect: Phase 2 RNG consumption order can change freely; bot baseline gets re-trained as part of the rollout.

## Recommended kickoff changes

- **Expand Phase 1 scope:** while touching `buildTacticOverrides`, also fix the `MIXED_AXIS` fan-out at line 759 in the same patch. Same bug, same diff.
- **Add Phase 1.5 — measurement baseline:** run the new analysis script (side entropy, same-lane streak, mixed-axis windows, repetition score) against the current scheduler _before_ changing anything else. That set of numbers is the floor every later phase compares against. Calibrate streak thresholds from this run, not from intuition.
- **Resolve concurrent-cap policy in Phase 2 design.** Pick one of the three options above. Don't ship cells without an answer.
- **Specify pool-to-cell allocation explicitly.** Even pseudocode. Decide what happens to remainders.
- **Answer Open Question 3 (deliberate speed by cell role).** It's not really open — existing fast-variant logic needs to compose with or be subsumed by cells.
- **Re-bake bot config and replay fixtures as part of Phase 2 merge.** Treat as a known step, not a surprise.

## Recommended sequencing

1. **Phase 1 (this week):** classification helpers + fix all six prefix-check sites, including MIXED_AXIS fan-out. Add regression tests for shahed-variant participation in each tactic. Expect a small difficulty bump because tactics finally apply to the missing variants.
2. **Phase 1.5:** ship the analysis script, capture baseline metrics on the post-Phase-1 scheduler. Calibrate anti-repetition thresholds.
3. **Phase 2 design doc:** answer the three load-bearing questions (cap policy, pool allocation, speed-by-role) before writing cell code.
4. **Phase 2 implementation:** internal cell layer, retain old spacing as fallback only for explicitly leftover threats. Re-bake bot config and replay fixtures on merge.
5. **Phase 3:** redesign tactics one at a time, in the order the plan suggests.
6. **Phase 4:** revisit count reduction _only_ after Phase 3 metrics actually move. Tuning two knobs at once teaches nothing.
