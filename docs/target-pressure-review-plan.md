# Effective target pressure — design and execution review

Date: 2026-09-20. Historical design review; **Stage B implemented and locally verified on 2026-09-21**.
Current accepted rules, evidence and Stage C handoff: docs/target-pressure-stage-b-execution.md.
The proposals and review questions below preserve the original design discussion.
Roadmap context: proposed follow-up to RM-09. This document does not supersede ROADMAP.html.
After approval, produce a separate, executable AI handoff with exact contracts, file ownership,
tests, commands and stop conditions. Do not treat this review plan as that handoff.

## 1. Player outcome and scope

The player should choose between protecting the Burj, preserving combat capability and saving
ordinary city buildings. Roughly two-thirds of committed attacks should genuinely avoid the
Burj. A destination behind the Burj does not qualify as a non-tower attack if its route hits it.
Use the same targeting policy across waves; later enemy introductions already add complexity.

Keep wave budgets, spawn intervals, concurrent caps, enemy stats, rewards, upgrade behavior and
bomb damage unchanged in this slice. Wave-volume flattening remains a separate design session.
Do not increase unpredictability by steering away from player shots or changing committed routes.

### Agreed routing direction — 2026-09-20

The user approved combining **flank-specific reachable target pools for missiles** with
**cruise, visible commitment and dive for drones**. Both use one effective pressure budget.
They do not need identical target shares individually. This supersedes a generic retargeting
repair applied to every threat. The policy stays fixed across waves.

## 2. Evidence and current behavior

- `src/game-logic.ts:pickTarget`: initially 30% Burj, otherwise live sites/launchers;
  ordinary buildings are excluded. No surviving military targets means fallback to the Burj.
- `src/game-sim.ts:resolveMissileApproach`: can replace a side-spawned missile's destination
  to satisfy a minimum horizontal slope. The nominal probability is therefore not the result.
- Current diving Shaheds choose a target and build their entire waypoint path at spawn.
  Bombs separately target buildings. Additional stacked-missile children choose widely spaced
  targets rather than using the ordinary selector.
- Read-only re-observation of 26 historical human replays reproduced checkpoints, final scores,
  final waves and complete saved threat traces. Across 2,079 ordinary missiles, 1,196 (57.5%)
  spawned aimed at the Burj. Another 354 (17.0%) had non-tower aims but initial straight routes
  crossing its silhouette. The latter is geometric exposure, not observed damage.
- Across missile/MIRV/stack launches, approach correction changed 635 targets toward the Burj
  and six away. Of 136 actual missile-family tower impacts, 51 had non-tower destinations.
- Evidence source: ignored `operator-results/building-audit-20260919/observed-results.json`,
  archived `observed.mjs`, inventory and baseline artifacts. Retargeting is now reproducible via
  `scripts/target-pressure/trace-retargeting.mjs`; see `docs/target-pressure-retarget-trace.html`.
  Ordinary missiles: 635 initial tower selections + 567 redirects toward it - 6 away = 1,196.
  All 3,159 checkpoints and complete saved traces matched. Stage A must independently check
  this evidence and preserve the separate geometric-crossing calculation. These are historical
  recordings, not fresh current-build play.

### Review comment — name the actual tower bias

`missileTargetCandidates` includes the Burj at the screen's centre, `BURJ_X = 460`
(`src/game-sim.ts:390`). The side-spawn branch of `resolveMissileApproach` filters this list
for playable angles, sorts by horizontal distance from the spawn, and takes the first candidate
(`src/game-sim.ts:423`). Nearby military targets often fail the angle check, leaving the central
Burj as the nearest playable alternative. The 635 corrections toward the tower across
missile/MIRV/stack launches are a symptom of this nearest-first fallback, not a faulty 30% roll.
**Stage B intervention:** make alternate-candidate eligibility category-aware and constrained by
the shared effective-pressure allocation and flank reachability before any distance ranking.
Distance may break ties within the eligible pool; it must not select the pressure category.
A non-tower candidate still needs a tower-clear route, so category filtering alone is insufficient.

## 3. Proposed design contract

### Meaning of the tuning values

Start with **30% effective tower pressure, 50% ordinary buildings, 20% combat infrastructure**.
These are proposed defaults, not measured optimum values. Group sites and launchers for policy
but report them separately. Keep all tuning in one obvious configuration location.

Classify the final route before committing it. A route capable of striking the Burj first counts
against the tower allowance regardless of its named destination. Keep destination category and
geometric exposure as separate audit fields; do not relabel a building attack to hide a crossing.

The tower percentage is a long-term per-wave target with bounded local variation, not an exact
percentage promised for every short prefix or every interrupted run. Do not carry early-wave
underuse forward as permission for a tower-heavy late wave. Also inspect short attack windows:
a correct final wave total must not conceal a long uninterrupted tower barrage.

Missiles may contribute more tower pressure and drones more building pressure. Measure their
combined allocation per wave and within short attack groups; do not enforce 30/50/20 separately
on each family, or offset a tower-only missile barrage with building attacks much later.

### Planning and correction

1. Read the commander pattern, required entry side, threat family and shared pressure allocation.
2. Construct the reachable target pool for that family and approach. Choose destination and route
   together instead of choosing them independently and repairing the destination afterward.
3. Apply family-specific movement constraints, then classify full-route tower exposure.
4. Choose a feasible allocation within the same commander side. If infeasible, use the documented
   bounded fallback; never repeatedly reroll targets or silently move a flank attack to the top.
5. Commit the route and its accounting together. After the visible commitment, keep the route fixed.

### Missile routes and reachable flank pools

Missiles use straight committed paths. For each commander entry side, build a pool of living
assets reachable with enough visibility and interception time. A non-tower entry in that pool
must have at least one approach that reaches the asset without first striking the Burj or another
blocking asset. Reachability depends on geometry and threat movement, not merely left/right labels.

Choose a target and compatible entry altitude together. A left-flank attack must remain a
left entry; mirror the rule for the right flank. Top-entry tactics have their own feasible pool.
Do not force an impossible destination into a pool, and do not use the Burj as an automatic
replacement when a nearby defense fails an approach constraint.

The approved architectural choice is reachable flank pools. Relaxing the blanket minimum-slope
rule, exact fair-warning limits and permitted altitude ranges remain contract decisions for the
execution handoff. A steep or vertical building approach is a candidate where playable, not permission
to create unseen low-altitude hits or convert side tactics to top attacks.

An empty feasible pool is different from an exhausted target category. First try another eligible
asset or entry altitude on the same side. If none works, record the conflict; the execution handoff must
define whether to defer the entry or request an explicitly permitted schedule alternative. Threat-type
substitution is not implicitly approved: composition and budgets stay unchanged in this slice.

### Accounting: decisions to settle before implementation

Recommended unit: **one terminal attacking body**, not current live count, kill count, or existing
spawn-budget threat-value weights. A simple missile or diving drone contributes one. A MIRV or
stack reserves its terminal descendants once; converting a carrier into children must not count
both carrier and children as independent quota units. Bomber bodies and their bombs need explicit
separate treatment; a non-attacking cruise-only carrier must not dilute the denominator.

The execution handoff must specify the full lifecycle table: scheduled, reserved, committed, split, skipped,
intercepted, exited and wave-ended. Include bombs skipped because buildings are gone, a MIRV
intercepted before splitting, the original stack body becoming a child, and carrier collision
risk before its children exist. Reservations are planning promises, not observed attacks; report
both distributions rather than claiming reserved children actually flew.

Player interceptions do not refund committed pressure or trigger compensation attacks. The
planner must not punish successful tower defense by replenishing its share. Preplanned descendant
allocations and bounded reservations are preferred to a controller chasing the surviving mix.
Do not promise exact realized percentages for enemies prevented from spawning by the player.

### Geometry and exhausted categories

Use shared collision geometry and simulation movement semantics, including body sizes and curved
waypoints. A straight ray is sufficient only for genuinely straight missile motion. Account for
carrier paths as well as terminal paths. Evaluate a route without counting player interception,
automated defense or flares as reasons it is safe. Those are outcomes after commitment.

Proposed fallback: redistribute unavailable building/infrastructure allocation among surviving
non-tower assets first. If only the Burj remains, explicitly enter tower-only endgame pressure;
report the exception and exclude it from claims that the normal distribution was achieved.
No silent tower fallback. If an asset dies after route commitment, keep the visible route and
accept a potentially wasted attack; do not invisibly redirect it to the Burj.

### Shahed behavior

Diving drones use **cruise → visible commitment → dive**, with a route planner distinct from
straight missiles. Reserve pressure allocation early; select the final living asset before its
commitment tell. Target position must influence the dive point: a far-side building may require
cruising above and past the Burj before descent, while a nearby asset may allow an early peel-off.

Validate the entire cruise, turn and dive against the actual skyline and movement rules. Changing
only the dive endpoint is insufficient. Preserve the commander’s entry side; a drone may then
traverse the battlefield before diving. The cruise path itself remains committed and continuous;
late target selection is limited to feasible continuations from the drone’s actual position.
If no feasible continuation remains, use the handoff's explicit fallback without an instant turn.

The visible bank reveals the final destination with sufficient response time. Once revealed,
no further retargeting, even if that asset dies. No dodging player shots. Keep propeller and jet
variants distinct and evaluate their timing separately. Pure bombers retain their role; include
their existing bomb attacks in the shared accounting rather than converting every drone to a diver.

The illustrated HTML companion includes four trajectory sketches: an early near-building dive,
a cruise past the tower into a far-building dive, a deliberate tower dive, and a rejected early
turn that crosses the tower. These are conceptual examples, not validated routes or chosen tuning.

Player choice: shoot during cruise to remove uncertainty, or wait for the tell and prioritize the
threatened asset. Predictability after commitment rewards anticipation rather than guessing.

## 4. Execution stages and handoffs

The unresolved rules — accounting lifecycle, short-group allocation, missile reachability, drone
continuations, fair-warning limits, empty-pool fallback and replay policy — are settled **in the
execution handoff itself**, not in a separate review stage. The handoff is written after this
review and is not complete while any of them is still open. Anything that materially changes how
the game plays comes back to the user; routine implementation detail is the implementing AI's call.

| Stage                                | Owner role            | Deliverable and exit gate                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Reproduce the diagnosis           | Analysis AI           | Check the saved retargeting trace, preserve crossing analysis, explicit denominators and representative clips. Baseline replay equivalence demonstrated.                                                                                                                                                                    |
| B. Shared budget and missile routing | Implementation AI     | Central configuration, deterministic per-wave accounting, flank-specific target pools, category-aware alternate eligibility replacing the unrestricted nearest-first fallback, joint target/entry construction, ordinary-building destinations and split integration. Focused tests; intermediate slice, not final balance. |
| C. Drone routing and commitment      | Implementation AI     | Cruise/commit/dive planner, target-dependent dive positions, whole-path geometry, visible tell and bomb accounting using the same budget. Propeller/jet cases and integration tests.                                                                                                                                        |
| D. Independent verification          | Review AI             | Audit final combined missile/drone behavior, every spawn/retarget/split path, reconstructed pressure, replay/seek determinism, geometry, CPU cost and fallbacks. Return defects to B/C.                                                                                                                                     |
| E. Human feel-check                  | User, supported by AI | Confirm flank identity, useful building saves, readable missile paths, fair warning, drone tells and meaningful sacrifice. Tune only agreed configuration; rerun affected checks.                                                                                                                                           |
| F. Close and document                | Coordinating AI       | Results, known limitations, approved tuning, replay/fixture updates and roadmap state. Commit/deploy only on explicit user instruction.                                                                                                                                                                                     |

Roles may be different AI sessions. Keep missile and drone work separate for review, then verify
the combined pressure budget before claiming completion. B and C can be handed between AI sessions;
D must inspect their final integrated result. This review update does not launch agents or authorize
implementation. The detailed execution handoff follows resolution of the remaining review decisions.

## 5. Verification and acceptance

- Preserve old recordings and their matching historical simulator. Changed-input playback of old
  actions is a counterfactual, not a recording of human adaptation or proof of fairness.
- Reproduce baseline figures; then use deterministic controlled cases and multiple seeds across
  early, transition and late waves, commander styles, asset layouts and loss states.
- Prove clear non-tower routes with actual simulated movement and collision checks, including
  side spawns, vertical building attacks, curved drones and split descendants. Classifier and
  independent execution must agree within a documented, justified boundary tolerance.
- Check left/right symmetry, top-entry pools and empty feasible pools. Prove commander entry sides
  remain intact; impossible flank routes never silently become top spawns or tower targets.
- Check early and far-side drone dives, tower clearance throughout cruise, continuity at commitment,
  target loss before/after the tell, and separate propeller/jet response windows.
- Check combined missile/drone allocation and short-group pressure. Per-family shares may differ;
  late building attacks must not conceal an earlier tower-only barrage.
- Show per-wave and short-window planned versus committed tower exposure, actual tower impacts,
  building/site/launcher destinations, correction frequency and explicit fallback counts.
- Verify quota ownership survives replay save/load and seek anchors. Follow the repository's
  replay-version policy; never silently play an incompatible recording as if it were faithful.
- Cover target destroyed before/after commitment, no buildings, no military assets, only Burj,
  impossible tactic routes, intercepted carriers, skipped drops and game-over mid-wave.
- Assert bounded planning work, stable seeded RNG behavior and no runtime feedback from successful
  player kills into replacement pressure. Measure route-planning cost under split-heavy waves.
- Run focused simulation/targeting tests, replay/determinism checks, type/build checks and maintained
  browser smoke appropriate to changed paths. Refresh affected golden/perf fixtures only after
  explaining expected changes. Current golden tests are not balance evidence.
- Human gate: ready to feel-check, not declared balanced from automated results. Look for legible
  destination choices, worthwhile building saves, acceptable sacrifices, fair vertical approaches,
  honest Shahed tells and absence of late-wave tower monopolization.

## 6. Review decisions requested

Agreed: distinct missile/drone planners; reachable flank pools; cruise/commit/dive drone behavior;
one shared effective pressure budget; fixed policy across waves; no changes after visible commitment.

1. Review the implementation sequence: shared budget/missiles, drones, combined independent review,
   then human feel-check. Wave-volume tuning remains separate.
2. Accept 30/50/20 as starting **effective** allocation, with site/launcher detail reported separately.
3. Accept per-wave allocation with bounded variation and no kill-driven compensation; terminal-body
   accounting is provisional until the execution handoff resolves carrier/child reservations rigorously.
4. Set fair-warning/altitude rules, permitted steep approaches and the fallback for an empty flank
   pool; separately accept or revise tower-only behavior when no other living assets remain.

After agreement, turn this into the detailed implementation handoff. Include exact files and
state fields, pseudocode, accepted lifecycle examples, numerical tolerances, test vectors,
commands, artifact paths, reviewer checklist and stop conditions. Any material unresolved design
choice comes back to the user before the implementation AI proceeds.
