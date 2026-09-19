# RM-09 Defect 2 — Swept city-building collisions

Date: 2026-09-19. Status: planned; implementation has not started.

## Problem and outcome

`updateMissiles` moves a threat, then tests only its endpoint against city-building
rectangles. A fast threat can enter and leave a building during one tick without
registering a hit. Damage application itself worked for all 52 eligible endpoint
contacts in the historical audit.

The recorded reproduction is run-003, wave 7, warhead 194, tick 5850:
(291.47347624231475, 1234.2623345012385) →
(299.2903632611607, 1278.923777785492), crossing building 4's rectangle
(left 262, right 296, top 1260, bottom 1404). The endpoint misses the right edge.
The implementation must destroy that building and consume the warhead that tick.

Evidence: [original audit](building-impact-audit-results.html), Defect 2.
Defect 1 is already committed in `064226d`; retain its roof-targeting calculation
and vertical-speed policy.

## Collision contract

- Apply to every threat processed by `updateMissiles`, including bombs and MIRV
  children, whether deliberately targeting a building or crossing it incidentally.
- Save the starting position before movement. Test the actual straight movement
  segment after the existing acceleration and `dt` calculation. Do not predict a
  future trajectory or add a projectile radius.
- Intersect with `getGameplayBuildingBounds` for each live city building. Use a
  pure segment/rectangle slab calculation returning entry fraction `t` in [0, 1]
  or no intersection. Bounds are inclusive, matching current endpoint behavior.
- Handle horizontal, vertical and zero-length segments without division by zero.
  Starting inside or on a boundary counts as contact at t=0. Tangential contact
  counts; a near miss outside the rectangle does not. Avoid an arbitrary padding
  or epsilon that enlarges the hitbox.
- Select the smallest entry fraction among live buildings. Exact ties retain
  building-array order for deterministic resolution. One threat directly destroys
  at most one building; skip already destroyed buildings.
- Place the consumed threat and its impact explosion at the entry point, then use
  the existing building destruction and FX path once. Keep damage, explosion
  radius, scoring and building-survival bonus rules unchanged. Earlier impact
  locations can affect nearby threats through existing explosion behavior.

## Explicit scope and ordering

Keep the existing update pipeline: flare-controlled threats skip this movement
path; MIRV/stack splitting runs before collision; Burj endpoint collision runs
before city-building collision; defense sites, launchers, ground and offscreen
cleanup follow it. Threats consumed earlier cannot hit a building.

First-contact selection applies **among city buildings**, not across all collider
classes. Thus an endpoint Burj hit still wins over a city-building crossing, and
a live building crossing wins before downstream site/launcher/ground checks.
This deliberately preserves the current category priority. A global chronological
collision resolver, swept Burj/sites/launchers, split-timing changes, drone dive
collision, spawn frequency and balance tuning are separate work.

## Implementation steps

1. Add a focused simulation regression with the recorded segment using the public
   `createGameSim` update path and a controlled state. Confirm it fails before
   changing collision code. Keep scheduling, defenses and other threats from
   obscuring the result; restore seeded RNG after each test.
2. Add the pure entry-fraction helper beside existing geometry in `src/game-logic.ts`
   and focused geometric coverage. The historical observer's boolean segment
   check is reference evidence, not a runtime dependency.
3. Replace only the city-building endpoint loop in `src/game-sim.ts` with nearest
   live-building entry selection. Preserve surrounding ordering and destruction
   effects; avoid state-schema changes or per-frame sorting.
4. Add integration coverage for collision ordering and first contact, then verify
   bomb targeting remains correct. Review the diff for incidental gameplay changes.
5. Increment replay version from 12 to 13 (recheck current version at implementation
   time), document the intentional change, update current-version E2E fixtures and
   re-record all three maintained performance replays. Do not relabel historical
   recordings as compatible. Existing performance measurements are historical;
   fresh comparable benchmark measurements need the regenerated fixtures.
6. Record verification evidence and a short before/after result for the known miss.
   Preserve the original audit and its old-simulator assertions. Any new private
   analysis artifacts belong in a separate output directory. Update roadmap and
   handoff with implementation status and the remaining human feel-check.

## Verification matrix

Geometry tests: recorded corner crossing; full pass-through; horizontal/vertical
and reverse movement; endpoint inside; start inside; zero movement inside/outside;
exact edge/corner touch; parallel outside and near misses.

Simulation tests:

- Recorded MIRV-child segment destroys building 4 and consumes the threat, with
  impact located on its roof; an equivalent fast bomb also hits.
- Crossing multiple buildings hits the earliest even when array order is reversed;
  an exact tie uses stable array order, and dead buildings are ignored.
- A miss preserves the building; a stationary overlap still hits; repeated updates
  cannot apply a second direct destruction from the consumed threat.
- Burj endpoint priority, downstream site/launcher/ground priority, split-before-hit
  behavior, dead threats and flare-controlled skips retain the stated contract.
- Non-unit `dt` and acceleration use the actual moved segment, not unscaled velocity.
- Existing Defect 1 bomb regressions still pass. No-contact movement and RNG state
  remain unchanged; impact-path RNG differences from existing FX are expected.

Run focused geometry/collision, bomb, simulation, replay and headless determinism
unit suites; `npm run typecheck`; focused ESLint/Prettier and `git diff --check`.
Run `npx tsx src/headless/sim-runner.ts 42` and inspect any intentional golden-canary
change before updating it. Validate regenerated replay fixtures with the maintained
replay validator, then run `npx playwright test e2e/smoke.spec.ts e2e/replay.spec.ts`.
Use current-version repeated-seed checks for determinism, not old-version playback.
Historical isolated segments may be reused without claiming the old full runs replay.

Human feel-check: stage a fast corner-crossing threat in the browser and a normal
bomb landing. Confirm impact appears at contact and building destruction reads
clearly. Report as ready to feel-check until the user confirms. Do not infer a new
building-survival percentage from the historical 1/53 contact count: a corrected
impact changes later simulation and RNG outcomes.

## Acceptance and review

Done when the recorded miss is fixed, boundary/ordering cases pass, Defect 1 remains
intact, current replays validate and deterministic runs agree. Visual feel remains
an explicit handoff item. No collision implementation or gameplay verification
was performed while writing this plan.
