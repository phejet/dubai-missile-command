# RM-10 Stage C — drone routing and commitment

2026-09-22. Implemented and locally verified; uncommitted. Canonical status: [RM-10](../ROADMAP.html#rm-10).
The user authorized proceeding with the current missile angles, and explicitly chose targeted
dives for baseline Shahed-136s. Stage B missile geometry is unchanged.

## Contract

- All propeller variants except the pure bomber now dive; jets retain their dive and two bombs.
  Baseline propellers give up their pre-existing 45% speed advantage and become the slowest,
  most readable diver; the dedicated dive airframe takes that premium so the wave-3 introduction
  escalates. Speed and wave-budget price move together in `SHAHED_136_TUNING`. Pure bombers retain one bomb
  and no body attack. All other health, speed, acceleration, damage, rewards, spawn schedules and
  concurrent caps are unchanged.
- Cruise remains on the commander's entry side. Every diver samples the dive altitude band, so
  baseline propellers move off the old level-flight band that ran through the tower: a dive needs
  to start above the skyline or whole-path clearance rejects it. Pure bombers use the existing jet altitude band instead of flying into the tower.
  This is an intentional altitude change: their carrier body must not be an unaccounted attack.
- Reserve each intended terminal body at spawn using the same per-wave requested B/T/I sequence
  as missiles. Bombs are separate terminal bodies; cruise-only carriers are not quota units.
- Enumerate living destinations and four target-relative dive offsets. The cruise is horizontal;
  the cubic turn starts tangent to it and ends vertically at the selected destination. Propeller
  cruise/dive waypoint speeds remain 1.08/1.34 times sampled speed, with the existing 1.06 ramp
  capped at 4. Jets retain 1/1.2 cruise/dive speeds. Tuning lives in `TARGET_PRESSURE.drone`.
- Check every path segment against the real tower silhouette and city/site/launcher rectangles,
  rejecting intervening assets. Non-tower paths clear the tower throughout their entire path,
  including beyond the first target contact. Route selection is seeded and bounded.
- Reserve a provisional destination early. At 52 cruise ticks before the bank, starting at least 40 pixels inside the screen, choose a still-living
  same-category destination reachable from the unchanged cruise. Prefer the reserved destination;
  otherwise choose a feasible alternate. Commit accounting and reveal the aim together.
- The amber tell shows an arrow toward that fixed destination, for both jets and propellers.
  After the tell, no re-selection, even if the target dies. Defensive flare behavior is unchanged.
- If no continuation exists, cancel the dive reservation and continue the same horizontal cruise
  out of the screen. No jump, hard reversal, tower fallback or compensating attack. An initially
  empty route pool has the same explicit cancelled reservation and fly-through fallback.
- Preserve bomb counts and the jet's capped separation between its two cruise drops. Reserve bombs
  using the planned drop origins, then revalidate same-category live destinations at the actual
  drop. Propeller drops use the midpoint of the planned cruise (replacing the previous fractional jitter).
  Preserve sampled vertical velocity (2.4–4) and constant velocity. Use the shared missile
  route evaluator for first contact, skyline clearance, and post-target tower clearance.
- A skipped drop cancels its reservation; a launched bomb takes sole ownership. Losing the carrier
  cannot cancel a launched bomb. Player kills never refund committed or cancelled allocations.
- Warning diagnostics distinguish dive tell-to-impact prediction from bomb visibility inherited
  from its carrier. Shortfalls remain explicit; do not claim these numbers establish device feel.

## Lifecycle

| Event                        | Accounting                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| Diver spawn                  | Reserve one body and its bomb opportunities                       |
| Pure bomber spawn            | Reserve bomb only                                                 |
| No feasible initial route    | Cancel unit with `no-route`, retain requested allocation          |
| Commitment tell              | Final living same-category destination; commit body               |
| Target lost before tell/drop | Revalidate; cancel with `target-lost` if no feasible continuation |
| Target lost after tell/drop  | Keep frozen route                                                 |
| Bomb drop                    | Transfer reserved unit to bomb and commit once                    |
| Carrier killed/exited        | Cancel unlaunched reservations; end committed body                |
| Bomb killed/removed          | End its committed unit                                            |
| Wave boundary / replay seek  | Existing full-state clone/reset rules include all drone plans     |

Requested 30/50/20 does not imply delivered 30/50/20. Geometry redistribution, cancelled
opportunities and carrier interception remain separately observable. Stage D must audit combined
windows and actual destinations, not infer success from the request sequence.

## Verification

- `npm test`: **915 tests passed across 81 files**. Includes 47 Stage C cases for all five
  families, both flanks, waves 1/20/50, fractional movement, target loss, carrier/bomb ownership,
  mixed requests, actual building destruction, tower-only endgame and replay anchors.
- `npx playwright test e2e/smoke.spec.ts e2e/replay.spec.ts`: **21 passed**, including real replay
  wave seek, shop/bonus boundaries, repeated playback, boot/input and phone layout.
- `npx tsc --noEmit`, changed-file ESLint/Prettier, roadmap validation and diff checks pass.
- `npx tsx scripts/target-pressure/verify-stage-c.ts`: **840 controlled cases**: 720 actual
  flights plus 120 no-assets reservation checks (gameplay is terminal when the Burj is gone).
  No non-tower tower crossings; every flown unit ended or cancelled. Layouts: intact, upgraded,
  upgraded-cleared-city, no buildings, only tower, one far-right building, no assets.
  Waves 1/5/20/50; seeds 7/42/114.
- Three independent 5,000-tick bot recordings reproduce checkpoints and final scores. Combined
  committed mix: **106 tower / 180 buildings / 58 infrastructure** (30.8/52.3/16.9%).
  **151 cancelled** reservations; zero reported warning shortfalls in those three runs.
  Ten-commitment windows contain **1–5 tower attacks**. This is measured variation, not proof
  of a perfectly even short-window experience or a human-run balance claim.
- Every cancellation in those three runs is `carrier-lost` — the player killed the carrier before
  it committed. No `no-route` or `target-lost` occurred, and no unit reached its target, because
  the bot survives all 5,000 ticks. The loss and fallback contract is therefore evidenced by the
  controlled sweep and unit tests, not by the bot recordings.
- CPU sample, Mac only, and only meaningful from an otherwise idle machine: wave-one prop
  dive-bomber spawn p50 **0.38 ms**, its commitment update p50 **0.058 ms**, wave-50 spawn
  p50 **0.09 ms**. The commitment measurement includes the entire simulation update. p95/max
  rows in the JSON are wall-clock sensitive; recapture before treating them as a baseline.
  All family/wave rows are in `scripts/target-pressure/stage-c-verification.json`.
  The initial implementation redundantly scanned the skyline and reached roughly 21 ms p95;
  conservative segment bounds and preferred-destination-first revalidation removed that work.
- `node scripts/target-pressure/capture-stage-c.mjs`: phone (390×844) and desktop (1000×1000)
  captures inspected, both real commitment states have destination arrows and no page errors.
  Artifacts: `operator-results/target-pressure-stage-c/commitment-{phone,desktop}.png` and
  `browser-check.json`. This is a staged render check, not a human motion/feel verdict.
  Vite's stale module cache was detected by comparing served source with disk; the server was
  restarted with file polling and the final served module/captures rechecked.

## Replay migration

Replay version is **16**. Drone routes, drop selection, reservations and RNG consumption change
outcomes; v15 recordings are rejected rather than relabelled. All three maintained fixtures were
re-recorded from their templates. `verify-stage-c-fixtures.ts` exercises both the archived v15
simulator/inputs and the current v16 fixtures; `stage-c-fixtures.json` records completed results.
The archive is `operator-results/target-pressure-stage-c/baseline-60b1fa4b2f19857146ff6a978e3a18471b5aab0c/`.
The seed-42 canary is now 36,486 / wave 7 / 5,000-tick timeout (25,416 at Stage B, 23,292 before
the variant retune below). A single seed is a determinism check, not balance evidence: across 24
seeds the retune moved median score 29,474 -> 27,438 with median wave unchanged at 7, same 6-7
range and no deaths either side. Prior performance baselines are stale; recapture them on the
relevant platform before comparison.

## Variant retune (2026-09-22, post-review)

Stage C's first cut flipped `shahed136HasDive` for the baseline Shahed and left every stat that
existed because it could not attack. It stayed cheap (0.75 budget), kept its 1.45x speed premium
and stayed out of altitude tactics, which made the wave-1 opener the fastest propeller diver in
the game while wave 3 "introduced" one 45% slower. The wave-1 teaching order inverted and the
budget underpriced its most dangerous propeller by 30%.

Resolved by making the baseline the slow, readable introductory diver and moving the speed premium
onto the dedicated dive airframe, which already has its own sprite:

| Variant                  | speedMul       | threat          |
| ------------------------ | -------------- | --------------- |
| `shahed-136`             | 1.0 (was 1.45) | 1.0 (was 0.75)  |
| `shahed-136-bomber`      | 1.45           | 1.0             |
| `shahed-136-dive`        | 1.45 (was 1.0) | 1.3 (was 1.05)  |
| `shahed-136-dive-bomber` | 1.45 (was 1.0) | 1.55 (was 1.25) |

Speed and wave-budget price now live together in `SHAHED_136_TUNING` (`src/wave-spawner.ts`), so a
faster variant cannot silently become a more numerous one. The baseline also joins altitude
tactics, since it dives now; the pure bomber remains the only propeller excluded. Late waves are
mostly dive/dive-bomber, so the endgame is genuinely faster and the repricing is what absorbs it.
The three perf fixtures were re-recorded again after this retune. No human feel verdict yet.

## Stage D / E handoff

Stage C implementation and local checks are complete. Stage D must independently audit combined
planned/committed windows, all spawn/drop/split paths, route loss/cancellation, replay/seek and
CPU cost. Review the 1–5 tower range per ten commitments and the empty-route fly-through fallback.
Stage E remains the human check: near-building peel-offs, far-side cruises, readable destination
arrows/banks, jet versus propeller reaction time, and worthwhile building saves. Pure bombers
no longer ram the Burj; baseline Shaheds now dive by explicit user choice.

Stage E should specifically judge the retuned difficulty curve, since only the bot has seen it:
does wave 1-2's slow baseline diver read as forgiving, and does the faster dive airframe from
wave 3 land as escalation rather than as an unfair jump? All eight knobs are in one table
(`SHAHED_136_TUNING`) for tuning between runs. The 1.45x premium on `shahed-136-dive-bomber` is
the least evidenced number: it is the wave-4+ staple, so if the endgame feels spiky, lower that
row first. None of this has a phone feel verdict yet. Device timings and the Stage B MIRV
performance gate remain open. No commit, push, release or device install was performed.
