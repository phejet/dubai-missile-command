# Spawn Tactics Redesign Plan

## Goal

Redesign wave spawning so difficulty comes from coordinated attack geometry, speed contrast, and target-priority pressure instead of mainly increasing the number of threats.

The model to preserve is the current wave 1 feel: accelerating missiles create vertical urgency while slow baseline Shahed-136 drones arrive from alternating horizontal directions. That mix works because the player has to switch attention, lead different speeds, and choose priorities. Later waves should build on that pattern rather than sending larger batches of similar threats through the same lane.

## Review Decisions

This plan incorporates the review in `tasks/spawn-tactics-redesign-review.md`.

Accepted decisions:

- Ship classification fixes as an independent Phase 1.
- Fix `MIXED_AXIS` Shahed handling in Phase 1, not later.
- Add Phase 1.5 for tactical metrics and baseline capture before attack-cell implementation.
- Do not reduce threat counts until after tactics have been redesigned and measured.
- Treat replay invalidation and bot retraining as acceptable costs.
- Resolve concurrent-cap behavior, pool-to-cell allocation, and speed assignment before Phase 2 implementation.

Phase 2 is not allowed to start as an implementation task until the Phase 2 policy section below is filled in and accepted.

## Current Problem

The spawn commander is still mostly a count scheduler. It chooses threat counts, assigns simple timing intervals, applies a small tactic override layer, then uses budget and concurrent cap as guardrails. This keeps difficulty controllable, but many waves still feel repetitive because the tactical layer is too shallow.

Observed problems:

- Multiple same-type threats often enter from the same side or angle.
- Homogeneous groups let the player camp one aim point and clear a stream cheaply.
- Some tactics increase density without creating new decisions.
- Several tactics do not affect Shahed-136 variants because their spawn type names do not start with `drone`.
- Difficulty spikes are now smoother numerically, but the skill ceiling is limited by repetitive geometry.

The blunt diagnosis: the game sometimes mistakes "more targets" for "more tactical pressure." Admirably primitive, like counting spoons to make dinner harder.

## Design Principle

Build waves from small coordinated attack cells instead of independent per-type spawn streams.

An attack cell is a short, intentional composition of threats with different roles:

| Role           | Purpose                                     | Examples                                             |
| -------------- | ------------------------------------------- | ---------------------------------------------------- |
| Anchor         | Creates the main urgent decision            | accelerating missile, fast missile, MIRV, Shahed-238 |
| Disruptor      | Pulls aim or attention away from the anchor | slow Shahed-136, bomber Shahed, low drone            |
| Punisher       | Arrives late or fast to punish tunneling    | fast missile, dive Shahed, right-side follow-up      |
| Decoy / Screen | Makes shots and priorities less obvious     | slow lateral drone, non-bomber Shahed                |

Each cell should vary at least two of:

- approach axis
- speed
- target type
- altitude
- timing offset
- target priority

Difficulty should scale by making cells more sophisticated before simply adding more threats.

## Desired Player Experience

Good spawn pressure should create questions like:

- Do I shoot the accelerating missile now or clear the slow Shahed crossing my aim lane?
- Do I switch sides for the bomber or hold for the faster top missile?
- Is the MIRV urgent enough to ignore the low drone?
- Can I use one explosion to cover both axes, or do I need separate shots?

Bad spawn pressure creates only one question:

- How many times do I click the same spot?

We want less of the latter, because even spreadsheet software has the decency to admit when it is repetitive.

## Current Logic Weak Points

### Shahed-136 Tactics Are Under-Applied

`buildTacticOverrides()` applies side and altitude tactics to entries where `entryType.startsWith("drone")`. This catches `drone238`, but not:

- `shahed-136`
- `shahed-136-bomber`
- `shahed-136-dive`
- `shahed-136-dive-bomber`

That means many direction and altitude tactics do not affect a major part of the wave composition.

Impact:

- `LEFT_FLANK`, `RIGHT_FLANK`, and `PINCER` do not control Shahed lanes.
- `LOW_APPROACH` and `HIGH_APPROACH` do not control Shahed altitude.
- `MIXED_AXIS` treats Shahed variants as neither drones nor missiles, so they fall through.

This should be fixed before deeper tuning, or the tactic system will keep lying in a small but expensive voice.

### Direction Tactics Are Too Absolute

Current flank tactics force all eligible threats from one side. This makes the wave readable and sometimes easier, because the player can focus a single lane.

Better behavior:

- Flank tactics should bias the primary side, not fully monopolize it.
- A flank should include off-axis disruptors.
- Pincer should create paired timing windows, not just alternate global entry index.

### Density Tactics Lack Geometry

`DRONE_SWARM` and `MISSILE_RAIN` mostly compress intervals. Compression raises pressure, but if the threats share similar lanes and speeds, it still becomes repeated execution.

Better behavior:

- Drone swarm should spread lanes and altitude.
- Missile rain should mix top, side, and fast/normal approaches.
- Timing compression should be paired with lane variation.

### Group Lulls Are Useful But Not Tactical Enough

The group lull system divides a sorted schedule into groups and inserts recovery gaps. That is good pacing, but each group does not yet have a strong identity.

Better behavior:

- Each group should get a lane plan.
- Later groups should be allowed to change pressure style.
- Fast variants should often appear in later groups as a deliberate escalation.

### Concurrent Cap Can Flatten Mixed Pressure

`advanceSpawnSchedule()` stops when the next scheduled entry would exceed the concurrent cap. Because schedule order is fixed, one blocked entry can delay different-axis threats behind it.

Impact:

- Mixed pressure can accidentally serialize.
- A cell intended to overlap may arrive as separate trickles.

Required Phase 2 policy:

- Cells must carry a stable `cellId`.
- The scheduler must preserve intended overlap where possible.
- Analysis must measure realized overlap after cap behavior, not just scheduled overlap.
- If cap stalls a cell, that must appear in metrics as a failed or degraded cell.
- Low-value disruptor bypass is allowed only if it preserves a cell's intended role mix and does not exceed cap.

The cap problem is not a future cleanup. It is load-bearing. A cell system that schedules overlaps but lets runtime cap serialize them has merely invented bureaucracy with extra steps.

## Proposed Architecture

### 1. Add Threat Classification Helpers

Create explicit helpers in `wave-spawner.ts`:

```ts
function isShahed136Type(type: SpawnType): boolean;
function isMissileLike(type: SpawnType): boolean;
function isDroneLike(type: SpawnType): boolean;
function supportsSideOverride(type: SpawnType): boolean;
function supportsAltitudeOverride(type: SpawnType): boolean;
```

Use these everywhere instead of string-prefix checks.

Expected outcome:

- Shahed variants participate in direction tactics.
- Shahed variants participate in altitude tactics where compatible.
- Mixed-axis tactics classify threats correctly.

### 2. Introduce Attack Cells

Add an internal planning representation before final `SpawnEntry[]` creation:

```ts
interface AttackCell {
  id: string;
  wave: number;
  tactic?: TacticId;
  startTick: number;
  entries: AttackCellEntry[];
}

interface AttackCellEntry {
  type: SpawnType;
  role: "anchor" | "disruptor" | "punisher" | "screen";
  tickOffset: number;
  lane?: SpawnLane;
  speed?: "normal" | "fast";
  altitude?: "low" | "mid" | "high";
}

interface SpawnLane {
  side?: "left" | "right" | "top";
  yRange?: [number, number];
}
```

The final schedule can still be `SpawnEntry[]`, so this does not require broad runtime changes.

### 3. Build Cells From Existing Counts Initially

Avoid a giant rewrite. First version can keep current wave budgets and type count ranges, then arrange selected counts into cells.

Example flow:

1. Generate counts with current budget logic.
2. Convert counts into a pool of planned threat types.
3. Pick cell templates based on wave and tactics.
4. Consume threats from the pool into cells.
5. Emit scheduled entries from cells.
6. Consume leftovers with explicit fallback cell templates.

This preserves balance while improving pattern quality.

Pool allocation policy for Phase 2:

- Use deterministic greedy allocation ordered by tactic priority and wave set-piece priority.
- Each template must declare required roles, acceptable type substitutions, min wave, max wave if needed, and threat-value range.
- A template may only instantiate when the pool can satisfy its required roles.
- Optional roles may be dropped before choosing a weaker template.
- Leftovers must go through fallback templates such as `single-anchor-with-screen`, `alternating-light-pressure`, or `cleanup-crossfire`.
- Raw old spacing may exist only as a debug last resort and should be counted as a metric failure.

Template failure behavior:

1. Try exact tactic template.
2. Try same tactic with optional roles removed.
3. Try generic mixed-axis cell.
4. Try alternating pressure cell.
5. Use raw leftover scheduling only if no cell can consume the pool.

This avoids the charming failure mode where the redesign builds elegant cells and then dumps nine identical leftovers into the same lane like a committee approving lunch.

### 4. Add Cell Templates

Start with a small set of reusable templates.

#### Alternating Pressure

Purpose: generalize the wave 1 pattern.

Composition:

- anchor: missile from top or shallow side
- disruptor: baseline Shahed from opposite horizontal side
- optional punisher: delayed fast missile or dive Shahed

Timing:

- disruptor appears first or near-simultaneously
- anchor follows within 20-70 ticks
- punisher follows after the player commits

Use waves:

- wave 1+
- default bridge cell for early and mid waves

#### Crossfire Pair

Purpose: force side switching.

Composition:

- left slow Shahed
- right missile or bomber

Timing:

- near-simultaneous with 10-35 tick offset

Use waves:

- wave 3+
- main building block for `PINCER`

#### Top Plus Side

Purpose: make top barrage more interesting.

Composition:

- top missile or stack
- side Shahed or jet

Timing:

- side threat starts first to pull aim
- top threat enters while aim is displaced

Use waves:

- wave 4+
- required for `TOP_BARRAGE`

#### Slow Screen, Fast Needle

Purpose: speed contrast.

Composition:

- slow baseline Shahed crossing at mid/high altitude
- fast missile or fast Shahed from the opposite side/top

Timing:

- slow screen enters first
- fast threat enters after 40-90 ticks

Use waves:

- wave 6+
- replaces some raw count scaling

Speed policy:

- Speed contrast should be deliberately assigned by cell role.
- `punisher` entries may request `variant: "fast"` and a speed multiplier.
- `anchor` entries may request fast only in late-wave or tactic-specific templates.
- `disruptor` and `screen` entries should normally remain non-fast so contrast is readable.
- Existing random fast assignment should be disabled for entries that already belong to a cell.
- Existing random fast assignment may remain for raw fallback entries during transition, but those entries should be counted separately in analysis.

This replaces "maybe fast because probability said so" with "fast because this role is meant to punish tunneling." Randomness is seasoning, not structural steel.

#### MIRV With Escort

Purpose: make MIRV pressure less isolated and more skill-based.

Composition:

- anchor: MIRV
- disruptor: slow Shahed or bomber on one side
- punisher: delayed missile from another axis

Timing:

- escort starts shortly before MIRV or at MIRV split-risk window

Use waves:

- wave 5 set piece
- wave 7+

#### Drone Sweep

Purpose: make drone swarm about lane coverage, not just count.

Composition:

- low Shahed from one side
- high Shahed or Shahed-238 from the other side
- optional bomber variant in later waves

Timing:

- staggered 15-45 ticks

Use waves:

- `DRONE_SWARM`
- `MIXED_AXIS`

## Tactic Redesign

### LEFT_FLANK / RIGHT_FLANK

Current behavior:

- Eligible threats all come from one side.

New behavior:

- 70-80% of anchors come from the primary side.
- 20-30% of disruptors come from the opposite side.
- Same-side streaks should be capped.

Example:

- left missile anchor
- right slow Shahed disruptor
- left fast missile punisher

### PINCER

Current behavior:

- Alternates side by global entry index.

New behavior:

- Creates paired threats from opposite sides within a short timing window.
- Pair types should differ when possible.

Example:

- left baseline Shahed at `t`
- right missile at `t + 25`
- optional top missile at `t + 70` on later waves

### TOP_BARRAGE

Current behavior:

- Missiles/stacked missiles spawn from top.

New behavior:

- Top threats must be paired with side pressure.
- Avoid long runs of only top missiles.

Example:

- side bomber pulls aim
- top accelerating missile enters
- opposite-side Shahed appears if the player tunnels

### LOW_APPROACH / HIGH_APPROACH

Current behavior:

- Applies only to `drone238`.

New behavior:

- Applies to Shahed variants where possible.
- Low/high should create aim-line conflicts with missile paths.

Example:

- low slow Shahed crosses near launcher sightline
- high fast jet or missile forces vertical retarget

### DRONE_SWARM

Current behavior:

- Reduces drone interval.

New behavior:

- Reduces count slightly, spreads lanes/altitudes, and staggers speeds.
- Avoids same-side same-altitude drone runs.

Example:

- low left Shahed
- high right Shahed
- fast Shahed-238 through centerline

### MISSILE_RAIN

Current behavior:

- Reduces missile interval.

New behavior:

- Mixes top and side missiles with speed variation.
- Keeps some missiles normal speed so fast variants stand out.

Example:

- normal top missile
- side fast missile
- delayed top stack2 on later waves

### MIXED_AXIS

Current behavior:

- `drone238` gets one side.
- missiles get top.
- Shahed variants fall through.

New behavior:

- All drone-like threats, including Shaheds, participate.
- Drones and missiles should cross axes in short cells.

Example:

- left Shahed screen
- top missile anchor
- right Shahed-238 punisher

### MIRV_STRIKE

Current behavior:

- MIRVs start earlier.

New behavior:

- MIRV becomes the cell anchor.
- Side threats create target-priority pressure around the MIRV intercept window.

Example:

- slow side Shahed enters
- MIRV enters top/angled
- delayed fast missile arrives if the player waits too long

### SATURATION

Current behavior:

- Raises concurrent cap.

New behavior:

- Means overlapping roles, not just more cap.
- Should prefer two compact attack cells with mixed axes over one large homogeneous stream.

## Anti-Repetition Rules

Add lightweight validation during schedule generation:

- Avoid same-side eligible threat streaks that exceed the calibrated threshold.
- Avoid same-type threat streaks that exceed the calibrated threshold unless explicitly part of a set piece.
- Avoid repeated same-type plus same-side plus same-speed entries.
- Prefer alternating anchor/disruptor roles inside each group.
- Ensure each wave after wave 3 has at least one multi-axis overlap window.

These rules should be soft constraints. If the budget pool cannot satisfy them, degrade gracefully.

Threshold calibration:

- Phase 1.5 must measure current wave 1 streaks, current post-Phase-1 waves 3-10 streaks, and current set-piece streaks.
- Initial thresholds should be derived from the wave 1 baseline plus a small slack margin, not guessed.
- Any threshold that fails wave 1 is wrong unless wave 1 itself is intentionally redesigned.
- Any threshold that never fails current repetitive late waves is too loose.

## Difficulty Scaling Strategy

The redesign should keep or slightly lower total difficulty at first, then reduce counts after patterns are proven.

Initial target:

- Keep current budgets.
- Keep current concurrent caps.
- Improve lane/speed diversity.
- Do not reduce threat counts in the first patch.

Later count-reduction target:

- Reduce wave 4-8 total entries by roughly 10-20%.
- Preserve or slightly increase mixed-axis overlap.
- Preserve bot survival distribution.
- Improve subjective player skill ceiling.

This target is intentionally deferred. Do not reduce counts until Phase 3 metrics show improved tactical quality. Tuning count and composition at the same time teaches us nothing, which is traditional, but not useful.

Longer-term target:

- Replace more count scaling with cell complexity.
- Use raw count increases mostly for late-game pressure, not baseline difficulty.

## Metrics To Add

Extend the wave analysis script with tactical quality metrics.

### Side Entropy

Measures how evenly threats use left, right, top, and natural/random approaches.

Goal:

- Low in wave 1 is acceptable.
- Waves 3+ should avoid near-zero entropy unless it is a deliberate set piece.

### Same-Lane Streak

Longest streak of entries with the same side and similar type.

Goal:

- Cap most waves at 3.
- Flag streaks of 4+ unless set-piece-approved.

### Mixed-Axis Windows

Count windows where threats from at least two axes are alive or scheduled close together.

Use a fixed 60-tick window for scheduled overlap metrics unless Phase 1.5 data shows this misses the wave 1 baseline pattern. If adjusted, document the reason and use one constant everywhere.

Goal:

- Wave 3+: at least one.
- Wave 6+: multiple.

### Speed Contrast Windows

Count windows where normal and fast threats overlap.

Use the same fixed 60-tick window as mixed-axis metrics unless deliberately changed for all overlap metrics.

Goal:

- None required before wave 6.
- Wave 6+: at least one in many samples.

### Role Diversity

Approximate whether each group contains different tactical roles.

Goal:

- Later waves should not have groups composed only of anchors or only of screens.

### Repetition Score

Penalty score for repeated same type, side, speed, and altitude.

Goal:

- Trend downward after redesign even if difficulty remains similar.

## Verification Plan

### Unit Tests

Add focused tests for:

- Shahed variants receive side overrides.
- Shahed variants receive low/high altitude overrides where intended.
- `MIXED_AXIS` applies to Shaheds and Shahed-238.
- Phase 1 only: existing non-cell tactics still produce deterministic schedules and stay within budget.
- Phase 2+: `PINCER` creates opposite-side pairs.
- Phase 2+: `TOP_BARRAGE` includes side pressure in the same cell or nearby timing window.
- Phase 2+: same-side streaks stay under calibrated thresholds for representative waves.
- Phase 2+: cell IDs are stable for deterministic seeds.
- Phase 2+: entries with cell-assigned speed do not also receive random fast assignment.

### Analysis Script

Run schedule analysis over 400+ deterministic samples for waves 1-10.

Compare before and after:

- total entries
- total threat value
- peak TV/sec
- mean alive count
- side entropy
- same-lane streak
- mixed-axis windows
- speed contrast windows
- repetition score

### Headless Bot Runs

Use bot simulations to compare:

- mean survival wave
- median survival wave
- score distribution
- kill efficiency
- shots fired
- death causes

Expected result:

- Similar survival distribution.
- Fewer total threats after second pass.
- Slightly lower shot efficiency, because better geometry should force harder aim decisions.

### Browser Playtest

Manual playtest focus:

- Does the player need to switch sides more often?
- Are there meaningful priority choices?
- Do fast threats feel like pressure rather than random cheap shots?
- Are waves readable enough to feel fair?
- Do fewer threats still feel intense?

## Rollout Plan

### Phase 1: Fix Classification

- Add threat classification helpers.
- Make tactics apply to Shahed variants.
- Fix `MIXED_AXIS` fan-out so Shahed variants are treated as drone-like threats.
- Add regression tests.
- Keep counts and timing mostly unchanged.

Expected risk:

- Waves may get harder immediately because tactics finally apply to more threats.

Mitigation:

- Keep Shahed side/altitude application conservative in early waves.
- Re-run focused wave-spawner tests and schedule analysis.

### Phase 1.5: Measurement Baseline

- Add tactical quality metrics to the analysis script.
- Run the script against the post-Phase-1 scheduler before any cell code exists.
- Capture metrics for waves 1-10 over 400+ deterministic samples.
- Calibrate anti-repetition thresholds from measured wave 1 and current late-wave behavior.
- Record baseline numbers in the implementation PR or a follow-up markdown note.

Metrics required before Phase 2:

- side entropy
- same-lane streak
- same-type streak
- mixed-axis windows using a fixed 60-tick window
- speed contrast windows using the same fixed 60-tick window
- repetition score
- scheduled overlap vs realized overlap if runtime simulation is included

Phase 1.5 is not optional. Without it, Phase 2 has no ruler and will inevitably be judged by vibes, those famously reliable instruments.

### Phase 2: Introduce Attack Cells Internally

- Add internal cell planning.
- Convert selected tactics to cell templates.
- Use deterministic pool-to-cell allocation.
- Assign fast variants by cell role.
- Preserve intended cell overlap under concurrent-cap behavior where possible.
- Keep raw old fallback scheduling only as a last-resort metric failure.
- Re-bake bot config and replay fixtures as part of the merge.

Expected risk:

- Schedule determinism and replay behavior may shift.
- Realized runtime overlap may differ from scheduled overlap if concurrent cap stalls entries.

Mitigation:

- Use seeded RNG consistently.
- Add deterministic schedule tests.
- Measure realized overlap and degraded cells.

### Phase 3: Redesign Tactics One By One

Suggested order:

1. `PINCER`
2. `MIXED_AXIS`
3. `TOP_BARRAGE`
4. `DRONE_SWARM`
5. `MISSILE_RAIN`
6. `MIRV_STRIKE`
7. `SATURATION`

Reason:

- Pincer and mixed-axis expose the core value fastest.
- Top barrage is currently the easiest to make less repetitive.
- Saturation should wait until role/cell logic exists.

### Phase 4: Reduce Counts

Only after Phase 3 metrics show improved tactical quality:

- Reduce wave 4-8 count ranges gradually.
- Preserve budgets as analysis labels or lower budgets if needed.
- Compare bot distribution before and after.

Initial reduction target:

- wave 4: 5-10% fewer entries
- wave 5: 10-15% fewer entries
- wave 6-8: 15-20% fewer entries

## Deferred Design Questions

- Should wave 5 remain a fixed MIRV set piece, or become a family of MIRV-with-escort templates?
- How much randomness is desirable before a tactic becomes unreadable?

Resolved for Phase 2:

- Attack cells should start as explicit data templates with deterministic selection. Procedural generation can come later if templates become too rigid.
- Concurrent cap remains a runtime guardrail, but cells carry IDs and analysis must measure realized overlap/degradation.
- Fast variants should be assigned deliberately by cell role for cell entries.
- Pool allocation uses deterministic greedy template selection with explicit fallback templates.

## Recommendation

Start with the classification bug, fix `MIXED_AXIS`, then establish tactical metrics before touching attack cells. Do not retune budgets first. The current budgets are useful guardrails; the immediate problem is that threat composition is tactically under-expressive.

The most elegant first milestone is:

- Shaheds correctly participate in tactics.
- `MIXED_AXIS` treats Shahed variants as drone-like threats.
- Wave analysis reports repetition and axis diversity.

The second milestone is the attack-cell layer with explicit cap, pool, and speed policies. After tactic quality improves, reduce counts. Otherwise we are tuning quantity while the quality knob is still unplugged, which is a bold strategy usually reserved for committees and very confident plumbing.
