# Surrounding-building targeting and impact audit

2026-09-19 · RM-09 · Local-corpus analysis complete; see [HTML findings](building-impact-audit-results.html)
and [method, coverage limits and scoped deferrals](building-impact-audit-method.md).
Canonical priority and status: [roadmap](../../ROADMAP.html#rm-09).
Run this next, before RM-06 and the scoring study's Part Six decision.

## Question and scope

Why do surrounding city buildings survive so well even when the player is not
prioritizing them? Measure whether they are rarely targeted, protected incidentally,
missed by trajectories, or spared by collision/damage bugs. The Burj is excluded
from the building metric; launchers and upgrade defense sites are separate categories.
The user mentioned two ideas; only this first idea is specified. Do not invent the second.
This is an investigation, not approval for balance changes or bug fixes.

## Preliminary code observations — not results

- `src/game-logic.ts`: `pickTarget` selects Burj, live defense sites and launchers;
  it does not select city buildings. `pickBuildingTarget` selects a live building's
  roof center. Its 70% choice concerns nearest versus second-nearest building,
  not the fraction of all threats that target buildings.
- `src/game-sim.ts`: both bomb-drop paths store that roof target, but initialize
  horizontal speed as `(targetX - spawnX) * 0.004` and vertical speed randomly
  between 2.4 and 4.0. Audit the entire subsequent motion path to determine whether
  those velocities actually carry bombs through the selected building.
- Missile/bomb building collision checks the current point against
  `getGameplayBuildingBounds` and marks a live building dead on contact. Drone
  building damage follows a separate dive-impact path with expanded bounds.
  Audit update order, segment crossings, termination and rendering geometry;
  a stored target coordinate alone establishes neither a hit nor a bug.

## Execution plan

1. **Inventory every available replay.** Refresh the authenticated read-only Staging
   inventory when access is available; include local exports, backups, diagnostics,
   bot and performance fixtures. Start with the prior 26-run study but do not assume
   it is still complete. Record source, hash, build, rules, duration and eligibility.
   Deduplicate overlapping exports. Report human play separately from bot/test runs,
   and list missing, expired, malformed or incompatible recordings. Keep raw data,
   identifiers and generated artifacts in ignored project-local storage.
2. **Verify playback before counting.** Reuse the maintained runner and study harness.
   Verify recorded checkpoints, action consumption, final tick, termination and
   available summaries. Quarantine divergence; distinguish current-code reconstruction
   from proven historical behavior where builds differ. Never repair a replay to make
   it pass. Record corpus coverage and limitations explicitly.
3. **Map selection through damage.** Audit every spawn, bomb drop, split child,
   waypoint/dive, guidance/flare, removal, ground impact and building-damage path.
   Trace target selection at the call site without making another RNG call. Give each
   threat and building stable observer-only identities. Record chosen target category
   and identity, aim point, target alive state, wave/tick, parent/child lineage and
   later retargeting. Separate carrier intent from each dropped bomb's intent.
   Unknown intent remains unknown; do not infer it just from where a threat died.
4. **Follow every threat to an outcome.** Record positions before/after movement and
   at the actual collision decision, target bounds, collision branch, death/removal
   reason and building alive transitions. Resolve each building-directed threat as:
   intended building destroyed; another asset hit; manual/automatic/active/chain
   interception; diversion; target already destroyed; ground/offscreen miss; split
   into tracked children; or unresolved at recording end. Track skipped bomb drops
   and carriers destroyed before dropping separately from spawned bombs. Reconcile
   all building deaths with their causal event, including incidental hits by threats
   aimed elsewhere. Record any contact that fails to destroy a still-live building.
5. **Check trajectory independently.** Compare swept movement segments with building
   bounds as well as the exact discrete collision predicate. Flag tunneling, roof
   overshoot, target/renderer coordinate disagreement, earlier collision precedence,
   ground removal and stale targets. Inspect all suspected anomalies with anonymous
   run/wave/tick references and trajectory overlays or short replay clips. For bombs,
   compare predicted unopposed intersection with measured motion; label any isolated
   continuation with defenses removed as a counterfactual, never a recorded outcome.
6. **Prove the observer and suspected defects.** Baseline and instrumented playback
   must preserve RNG, sampled state, every available checkpoint, actions and final
   summaries. Add focused real-simulation cases for direct roof contact, narrow/edge
   crossings at actual speed ranges, misses, interception, target destroyed first,
   overlapping collision candidates, drone impacts and recording truncation. Reproduce
   each suspected bug in a minimal fixture and identify the exact responsible branch.
   Classify uncertain cases explicitly rather than manufacturing a clean bill of health.
7. **Report why buildings survive.** Produce an anonymous HTML report with coverage,
   type/wave/build breakdowns, target-to-outcome funnel, building survival over time,
   representative successful hits and every distinct failure mechanism. Distinguish
   confirmed defects from targeting policy and incidental protection. Recommend the
   smallest follow-up only after evidence; gameplay changes require a separate task.

## Percentages and denominators fixed before measurement

- **Building targeting share:** building-directed threats / all spawned hostile threat
  entities, with counts. Also show each threat type separately and the share among
  entities with a known selected target. Include unknown/no-target categories in the
  overall denominator. Show root threats versus descendants separately so splits and
  bomb-dropping carriers cannot silently distort the interpretation.
- **Intended-target success:** intended building destructions / building-directed
  threats. Show competing outcomes and unresolved recordings alongside this percentage.
- **Unintercepted arrival success:** intended-building hits / resolved, building-directed
  threats that were not intercepted or diverted and whose target remained alive until
  arrival/miss. Publish exclusions and counts; this conditional rate is not overall accuracy.
- **Collision failure:** verified eligible geometric contacts with no expected building
  destruction / eligible contacts. Report discrete point contacts and swept-only crossings
  separately, including collision-order explanations.
- **Survival context:** buildings alive at wave start/end, losses and causes, targeted
  exposure per building, bomb drops versus skipped/prevented drops, and manual versus
  automated interception. Report pooled counts and per-run variation; stratify builds,
  waves and human/test provenance. Observed interception does not prove a counterfactual save.

## Exit evidence

Every discovered replay is accounted for, every verified threat ledger reconciles,
every building death has a cause or explicit unresolved reason, and all suspicious
miss/contact cases have inspectable evidence. Deliver actual targeting and outcome
percentages with denominators, observer-equivalence results, minimal bug reproductions
where warranted, and a clear explanation of survival. An absence of observed bugs is
limited to verified coverage. No percentage or bug verdict is claimed by this plan.
