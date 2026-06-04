# Run Recap Redesign — Design Spec (LOCKED: Option 9 "Last 12 + Best Wave Chip")

**Goal:** Single-screen recap, no vertical scroll. Run summary + featured wave + final 12-wave
selector + tappable best-wave chip when needed, compact, in the game's own UI language — not a
dashboard chart, not a battlefield diorama.

**Reference mockup:** `tasks/recap-option9-last12-best-chip.html` (interactive).

## Why this one

- First pass (bars/axes/stat-tiles, `recap-option1/2/3`) read as a BI spreadsheet.
- Second pass (skyline tracers, radar rings, `recap-option4/5`) read as an art installation —
  too busy, costly, hard to parse at 20+ waves.
- Option 9 sits in the middle: reuses the existing `.portrait-panel` chrome so it feels native,
  leads with the late-run story, keeps the final 12 waves directly tappable, and preserves the best
  wave as a dedicated chip when it sits outside that final stretch — no chart, no table, no diorama.

## Layout (top → bottom, fixed, no scroll)

```
┌──────────────────────────────────┐
│ RUN RECAP       Burj fell · Wave 12 │  header: kicker + outcome
│ 26,200                             │  big neon score
│ 271 kills · 63% acc · 9× · 8:42    │  one quiet inline stat line
├──────────────────────────────────┤
│ ★ BEST WAVE                        │  FEATURED CARD (defaults to best
│ Wave 7                             │  wave; doubles as the detail panel)
│ +4,200   38      9×     ♥♥         │  score · kills · combo · Burj
│  score  kills  combo   Burj        │
│ Bought: Iron Beam, Patriot         │
├──────────────────────────────────┤
│ FINAL WAVES                        │
│ ★ Best: Wave 7 · +4,200            │  tappable chip if best is outside final 12
│ [13][14][15][16][17][18]           │  6x2 pill grid, heat-dot per pill
│ [19][20][21][22][23][24]           │
├──────────────────────────────────┤
│ [ ▶ Watch Replay ] [Save] [Close]  │  one compact action row
└──────────────────────────────────┘
```

**Fill the phone height — don't hug content.** The panel takes the available portrait height
(e.g. `height: …; max-height: 94vh`) and spreads sections out with generous gaps. The featured
card `flex-grow`s to absorb spare vertical space; the action row is pinned to the bottom. This
adapts from a short phone to a tall one with no dead space and no scroll. Larger type throughout
(score ~64px, featured numerals ~26px) and 44px+ pill/button tap targets.

## Components

1. **Header** — `RUN RECAP` kicker + outcome on one line (`Burj fell · Wave 12` red /
   `Survived · Wave 12` green / `Left · Wave 12` neutral). Drops "After-action report" filler.
2. **Hero** — big score (neon glow, matches title treatment) + ONE inline stat line:
   `kills · accuracy · best combo · time`. No stat-tile grid.
3. **Featured card** — the centerpiece + the detail surface in one element.
   - On open, **defaults to the best wave** (max `scoreEarned`) → the recap opens on a high.
   - Caption changes by wave kind: `★ Best wave` / `✷ Final stand` (terminal) / `Wave detail`.
   - Body: 4 inline stats — score, kills (missile+drone), max combo, Burj HP (hearts) —
     plus a `Bought:` line. Fixed min-height so swapping waves doesn't reflow.
   - Border/wash tint by kind: gold (best) / red (terminal) / cyan (normal).
4. **Final-wave selector** — `FINAL WAVES`: a fixed 6×2 grid of the last 12 wave pills, each with a
   small heat-dot (cool→warm by score; red = terminal). If the best wave is outside those 12, show a
   tappable chip above the grid: `★ Best: Wave 7 · +4,200`. Tap a pill or chip → featured card
   morphs to that wave; selected control gets the bright outline.
5. **Actions** — `▶ Watch Replay` (primary, wide) + `Save` + `Close` in one row.

## Interaction & accessibility

- Tap/click a pill selects; featured card updates in place. No layout shift.
- Pills are focusable buttons, arrow-key navigable, `aria-label="Wave N, +score, <kind>"`.
- **Future fast-forward hook:** keep `onWatchFromWave(startTick)` + `startTick` in the data
  (wired but dormant). A "Replay from Wave N" button drops into the featured card later with no
  new plumbing. No per-wave replay button ships now.

## Removed / changed

- ❌ `renderWaveCards` fat-card scroll list + all `.wave-card*` CSS.
- ❌ Per-wave `Replay` buttons (`data-wave-replay`).
- ❌ `.run-recap__timeline` horizontal-scroll strip; `.run-recap__focus-*`, `.run-recap__hero`,
  `.run-recap__kill-bar`/legend if unused after the rewrite.
- ❌ Section titles "Best Wave" / "Wave History".
- 🔁 Stacked-wide action buttons → one compact row.

## Defaults baked in (flag if you disagree)

- Featured card always opens on **best wave**. If the best wave is outside the final 12, the best
  chip starts selected and the final-wave grid has no selected pill until the user taps one.
- Pill heat-dot encodes **score**; gold=best, red=terminal override.
- Burj HP shown as **hearts** in the featured card (matches in-game motif).
- Per-wave **accuracy is NOT shown** — `WaveSummaryRecord` has no per-wave `shotsFired`.
  (Run-level accuracy stays in the hero line.) If you want per-wave accuracy, that's a
  small data-layer add in `game-sim` wave bookkeeping.

## Touch points (build phase)

- `src/ui.ts`: rewrite `renderRunRecapHero`; replace `renderBestWave` + `renderWaveCards` with
  `renderFeaturedWave` + `renderWavePills`; add pill-select click/keyboard handling in
  `showRunRecap` (re-renders featured card only); shrink `renderRunRecapActions` to a row.
- `src/App.css`: add `.run-recap__feature`, `.run-recap__pills`, `.run-recap__pill` rules;
  delete `.wave-card*`, `.run-recap__timeline`, `.run-recap__focus-*`.
- `src/types.ts` / `src/run-recap.ts`: **no change** — `RunRecapWaveCard` already carries
  score/kills/combo/burjHealth/startTick/terminal/bought.

## Status

Design locked. Implementation plan below. Other mockups (`recap-option1..6`) kept for
reference; delete once the build lands.

---

# Implementation Plan

**Reference:** `tasks/recap-option9-last12-best-chip.html` (phone-height version).
**Net change:** all in `src/ui.ts` + `src/App.css`, plus an e2e assertion update. No changes to
the data layer (`run-recap.ts`), types, `index.html`, or `game.ts` — `RunRecapWaveCard` already
carries score/kills/combo/burjHealth/startTick/terminal/bought, and `#run-recap-panel` already
wears `.portrait-panel .portrait-panel--run-recap`.

### Correction vs mockup

- **Burj HP is 0–7** (starts at 7 in `game-sim.ts:256`, repair capped at 7 in
  `game-sim-shop.ts:191`). The mockup's three-hearts is wrong. Render Burj health as
  `♥ N` (heart glyph + number) in the featured card and pill aria-labels.

### Step 1 — `src/ui.ts` helpers (new, local)

- `getBestWaveCard(cards): RunRecapWaveCard | undefined` — max `scoreEarned`, ties → earliest.
- `waveKind(card, bestWave): "best" | "terminal" | "normal"` — **terminal wins** over best for
  coloring; the ★ marker is shown separately when `card.wave === bestWave`.
- `heatColor(score, maxScore): string` — `hsl(190 - t*150, 80%, 58%)`, t = score/maxScore.
- `formatBurjHealth(hp): string` → `♥ ${hp}`.
- Reuse existing `formatPercent`, `formatDuration`, `getPurchaseDisplayName`, `escapeHtml`.

### Step 2 — `src/ui.ts` render functions

- **Rewrite `renderRunRecapHero(data)`** → header row (`RUN RECAP` kicker + outcome text from the
  existing `outcome` mapping) · big score · one substat row: `kills · accuracy · best combo ·
time` from `totalStats` + `hitRatio` + `timePlayedMs`.
- **Delete `renderBestWave` and `renderWaveCards`.** Add:
  - `renderFeaturedWave(card, bestWave): string` — caption (`★ Best wave` / `✷ Final stand` /
    `Wave detail`), `Wave N`, 2×2 stat grid (score, kills = missile+drone, max combo,
    `formatBurjHealth`), and `Bought:` line (or "No purchases this wave"). Kind class drives tint.
  - `renderWavePills(cards, bestWave, selected): string` — one `<button data-wave-pill data-wave>`
    per card, heat-dot span, `--best`/`--terminal`/`--selected` classes,
    `aria-label="Wave N, +score, <kind>"`.
- **Rewrite `renderRunRecapActions`** → one compact row: `▶ Watch Replay` (primary, wide) +
  `Save` + `Back` (keep `data-run-recap-watch/save/close`; keep disabled-when-no-replay logic).

### Step 3 — `src/ui.ts` `showRunRecap` shell + selection

- Container markup: hero, `<div class="run-recap__feature" id="run-recap-feature">`, pills block
  (`<div id="run-recap-pills">`), actions.
- `selectedWave` defaults to `getBestWaveCard(...).wave`.
- If the best wave is outside the final 12, render the best-wave chip as selected on open and leave
  all final-wave pills unselected until the user taps a pill.
- Extend the existing click handler: keep close/watch/save branches; **drop the `[data-wave-replay]`
  branch**; add `[data-wave-pill]` → set `selectedWave`, replace only `#run-recap-feature`
  innerHTML + toggle `--selected` on pills (no full re-render, no layout shift).
- Keep `onWatchFromWave` in `RunRecapCallbacks` and `startTick` in data — **dormant**, for the
  future "Replay from Wave N" button that will live in the featured card.
- Pills are real `<button>`s → native Tab/Enter a11y; arrow-key nav is a nice-to-have.

### Step 4 — `src/App.css`

- **Add:** `.run-recap__hero/.run-recap__score/.run-recap__substats(.s)`,
  `.run-recap__feature(--best/--terminal/--normal)`, `.run-recap__pills/.run-recap__pill`
  (+ `__dot`, `--best`, `--terminal`, `--selected`), compact `.run-recap__actions` row.
- **Fill phone height:** change `.portrait-panel--run-recap` from `max-height: min(76vh,860px);
overflow-y:auto` to a flex column that fills available height (`height: min(94vh, …)` /
  flex-grow within `.game-shell__content`); `.run-recap` is `flex:1; display:flex; column`;
  `.run-recap__feature` is `flex:1 1 auto; min-height:0` so it absorbs spare space and can shrink
  on short phones; actions pinned at the bottom.
- **Delete (after grep-confirming each is unused elsewhere):** `.wave-card*`,
  `.run-recap__timeline`, `.run-recap__wave*`, `.run-recap__focus-*`, `.run-recap__kill-*`,
  `.run-recap__legend*`, `.run-recap__swatch`, `.run-recap__hero-stat*`, `.run-recap__summary`,
  `.run-recap__best-wave`, `.run-recap__details`.

### Step 5 — `e2e/smoke.spec.ts` (lines ~199–204)

The smoke run dies on **wave 1**, so there's exactly one wave that is both best and terminal.

- Remove asserts for: `wave history` heading, `.wave-card` ×1, `.wave-card--terminal` ×1,
  `replay wave 1` button, `best wave` heading, `.run-recap__best-wave`.
- Add asserts: `.run-recap__feature` visible; featured caption contains `Final stand`
  (best == terminal on a 1-wave run); `Final waves` label visible; `.run-recap__pill` count ×1;
  pill carries the terminal class; **no** per-wave replay button exists; `Back`/close button
  still returns to `#gameover-panel`.
- Keep the `#run-recap-panel .run-recap__death-canvas` count-0 assertion (we add no canvas).

### Step 6 — verify

- `npx tsc --noEmit` (types) and `npx vite build` (bundles).
- `npx vitest run src/run-recap.test.ts` — must stay green (data layer untouched).
- `npx playwright test e2e/smoke.spec.ts` — green with updated asserts.
- Manual `npm run dev`: reach game over → Run Recap. Check on desktop **and** a phone-width
  viewport: fills height, no scroll, featured card swaps on pill tap with no reflow, best/terminal
  colors read instantly, actions reachable. Restart dev server before finishing; report local URL.

### Risks

- **Height-fill across form factors** is the main risk: the panel used to scroll; now it must
  fill without overflowing a short phone. Mitigation: `feature { flex:1 1 auto; min-height:0 }`
  lets it shrink before anything clips; keep `overflow:hidden` on the panel and only fall back to
  scroll if content truly can't fit the shortest target. Verify on a small viewport.
- Many-wave runs (20+): pills wrap to extra rows (fine) and eat height — the flex-grow featured
  card yields space to them automatically. Confirm a high-wave run still fits.
