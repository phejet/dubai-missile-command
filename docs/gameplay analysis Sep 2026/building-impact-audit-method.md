# Building-impact audit: reproduction and limits

2026-09-19 · [RM-09](../../ROADMAP.html#rm-09) · [HTML findings](building-impact-audit-results.html)

Historical baseline: this audit describes replay v11 at commit `4145b2f`. The later
[bomb targeting fix](building-impact-fix.html) advances the simulator to v12. Rebuilding
the original audit on the fixed simulator will not reproduce the v11 recordings;
retain its frozen ledgers and report. The separate `verify-fix.mjs` script checks
recorded launch geometry against the corrected simulator.

The original commands below run against that baseline checkout. Scripts are retained under `scripts/building-audit/`
for the eventual commit. Inputs, generated bundles, detailed ledgers and browser artifacts
stay in ignored `operator-results/building-audit-20260919/`. Nothing uses a TMP directory.

```bash
node scripts/building-audit/inventory.mjs
node scripts/building-audit/build.mjs
node operator-results/building-audit-20260919/baseline.mjs
node operator-results/building-audit-20260919/observed.mjs
node operator-results/building-audit-20260919/observed.mjs --cases
node operator-results/building-audit-20260919/observed.mjs --reproduce
node scripts/building-audit/report.mjs
python3 scripts/building-audit/crosscheck.py
node scripts/building-audit/verify.mjs
```

The final command requires the local Vite server at port 5173 and Playwright Chromium.

## Observation points

Esbuild instruments source in memory; TypeScript AST positions identify hostile entity
spawns and `alive = false` assignments. The generated bundles expose replay action/checkpoint
consumption and the real missile updater for isolated reproductions. `instrumentation.json`
records original simulation source hashes and hook counts. No production source is edited.

Bomb selection is observed at `pickBuildingTarget`'s return. At spawn, the selected point
must match the emitted bomb and a live building's roof center. Observer-only object maps
assign entity IDs and parent IDs; nothing is added to game state and no RNG calls are made.
Other threat classes' lack of city targeting is established by inspecting `pickTarget`,
`missileTargetCandidates`, `getSplitCandidateTargets`, and drone spawn/dive paths. Unknown
non-bomb target identities are not inferred from destruction coordinates.

Movement segments are sampled after missile movement and the earlier tower-collision
branch, immediately before building collision. Point contact and swept contact are kept
separate; prior collision precedence is recorded. Actual building collision records which
building was hit. Every building death records its missile or drone actor. Other threat
deaths record the responsible source branch. Explosion deaths include `playerCaused` and
chain flags; these are not a claim about the player's intent or a counterfactual save.

Both baseline and instrumented runs use the real replay runner. They verify checkpoints,
action/checkpoint consumption, endpoint and stored score/wave. The 26 known human runs
also match the complete operator summary. State/RNG hashes sampled every 120 ticks and at
recorded checkpoints agree between baseline and observed execution. Missing endpoints and
checkpoint divergences are accounted for without running invalid recordings into aggregate
results. This is compatibility with current simulation, not a claim that unrecorded historical
intermediate values are known.

The 132 initial trajectory misses are forward-ray versus intended-building geometry.
They assume continued initial velocity, no flare diversion, no interception and no prior
asset loss; they are not 132 observed impact failures. The independent Python check uses
boundary intersections rather than the observer's slab-clipping algorithm. It checks all
1,238 predictions and 53 actual contact segments. It also reproduces the wrong-building
bomb's final coordinates analytically.

## Controlled and replay-derived evidence

Four small real-updater cases cover direct roof contact, geometric miss, already-dead
target, and a deliberately high-speed swept-only crossing. The last case demonstrates
the collision limitation and is not used as evidence of observed speed frequency.

Two additional cases replay exact measured geometry through the real updater:

- `run-016`, bomb 112, wave 6, ticks 3898–4362: selected building 2 stays alive;
  building 3 is destroyed. Flight is 464 simulation ticks. Its horizontal roof position
  is 219.21, outside target bounds 150–184. This is an actual misdirected bomb.
- `run-003`, warhead 194, wave 7, tick 5850: the actual movement segment crosses
  building 4 near its top-right corner but the endpoint lies outside. The building
  remains alive. This threat targeted a defense site; it is an incidental skyline
  collision failure, not a building-targeting failure. The recorded warhead is
  intercepted at tick 5852.

In the isolated cases other assets are disabled to isolate the mechanism. These are
explicit counterfactual fixtures; unchanged full replay evidence establishes that the
same defects occurred in the original recorded action sequence.

## Limits and scoped deferrals

The local scan finds 110 payloads / 89 unique signatures: 26 human runs, 51 automated
recordings and 12 fixtures. Only one automated run verifies; it contains no threats.
The other 50 diverge; the fixtures lack endpoints. The September 15 Staging snapshot is
included, but live inventory was not refreshed because no operator bearer is available.
Raw private paths remain in the local manifest; the public report uses anonymous labels.

The report measures actual spawned bombs, not how many a carrier would have dropped if
it survived. It does not run altered player/defense policies or estimate causal saves.
Trajectory diagrams show sampled observed positions and collision rectangles, not a
pixel-exact rendering test. Code inspection confirms the skyline renderer and collisions
share the building dimensions and scenic base; ornamental pixels may extend beyond bounds.

The investigation answers the user's targeting, hit and destruction questions. Full
carrier-opportunity accounting, a new live export, balance tuning and gameplay fixes
are separate follow-ups. The second idea mentioned by the user remains unspecified.
