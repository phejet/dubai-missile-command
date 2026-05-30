# Per-Wave Recap Cards — Code Review

Reviewer: Claude (Opus 4.7)
Date: 2026-05-29
Scope: Working-tree diff against `.plans/per-wave-recap-cards.md`
Files reviewed:

- `src/replay-seek.ts` (new)
- `src/replay-seek.test.ts` (new)
- `src/run-recap.ts`
- `src/run-recap.test.ts`
- `src/run-recap-death-clip.ts`
- `src/types.ts`
- `src/game.ts`
- `src/ui.ts`
- `src/App.css`
- `e2e/smoke.spec.ts`
- `tasks/run-recap-preview.html`

---

## Plan compliance: high

All 10 steps from the plan landed.

| Step                                       | Status | Notes                                                                                                                             |
| ------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 — `wave_plan` markers in browser replays | ✅     | `recordWavePlanAction` at `initGame` (game.ts:737) and after `simCloseShop` (game.ts:1098); forced checkpoints at both boundaries |
| 2 — Carry wave anchors into `RunRecapData` | ✅     | Terminal start tick pulled from `wave_plan` map with `_waveStartTick` fallback (run-recap.ts:126-140)                             |
| 3 — Card data joiner                       | ✅     | `aggregateBoughtByWave` appends, doesn't overwrite (run-recap.ts:63-71)                                                           |
| 4 — UI render swap                         | ✅     | `renderWaveCards` (ui.ts:808), Burj Damage strip + Upgrade Path section removed                                                   |
| 5 — `onWatchFromWave` callback             | ✅     | Wired in `openRunRecap` (game.ts:1141)                                                                                            |
| 6 — `startReplay` fast-forward             | ✅     | Generation-token cancellation; seek-time events routed through `handleRunRecapReplayEvent` instead of `handleSimEvent`            |
| 7 — Lift seek loop into shared util        | ✅     | `seekRunnerToTick` (replay-seek.ts:42); both `startReplay` and death clip consume it                                              |
| 8 — Styles                                 | ✅     | `.wave-card*`, `.wave-card--terminal` left-border accent, `.replay-seek-overlay`                                                  |
| 9 — Tests                                  | ✅     | Unit (run-recap + replay-seek), smoke test rewritten                                                                              |
| 10 — Cleanup                               | ✅     | Old `.run-recap__burj-*` and `.run-recap__upgrade-*` CSS removed; smoke selectors updated                                         |

---

## Bugs and rough edges

### 1. Unreachable seek still flips to "playing"

**Location:** `src/game.ts:915-922`

When `result.reached === false` (runner finished before `targetTick`, e.g. seeking past the end of a partial replay), the code logs a warning but still calls `setScreen("playing")`. The render loop detects `runner.isFinished()` next frame and bounces back to gameover.

Not catastrophic — visible flicker only — but cleaner to short-circuit before `setScreen`. The death-clip path handles this correctly by simply not entering its render loop (run-recap-death-clip.ts:47).

**Fix sketch:**

```ts
if (!result.reached) {
  console.warn(`[replay] seek target ${seekToTick} was not reached; aborting`);
  runner.cleanup();
  if (this.replayRunner === runner) this.replayRunner = null;
  this.hideReplaySeekOverlay();
  return;
}
```

### 2. `extractWaveStartTicks` overwrites on collision

**Location:** `src/run-recap.ts:54-61`

```ts
for (const action of actionLog as ReplayAction[]) {
  if (action.type !== "wave_plan" || typeof action.wave !== "number") continue;
  ticks.set(action.wave, action.tick);
}
```

Last `wave_plan` for a given wave wins. Normal play emits exactly one per wave, so this is fine in practice — but plan §3 step 3 explicitly required append-not-overwrite semantics for the upgrade joiner. The same principle should apply: if `wave_plan` is ever re-emitted for a wave, we want the **first** one (the actual wave-start anchor), not the last.

**Fix sketch:**

```ts
if (!ticks.has(action.wave)) ticks.set(action.wave, action.tick);
```

### 3. Outcome label `"Ended"` is unreachable in practice

**Location:** `src/ui.ts:816-817`

```ts
const outcome = card.terminal && data.outcome === "burj_destroyed" ? "Burj Fell" : card.terminal ? "Ended" : "Survived";
```

`openRunRecap()` only runs when `screen === "gameover"`, which currently only happens when the Burj falls. So `outcome` is always `"burj_destroyed"` on a terminal card — the `"Ended"` branch is dead. Harmless, but if there's no plan to support other game-over causes, it's dead code.

### 4. `mountRunRecapDeathClip` is now misnamed

**Location:** `src/run-recap-death-clip.ts:55`, CSS class `.run-recap__death-clip--live`

Per commit `fc6cdd1`, the death clip was removed from the recap screen and the function is now used only on the gameover panel. The file, function, and CSS class still carry the `run-recap` prefix. Cosmetic; rename later if churn is acceptable.

### 5. Wave-1 replay button is identical to "Watch Replay"

A wave-1 button has `startTick=0`, which falls through `shouldSeek = seekToTick > 0 === false`, so `startReplay` runs a full replay — exactly like the top "Watch Replay" action button. On a 1-wave run (e.g. the smoke test scenario), two buttons do the same thing. The smoke test even relies on this (`Replay Wave 1` is asserted enabled).

Probably fine, but worth noting if dedup matters.

---

## What looks solid

- **Cancellation correctness.** `replaySeekGeneration` properly blocks stale seeks from clobbering newer state (game.ts:902-913). The stale runner is cleaned up, `setScreen("playing")` is skipped, and `this.replayRunner` is only nulled when it still points at the cancelled runner.
- **Pause handling during seek.** `handleRunRecapReplayEvent` flips `_bonusScreenDone = true` synchronously inside `waveBonusStart`, so the sim never actually parks on the bonus screen during seek. Shop pauses are auto-resumed via `resumeIfPaused` inside `seekRunnerToTick`. The `_bonusScreenDone` flag is correctly reset by `prepareWaveStart` for each new wave.
- **`_waveStartTick` fidelity.** `prepareWaveStart` updates it for every wave, including debug starts (debug-starts.ts:262). Recorded `wave_plan` ticks match `_waveStartTick` exactly.
- **Test coverage matches plan §9.** Wave-card aggregation, terminal `startTick`, mid-seek cancellation, and unreachable-target cases all asserted. Smoke test verifies one card per wave, terminal class, and the `Replay Wave 1` button.
- **Data builder shape.** `RunRecapWaveCard` carries enough fields (`missileKills`, `droneKills`, `multiShots`, `maxCombo`, `buildingsSurviving`, `burjHealth`, `endTick`) for the "Best Wave" rendering without a second data path.

---

## Recommendation

Merge after addressing #1 and #2 — both one-line fixes. #3-#5 are paper cuts; defer.

No blocking bugs. The seek flow, cancellation, and data join are all correct. Plan compliance is the highest I've seen on a Codex hand-off recently.
