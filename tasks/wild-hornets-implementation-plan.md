# Wild Hornets — implementation plan

**Source:** [`docs/wild-hornets-targeting-analysis.md`](../docs/wild-hornets-targeting-analysis.md) §7 recommendations.
**Date:** 2026-07-25
**Status:** plan only — nothing implemented.

The analysis ranks its fixes by "does this break player intuition?", not by score. This plan keeps
that ordering: the feedback channel gets fixed first, and every measured claim is re-verified
against the vendored harness at the same seeds before the next phase lands.

---

## 0. Shape of the work

Eight phases (0–7), each independently landable and independently revertable.

> **Resolved (codex review):** the "defer replay repair to Phase 7" split was unshippable.
> `replay.ts:112` **hard-rejects** any replay below `CURRENT_REPLAY_VERSION` — not "diverges",
> _refuses to load_. So the version bump and the fixture re-recording must happen in the **same
> commit**, at Phase 1. Only the desktop/iPhone baseline _capture_ defers to Phase 7. See §7.

| Phase  | Contents                                            | Balance impact          | Feel-check needed |
| ------ | --------------------------------------------------- | ----------------------- | ----------------- |
| 0      | Baseline capture + tuning-constant extraction       | none (provably)         | no                |
| 1      | L1 — three distinct death presentations             | ~none, must be measured | **yes**           |
| **2a** | L3a — detonate at the hornet, keep 12/30            | ~none (near no-op)      | light             |
| 2b     | L3b — fuze 45 / blast 52 — _optional, unreplicated_ | balance change          | **yes, critical** |
| 3      | L5 / L6 — pad batch-pick, relinquish-on-pass-below  | free / negligible       | light             |
| 4      | L2 — accel-aware fuel gate (+ conditional MIRV)     | fuel-outs 9% → 0.3%     | yes               |
| 5      | §6 — SkyMesh loiter — _prototype, decide after_     | **+11–30%, deliberate** | **yes, critical** |
| 6      | Tier 3 — lead clamp for the uncatchable case        | small                   | light             |
| 7      | Device perf + bot re-baseline                       | n/a                     | no                |

Phase 5 depends on Phase 4 (the fuel gate is wash-to-negative for SkyMesh on its own — E20).
Everything else is order-independent, but the order above is the recommended landing order.

**Cut by review:** the role-shaped speed cap (was Phase 4's L7 half) — deferred indefinitely, see
§4.2. **Split by review:** Phase 2 into 2a/2b.

---

## Phase 0 — Guardrails and one obvious place for the knobs

No behaviour change. This phase exists so every later phase can be measured and tuned.

### 0.1 Capture the pre-change baseline

```bash
# PRIMARY baseline — unmodified `average` bot, no knobs
npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 pre-A-avg
npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 91000 pre-B-avg

# SECONDARY scenario — the analysis's "realistic" profile
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 pre-A
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 91000 pre-B
BOT_SKIP=0.35 npx tsx docs/analysis-harness/wild-hornets/marginal.ts
```

Save raw output to `tasks/hornet-measurements.md`. Every later phase re-runs these and appends to
the same table. Per Appendix E.2, **treat any delta under ~10% as unresolved** — run-to-run spread
on an unchanged config is ±5–10%.

> **Resolved (codex review) — and both claims are confirmed in the code.** `probe.ts:105` calls
> `resolveBotConfig(defaultConfig, "average")`, so the harness's "stock bot" is **already** the
> humanized `average` preset, not the max-accuracy `perfect` default. `BOT_SKIP=0.35` then deletes
> another 35% of its actions on top. And `probe.ts:150` reads
> `if (action && BOT_FOCUS_Y > 0 && (action.targetRef?.y ?? 0) > BOT_FOCUS_Y) action = null;` — it
> **discards the shot** rather than letting the bot pick an available upper target. So `BOT_FOCUS_Y`
> does not model "concentrate attention up top"; it models "fire less".
>
> The "realistic" profile is therefore a triple reduction in player fire, and §3.1's premise —
> "the stock bot fires far more accurately and often than a human" — is wrong about the harness's
> own default. Hit-rate and orphan-rate gaps between profiles (44.7%/38.6% vs 31.0%/53.2%) are
> substantially an artifact of the player shooting less, not of hornets working better.
>
> **Consequence for this plan:** trust hornet-internal geometry (E2, E3, E17, E19) from these runs.
> Do **not** treat orphan-rate, role-mix or cede-the-bottom conclusions as settled.

Also record the current-state facts the harness README claims, so a later failure is attributable:

```bash
npx vitest run src/game-sim.test.ts     # expect 134 passing
npx tsx src/headless/sim-runner.ts 12345 # determinism check
```

### 0.2 Extract the hornet tuning block

Every hornet number is currently a literal buried in `updateAutoSystems()`. Phases 1, 2 and 5 are
all feel-bearing, and the user holds the controller — the knobs must be in one place they can
find without reading the sim.

New block in `src/game-logic.ts`, alongside the existing `IRON_BEAM_*` / `LAUNCHER_*` constants:

```ts
// ── Wild Hornets tuning ──
export const HORNET_LIFE = 168;
export const HORNET_SPEED_MIN = 4.476;
export const HORNET_SPEED_MAX = 6.72;
export const HORNET_BLAST_RADIUS = 30;
export const HORNET_FUZE_RADIUS = 12; // Phase 2 raises this
export const HORNET_RELOAD_TICKS = 60;
export const HORNET_LAUNCH_GAP = 24;
export const HORNET_LEAD_FRACTION = 0.3; // deliberate under-lead — the tail chase is the drama
export const HORNET_DIVE_SLACK = 80;
```

`HORNET_DIVE_SLACK` moves out of `game-sim.ts:872`. Everything else replaces the literals in
`updateAutoSystems()` (`game-sim.ts:965–1099`).

**Verification that this is a true no-op:** harness output must be byte-identical to 0.1, and the
determinism check must produce the same hash. If it does not, a literal was transcribed wrong.

---

## Phase 1 — L1: three outcomes, three presentations

The highest-value change in the analysis and the one that makes the rest legible. A hornet that
ran out of fuel, a hornet whose target was stolen, and a hornet that scored are currently the same
yellow puff with the same explosion sound.

### 1.1 Sim — an explicit death, not three identical `boom()` calls

`Hornet` gains a dying phase (`src/types.ts:326`):

```ts
phase?: "flying" | "dying";
fate?: "fuelOut" | "standDown";
dyingTicks?: number;
spin?: number;
vy?: number;   // tumble only
```

Optional fields so `editor-scene.ts` and any state constructors need no churn.

New helper in `game-sim.ts` replacing the three call sites (`:1025`, `:1050`, `:1088`):

| Fate        | Was                         | Becomes                                                                                                     |
| ----------- | --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `kill`      | `boom()` at **target** pos  | `boom()` at hornet pos (Phase 2) — unchanged bright detonation                                              |
| `fuelOut`   | `boom()` r=15 at hornet pos | **no explosion.** Sputter burst (reuse the existing recipe at `:1029`) → tumble → small smoke puff          |
| `standDown` | `boom()` r=15 at hornet pos | **no explosion.** No sparks — power loss: brief flicker, dead fall, faint puff. Visually _not_ a detonation |

Dying hornets:

- clear `targetRef` immediately, so `getHornetAssignmentCounts` (`:780`) stops reserving the threat
  — otherwise a fizzling hornet suppresses the next launch for the length of its tumble;
- skip all targeting, dive and fuze logic (early return at the top of the per-hornet loop) — a dead
  hornet must not kill anything;
- integrate gravity + spin only, and are culled on the same bounds check or after `dyingTicks`.

### 1.2 Render — `src/pixi-render.ts:3530–3564`

The hornet block already fades the trail by `lifeFrac`. Extend it by phase:

- **flying** — unchanged.
- **fuelOut** — trail collapses fast, sprite tumbles by `spin`, sparks are the story.
- **standDown** — no engine glow at all, trail cut immediately, sprite darkens and falls.

The distinction has to be readable at gameplay speed on a phone screen, not in a freeze-frame.

### 1.3 Audio — half the feedback channel

Today `boom()` emits an `explosion` sfx for all three outcomes. Removing the fuel-out and orphan
explosions removes those sounds, which is most of the win on its own.

Recommended addition: a `hornetFizzle` sfx (`types.ts:788` union → `sound.ts` → `game.ts:1352`
switch → `docs/audio-event-contract.md`). Cheap, and it makes "my hornet stood down" audible
without looking.

### 1.4 The honesty note

The analysis calls L1 "no balance impact". **That is not strictly true.** Fuel-out and orphan
currently create a real 15px-radius blast that can kill something. Removing it is a small nerf.
Expected to be inside the noise floor — but it must be _measured_, not assumed. Re-run 0.1.

### 1.5 The harness classifier must learn about the dying phase — in this phase

> **Resolved (codex review):** accepted, and it gates the phase.

`probe.ts` classifies a hornet's fate by reproducing the sim's branch order against a **pre-update
snapshot**, and only when the hornet leaves `g.hornets`. A hornet that lingers for a tumble with a
cleared `targetRef` classifies as `orphan` at removal time regardless of why it actually died.

So the classifier must read the new `phase` / `fate` fields directly and classify at the _entry_
into `dying`, not at removal. **Until that lands, Phase 1's measurement is noise**, and the whole
"is L1 really balance-neutral?" question (§1.4) is unanswerable.

### 1.6 Replay version and fixtures — lands here, not in Phase 7

`replay.ts:112` rejects any replay below `CURRENT_REPLAY_VERSION` outright. The moment particle
counts change, every archived replay is invalid — so:

- bump `CURRENT_REPLAY_VERSION` 6 → 7 (`src/replay-version.ts`);
- re-record `public/replays/perf-wave1.json`, `perf-wave4-upgrades.json`, `perf-burj-burning.json`
  via `src/headless/record.ts`, **in the same commit**;
- update the `version: 6` literal in `e2e/replay.spec.ts` (its fixture is inline and compares two
  runs of the same replay against each other, so it is otherwise self-healing).

Phases 2–6 then re-record fixtures only — the version stays at 7.

### 1.7 Tests (`src/game-sim.test.ts`)

1. Hornet at `life = 1` with a live target → no explosion created, hornet enters `dying`,
   `targetRef` is null.
2. Hornet whose target is killed by something else, no SkyMesh → `standDown`, no explosion.
3. Dying hornets do not reserve targets: two pads, one threat, first hornet dying → second launches.
4. A dying hornet passing within fuze range of a threat does not detonate or damage it.

---

## Phase 2 — L3: stop teleporting the blast (2a), then decide about the fuze (2b)

> **Resolved (codex review) — blocking, and the decomposition is better than the original.**
> These were one item. They are two, and only one of them is a correctness fix.

### 2a — Detonate at the hornet's own position. Keep 12/30.

`boom()` moves from `hTarget.x, hTarget.y` to `h.x, h.y` (`game-sim.ts:1088`). Nothing else changes.

This is the honest version, and at the current fuze it is **very nearly a no-op**: a target inside
the 12px fuze is already well inside a 30px blast, so the same things die either way. That is
exactly what makes it the right first step — it removes the lie without buying anything with it,
and it is a precondition for widening the fuze later (at 45px the teleport would be blatant).

Expected: within noise on every metric. If it is not, something else is wrong.

### 2b — Widen the fuze. This is a balance change, on weaker evidence than it first appears.

`HORNET_FUZE_RADIUS` 12 → 45, `HORNET_BLAST_RADIUS` 30 → 52. Blast **area** nearly triples.

**Correcting the original framing in this plan:** "+38% kills at 2 pads" (31.4 → 43.3) is a count
of _classified detonations_, and Appendix E.6 says plainly that detonation counts are exact while
kill attribution is approximate. The metric that survives that caveat is score, and E5 is
bot-default, single seed: 13,252 → 14,453 at 2 pads — **+9%, at the edge of the ±5–10% noise
floor**. The SkyMesh number is stronger (16,609 → 20,246, +22%). Neither is replicated on seed B.

So 2b is optional, and it needs a replicated measurement before it lands — not an inherited number.

Two things the analysis did not have to care about but we do:

- **The explosion sfx is sized by radius.** `boom()` classifies `> 45` as `"large"`
  (`game-sim.ts:103`). A 52px hornet warhead would make every hornet kill sound like a Patriot.
  Add an explicit size override to `boom()`'s options and pin hornets to `"medium"`.
- **Splash at 52px, `playerCaused = false`.** Verify against the F-15 rule (only direct interceptor
  hits are meant to destroy friendlies) and against `isThreatDoomedByActiveExplosion` chaining.

**Dropped:** the earlier suggestion of pairing 2b with a reload nerf to hold aggregate score
constant. Buffing one axis to nerf another is how a system ends up with two wrong numbers instead
of one. If the wide fuze does not earn its place on its own, it does not land.

### 2.3 Feel-check for 2b

Hornets will pop ~45px short instead of kissing the target. Watch for:

- does it read as a proximity warhead, or as hornets chickening out?
- do multiple hornets on one threat now chain-pop into a popcorn effect?
- at phone scale, is a 52px blast still recognisably a _hornet_ blast and not a Patriot's?

### 2.4 Tests

2a: kill detonation is created at the hornet's position, not the target's.
2b: a threat at 44px triggers the fuze and one at 46px does not.

---

## Phase 3 — L5 / L6: two cheap consistency fixes

### 3.1 Alternate pad iteration order

`getActiveHornetSiteKeys` (`game-sim-shop.ts:131`) always returns left before right, and the launch
loop iterates in that order, so the left pad gets first refusal on every target every tick —
including the right pad's half. Left does 33% more work and is dry 51% of the time vs 39%.

> **Resolved (codex review) — blocking, and the mechanism analysis is correct.** The original fix
> was `Math.floor(g.waveTick) % 2 === 1`. It would not have alternated anything. `HORNET_LAUNCH_GAP`
> is 24 and `HORNET_RELOAD_TICKS` is 60 — **both even**. Two pads that start a wave synchronised
> (both at `ammo = 2`) become eligible on same-parity ticks and stay there, so a tick-parity swap
> resolves to a _constant_ order for that pair. It would have looked like a fix and changed nothing.

**Fix: batch-pick before committing.** Compute a target for every eligible pad against the same
assignment snapshot, deduplicate across pads, then commit all launches. This removes first refusal
as a concept rather than taking turns at it, and needs no new GameState field.

The fallback if batch-picking proves invasive is an explicit persistent salvo owner
(`g.hornetLaunchParity`, flipped on each launch, not each tick) — real state, but honest state.

**Test the mechanism, not the aggregate.** Two pads eligible on the same tick with two equally-good
targets must not both resolve to the left pad's preference. A 50/50 aggregate split is _not_ a valid
assertion — threat geography can legitimately keep the totals asymmetric, and a test that demands
symmetry would be measuring the spawn table.

### 3.2 Delete the climb-away branch

`game-sim.ts:1073–1080`: a hornet whose target is more than `HORNET_DIVE_SLACK` _below_ it drifts
upward at half speed, away from the thing it is supposed to kill. 0.2–0.5% of hornets, and exactly
the kind of edge case that reads as broken.

> **Resolved (codex review) — accepted on the main point, with one premise corrected.**
>
> The main point is right and reframes the bug: the absurdity is not "refuses to dive", it is
> **holding the reservation while flying away from the target**. The hornet keeps the threat marked
> as covered, suppressing other launches, while actively increasing the distance. That is the part
> that is indefensible under any role reading.
>
> The stated risk — "hornets diving into the protected ground area" — does not hold mechanically.
> There is no explosion→friendly-structure damage path: Burj damage comes from threat impacts
> (`applyBurjHitDamage`, called at `game-sim.ts:173`), not from blasts. So a low-diving hornet is a
> _feel_ risk (hornets nose-diving into the city looks odd), not friendly fire.

**Adopted fix: relinquish, don't climb.** When the target passes more than `HORNET_DIVE_SLACK`
below the hornet, drop the reservation immediately. SkyMesh hornets then retarget or loiter; a base
hornet enters the `standDown` presentation Phase 1 just built. The climb-away movement branch is
deleted either way — it has no defensible reading.

**Keep** the `HORNET_DIVE_SLACK` filter in `pickHornetRetargetTarget` (`:880`) — that one is target
_selection_, and Phase 5 relaxes it for loitering hornets only.

**Measure both variants**, because relinquish-on-pass-below is a larger behaviour change than
deleting a branch that fires for 0.2–0.5% of hornets: it will raise the `standDown` rate, and the
alternative (allow the dive, bounded by the fuel gate) is not obviously worse. Do not assert which
is right — 0.2–0.5% is small enough that either could vanish into the noise floor.

Test: a hornet whose target passes below it clears `targetRef` within one tick and stops moving
away from it.

---

## Phase 4 — L2 + L7: can we get there, and is it our job

Two rules answering different questions. Only the second one needs to be legible to the player.

### 4.1 The accel-aware intercept solver (L2)

Missiles compound `vx *= accel ** dt` (`game-sim.ts:1341`) with `accel = 1.018` — over 120 ticks
that is 8.4×. Comparing straight-line distance against `speed × life` ignores both the acceleration
and the fact that the threat is descending _toward_ the pad, so it rejects targets that are
comfortably reachable.

New pure, exported, independently testable helper:

```ts
// Displacement after n ticks with accel applied before the move: v0·a(aⁿ − 1)/(a − 1)
// Smallest n where hornetSpeed·n >= |P_threat(n) − from|, by bisection. null if unreachable.
export function hornetInterceptTicks(
  fromX: number,
  fromY: number,
  threat: Threat,
  hornetSpeed: number,
  maxTicks = 400,
): number | null;
```

`a === 1` (drones, no accel) degenerates to `v0 · n`. This helper is the single highest-confidence
piece of the whole plan, because **the analysis hands us its expected outputs** (E17) — they become
the test:

| Missile v0 | Hornet speed | Expected ticks |
| ---------- | ------------ | -------------- |
| 1.3        | 4.476        | 137            |
| 1.3        | 6.72         | 122            |
| 2.0        | 4.476        | 120            |
| 2.0        | 6.72         | 108            |
| 3.0        | 5.6          | 100            |

Gate in `pickHornetLaunchTarget`: keep only candidates with `ticks !== null && ticks <= HORNET_LIFE * 0.9`;
**hold the slot** if none qualify. The 0.9 is the margin — median actual/predicted is 1.01×, 90th
percentile 1.06–1.10×.

This reverses the general "never hold the slot" rule (§4.6) on purpose. Holding is wrong when the
reason is "my half is busy" (common, arbitrary). It is right when the reason is "nothing on screen
is physically catchable" (rare, provably correct — it correctly flagged 98.9% of actual fuel-outs).

**One design call the analysis leaves open:** the picker does not know the hornet's speed, which is
rolled at spawn (`rand(4.476, 6.72)`).

> **Resolved (codex review) — blocking, and it kills the original proposal.** That proposal was
> "roll the speed before target selection and pass it in". It is wrong, for a reason worth writing
> down: when the gate rejects everything the pad **holds**, and next tick it would roll again. That
> is rejection sampling. It consumes seeded sim RNG while the pad is idle, and — worse — it
> **manufactures a fast hornet through repeated attempts**, because rolls keep happening until one
> is fast enough to catch something. The speed distribution would skew high exactly when targets are
> marginal, which is precisely when it should not.

**Adopted: a preloaded speed in magazine state.** `HornetSiteState` gains `loadedSpeed`, rolled
once when a slot finishes reloading. The RNG is consumed exactly once per reload regardless of how
long the pad holds, the gate models the actual hornet that will fly, and it is physically coherent —
the drone in the tube has the speed it has. `HornetSiteState` lives in `GameState`, which replays do
not serialise, so this is cheap.

**Fallback if that proves invasive:** gate on a fixed conservative planning speed
(`HORNET_SPEED_MIN`, or the 5.6 mean). No new state, no RNG change, slightly pessimistic for fast
hornets — and it never rejection-samples, which is the property that actually matters.

### 4.2 The role-shaped engagement rule (L7)

Today: "anything unassigned". Not a rule anyone can hold in their head, which is why the role reads
as fuzzy. Rule C from §5.6, the only candidate score-positive on both seed bases:

> **Hornets take drones and bombs, whatever they are doing. They will take a missile only while it
> is still slow — once it has built up speed, that is the Patriot's and Roadrunner's job.**

In `pickHornetLaunchTarget`, before scoring:

```ts
const inRole = t.type === "drone" || t.type === "bomb";
const eligible = inRole || Math.hypot(t.vx ?? 0, t.vy ?? 0) <= HORNET_BALLISTIC_SPEED_CAP;
```

Cap default **4.5** (E23 best at 13,148; 3.5 scored 12,712 and is the one replicated on seed B).

> **Resolved (codex review) — deferred, and the argument is the stronger one.** The whole
> justification for rule C was _legibility_ — "one sentence a player can hold in their head". But
> **a px/tick threshold is invisible**. The player cannot see velocity; they would observe only
> "hornets stopped taking missiles at some point", which is no more inferable than the assignment
> state it replaces. The rule's legibility claim does not survive contact with what is actually
> on screen.
>
> Combined with Appendix E.2 naming this exact result as inside the noise floor (+4–8% on n=20),
> it is the weakest-evidence item in the plan and the only one whose stated benefit is unmeasurable.
>
> **What ships instead** is the rule the system already implements and the fuel gate completes:
> _hornets prefer bombs and drones, then take whatever else they can actually catch._ Both halves
> of that are visible in play.
>
> Revisit the speed cap only if a larger sample **and** a feel-check show a role problem that the
> feasibility gate did not solve.

### 4.3 MIRV exclusion — conditional, measured after the gate

Deferring rule C un-redundants §5.4, so the MIRV question comes back. It rests on a cleaner
observation than any score delta: **0-for-33** against a class Roadrunner scores at 1000 and
Patriot at 100. That is a capability statement, not a noisy mean.

But the fuel gate may already answer it — so **do not pre-commit**. Land the gate, then count MIRV
launches and hits in the same harness run. If hornets still launch at MIRVs and still go ~0-for-N,
add the exclusion in E15's soft form (drop `mirv` / `mirv_warhead` / `stack2` / `stack3` from launch
candidates _when anything else exists_, so a pad with nothing else to shoot is not left idle;
score-neutral-to-positive at 12,320 / 14,637). If the gate already suppressed them, nothing to do.

### 4.4 Composition and hold-fire

Order: MIRV filter → fuel gate → existing scoring/half-map logic. Hold the slot only when the fuel
gate leaves nothing — that is the "physically uncatchable" case, which is rare and provably correct.

### 4.4 Expected results

Fuel-outs ~9% → ~0.3%, launches/run 98 → 87 at 2 pads, score flat-to-up. **SkyMesh will look
wash-to-negative here** (E18: 15,642 on seed A but 14,157 on seed B against a 15,459 baseline).
That is expected and is precisely why Phase 5 exists — refusing uncatchable targets only pays if
the hornet has something else to do.

### 4.5 Tests

Gate holds fire when nothing is catchable and launches when something is; a fast plain missile is
rejected while a fast diving drone is accepted; the solver table above.

---

## Phase 5 — §6: SkyMesh loiter

**A deliberate +11–30% power increase, not a consistency fix.** Land it as its own commit so it can
be reverted without taking Phase 4 with it.

With the fuel gate in place, 96% of remaining SkyMesh fuel-outs are hornets that ran out of _work_,
not fuel (E19). Today that fizzles indistinguishably from a failed intercept. The proposal turns it
into the upgrade's own fantasy: when nothing is catchable, hold station.

### 5.1 Mechanic

Reached only from the retarget branch (`game-sim.ts:1053–1070`), which requires
`retargetsRemaining > 0` — Infinity only when `skyHunterMesh` is owned. **SkyMesh-exclusive by
construction**, and E20 confirms 1-pad and 2-pad results stay byte-identical.

- On finding no target: anchor at the current position, fly a slow ellipse around it.
- Fuel burn drops to **0.25×** — 168 ticks of fuel becomes ~670 of station time.
- Re-scan every tick; break off the instant a catchable target appears.
- While loitering, drop the `HORNET_DIVE_SLACK` filter so it can engage _below_ itself. A mesh
  defends its patch in all directions. Worth a further ~4% (17,338 vs 16,588).
- **No separate grace timer.** The reduced burn is the natural limiter; a timer would be redundant,
  and a 1s grace would cut off ~22% of reactivations that do eventually happen.

New `Hornet` fields: `loiterX`, `loiterY`, `loiterAngle`. A loitering hornet has a null `targetRef`,
so it correctly reserves nothing.

Tuning constants (all arbitrary in the measured version — they go in the Phase 0 block):
`HORNET_LOITER_RADIUS = 22`, `HORNET_LOITER_RATE = 0.06` rad/tick, `HORNET_LOITER_BURN = 0.25`.

> **Resolved (codex review) — accepted, and it matters more here than in the abstract.** 168 ticks
> at 0.25× burn is **~11 seconds** of station time per hornet. On an orphan-heavy mixed build that
> accumulates into a cloud that is both visually noisy and performance-relevant — each loiterer is a
> live Pixi node with a trail. This lands on a project with an **open WebContent memory-kill
> investigation on iPhone** ([`docs/webcontent-memory-limit-proof-2026-07-19.md`](../docs/webcontent-memory-limit-proof-2026-07-19.md)),
> so "probably fine" is not an available answer.
>
> Required before this phase is accepted:
>
> - **peak and p95 concurrent-loiterer counts** added to the harness telemetry;
> - **its own replay perf run** on device — not deferred to the Phase 7 baseline;
> - a `HORNET_LOITER_MAX_CONCURRENT` cap constant in the Phase 0 tuning block, kept as an obvious
>   lever alongside a less generous burn rate.

### 5.2 Feel-check — the crux

The analysis is explicit that this is unresolved: whether hornets holding station read as
"protective mesh" or "confused insects" depends entirely on orbit rate, radius, and whether they
visibly spread or cluster. Reactivation is fast (median 31 ticks, 0.52s) and 11.4% of all kills
come from a reactivated loiterer, so the payoff moment exists — it just has to _look_ like one.

### 5.3 Tests

With mesh and no valid targets, a hornet survives well past `HORNET_LIFE` and stays near its anchor;
without mesh, behaviour is unchanged; a new threat inside reach breaks the loiter within one tick.

---

## Phase 6 — Tier 3: clamp the lead for the uncatchable case

Keep `HORNET_LEAD_FRACTION = 0.3`. The tail chase is the drama and raising the multiplier is
measurably _worse_ than doing nothing (E6: SkyMesh 16,609 → 14,867 at ×1.0).

The genuine defect is that when no intercept solution exists, `hLeadFrames = d / h.speed` degenerates
and the hornet flies off in a near-constant wrong direction. Two lines:

- clamp `hLeadFrames` to the hornet's remaining `life`;
- when `hornetInterceptTicks` (Phase 4) returns null, drop to pure pursuit (lead 0).

Small, cheap, and if it measures inside the noise floor it can be dropped without loss.

---

## Phase 7 — Final baseline capture

> **Resolved (codex review) — blocking, and correct.** "Defer replay repair to the end" is
> compatible with one long-lived branch, not with per-phase landing. `replay.ts:112` _rejects_ a
> stale replay rather than merely diverging, so a landed commit that skipped the repair would ship
> a broken perf harness.
>
> **Chosen:** replay repair at every landing boundary. It is cheap — `src/headless/record.ts` is a
> headless run, not a device cycle. The version bump and first re-record move into **Phase 1**
> (§1.6); every later phase re-records fixtures as part of its own commit.

What actually remains at the end, because it is the expensive part and only the final state is
worth measuring:

- Recapture desktop baselines (`npm run perf:smoke`) and iPhone baselines (`scripts/bench.sh`),
  commit the medians under `perf-results/baselines/<buildId>/`.
- Re-tune the headless bot via `/train-bot` — Phases 2 and 4 change what hornets cover, so
  `bot-config.json` targeting priorities may be stale.

**Exception:** Phase 5 (loiter) takes its own device perf run regardless, for the concurrent-node
reasons in §5.1.

---

## Per-phase verification protocol

Every phase, without exception:

```bash
npx vitest run                                          # unit + sim tests
npx tsx src/headless/sim-runner.ts 12345                # determinism
npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 <phase>-avg   # primary
npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 91000 <phase>-avg
BOT_SKIP=0.35 BOT_FOCUS_Y=700 npx tsx docs/analysis-harness/wild-hornets/variants.ts 20 70000 <phase>
npx tsx src/headless/record.ts                          # re-record perf fixtures (see §1.6)
npx playwright test e2e/smoke.spec.ts e2e/replay.spec.ts
```

Append the numbers to `tasks/hornet-measurements.md`. **Deltas under ~10% are unresolved, not wins**
— and per §0.1, read the `-avg` rows as primary and the `BOT_SKIP`/`BOT_FOCUS_Y` rows as a
fire-less scenario, not as "what a human does".

Then, for the feel-bearing phases (1, 2b, 4, 5): build to the iPhone (`npm run ios:deploy`) and hand
back with an explicit "watch for X" list. Score is a diagnostic here, not the objective — the stated
rubric is consistency and legibility, and only the controller-holder can judge that.

---

## Explicitly not doing

Straight from §7's own exclusion list, recorded so nobody re-derives them:

- **Raise hornet speed ~30%** (+19–25%) — short reach is the role's intended weakness; erasing it
  makes hornets a worse-differentiated Roadrunner.
- **Shorten the reload** (+12–18%) — a power buff, not a consistency fix. Back pocket for a future
  balance pass. **Not** to be used as compensation for Phase 2b; see §2b.
- **The role-shaped ballistic speed cap** — deferred by review (§4.2). Its justification was
  legibility, and a px/tick threshold is invisible to the player. Revisit only on a larger sample.
- **Block cross-side launches** — they are the _better_ intercept (82.2% conversion on arrival vs
  73.0%). Measured at 12,165 → 10,618.
- **Force hornets to stay in-role** — 12,165 → 9,817, orphan rate 38.6% → 51.9%.
- **Swept-collision fuze test** — tunnelling does not happen (median hidden approach 0.0px).
- **An altitude activation border** — makes hornets engage _faster_ targets, the opposite of the
  intended role.
- **Spell the pad→pad→mesh synergy out in shop text** — it is a discovery worth more than a tooltip.
  Phase 1 is what makes the discovery possible: with distinct feedback a lone pad reads as "my
  hornet stood down because you shot its target first", 69% of the time, which points at SkyMesh
  by showing its work.
- **Treating the rank-1 orphan rate as a bug** — it is SkyMesh's reason to exist. Only its
  presentation needed fixing.

---

## Decisions — settled by the review

Four of the five open decisions are now answered, and the answers are all "do less, measure first".
Recorded with what changed:

**D1 — Landing scope. → Phase 1 alone.** Bundling 1+2+3 would have made the legibility result
unreadable, and 2 and 3 both turned out to contain design defects. Isolating Phase 1 also isolates
the one question worth an early answer: does distinct feedback alone change the "hornets are bad"
impression?

**D2 — Phase 2's buff. → Neither option as posed.** The question assumed fuze-widening and
self-detonation were one change. They are not. Ship 2a (blast at hornet, 12/30) as the correctness
fix; treat 2b (fuze 45 / blast 52) as a separate, optional balance change requiring a replicated
measurement. The reload-nerf compensation idea is dropped outright.

**D3 — Role rule. → No speed cap in the first pass.** Its sole justification was legibility, and a
px/tick threshold is not visible to the player. Let the feasibility gate answer the physical
question. MIRV exclusion becomes conditional on what survives the gate (§4.3).

**D4 — Phase 5. → Prototype, decide later.** Not in or out on paper. Decide after phone feel,
concurrent-loiterer telemetry, and its own perf replay.

**D5 — Re-baseline cadence. → Per landing boundary.** Forced, not chosen: `replay.ts:112` rejects
stale replays outright, so a landed commit without re-recorded fixtures ships a broken perf harness.
Only the device baseline capture defers to Phase 7.

### Still open

**D6 — Phase 3.2 variant.** Relinquish-on-pass-below (adopted default) or allow the dive bounded by
the fuel gate? Affects 0.2–0.5% of hornets, so it may not be resolvable by measurement at all — in
which case pick on role reading, not on score.

**D7 — Does 2b ever get tried?** It needs a replicated two-seed measurement it does not currently
have. Worth spending the runs on, or is 2a enough?
