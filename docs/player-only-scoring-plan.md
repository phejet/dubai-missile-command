# Plan: Player-only kill points, ×5 combo cash-out, fair combo holds

## Summary for humans

Three scoring changes, nothing else in gameplay:

1. **Automation earns no kill points.** Hornets, Roadrunner, Patriot, Iron Beam, Phalanx and
   threats exploding on impact score 0. Interceptor shots (and their chain explosions), F-15,
   EMP and flares keep base × combo. Multi-kill bonuses still pay for every source.
2. **Combo caps at ×5 and cashes out.** _Revised after the feel-check: the hit that reaches ×5
   (the fourth in a row from ×1) pays the bonus in the "5× COMBO! +1000" toast; see the
   handover._ Originally: the next hit at ×5 (the fifth hit in a row from ×1)
   pays a flat **+1,000**, shows a small popup styled like the multi-kill popup, and resets
   the combo to ×1.
3. **Non-misses don't reset the combo.** An empty shot whose intended target was killed by
   automation before the shot's blast stopped dealing damage, and a flare explosion that hits
   nothing, leave the combo unchanged. In the study corpus these were 355 of 1,344 resets
   (258 automation, 97 flare).

How: the game currently does not know _who_ made a kill (the study inferred it by
instrumenting the code). So each explosion and direct-damage kill gets an explicit `source`,
and every score change goes through one function. That function pays player kills, pays 0
for automation, and can be audited in tests. The combo update becomes a small pure function
with the ×5 cash-out and the "hold" outcome. Replay version goes 12 → 13 because recorded
scores change. A before/after trace proves the fixtures play out identically apart from
score. Tuning lives in two constants: `COMBO_CAP = 5`, `COMBO_CASHOUT_BONUS = 1000`.

Hand back for an iPhone feel-check: the popup, the HUD combo tiers, and the combo holding
when a Hornet steals your target.

## Goal

Score only player-initiated kills, replace the ×10 persistent combo with a ×5 cash-out
(+1,000 popup), and stop resetting the combo for empty shots the player could not prevent.

## Context

- **Kill scoring sites (7), all `score += getKillReward(t) * combo`:**
  - `src/game-logic.ts` `damageTarget` (3 branches). Callers: EMP ring
    (`src/game-sim-emp.ts:164`, `COL.emp`), Iron Beam (`src/game-sim.ts:~1620`, `COL.laser`),
    Phalanx (`src/game-sim.ts:~1676`, `COL.phalanx`).
  - `src/game-sim.ts:~1579` flare `destroyThreat` callback.
  - `src/game-sim.ts:~2179/2206/2237` explosion kills inside `updateExplosions`, which also
    spawns chain explosions at `~2183/2210/2241`.
- **Other score mutations:**
  - Multi-kill bonus and top-up (`src/game-sim.ts:~2273/2286`).
  - Friendly fire −500 (`~2389`) and wave clear (`~2583`).
  - Shop spending (`src/game-sim-shop.ts:189/338/380/390`).
  - Building bonus: live in `src/game.ts:~1734`, replay in `src/replay.ts:~288`.
- **No source on explosions today.** `Explosion` (`src/types.ts:147`) has `playerCaused`,
  `chain` and `rootExplosionId`, but no owner. `createExplosion(..., options)`
  (`src/game-logic.ts:617`) and `boom(...)`
  (`src/game-sim.ts:114`) have 35 call sites. The scoring study attributed sources by
  enclosing function (`scripts/scoring-study/build.mjs`, `observer.mjs`). That mapping is the
  spec for step 2.
- **Combo:**
  - `processRootExplosionCombo(g, forceFinalKills)` (`src/game-sim.ts:~2298`) handles
    `playerCaused` root explosions: interceptor blasts and flare blasts
    (`game-sim-flare.ts:203/210/240`, `playerCaused=true`).
  - Today: kills ≥ 1 → `min(10, combo+1)`, else reset to 1.
  - Callers: `~2456` (startWaveBonus), `~2585` (wave completion), `~2625` (main tick).
  - `comboToast` (increments, 70-tick timer) and `multiKillToast` (DOUBLE/TRIPLE/MEGA,
    `~2262–2292`) decay near `~2508–2525`.
- **Blast timing:** an explosion deals damage only while `alpha > 0.2`
  (`updateExplosions`, `~2166`). The combo is processed only once `alpha <= 0` (except
  forced wave-end processing of blasts with kills). So a short visual fade follows the end
  of the damage window.
- **Intended targets:** `fireInterceptor` stores `ic.intendedTargets` (live threats near the
  tap, `src/game-logic.ts:443–486`). The root blast is created in `updateInterceptors`
  (`src/game-sim.ts:~2130–2145`). F-15 missiles are interceptors with `fromF15`.
- **Popup pipeline:** GameState toast → `src/game.ts` snapshot (defaults `~289–308`,
  builder `~365–395`) → `src/ui.ts` overlay refs (`~688–691`) and updates (`~736–758`) →
  `index.html:193–197` overlay elements → `src/App.css` `.transient-overlays__multi-kill*`.
  `src/editor-scene.ts:385–387` also builds a GameState.
- **HUD thresholds assume ×10:** `src/ui.ts:611–619` (tiers at 2/5/8, "Overdrive" ≥ 8) and
  `src/game.ts:~384–391` ("10× COMBO!", tiers 5/8).
- **Score is output-only in live play.** `draftMode` is always true (`src/game.ts:492`) and
  nothing in the sim reads `g.score` except shop purchases (non-draft replays/tests) and
  display/telemetry. The leaderboard index is build-scoped (`worker/migrations/0001_init.sql`).
- **Replays:**
  - `CURRENT_REPLAY_VERSION = 12` (`src/replay-version.ts`), with a strict version gate
    (`src/replay.ts:109–116`) and notes in `docs/replay-system.md`.
  - `public/replays/*` fixtures have no shop actions and no checkpoints.
  - `e2e/replay.spec.ts:30` hard-codes the version.
  - Headless replay: `createReplayRunner` (`src/replay.ts:29`) and `getRngState`
    (`src/game-logic.ts:362`). `scripts/scoring-study/run.ts` shows the pattern.
- **Shared-checkout rules:** no worktrees, stashes or branches. So the "old rules" side of
  any comparison must be captured before the code changes.
- **Existing tests:** `src/game-sim.test.ts` (441, 471, 488, 585: multi-shot, max combo,
  wave summary, final-explosion combo), `src/run-recap.test.ts`, `e2e/operator.spec.ts`
  mention combo.

## Steps

### Step 0: Capture the old-rules fixture baseline before editing anything

- **Files**: new `scripts/scoring-change/fixture-trace.ts`. Output goes to the ignored
  `operator-results/scoring-change-20260919/fixture-baseline.json`.
- **Changes**:
  - Replay each `public/replays/*.json` headlessly with `createReplayRunner`.
  - Record for each wave: start/end tick, RNG state (`getRngState`) at each wave boundary
    and at the end, spawned/destroyed/neutralized counts by threat type, asset state (Burj
    health, buildings alive, launcher HP, defense sites), picks, and final tick and outcome.
  - Deliberately exclude score, combo and toasts.
  - The same script run after the change writes `fixture-after.json` and diffs the two. It
    exits non-zero on any difference.
  - If building-impact Defect 2 lands first, take the baseline after it lands. If both
    changes land together, Defect 2 needs its own fixture decision before this comparison
    can pass.
- **Rationale**: two runs of the new build prove only repeatability. An old-vs-new trace
  proves the fixtures still play out identically apart from the intended score changes.

### Step 1: Scoring constants, pure rules and one audited score path

- **Files**: `src/game-logic.ts`, `src/types.ts`
- **Changes**:
  - `types.ts`:

    ```ts
    export type KillSource =
      | "player"
      | "f15"
      | "emp"
      | "flare"
      | "hornets"
      | "roadrunner"
      | "patriot"
      | "ironBeam"
      | "phalanx"
      | "impact"
      | "friendlyFire";
    export type ScoreKind =
      | "kill"
      | "multi"
      | "cashout"
      | "wave_clear"
      | "building_bonus"
      | "friendly_fire"
      | "spending";
    ```

    - `Explosion` gains `source: KillSource`, optional `intendedTargets?: Threat[]` and
      `_holdEligible?: boolean`.
    - The threat base type(s) gain `killedBy?: KillSource`.

  - `game-logic.ts`, beside `getKillReward` / `getMultiKillBonus`:
    - `COMBO_CAP = 5` and `COMBO_CASHOUT_BONUS = 1000`.
    - `PLAYER_KILL_SOURCES` (player, f15, emp, flare) and `AUTOMATED_KILL_SOURCES`
      (hornets, roadrunner, patriot, ironBeam, phalanx) as `ReadonlySet`s.
    - `addScore(g, amount, kind, source?)`: the only function that changes `g.score`. It
      also forwards `{ amount, kind, source, wave }` to an optional module-level audit sink
      set by `setScoreAuditSink(fn | null)`. The sink is module state, not a GameState
      field, so state cloning and serialization are unaffected. Production never sets it.
    - `awardKill(g, target, source)`: sets `target.killedBy = source`, then calls
      `addScore(g, points, "kill", source)`. `points` is `getKillReward(target) * g.combo`
      for player sources and `0` otherwise. The zero entries are emitted on purpose so an
      audit can prove automation contributed nothing.
    - `stepCombo(combo, outcome: "hit" | "miss" | "hold")` returns
      `{ combo, bonus, cashout }`:
      - hit < cap → +1
      - hit at cap → bonus `COMBO_CASHOUT_BONUS`, combo 1, cashout true
      - miss → 1
      - hold → unchanged

- **Rationale**: one obvious tuning spot, pure functions that are easy to unit-test, and a
  single scorer that makes a missed kill path impossible to hide or to leave unverified.

### Step 2: Make every explosion and direct kill carry its source

- **Files**: `src/game-logic.ts`, `src/game-sim.ts`, `src/game-sim-emp.ts`,
  `src/game-sim-flare.ts`, `src/editor-scene.ts` (and any other `createExplosion` users the
  type checker finds)
- **Changes**:
  - `ExplosionOptions` gains **required** `source: KillSource` and optional
    `intendedTargets`. Make the `options` parameter of `createExplosion` and `boom` required,
    so every call site must choose a source. Store both on the explosion.
  - Assign sources:

    | Call site (enclosing function)                                     | source                                               |
    | ------------------------------------------------------------------ | ---------------------------------------------------- |
    | `updateInterceptors` normal blast                                  | `player`, plus `intendedTargets: ic.intendedTargets` |
    | `updateInterceptors` `fromF15` blast                               | `f15`                                                |
    | `updateExplosions` chain blasts (3)                                | inherit `ex.source`                                  |
    | `hornetRunOutOfFuel`, `updateHornetFlight` (3)                     | `hornets`                                            |
    | `updateRoadrunnerFlight` (3)                                       | `roadrunner`                                         |
    | `updateAutoSystems` / `updateHaltedSimVisuals` Patriot callbacks   | `patriot`                                            |
    | `game-sim-flare.ts` (4, including harmless)                        | `flare`                                              |
    | `updateMissiles` (7), `updateDrones` (2), `applyBurjHitDamage` (2) | `impact`                                             |
    | `updatePlanes` F-15 wreck (friendly fire)                          | `friendlyFire`                                       |
    | `damageTarget` own explosions                                      | the `source` passed to `damageTarget`                |

  - `damageTarget(g, target, damage, color, radius, source, opts)`: new required `source`.
    Callers pass `emp`, `ironBeam` and `phalanx`.
  - Flare `destroyThreat` callback uses source `flare`.

- **Rationale**: the type checker enforces full coverage. The mapping matches the verified
  study attribution, so the study's numbers predict the result.

### Step 3: Route every score change through `addScore`

- **Files**: `src/game-logic.ts`, `src/game-sim.ts`, `src/game-sim-shop.ts`, `src/game.ts`,
  `src/replay.ts`
- **Changes**:
  - Replace the 7 kill-scoring lines with `awardKill(g, target, source)`, using `ex.source`
    inside `updateExplosions`.
  - Replace the other score mutations with `addScore` and the matching kind: multi-kill
    bonus and top-up (`multi`, source `ex.source`), cash-out (step 4), wave clear, building
    bonus (live and replay), friendly fire and shop spending.
  - Leave `recordThreatDestroyed`, kill stats and destroyed-type counts unchanged:
    automation kills still count as kills, they just score 0.
  - Leave the multi-kill bonus amounts unchanged for every source.
- **Rationale**: stats and recap stay comparable, and a headless run can reconcile the
  final score exactly against audited entries.

### Step 4: Combo cash-out and fair holds

- **Files**: `src/game-sim.ts`
- **Changes**:
  - **Freeze hold eligibility when the blast stops dealing damage.** "Killed first" means
    killed by automation before this shot's blast damage window closed: after firing, before
    or during the blast.
    - In `updateExplosions`, on the first frame a `playerCaused` root explosion with
      `intendedTargets` reaches `alpha <= 0.2`, set `ex._holdEligible` once:

      ```ts
      ex._holdEligible =
        (ex.kills ?? 0) === 0 && ex.intendedTargets.some((t) => !t.alive && AUTOMATED_KILL_SOURCES.has(t.killedBy));
      ```

    - Never recompute it afterwards. An automation kill during the visual fade (after the
      damage window) cannot turn a real miss into a hold.

  - `processRootExplosionCombo(g, forceFinalKills, onEvent)`: pass `onEvent` from all three
    callers. The outcome for each processed root explosion:
    - kills ≥ 1 → `hit`
    - else if `ex.source === "flare"` → `hold`
    - else if `ex._holdEligible === true` → `hold`
    - else → `miss`
  - Apply `stepCombo`:
    - **Increment:** keep today's `comboToast`.
    - **Cash-out:** `addScore(g, bonus, "cashout", ex.source)`, then set
      `g.comboBonusToast = { bonus, x: ex.x, y: ex.y - 20, timer: 90, pulse: 1 }`, then
      **`g.comboToast = null`**, clearing any still-visible "5× COMBO!" toast. Emit
      `onEvent("sfx", { name: "multiKill" })`.
    - **Hold:** changes nothing.
  - `_waveMaxCombo` and `stats.maxCombo` keep tracking (now ≤ 5).
  - Keep the `forceFinalKills` early return for empty blasts, so wave-end processing never
    resets. A cash-out at wave end must land before the wave summary.
  - Add `comboBonusToast: null` to the initial state (~335) and decay it beside
    `multiKillToast` (~2514).

- **Rationale**: the hold rule needs only data the sim already has (intended targets and who
  killed them), and freezing it at the damage window makes it deterministic and fair.
  Holding only on automation, not on the player's own other shot, matches the agreed
  definition of a non-miss.

> **Resolved — Codex [P2] stolen-target cutoff:** the cutoff is the end of the shot's
> damage window (`alpha <= 0.2`), frozen once in `_holdEligible`. Step 8 tests an
> automation kill before detonation (hold), during blast damage (hold) and after damage
> ended (miss).
>
> **Resolved — Codex [P2] stale increment toast:** a cash-out sets `g.comboToast = null`.
> Step 8 adds a regression that cashes out while the "5× COMBO!" toast is still live.

### Step 5: Cash-out popup (same style as multi-kill)

- **Files**: `src/types.ts`, `src/game.ts`, `src/ui.ts`, `index.html`, `src/App.css`,
  `src/editor-scene.ts`
- **Changes**:
  - `types.ts`: `ComboBonusToast { bonus; x; y; timer; pulse }`, plus
    `comboBonusToast: ComboBonusToast | null` on `GameState`.
  - `game.ts`: add a snapshot entry `comboBonusToast` (`visible`, `label: "COMBO BONUS"`,
    `bonus`, `x`, `y`, `alpha`, `scale`), using the same rise/alpha/scale math as `multiKillToast`. If a
    multi-kill toast is visible in the same frame, `ui.ts` stacks this one a full popup
    height above it (below near the top) so they don't overlap (review fix).
  - `index.html`: add a `#overlay-combo-bonus` sibling of `#overlay-multi-kill`. Reuse the
    multi-kill classes plus `data-tier="combo"`, with label and bonus spans.
  - `ui.ts`: add element refs and an update block mirroring the multi-kill one (`+1000`
    text, world position, visibility).
  - `App.css`: one `[data-tier="combo"]` colour rule, reusing an existing combo/HUD token.
  - `editor-scene.ts`: `comboBonusToast: null`.
- **Rationale**: the same pipeline and look as the multi-kill popup, with no Pixi changes.

### Step 6: Retune combo HUD and increment toast to the cap

- **Files**: `src/ui.ts` (~611–619), `src/game.ts` (~384–391)
- **Changes**: derive tiers from `COMBO_CAP`: warm 2–3, hot 4, critical at 5 (keep the
  Building/Burning/Overdrive labels). The max toast becomes `${COMBO_CAP}× COMBO!`.
- **Rationale**: with the old 8/10 thresholds the top tier could never be reached.

### Step 7: Replay version 12 → 13, backed by the old/new trace

- **Files**: `src/replay-version.ts`, `docs/replay-system.md`, `public/replays/*.json`
  (version field only), `e2e/replay.spec.ts`
- **Changes**:
  - Bump the version. Add a note: "`version: 13` scores only player-initiated kills, uses
    the ×5 combo cash-out and holds the combo for automation-stolen targets and empty flare
    blasts; earlier recordings produce different scores and are rejected."
  - Change only the fixtures' version fields, and only if the step 0 comparison shows no
    difference in waves, ticks, RNG, threats, assets or picks. Any difference means stop and
    re-record the fixture deliberately, with perf baselines recaptured per `CLAUDE.md`.
- **Rationale**: recorded summaries and verification must not mix scoring rules, and the
  trace is the evidence that a version-only fixture edit is honest.

> **Resolved — Codex [P2] fixture migration evidence:** step 0 captures an old-rules trace
> before any edit (the shared-checkout rules forbid worktrees and stashes). Step 7 diffs it
> against the new build, excluding only score, combo and toasts. It also records the
> Defect 2 sequencing condition.

### Step 8: Tests

- **Files**: `src/game-logic.test.ts` (or the existing logic test file), `src/game-sim.test.ts`
- **Unit tests:**
  - `stepCombo` table: 1→2, 2→3, 3→4, 4→5 with no bonus; hit at 5 → 1 with exactly +1,000;
    miss → 1 from every level; hold leaves every level unchanged.
  - `awardKill` for every `KillSource`: player sources add base × combo, all others add 0.
    Each call emits one audit `kill` entry and sets `killedBy`.
- **Sim tests — ownership:**
  - Patriot/Hornet/Roadrunner explosion kills add 0 kill points but increment destroyed
    stats.
  - Iron Beam and Phalanx kills add 0.
  - EMP, flare and F-15 kills add base × combo.
  - A chain explosion from a player blast scores; a chain from a Patriot blast does not.
  - An automated (Patriot) double kill changes the score by **exactly +150**, the
    multi-kill bonus with no kill points.
- **Sim tests — cash-out:**
  - Starting at ×1, five hits in a row, resolving each root before firing the next: hits
    1–4 give ×2…×5 with no bonus. **Hit five** scores its kills at ×5, adds exactly +1,000,
    resets to ×1 and sets `comboBonusToast`. A sixth hit goes to ×2.
  - Overlapping roots: two productive blasts alive at once starting at ×4. The combo
    changes only as each root is processed (×5, then a cash-out), not at the first kill.
    Kills landing before a root is processed use the multiplier current at that moment.
  - A cash-out while the "5× COMBO!" increment toast is still live leaves `comboToast` null.
    The snapshot shows the bonus popup and a ×1 HUD, without a stale ×5 toast.
  - A wave-end cash-out (forced processing) appears in the wave summary's score.
- **Sim tests — holds:**
  - An empty flare blast holds the combo.
  - An automation kill of the intended target before detonation holds the combo.
  - An automation kill during the blast's damage window holds the combo.
  - An automation kill after the damage window closed (during the fade) resets the combo.
  - An empty blast whose target the player's own other shot killed resets the combo.
  - An empty blast at empty sky resets the combo.
- **Existing tests to update:** 471/488/585 and any others that assume the ×10 cap or
  automated kill points.
- **Rationale**: every rule, source and timing edge is covered at unit and sim level.

> **Resolved — Codex [P2] off-by-one test:** the cash-out test now uses an explicit
> five-hit sequence (no bonus on hit four, +1,000 on hit five), and a separate
> overlapping-roots test checks the processing order. The summary now says "the fifth hit
> in a row from ×1".

### Step 9: Docs and roadmap

- **Files**:
  - `docs/game-state-contract.md`: explosion `source`, `killedBy`, `comboBonusToast`,
    combo rules, `addScore`.
  - `docs/ui-architecture.md` / `docs/runtime-controller.md`: the new overlay.
  - `ROADMAP.html`, via the `roadmap` skill: record the scoring decision and cite Part Six.
- **Changes**: short factual updates. `ROADMAP.html` currently has another session's
  uncommitted edits: merge onto them, don't overwrite.
- **Rationale**: the roadmap is the single source for product direction.

### Step 10: Verify

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e:quick`,
  `npx playwright test e2e/replay.spec.ts`.
- Fixture comparison: `npx tsx scripts/scoring-change/fixture-trace.ts --compare` must
  report no gameplay differences against the step 0 baseline.
- Determinism: `npx tsx src/headless/sim-runner.ts 42` (two identical runs).
- Headless score audit: new `scripts/scoring-change/verify-scoring.ts` runs several bot
  games with `setScoreAuditSink`. It asserts:
  - (a) every `kill` entry from a non-player source has amount 0;
  - (b) every `kill` entry from a player source equals base × the combo at that moment;
  - (c) every `cashout` is exactly 1,000 and follows a hit at ×5;
  - (d) the combo never exceeds 5;
  - (e) the final score equals the sum of all audit entries (kills, multi, cash-out, wave
    clear, building bonus, friendly fire, spending);
  - (f) at least one automated multi-kill entry pays its bonus, as the positive exception.
- Restart `npm run dev` if stopped, confirm the URL, and hand back for an iPhone
  feel-check: popup placement and legibility next to multi-kill, HUD tiers, and the combo
  holding when automation steals a target.

> **Resolved — Codex [P2] headless check:** this no longer compares whole-tick score deltas.
> Every score change goes through `addScore`, the audit asserts zero kill contribution from
> non-player sources, and the final score reconciles against all audited kinds. An
> automated multi-kill is the required positive exception.

## Risks & Open Questions

- **Coverage:** a kill path missed by the source mapping would silently drop player points.
  Mitigations:
  - `source` is required in the types.
  - `awardKill` and `addScore` are the only scorers (grep: no remaining `score +=` or
    `score -=` outside `addScore`).
  - There is a test per source, plus the headless audit.
- **Hold abuse:** holding on automation-stolen targets could reward firing at targets
  automation will surely kill. Holds never add points and the shot still costs ammo; accept.
- **Flares still feed the combo on hits** (they can reach or cash out ×5). Only empty flare
  blasts change. Confirm that is intended.
- **Sound:** reuse the `multiKill` sfx for the cash-out, or silent? Default: reuse.
- **Telemetry comparability:** scores and `max_combo` change meaning at this build. The
  leaderboard is build-scoped; RM-06 cross-build analysis must treat this build as a scoring
  break.
- **Bot/balance tooling** that uses score (bot training, balance reports) gets a new
  baseline; don't compare across the change.
- **Replay version:** v12 is committed but not pushed. Bumping to 13 is still the
  unambiguous choice; folding the change into v12 is possible only if both ship together.
- **Shared checkout:** another session is working on building-impact Defect 2
  (`docs/gameplay analysis Sep 2026/building-impact-defect-2-plan.md`) and has uncommitted
  `ROADMAP.html` edits. Sequence the `game-sim.ts` edits, and the step 0 baseline, around it.
- **Optional pre-check:** add the final rule set (player-only + ×5/+1000 + holds) as a
  scenario in the Part Six report to preview the score impact before implementing.

## Acceptance Criteria

- [ ] Hornet, Roadrunner, Patriot, Iron Beam, Phalanx, impact and friendly-fire kills add 0
      kill points; interceptor (including chains), F-15, EMP and flare kills add base × combo.
- [ ] Multi-kill bonuses unchanged for every source; an automated double kill adds exactly
      its bonus.
- [ ] Combo never exceeds 5; the fifth consecutive hit from ×1 adds exactly 1,000, resets to
      ×1, clears the increment toast, and shows a "COMBO BONUS +1000" popup styled like the
      multi-kill popup, without overlapping it.
- [ ] Empty flare blasts, and empty interceptor blasts whose intended target automation
      killed before the blast's damage window closed, leave the combo unchanged. Every
      other empty blast resets it, including an automation kill after the damage window.
- [ ] HUD tiers and the increment toast reach their top state at ×5.
- [ ] Old/new fixture traces match apart from score, combo and toasts. Replay version 13,
      docs note, fixture versions and e2e updated.
- [ ] Headless score audit passes (zero non-player kill points; exact reconciliation).
- [ ] Typecheck, lint, unit, quick E2E and replay E2E pass; kill stats unchanged in meaning.
- [ ] Tuning via `COMBO_CAP` and `COMBO_CASHOUT_BONUS` only.
- [ ] User feel-check on iPhone passes.

## Status

- **Created by**: Claude
- **Validated by**: Codex review 2026-09-19 — five P2 findings, all resolved in revision 2
  (inline "Resolved" notes)
- **Consensus**: pending Codex confirmation of revision 2
