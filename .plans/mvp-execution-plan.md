# MVP Execution Plan — Run Recap (Phase 1)

Companion to `.plans/run-recap-playtest-platform.md`. The brain dump
captures _why_ and _what_; this document captures _how_. Read in order.

Status: ready to execute. No backend, no upload pipeline, no
leaderboard. Pure local UI + iOS share + PWA hedge.

Last updated: 2026-05-24

---

## 0. Goal & scope

Ship a Run Recap surface that replaces the bloated Game Over screen,
plus a way to save replays off-device and a PWA manifest to lay
groundwork for later phases. **No backend code.** No uploads. No
short links. No leaderboard UI. No telemetry.

Hypothesis being tested: **do players engage with their own replays?**
If yes → Phase 2 (backend) is justified. If no → don't build it.

### What ships

1. Game Over panel reduced to **Score · Wave · Hit Ratio** + action
   buttons.
2. New **Run Recap** surface (opens via former "Upgrade Graph" button)
   containing hero summary, stacked-bar kill viz, wave-by-wave
   timeline, upgrade purchase timeline, inline "Watch how you died"
   slow-mo, detailed stats accordion, and actions row.
3. **Save Replay** via iOS share sheet (Capacitor Share plugin) with
   web download fallback.
4. **PWA manifest + icons** (no service worker yet — that's a Phase 3
   concern).

### What does NOT ship in MVP (explicit out-of-scope)

- Cloudflare Worker / R2 / D1 / any backend
- "Share my run" short-link flow
- Auto-stream toggle / opt-in plumbing
- Leaderboard surface (schema lives in brain dump; UI is deferred)
- Daily Challenge / ghost runs
- AI inspection, anomaly detection
- OG / unfurl preview cards
- Game Center integration
- Apple Privacy Manifest (`PrivacyInfo.xcprivacy`) — only required
  when collecting data; MVP collects nothing
- App Privacy questionnaire updates — same reason

---

## 1. Inventory — what's already in the codebase

Verified before writing this plan. Cross-reference these so we don't
duplicate work.

### Stats & state we can use as-is

- `GameStats` in `src/types.ts:523-530`:
  `missileKills`, `droneKills`, `shotsFired`, `destroyedByType`,
  `multiShots`, `maxCombo`.
- `DESTROYED_TYPE_KEYS` enum in `src/types.ts:510-518` + labels in
  `src/ui.ts:241-250` (8 categories).
- `GameState.stats`, `.score`, `.wave`, `.burjHealth`, `.launcherHP`
  in `src/types.ts` — everything needed for hero summary + outcome
  cause.
- Per-wave delta tracking already in sim: `_waveStartMissileKills`,
  `_waveStartDroneKills`, `_waveStartDestroyedByType`,
  `_waveStartMultiShots`, `_waveMaxCombo` (see `src/game-sim.ts:479-
483`, used at `src/game-sim.ts:3025-3036` to build the wave-end
  bonus summary). **Note: today these only describe the _current_
  wave. To get per-wave history for the timeline we need to persist
  each wave's summary into a new array — see §3 Step 1.**
- Shop purchases are logged into `_actionLog` per
  `src/game.ts:972`: `{ tick, type: "shop", bought: [...] }`. Same
  log captures `flare`, `f15`, `emp`, `fire`, `cursor`, `wave_plan`
  actions. Filterable.

### Replay availability

- `this.lastReplay` is populated on game completion in
  `src/game.ts:885-893` (seed from `_gameSeed`, actions from
  `_actionLog`, plus version/wave/score).
- Exposed globally as `window.__lastReplay`
  (`src/game.ts:499`).
- `ReplayData` type at `src/types.ts:763-778`.
- Replay runner factory at `src/replay.ts:25` (`createReplayRunner`)
  is the existing playback engine — we'll reuse it for the inline
  "Watch how you died" widget.
- `window.__loadReplay()` and the on-canvas drop-loader are already
  wired (`src/game.ts:498`), so a saved-then-reloaded replay will
  just work.

### UI surfaces we'll modify

- `showGameOver(score, wave, stats)` in `src/ui.ts:712-727` —
  populates the existing `#gameover-panel`.
- `#gameover-panel` markup in `index.html:179-240`. Buttons:
  `title-menu-button`, `progression-button` (currently → Upgrade
  Graph), `retry-button`, `replay-button`.
- `showUpgradeProgression()` in `src/ui.ts:752` and `#progression-
panel` — stays put; we just stop using it as the post-death
  default. It remains reachable from Title Menu via
  `title-progression-button` (`src/game.ts:415`).
- Existing reusable `portrait-panel` pattern — Run Recap will adopt
  it (see `bonus-screen`, `gameover-panel`, `progression-panel` for
  precedent).

### iOS / Capacitor

- Capacitor 8 is configured (`@capacitor/app`, `@capacitor/core`,
  `@capacitor/cli`, `@capacitor/ios` in `package.json:32-39`).
- Build scripts already work (`npm run ios:deploy`,
  `npm run ios:install`).
- **No Share plugin installed yet.** Needs `@capacitor/share` +
  `npm run cap:sync` to land.
- **No Filesystem plugin.** We'll need this too to stage the replay
  JSON to a temp file before invoking the share sheet.

### PWA

- No `manifest.json` anywhere in `public/`.
- No service worker.
- Existing icon: `public/favicon.svg` (good for desktop tabs, not
  for home-screen install — need raster PNGs).

---

## 2. What we need to add or change

### New runtime data

1. **`g._waveSummaries: WaveSummaryRecord[]`** — push one record per
   wave when it completes. Schema:
   ```ts
   interface WaveSummaryRecord {
     wave: number;
     scoreEarned: number; // delta from wave start
     missileKills: number;
     droneKills: number;
     destroyedByType: DestroyedByTypeStats;
     multiShots: number;
     maxCombo: number;
     buildingsSurviving: number; // for the timeline visual
     startTick: number;
     endTick: number;
   }
   ```
2. **Outcome cause derivation** — pure function over end-of-game
   state. Returns `"burj_destroyed"` | `"all_launchers_down"` |
   `"survived"` | `"abandoned"` (abandoned is unreachable in MVP
   but reserved for Phase 4).

### New types / interfaces

3. **`RunRecapData`** consumed by `showRunRecap()`:
   ```ts
   interface RunRecapData {
     score: number;
     wave: number;
     timePlayedMs: number;
     hitRatio: number; // 0..1
     outcome: "burj_destroyed" | "all_launchers_down" | "survived";
     totalStats: GameStats;
     waves: WaveSummaryRecord[];
     upgrades: UpgradeTimelineEntry[];
     hasReplay: boolean;
     replayId?: string;
   }
   interface UpgradeTimelineEntry {
     tick: number;
     wave: number;
     bought: string[];
   }
   ```

### New UI

4. `#run-recap-panel` markup in `index.html`.
5. `showRunRecap(data, callbacks)` in `src/ui.ts`.
6. Stacked-bar kill viz subcomponent.
7. Wave-by-wave timeline subcomponent.
8. Upgrade timeline subcomponent.
9. Watch-how-you-died inline player.
10. Detailed-stats accordion (reuses existing
    `renderDestroyedTypeRows`).
11. CSS for all the above.

### New plumbing

12. `buildRunRecapData(game, lastReplay): RunRecapData` — pure
    factory consumed by `Game.setScreen("gameover")` flow.
13. `saveReplayToFile(replay, opts): Promise<{ok: true} | {ok:
false, error}>` — Capacitor Share on iOS, anchor-download on
    web.
14. Game Over button wiring: repoint `progression-button` to open
    Run Recap instead of Upgrade Graph (the Upgrade Graph link stays
    on the Title screen via `title-progression-button`).

### Infra

15. Install `@capacitor/share` + `@capacitor/filesystem`.
16. `npm run cap:sync` so the iOS shell picks them up.
17. Create `public/manifest.json` + icon PNGs (192, 512) +
    `<link rel="manifest">` in `index.html`.

---

## 3. Execution order (step-by-step)

Each step ships in isolation. Don't combine; sequential PR-sized
units make review and rollback easy.

### Step 1 — Sim: persist per-wave summaries

**Files**: `src/game-sim.ts`, `src/types.ts`, `src/game-sim.test.ts`

1. Add `_waveSummaries: WaveSummaryRecord[]` to `GameState` in
   `src/types.ts` (initialize to `[]` in the same place
   `_waveStartMissileKills` etc. are initialized).
2. In `src/game-sim.ts` around line 3025 — the wave-complete branch
   that currently computes the bonus delta — push a
   `WaveSummaryRecord` onto `_waveSummaries` _before_ resetting the
   wave-start snapshot fields.
3. `buildingsSurviving` derivation: count alive defense sites +
   alive launchers + (burj alive ? 1 : 0) at wave end.
4. `startTick` / `endTick`: track wave start in a new
   `_waveStartTick` field (set when wave begins, captured at end).
5. **Test**: extend `src/game-sim.test.ts` to assert that
   `g._waveSummaries.length === g.wave - 1` after each wave
   completes (or `=== g.wave` if including the in-progress wave —
   pick one and document).

**Acceptance**: existing tests pass. New test asserts wave
summaries are correctly accumulated across a multi-wave game.

**Why first**: every later step depends on this data being there.
Sim changes are also the riskiest — get them in and validated before
touching UI.

---

### Step 2 — Run Recap data factory (no UI yet)

**Files**: `src/run-recap.ts` (new), `src/run-recap.test.ts` (new),
`src/types.ts`

1. Add `RunRecapData`, `UpgradeTimelineEntry`,
   `WaveSummaryRecord`, `OutcomeCause` types to `src/types.ts`.
2. New module `src/run-recap.ts`:
   - `buildRunRecapData(game: GameState, replay: ReplayData |
null): RunRecapData`
   - `deriveOutcomeCause(game): OutcomeCause` — pure
   - `extractUpgradeTimeline(actionLog, waveSummaries):
UpgradeTimelineEntry[]` — filters shop actions and pairs each
     with the wave it belongs to (via tick → wave mapping)
3. Unit tests covering:
   - Outcome cause for each branch (burj dead vs all launchers dead
     vs survived)
   - Upgrade timeline correctly assigns purchases to waves
   - `hitRatio` correctly computed (handle 0 shots edge case)
   - `timePlayedMs` from `_replayTick` × tick rate

**Acceptance**: pure unit tests pass. No game integration yet.

---

### Step 3 — Reduce the Game Over panel

**Files**: `index.html`, `src/ui.ts`, `src/game.ts`

1. **`index.html#gameover-panel`** (currently lines 179-240):
   - Keep the three hero cards: Score, Wave, Hit Ratio.
   - **Remove** the four detail cards (Total Kills, Shots Fired,
     Multi Shots, plus the rendered "Destroyed by Type" rows).
   - Keep all four action buttons but rename the
     `id="progression-button"` label from "Upgrade Graph" to
     **"Run Recap"**. (We're not renaming the id — too much churn.
     Just the label.)
2. **`src/ui.ts:showGameOver()`** (line 712):
   - Strip the `go-shots`, `go-multi-shots`, `go-destroyed-types`
     writes (those elements are gone now).
   - Keep `go-score`, `go-wave`, `go-kills` (wait — we're keeping
     **Hit Ratio** not Total Kills). Rename `go-kills` ↔ swap to
     showing hit ratio in the new third card. Or: rename the
     element id to `go-hit-ratio` and update both HTML + JS.
     (Recommend renaming for clarity.)
3. **`src/game.ts:419-422`** — the `progression-button` click
   currently opens the Upgrade Graph. Re-wire it to open the new
   Run Recap panel (which doesn't exist yet — at this commit it can
   stub-call a `console.log` or open the existing progression to
   avoid breaking; the real wiring happens in Step 5).
4. Verify Title Menu still shows Upgrade Graph via
   `title-progression-button` (which is a separate element at
   `index.html:146`). Should be untouched.

**Acceptance**: Game Over panel renders only 3 hero stats + 4
buttons. Tapping "Run Recap" stubs out to console (or temporarily
reopens the old Upgrade Graph). Existing Playwright smoke
(`e2e/smoke.spec.ts`) still passes after updating selectors for the
removed elements.

---

### Step 4 — Run Recap panel HTML + base CSS

**Files**: `index.html`, `src/styles.css` (or wherever portrait
panel styles live — search for `.portrait-panel`).

1. Add `#run-recap-panel` section, mirroring the existing
   `portrait-panel--gameover` and `portrait-panel--progression`
   patterns. Use `portrait-panel portrait-panel--run-recap` classes.
2. Static sub-panel containers (filled by JS in Step 5):
   - `.run-recap__hero` (Score, Wave, Hit Ratio, Time, Outcome)
   - `.run-recap__kill-bar` (stacked bar viz)
   - `.run-recap__timeline` (wave timeline)
   - `.run-recap__upgrades` (upgrade purchase list/timeline)
   - `.run-recap__death-clip` (canvas for slow-mo)
   - `.run-recap__details` (collapsible accordion)
   - `.run-recap__actions` (Save Replay, Watch Replay, Back)
3. CSS only for layout + visual baselines. Don't over-design;
   we'll iterate after first playthrough.

**Acceptance**: panel renders empty placeholders when shown with
`hidden = false`. No interaction yet.

---

### Step 5 — Run Recap renderer (without "watch how you died" widget)

**Files**: `src/ui.ts`, `src/game.ts`

1. New exported `showRunRecap(data: RunRecapData, callbacks:
{ onClose, onSaveReplay, onWatchFullReplay }): void` in
   `src/ui.ts`. Mirrors the structure of `showUpgradeProgression`.
2. Subcomponent rendering functions (kept private to the module
   unless we discover reuse):
   - `renderRunRecapHero(data)` — five-stat band, formatted.
   - `renderKillStackedBar(data.totalStats.destroyedByType)` — see
     Step 6 for details; for now stub it as an empty div.
   - `renderWaveTimeline(data.waves)` — horizontal bars,
     one per wave, height proportional to score earned, segments
     within each bar showing kill mix. Click → expands a row with
     per-wave details below.
   - `renderUpgradeTimeline(data.upgrades)` — chip per purchase
     with wave label. (Could later evolve into a tree view.)
   - `renderRunRecapDetails(data)` — accordion containing the
     legacy destroyed-by-type rows + multi-shots + max-combo +
     shots-fired.
   - `renderRunRecapActions(data, callbacks)` — buttons:
     **Watch Replay** (calls existing replay loader on
     `__lastReplay`), **Save Replay** (Step 7), **Back to results**.
3. Wire it up in `src/game.ts`:
   - On game-over screen entry, build `runRecapData =
buildRunRecapData(game, this.lastReplay)`.
   - Repoint the `progression-button` click handler to call
     `showRunRecap(runRecapData, {...})`.
   - Hook `onClose` to hide the recap and bring the gameover panel
     back into view (existing pattern from `showUpgradeProgression`).
4. Update Playwright smoke: add a step that taps "Run Recap" and
   asserts the panel becomes visible.

**Acceptance**: panel shows hero band + wave list + upgrade chips +
details accordion + buttons. Looks raw but functional. "Save
Replay" can still be a no-op at this step; "Watch Replay" just
fires the existing full-replay loader.

---

### Step 6 — Stacked-bar kill distribution viz

**Files**: `src/ui.ts` (or pull into `src/run-recap-viz.ts` if it
gets fat), `src/styles.css`, optional test in
`src/run-recap.test.ts`.

1. Implement as a single horizontal flex row. Each segment is a
   `<div>` with `flex-grow` equal to the kill count, a category
   color from `COL` constants (`src/game-logic`), and a `data-
count`/`data-label` for tap-to-reveal.
2. If total kills = 0, render an explicit "No kills" state — don't
   show an empty bar.
3. Below the bar: a legend row with color swatches + counts (or
   put counts in a tooltip / popover on tap; pick whichever feels
   less cluttered after seeing it live).
4. Match the existing 8 colors used elsewhere (check
   `art-render.ts` for threat type colors so the recap reads
   consistently with the gameplay sprites).
5. Unit test: given a stats object, the renderer outputs N
   segments where N = number of non-zero categories.

**Acceptance**: viz renders correctly for runs with 1, 4, 8
categories. Looks better than the 8-row list at the same data
density. Reads at-a-glance.

---

### Step 7 — Save Replay via iOS share sheet (and web fallback)

**Files**: `package.json` (deps), `src/save-replay.ts` (new),
`src/ui.ts` (wire callback), `ios/` (auto-updated by cap:sync).

1. `npm install @capacitor/share @capacitor/filesystem`
2. `npm run cap:sync`
3. New module `src/save-replay.ts`:

   ```ts
   import { Capacitor } from "@capacitor/core";
   import { Share } from "@capacitor/share";
   import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
   import type { ReplayData } from "./types";

   export async function saveReplayToFile(replay: ReplayData): Promise<void> {
     const json = JSON.stringify(replay);
     const filename = `dmc-replay-${Date.now()}.json`;
     if (Capacitor.isNativePlatform()) {
       const written = await Filesystem.writeFile({
         path: filename,
         data: json,
         directory: Directory.Cache,
         encoding: Encoding.UTF8,
       });
       await Share.share({
         title: "Dubai Missile Command replay",
         text: `Wave ${replay.wave ?? "?"} · Score ${replay.score?.toLocaleString() ?? "?"}`,
         url: written.uri,
         dialogTitle: "Share replay",
       });
       return;
     }
     // Web fallback: trigger anchor download.
     const blob = new Blob([json], { type: "application/json" });
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a");
     a.href = url;
     a.download = filename;
     a.click();
     URL.revokeObjectURL(url);
   }
   ```

4. Wire `onSaveReplay` callback in the recap to this function.
   Disable the button if `data.hasReplay === false`.
5. iOS smoke test:
   - `npm run ios:deploy`
   - Play to game over, open Run Recap, tap Save Replay
   - Share sheet appears; pick "Save to Files" → confirms file
     lands in iCloud Drive
   - Drop that file back onto the canvas in the web build → replay
     plays
6. Web smoke test: in Playwright, mock the click and assert a
   download is triggered (or just assert the blob URL machinery
   was called).

**Acceptance**: replay file saved on iOS, replay file downloads on
web, replay file plays back when re-loaded.

**Plugin install gotcha**: after `cap:sync`, you may need to open
Xcode once and let it resolve the new pods (`pod install` runs
automatically as part of `cap:sync` for iOS 8 but verify).

---

### Step 8 — "Watch how you died" inline slow-mo

**Files**: `src/run-recap-death-clip.ts` (new), `src/ui.ts`,
`src/game-render.ts` (read-only access to render code; we'll
reuse the existing renderer against a separate canvas).

This is the trickiest step. The approach:

1. The deterministic sim means we can re-derive any state from
   `(seed, actions, tickRange)`. The replay runner already does
   this.
2. Pick a clip window: last **5 seconds before death** =
   ~300 ticks at 60 ticks/sec. If the game lasted < 5 sec (rare),
   start from tick 0.
3. **Strategy A (recommended for MVP)**: re-run the replay
   silently (no canvas writes) from start until 300 ticks before
   the end, then render the final 300 ticks **at half speed** (or
   30 ticks/sec) into a small off-screen canvas placed inside
   `.run-recap__death-clip`.
4. **Strategy B (faster, more code)**: use the existing checkpoint
   machinery (`buildReplayCheckpoint` in `src/replay-debug.ts`) to
   seek directly to N ticks before death. Requires a checkpoint
   near the end, which `_actionLog` and current checkpoint cadence
   may or may not provide. **Defer to follow-up; MVP uses
   Strategy A.**
5. UI:
   - Auto-play once when the Run Recap opens.
   - Show a "▶ Replay last 5 seconds" button afterwards.
   - No audio (silenced via render adapter or by not wiring the
     SFX bus).
6. Performance concern: re-running a full game silently may take
   100-500ms for late-wave runs. Acceptable as long as it's done
   off the main render thread or with a loading spinner. Likely
   fine on iPhone given existing sim perf; worth a quick
   benchmark.

**Acceptance**: opening Run Recap after death plays the last 5
seconds in slow-motion in the recap panel, looping or replay-on-
demand. No audio. Smooth.

**Risk**: this is the highest-effort step in the MVP. If it slips,
ship the rest first and add this as a follow-up — the data and
panel layout already support it.

---

### Step 9 — PWA manifest + icons

**Files**: `public/manifest.json` (new), `public/icon-192.png` (new),
`public/icon-512.png` (new), `index.html`,
optionally `vite.config.ts` if base path needs tweaking.

1. `public/manifest.json`:
   ```json
   {
     "name": "Dubai Missile Command",
     "short_name": "DMC",
     "description": "Canvas-based missile defense over the Burj.",
     "start_url": "./",
     "scope": "./",
     "display": "standalone",
     "orientation": "portrait",
     "background_color": "#040614",
     "theme_color": "#040614",
     "icons": [
       { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
     ]
   }
   ```
2. Generate two PNG icons. Quickest path: take the existing
   Capacitor iOS icon set (under `ios/App/App/Assets.xcassets/
AppIcon.appiconset/`) and resize to 192/512. Or render the
   Burj/missile composite once and export.
3. Add `<link rel="manifest" href="manifest.json">` to
   `index.html` `<head>`. Use a relative path so GitHub Pages base
   path `/dubai-missile-command/` resolves correctly.
4. Add `<meta name="theme-color" content="#040614">` if not
   already present.
5. Smoke: in Chrome desktop, devtools → Application → Manifest →
   verify no errors, icon previews show.
6. iOS Safari → Add to Home Screen → verify it installs and opens
   in standalone mode.

**Acceptance**: PWA installs cleanly from web. No service worker
yet — that's a Phase 3 task. No offline behavior yet, that's fine.

**Why now**: it's a tiny hedge. When the Phase 3 share-link flow
ships, a friend can install the game to home screen from the
shared link without a separate effort. Cheap insurance.

---

### Step 10 — Smoke, polish, ship

**Files**: `e2e/smoke.spec.ts`, possibly visual tweaks across
recap CSS.

1. Extend `e2e/smoke.spec.ts`:
   - Fast-forward / inject a quick game-over (existing test
     utilities may help — check `e2e/` patterns)
   - Assert Game Over panel shows 3 stat cards
   - Tap Run Recap, assert panel becomes visible and contains
     hero, kill bar, wave timeline elements
   - Tap Back, assert Game Over panel returns
2. Run full Playwright suite (`npm run test:e2e`) — fix anything
   that broke.
3. Run `npm test` for unit tests.
4. Manual playtest:
   - Quick run, die wave 2, look at Recap. Does it tell a story?
   - Long run, die wave 8 with diverse threats. Does the stacked
     bar still read at a glance? Does the wave timeline scroll
     gracefully?
   - iPhone build (`npm run ios:deploy`). Test on real device.
5. Commit + push when satisfied.

**Acceptance**: all tests green, manual smoke clean, iPhone smoke
clean.

---

## 4. File-level change list (cheat sheet)

| File                                               | Change                                                                                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                                     | Add `WaveSummaryRecord`, `UpgradeTimelineEntry`, `RunRecapData`, `OutcomeCause`, `GameState._waveSummaries`, `GameState._waveStartTick`               |
| `src/game-sim.ts`                                  | Push per-wave summary on wave complete; track wave start tick                                                                                         |
| `src/game-sim.test.ts`                             | Assert wave summaries accumulate                                                                                                                      |
| `src/run-recap.ts` (new)                           | `buildRunRecapData`, `deriveOutcomeCause`, `extractUpgradeTimeline`                                                                                   |
| `src/run-recap.test.ts` (new)                      | Unit tests for above                                                                                                                                  |
| `src/save-replay.ts` (new)                         | `saveReplayToFile`                                                                                                                                    |
| `src/run-recap-death-clip.ts` (new)                | Step 8 slow-mo widget                                                                                                                                 |
| `src/ui.ts`                                        | Slim `showGameOver`; add `showRunRecap`, `hideRunRecap`; render helpers for hero / stacked bar / wave timeline / upgrade timeline / details accordion |
| `src/game.ts`                                      | Build RunRecapData on game-over; repoint `progression-button` to open Run Recap                                                                       |
| `index.html`                                       | Trim `#gameover-panel`; add `#run-recap-panel`; add manifest `<link>`; rename progression button label                                                |
| `src/styles.css` (or wherever)                     | Styles for `.run-recap__*` blocks                                                                                                                     |
| `public/manifest.json` (new)                       | PWA manifest                                                                                                                                          |
| `public/icon-192.png`, `public/icon-512.png` (new) | PWA icons                                                                                                                                             |
| `package.json`                                     | Add `@capacitor/share`, `@capacitor/filesystem`                                                                                                       |
| `e2e/smoke.spec.ts`                                | Run Recap path coverage                                                                                                                               |

---

## 5. Test plan

### Unit tests (Vitest)

- `src/run-recap.test.ts`: `buildRunRecapData` shape, outcome
  cause branches, upgrade timeline wave assignment, hit ratio edge
  cases (0 shots, 0 kills).
- `src/game-sim.test.ts`: existing tests stay green; new
  assertions on `_waveSummaries` length and content after multi-
  wave games.
- `src/ui.ts` (if applicable to existing test pattern): basic
  smoke on `showRunRecap` rendering — feed mock data, verify DOM
  nodes exist with expected counts.

### Integration (Playwright)

- Add a smoke test that simulates a fast game-over and walks the
  recap UI: open, see hero stats, see kill bar segments, tap
  back, return to game-over.
- Run the existing E2E suite to catch regressions on the
  trimmed gameover panel.

### Manual / device

- iOS: install via `npm run ios:deploy`. Play through one wave,
  die, verify Run Recap opens. Tap Save Replay → share sheet
  appears → save to Files → open file → drop onto web canvas →
  replay plays.
- Desktop web: load PWA install prompt (Chrome dev console),
  install, open in standalone mode.
- iOS Safari: Add to Home Screen → opens in standalone mode.

### Visual / "feels right" check

- The whole point of this MVP is to test whether the recap is
  _good_. After integration, sit with it for 20 minutes. Try
  different death types. Does it tell a story? Do you want to
  share it? Is "Watch how you died" actually fun?

---

## 6. Acceptance criteria (definition of done)

- [ ] Game Over panel shows only Score / Wave / Hit Ratio + 4
      action buttons. No breakdown, no shots/multi-shot/kills
      cards.
- [ ] Tapping the (renamed) Run Recap button opens the new
      `#run-recap-panel`.
- [ ] Run Recap panel renders hero summary, stacked-bar kill viz,
      wave-by-wave timeline, upgrade purchase list, and details
      accordion.
- [ ] Stacked bar reads at a glance for runs with 1, 4, and 8
      categories of kills. Empty state handled.
- [ ] Wave timeline lists every completed wave; deltas match
      what the bonus screen would have shown.
- [ ] "Watch how you died" auto-plays the last ~5 seconds in
      slow-mo on panel open. Re-playable.
- [ ] Save Replay produces a `.json` file via iOS share sheet
      (or a download on web) that loads back into the game
      successfully.
- [ ] PWA manifest validates; "Add to Home Screen" works on iOS
      Safari and Chrome desktop.
- [ ] All existing unit + E2E tests pass.
- [ ] New unit tests for `run-recap.ts` pass.
- [ ] Code review checklist: no new lint errors, types are
      complete, no dead code from the old breakdown rendering.

---

## 7. Risks & open questions

### Risks

- **R1 — "Watch how you died" perf.** Re-running a full replay
  to seek the last 5 seconds may stall for late-game runs (wave
  10+). Mitigation: show a small loading state; if perf is bad,
  defer this widget to a follow-up.
- **R2 — iOS Share plugin on Capacitor 8.** Plugin API has been
  stable but `Filesystem.writeFile` to `Directory.Cache` + sharing
  by URI sometimes requires `Directory.Documents` to expose to the
  share sheet on older iOS. Test early.
- **R3 — Wave-summary backfill.** Existing saved games (if any)
  won't have `_waveSummaries`. Initialize defensively; treat empty
  array as "no per-wave data" and render timeline gracefully.
- **R4 — Visual quality on dense kill mixes.** 8 bins is a lot for
  a horizontal bar. May need to group ("missiles / drones / other")
  if it looks bad. Decide after Step 6.
- **R5 — PWA on GitHub Pages base path.** Manifest paths must be
  relative or include the `/dubai-missile-command/` prefix.
  Validate in deploy preview, not just local.

### Open questions to resolve during execution

- Should "Hit Ratio" round to integer % or show one decimal?
  Recommend integer for the Game Over hero; decimal in the details
  accordion.
- Death clip: loop or play once? Recommend play-once with a
  replay button.
- Save Replay filename format: include wave + score? Probably yes
  for human-readability: `dmc-w14-s124580-<unix>.json`.
- Should Watch Replay (full) and Save Replay live on Run Recap, or
  also still on the Game Over panel? Recommend Run Recap only —
  Game Over stays minimal.

---

## 8. Effort estimate (rough)

For a single developer working in focused stretches. Not
including review/iteration time.

| Step                                         | Effort               |
| -------------------------------------------- | -------------------- |
| 1. Sim per-wave summary                      | 1-2 h                |
| 2. Run Recap data factory + tests            | 2-3 h                |
| 3. Game Over panel trim                      | 30 min               |
| 4. Recap panel scaffolding (HTML + base CSS) | 1-2 h                |
| 5. Recap renderer (no death clip)            | 3-4 h                |
| 6. Stacked-bar viz                           | 1-2 h                |
| 7. Save Replay (Share plugin)                | 1-2 h                |
| 8. Watch how you died (Strategy A)           | 3-5 h                |
| 9. PWA manifest + icons                      | 30-60 min            |
| 10. Smoke + polish                           | 2-3 h                |
| **Total**                                    | **~15-24 h focused** |

A full week of evening sessions, or 2-3 focused days. Step 8 is
the floating variable — if it stalls, ship Steps 1-7 + 9-10 as
the wedge and follow up with Step 8 later.

---

## 9. What comes next (post-MVP)

Tied directly back to the brain dump's Phase 2+ list — captured
here so we don't forget the arc:

1. **Phase 2** — Cloudflare Worker + R2 + D1 skeleton. Accepts
   replay uploads, serves short-link redirects. No game UI yet.
2. **Phase 3** — Share my run flow + post-replay CTA + install
   CTAs + OG previews.
3. **Phase 4** — Auto-stream toggle for friends mode + emoji
   feedback prompt + recent-uploads audit list.
4. **Phase 5** — Leaderboard (only when 20+ installs exist).
   Daily Challenge / ghost-run mode lives here too.
5. **Phase 6** — AI inspection (manual, query-driven).
6. **Phase 7** — Polish (custom domain, Game Center, achievements).

If MVP validates the hypothesis ("players engage with their own
replays"), Phase 2 is justified. If not, we don't build it.

---

## 10. Notes for whoever picks this up

- Read the brain dump first
  (`.plans/run-recap-playtest-platform.md`) for context. This
  document is the _how_; that one is the _why_.
- Don't extend scope. The MVP exists to _test a hypothesis_, not
  to deliver the whole platform. Resist adding the Save-to-Cloud
  button. Resist adding a leaderboard placeholder. Both will come
  if Phase 1 is good.
- Step 8 is the only step that might warrant cutting if time is
  tight. Everything else is small. Steps 1-7 + 9 + 10 alone are a
  shippable wedge.
- The deterministic sim is your friend. Every "how do I derive
  X?" question has the answer: "from the replay." Don't
  re-implement state tracking when re-running the replay gives it
  to you for free.
