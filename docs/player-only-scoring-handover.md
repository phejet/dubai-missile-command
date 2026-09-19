# Player-only scoring — review and verification handover

2026-09-19. Implementation is local and uncommitted. The user explicitly requested
that a different model review the code and run broader checks. Do not treat the
implementation as fully verified or ready to ship.

## Scope and decisions

Implement [the approved plan](player-only-scoring-plan.md), under the RM-08 supporting
scoring study. Player, F-15, EMP and flare kills score base × combo; automation,
impact and friendly-fire explosion kills score zero. Multi-kill bonuses still pay.
The fifth consecutive productive root from ×1 cashes out +1,000 and resets to ×1.
Empty flare roots hold; empty interceptor roots hold when automation killed an
intended target before the blast damage window closed. Other empty roots reset.

The separate RM-09 Defect 2 collision fix has **not** been implemented. Do not mix it
into this verification: changing collision behavior invalidates this comparison.

## Implementation map

- `src/types.ts`: required explosion source, optional intended-target references and
  frozen hold eligibility, threat `killedBy`, score kinds and bonus-toast state.
- `src/game-logic.ts`: `COMBO_CAP`, `COMBO_CASHOUT_BONUS`, source sets, `stepCombo`,
  `awardKill`, `addScore` and optional module-level audit sink. Audit entries include
  base reward and current combo so kill awards can be checked independently.
- `src/game-sim.ts`, `game-sim-emp.ts`, `game-sim-flare.ts`: source assignment at every
  explosion/direct kill, chain inheritance, hold cutoff, ordered combo processing,
  cash-out before wave summary, toast initialization/decay.
- `src/game-sim-shop.ts`, `game.ts`, `replay.ts`, `headless/sim-runner.ts`: other score
  mutations routed through `addScore`. Headless human building bonuses were an extra
  mutation omitted from the original plan's inventory; they are covered too.
- `src/game.ts`, `ui.ts`, `App.css`, `index.html`: DOM cash-out popup, stale increment
  toast clearing and cap-derived HUD tiers. Editor scenes and editor preview calls
  now supply explicit explosion sources.
- `src/replay-version.ts`, `e2e/replay.spec.ts`, `public/replays/*.json`: version 13.
  The three public fixture files changed only their version fields.
- `src/player-scoring.test.ts`: 31 new focused cases. Existing explosion fixtures
  now supply sources; the wave-summary example uses valid ≤5 combo values.
- `scripts/scoring-change/fixture-trace.ts`: old/new gameplay projection comparison.
- `scripts/scoring-change/verify-scoring.ts`: three-seed headless score audit, written
  but **not run**. `tsconfig.json` does not include scripts, so app typecheck does not
  validate this script.
- State-contract/runtime/replay docs and ROADMAP record the local implementation,
  scoring break and outstanding review/device evidence.

## Checks already performed

- `npm run typecheck`: passed after implementation and formatting.
- `npx vitest run src/player-scoring.test.ts`: **31 passed**, before formatting only.
- `npx tsx scripts/scoring-change/fixture-trace.ts`: captured v12 baseline **before
  runtime edits**. Never regenerate that baseline with the new code.
- `npx tsx scripts/scoring-change/fixture-trace.ts --compare`: all three fixture
  traces matched after the runtime changes, before changing version fields to 13.
  An initial comparison failed solely because in-memory `undefined` keys differed
  from JSON-omitted keys; comparison now normalizes both through JSON.
- Changed implementation files formatted; `git diff --check` passed.
- Existing dev server returned HTTP 200 at
  <http://localhost:5173/dubai-missile-command/>. No browser/device inspection done.

Baseline and after files are local ignored artifacts:
`operator-results/scoring-change-20260919/fixture-{baseline,after}.json`.
The script hashes a gameplay projection every step and records phase boundaries and
final state: RNG, threat positions/types/alive flags, assets, upgrades, non-combo
stats and non-scoring wave summaries. This is **not a full-state proof**: it does not
separately instrument spawned/neutralized event counts or draft pick events.
Boundary objects also retain references until serialization; use the per-step hash
for historical comparison rather than assuming every nested boundary value is a
frozen snapshot. The short perf fixtures do not exercise every wave/shop edge.
Review whether this evidence is sufficient before accepting the fixture migration.

## Review priorities and missing coverage

1. Audit all real source paths, especially Hornet fuel exhaustion, both Patriot
   callbacks, direct flare kills versus harmless neutralization, chains, EMP,
   Iron Beam and Phalanx. Check that stats and RNG consumption remain unchanged.
2. Check hold timing/order: automation before detonation, during damage, and after
   alpha crosses 0.2; chain/root expiry; forced wave-end processing skips empty
   roots. Current tests use actual explosions but stage target-death metadata for
   hold timing. Add real interceptor/automation integration coverage.
3. Cash-out tests cover five hits, sixth-hit restart, exact reward multiplier,
   stale toast clearing and ordered overlapping root expiry. Add a wave-ending
   cash-out assertion against the recorded summary, overlapping kills at different
   current multipliers, and snapshot/HUD consistency with a live multi-kill popup.
4. Current ownership tests exercise source-tagged explosions and `damageTarget`;
   they do not independently prove every weapon caller passes the correct source.
5. Inspect popup placement at phone width. The specified extra 44 world pixels may
   not keep two tall DOM popups fully separate at every position/scale. Verify
   actual bounding boxes, screen edges, fade, sound, and the ×1 HUD on cash-out.
6. Inspect replay-anchor cloning of `intendedTargets` and newly retained dead
   threats; exercise seek/restoration around stolen-target holds.
7. **Known pending expectation:** `src/headless/sim-runner.test.ts` still expects
   seed 42 / 5,000 ticks to score **25,904** under the old scoring rules. Run it,
   explain the intended score delta, then update its score/comment deliberately.
   Preserve the wave/outcome tripwires unless evidence justifies a change. Other
   old assertions may also assume automated kill rewards or ×10.
8. The headless audit requires cash-outs in each chosen seed and an automated
   multi-kill across them. If coverage is absent, add a controlled positive case;
   do not silently remove these coverage assertions. The sink checks cap only at
   score events plus final maxCombo; the focused combo tests cover transition rules.
9. Review leaderboard/build and telemetry comparability: scores/max_combo have new
   meaning from v13. Do not compare bot-training scores across this change.

## Suggested verification sequence

Run focused gates first; investigate failures before broadening:

```sh
npm run typecheck
npx vitest run src/player-scoring.test.ts src/game-logic.test.ts src/game-sim.test.ts src/headless/sim-runner.test.ts
npx tsx scripts/scoring-change/fixture-trace.ts --compare
npx tsx scripts/scoring-change/verify-scoring.ts
npx tsx src/headless/sim-runner.ts 42
npm run lint
npm test
npm run test:e2e:quick
npx playwright test e2e/replay.spec.ts
node .agents/skills/roadmap/scripts/validate-roadmap.mjs
```

Review formatting and ROADMAP in the browser. Add the missing focused regressions
above, inspect the new overlay in-browser, then hand back for the user's iPhone
feel-check. No device release, commit or push is authorized by this handover.

## Shared checkout

Pre-existing edits were preserved: ROADMAP, docs index, Part Six report and generator/
verifier, lessons, and the untracked scoring/Defect 2 plans. This task added a scoring
paragraph to the existing ROADMAP edits and a lesson about deferring broader checks.
`tasks/todo.md` contains the current handoff but is locally ignored. Keep all work in
this checkout; no stash, worktree, reset, branch or fixture re-recording to hide drift.

## Review results — Claude, 2026-09-19

Code review found the scoring, source mapping, hold cutoff and cash-out logic correct
against the plan. One UI defect was fixed; one replay defect needs a decision.

**Independent evidence added**

- `scripts/scoring-change/verify-sources.ts`: 33 recorded bot games replayed tick by
  tick (24 random draft runs, plus runs bootstrapped with EMP, F-15 and Phalanx).
  Every root explosion's new `source` matches the weapon colour its call site already
  used (36,997 explosions). Every chain inherits its root's source (16,426 chains).
  Kills observed for every source except Phalanx, which bots never engage (100px
  turret range), so a real-path test covers it instead. 1,878 frozen hold decisions
  match an oracle rebuilt from observed death ticks and damage-window close ticks,
  including 422 automation-stolen holds and 0 same-tick ambiguities.
- `src/player-scoring.test.ts` (31 → 35 cases): Phalanx through its real turret path;
  wave-ending cash-out lands before the bonus screen (`kill, wave_clear, cashout`,
  score equals the audit); overlapping roots score kills at ×4 then ×5 before the
  cash-out; replay-anchor clones keep intended-target identity and hold identically.
- `scripts/scoring-change/verify-popup.mjs`: real DOM boxes at 390px and desktop.

**Fixed**

- Cash-out and multi-kill popups overlapped by ~14,000 px² at every position (the
  44-world-px shift is ~19 screen px; the popups are ~45px tall). `ui.ts` now anchors
  the bonus to the multi-kill popup when both are visible and stacks it one popup
  height above (below it near the top of the screen). Measured overlap is now 0 at
  every position on both viewports, including the spawn pulse. The multi-kill popup
  already overflows the canvas at the far left/right edges; the bonus now matches it.
- Golden seed updated 25,904 → 28,634 with the breakdown: same run (wave 7, timeout);
  9,134 player kill points + 6,250 multi + 5,250 wave clears + 8 cash-outs; the 18
  automation kills score 0.
- Four failures that predate this change: `test-fixtures/capture.ts` and
  `scripts/extract-diagnostic-replays.test.ts` hard-coded replay version 11 and had
  been failing since the v12 bomb fix. They now use `CURRENT_REPLAY_VERSION`.

**Open — deferred (test adjusted)**

- `src/replay-verification.test.ts` "verifies an unmodified headless recording…" fails:
  the first shop checkpoint differs only in score (recorded 106, replayed 1,618).
  Cause: in non-draft (shop-mode) replays, `resumeFromShop` calls
  `grantReplayUpgrade` first, which applies purchases for free (added in `07adfe6` to
  bypass meta-progression locks). The recorder paid through `buyUpgrade`. Under the
  old scoring, seed 74 could not afford anything at that shop, so the gap was hidden.
  Suggested fix: in non-draft replays call `buyUpgrade` first (the recorder's path) and
  fall back to `grantReplayUpgrade` only if the purchase fails. Live play is draft-only,
  so this affects bot and test replays only, under the v13 bump.
- User decision (2026-09-19): defer the replay fix. The checkpoint test now records in draft
  mode, like live play, with a comment pointing here; all 831 unit tests pass.

**Checks run**

Typecheck, lint (tracked code; `eslint .` also scans ignored `operator-results/`
study artifacts and fails there), 830/831 unit tests (the open item above), worker
tests 105/105, quick E2E 3/3, replay E2E 6/6, fixture old/new trace match, headless
score audit (3 seeds), sources and holds check (33 games), headless determinism,
roadmap validation, popup DOM check. Not done: iPhone feel-check.
