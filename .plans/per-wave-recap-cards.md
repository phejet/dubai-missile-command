# Per-Wave Recap Cards

Status: design plan, not yet committed to implementation
Date captured: 2026-05-29
Last revised: 2026-05-29 (after Codex review pass)
Owner: Alex

---

## 0. Goal

Replace the current two-block recap layout (separate **Burj Damage** strip

- **Upgrade Path** timeline) with a single vertical list of **wave
  cards**, one card per wave the player reached. Each card consolidates
  that wave's outcome into one glanceable row and adds a per-wave replay
  shortcut.

Why now:

- After the Burj one-shot commit (`297a22a`), the per-wave Burj-health
  bar is binary (full or zero on the terminal wave) — the standalone
  strip carries almost no information.
- The upgrade-per-wave list lives in a separate section; players have to
  cross-reference "I bought Patriot in W4" against "Burj fell in W6"
  manually.
- Players regularly want to re-watch _a specific decision point_, not
  the whole run from W1.

A single wave-card list pays for itself in vertical space (we drop one
section) and adds a feature (jump-to-wave replay) we didn't have.

---

## 1. UX

### Card structure (one per wave)

```
┌──────────────────────────────────────────────────────────────────┐
│ Wave 3            +4,820 score        Survived ✓     [▶ Replay]  │
│ Bought: Patriot · Roadrunner                                     │
└──────────────────────────────────────────────────────────────────┘
```

Slots:

- **Wave N** — left anchor.
- **Score earned this wave** — large secondary number, formatted with
  commas, prefixed with `+`. Comes straight from
  `WaveSummaryRecord.scoreEarned` (or the synthesized terminal-wave
  delta — see §2).
- **Outcome badge** — `Survived ✓` (neutral teal) or `Burj Fell 💥`
  (red, terminal wave only). Replaces the colored Burj-health bar.
- **▶ Replay** button — right anchor. Disabled if `!data.hasReplay` or
  if the card has no seek anchor (defensive — should not happen once
  step 1 lands wave-start markers).
- **Bought:** second row, comma-separated upgrade display names. Hidden
  when no upgrades were bought that wave (keeps single-row cards tight).

Terminal wave (the one the run ended on) gets a subtle red left-border
accent so it reads as "the end" without needing an extra label.

### Section placement in `showRunRecap`

```
[Hero strip — score / wave / hit% / time]
[Best Wave card]               ← keep
[Wave history (this is new)]   ← replaces Burj Damage + Upgrade Path
[Actions: Watch Replay (full) / Save Replay / Back]
```

The full-run replay button at the top of the actions still does
"from tick 0". Per-wave replays come from each card's button.

### iPhone considerations

- Card body: 2 rows max. With padding it's ~64px per card.
- 8 waves visible at ~64px = ~512px → fits in the existing scrollable
  recap panel without issue (panel already has `max-height: min(76vh,
860px); overflow-y: auto`).
- Replay button is a tap target — min 44×44, right-aligned, never
  collides with the score number even on iPhone SE width.

---

## 2. Data — what's there and what's missing

`WaveSummaryRecord` (in `src/types.ts:532`) carries everything we need
_for waves that completed_:

- `wave`, `scoreEarned`, `burjHealth` (post-wave), `startTick`,
  `endTick`, plus per-wave kill stats.

**The terminal wave is the gap.** `recordWaveSummary()`
(`src/game-sim.ts:507`) only fires when `g.burjAlive` is still true —
i.e. only when a wave was _survived_. A Burj-death run pushes nothing
for the wave it died on. The recap UI papers over this in
`buildWaveStory()` (`src/ui.ts:791`) by synthesizing a terminal entry
from `data.score - completedScore`, but that synthetic entry has no
`startTick` — so a per-wave replay button on the terminal card would
have no seek anchor.

### The fix: wave-start markers in browser replays

The headless sim-runner already emits `wave_plan` actions at run start
and after `closeShop` (`src/headless/sim-runner.ts:64-72, 111-119`).
The browser recording path (`src/game.ts`) does **not** — that's the
discrepancy.

Step 1 of the implementation closes this gap. Once `wave_plan` markers
exist in browser replays, the recap data builder gets a deterministic
"wave N started at tick T" map for every wave the player saw, terminal
or not.

### Sanity checks before coding

- [x] `WaveSummaryRecord.scoreEarned` is populated only for survived
      waves; terminal wave is synthesized — confirmed above.
- [x] `_waveStartTick` is initialized to 0 and reset per wave —
      confirmed at `src/game-sim.ts:491`.
- [ ] Multiple shop visits on the same wave: nominally impossible
      (shop opens once per wave), but our `data.upgrades` joiner must
      accumulate into a `UpgradeKey[]` and not overwrite on collision.
      See §3 step 3.
- [ ] Score awarded _after_ the Burj falls but before the run ends
      (final kill chain, multi-shot bonus): does it tally against the
      terminal wave, or get dropped? Search `gameOverTimer` for any
      score writes downstream — this is a real edge case the synthetic
      delta will absorb either way, but it's worth knowing.

---

## 3. Implementation steps

### Step 1 — Wave-start markers in browser replays

Mirror the headless behavior in `src/game.ts`:

1. At run start (`startGame`, around `maybeRecordReplayCheckpoint(...,
"start")` at `src/game.ts:722`), push a `wave_plan` action for
   wave 1 with the same shape the headless emits.
2. Immediately after `simCloseShop(game)` in
   `src/game.ts:1026`, once `game.wave` has advanced and
   `_waveStartTick` has been reset for the new wave, push another
   `wave_plan` action.
3. Force a replay checkpoint at the same boundary:
   ```ts
   maybeRecordReplayCheckpoint(game, {
     force: true,
     reason: `waveStart:${game.wave}`,
   });
   ```

**Do not** snapshot the full `GameState` into the action. The action
is indexing metadata only; the seeded RNG + replay log already
restore state deterministically. Snapshots are a separate, larger
feature (a "true instant restore" path) and out of scope here.

Benefits beyond this plan:

- Replay audits can compare checkpoint hashes at wave boundaries and
  report the first divergent wave instead of only learning at game
  over.
- Seek verification can assert the runner is in the expected wave
  before visible playback starts (§3 step 5).

### Step 2 — Carry wave anchors into `RunRecapData`

Extend the recap data builder (`src/run-recap.ts`) to attach a
`startTick` to every wave card the UI will render, terminal included:

- For survived waves, use `WaveSummaryRecord.startTick` as today.
- For the synthetic terminal wave, pull the start tick from the most
  recent `wave_plan` action in the replay log (or from
  `game._waveStartTick` if no replay was recorded — defensive fallback
  for non-replay runs, which should be rare since recording is
  default-on).

Either expose `startTick` directly on the existing synthesized entry
that `buildWaveStory()` produces, or move the synthesis logic into the
recap data builder so the UI consumes a uniform shape. Latter is
cleaner; do that.

### Step 3 — Card data joiner

In `src/ui.ts` (or wherever `buildWaveStory` ends up):

```ts
const upgradesByWave = new Map<number, UpgradeKey[]>();
for (const entry of data.upgrades) {
  const list = upgradesByWave.get(entry.wave) ?? [];
  list.push(...entry.bought);
  upgradesByWave.set(entry.wave, list);
}

const cards = waveStory.map((w) => ({
  wave: w.wave,
  scoreEarned: w.scoreEarned,
  bought: upgradesByWave.get(w.wave) ?? [],
  terminal: w.terminal,
  startTick: w.startTick, // populated in step 2
}));
```

Append, do not overwrite — same wave could in principle carry multiple
shop entries (e.g. future debug or refund flows) and we want all of
them surfaced.

### Step 4 — UI render swap

In `src/ui.ts`:

1. Delete `renderBurjDamageTrack()`.
2. Replace `renderUpgradeTimeline()` with `renderWaveCards(data)` that
   joins the data per §3 and emits one `<article class="wave-card">`
   per card.
3. Update the panel HTML in `showRunRecap()`:
   - Drop the **Burj Damage** section.
   - Replace **Upgrade Path** with **Wave History** that calls
     `renderWaveCards`.
4. Add a click handler for `[data-wave-replay][data-start-tick]`
   that invokes the new callback (§5).

### Step 5 — Wire the per-wave replay button

Add a new optional callback to `RunRecapCallbacks`:

```ts
onWatchFromWave?: (startTick: number) => void;
```

In `game.ts`'s `openRunRecap()`:

```ts
onWatchFromWave: (startTick) => {
  if (!this.lastReplay) return;
  this.runRecapOpen = false;
  this.stopDeathClip();
  uiHideRunRecap();
  this.battlefieldCard.hidden = false;
  void this.startReplay(this.lastReplay, { seekToTick: startTick });
},
```

### Step 6 — `startReplay` learns to fast-forward

Change `startReplay(replayData: ReplayData, opts?: { seekToTick?:
number })` in `src/game.ts:817`.

The seek logic mirrors `createRunnerAtTick()` in
`src/run-recap-death-clip.ts`, but with three important guards:

1. **Sim events during seek must not hit the real UI.** Do not route
   sim events through `this.handleSimEvent` while seeking — that
   would open the bonus screen, play SFX, perturb human-replay bonus
   scoring, etc. Use the same event-handling shape the death clip
   uses (`handleRunRecapReplayEvent`): swallow UI events, auto-resume
   shop/bonus pauses, leave score side-effects to the sim. Switch to
   `handleSimEvent` only after seek completes and the visible loop
   starts.
2. **Cancellation ownership.** Carry a generation token or
   `AbortSignal` so that:
   - A stale seek that gets superseded (user starts another replay,
     closes the recap, navigates away) **must not** call
     `setScreen("playing")` afterward.
   - Mirror the death-clip's `++generation` pattern; cleanest fit
     given the existing style.
3. **Visible seek progress.** Render a `<div
class="replay-seek-overlay">Seeking to Wave N…</div>` over the
   canvas while seeking. Update copy with `tick / targetTick`
   progress (or wave-number once we can derive it from the markers).
   Yield every ~7ms (same `SEEK_FRAME_BUDGET_MS` pattern) to keep
   the main thread responsive.

If `seekToTick` is missing or `<= 0`, behave identically to today.

### Step 7 — Lift the seek loop into a shared util

`createRunnerAtTick` currently lives in `run-recap-death-clip.ts` and
is tied to its `onRunner` / `onProgress` callbacks. Lift the core
loop into `src/replay-seek.ts`:

```ts
export interface SeekResult {
  reached: boolean; // false if runner finished before targetTick
  finalTick: number; // where we actually ended up
}

export async function seekRunnerToTick(
  runner: ReplayRunner,
  targetTick: number,
  signal: { cancelled: boolean },
  onProgress?: (tick: number) => void,
): Promise<SeekResult>;
```

Requirements:

- Owns the pause/resume semantics currently hidden in
  `resumeIfPaused()` — caller doesn't think about bonus/shop.
- Returns `{ reached: false, finalTick }` if the runner finishes
  before hitting `targetTick`, instead of silently completing a
  partial seek. Caller decides what to do (start from `finalTick`,
  show an error, etc.). No silent partial seeks.
- Respects `signal.cancelled` checked between batches; returns early
  without throwing.
- Yields per-frame with the same `SEEK_MAX_STEPS_PER_FRAME` and
  `SEEK_FRAME_BUDGET_MS` budget the death clip uses today.

Both `run-recap-death-clip.ts` and the new `startReplay` seek path
consume it. Smaller diff, one place to fix bugs.

### Step 8 — Styles

New rules in `src/App.css`, near the other `.run-recap__*` styles:

```css
.wave-card {
  /* row layout, 12px padding, 14px radius, 1px border */
}
.wave-card--terminal {
  border-left: 3px solid rgba(255, 96, 96, 0.6);
}
.wave-card__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.wave-card__score {
  color: #effcff;
  font-weight: 700;
}
.wave-card__outcome {
  /* pill, neutral or danger */
}
.wave-card__bought {
  font-size: 12px;
  color: #a9c2d0;
}
.wave-card__replay {
  /* small ▶ icon button, min-tap 44×44 */
}
.replay-seek-overlay {
  /* dim, centered, dismiss-blocked */
}
```

Reuse `.run-recap__upgrade-chip` for the bought list if it still
looks good; otherwise fold its visual into the inline list.

### Step 9 — Tests

- **Unit** (`src/run-recap.test.ts`):
  - Feed a synthetic `GameState` with three waves (W1 survived +1200,
    W2 survived +800, W3 burj fell +0) and assert the cards-builder
    helper produces three entries with the right `terminal` flag,
    score, and bought list — including bought list aggregation when
    two purchase entries share a wave.
  - Assert the terminal card has a defined `startTick` once step 2
    is in place.

- **Unit** (`src/replay-seek.test.ts`, new):
  - `seekRunnerToTick` reaches the target across bonus and shop
    pauses without mutating the consumer's event stream.
  - Cancellation: setting `signal.cancelled = true` between batches
    aborts and the promise resolves with the last tick reached.
  - Unreachable tick: when target > replay finalTick, returns
    `{ reached: false }`.

- **Smoke** (`e2e/smoke.spec.ts`):
  - After opening Run Recap, assert one `.wave-card` per wave, the
    terminal one has `.wave-card--terminal`, the `▶ Replay` button
    on W1 exists and is enabled (when `hasReplay`).
  - Click the W2 replay button on a multi-wave saved run and poll
    `window.__gameRef.current.wave` until it equals 2 (or wait for
    the seek overlay to clear). This is the canary that proves the
    end-to-end wiring works in a real browser.

- **Manual**: open Run Recap on a saved replay → tap "Replay W4" →
  confirm the canvas shows the right game state for wave 4 (Burj
  intact, fresh threats spawning at the wave-4 plan).

### Step 10 — Cleanup

Remove only after preceding steps land and a grep confirms no
remaining references:

- `.run-recap__burj-track`, `.run-recap__burj-wave` (and
  `--terminal` variant if present)
- `.run-recap__upgrade-list`, `.run-recap__upgrade-entry`,
  `.run-recap__upgrade-wave`, `.run-recap__upgrade-chips`

Update the smoke test selectors that targeted the deleted sections
(`.run-recap__burj-wave` count, the `/burj damage/i` heading).

---

## 4. Risks and unknowns

1. **Seek perf.** Late-wave replays might mean seeking through
   10,000+ ticks. The death-clip already does up to 240 steps per
   animation frame; a wave-9 seek at that rate could take ~2 seconds
   of wall time before the visible replay starts. Acceptable, but
   the overlay copy should be honest ("Seeking to Wave 4…") and
   show progress.
2. **Wave-start tick fidelity.** If the sim ever re-numbers waves
   mid-run (it shouldn't, but…), `startTick` could point at the
   wrong moment. Unit test: assert `startTick[N+1] > startTick[N]`
   for all consecutive waves in a recorded replay.
3. **Score-earned for the terminal wave.** Whatever points are
   awarded _as the Burj falls_ (final kill chain, multi-shot bonus)
   need to count toward the terminal wave's `scoreEarned`. The
   synthetic delta absorbs them, but verify nothing is awarded
   _after_ `gameOverTimer` is set and dropped.
4. **Replay determinism after seek.** `createReplayRunner` is
   deterministic when seeded; the death clip relies on this and it
   works. Same guarantee should hold for the new flow.
5. **Cancellation correctness.** Easiest place for this plan to
   regress is a stale seek racing a new one. Step 6 + step 7's
   `signal` parameter exist specifically to prevent it; test
   coverage in step 9 makes the bug regression-resistant.
6. **Wave count blow-up.** A wave-22 run produces 22 cards. With
   ~64px each that's ~1400px — still inside the recap panel's
   scroll container, but worth eyeballing on iPhone SE.

---

## 5. Out of scope (explicitly)

- No per-wave stat _breakdowns_ (kills by type, hit ratio per wave,
  etc). The card stays at four slots. Deeper telemetry → follow-up
  with a tap-to-expand drill-down.
- No animation between cards. Static list, scrolls in the panel.
- No "share this wave" deep-link. Maybe later.
- No full `GameState` snapshot in `wave_plan` actions. Snapshots are
  a separate feature (true instant restore) that we can pursue if
  late-wave seek time becomes the bottleneck after Step 1 lands.
- Bot/training UI is untouched.

---

## 6. Done definition

- Browser-recorded replays carry `wave_plan` markers + force-checkpoint
  at every wave boundary, matching the headless sim-runner.
- `RunRecapData` exposes a `startTick` for every wave the UI shows,
  including the terminal one.
- Run Recap screen shows one card per wave, in order, on both desktop
  and iPhone portrait.
- Each card shows wave number, score earned, outcome badge, upgrades
  bought (if any).
- The terminal wave is visually distinct.
- Tapping `▶ Replay` on any card starts the saved replay seeked to
  that wave's `startTick`, with a visible seeking overlay and proper
  cancellation if the user navigates away mid-seek.
- Burj Damage strip and standalone Upgrade Path section are gone.
- Unit + smoke + replay-seek tests are green.
- Tested on the iPhone via `npm run ios:deploy` end-to-end.
