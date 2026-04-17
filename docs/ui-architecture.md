# UI Architecture

The runtime UI is imperative DOM code in `src/ui.ts`. It does not use React.

## Scope

`src/ui.ts` owns:

- shop modal
- wave-bonus screen
- HUD element caching and updates
- game-over stat fill
- upgrade-progression panel

The runtime controller in `src/game.ts` remains the source of truth and calls into this UI layer with structured data.

## Data In, Callbacks Out

The UI layer should be thought of as:

- pure-ish data-to-markup rendering
- DOM event wiring
- cleanup closures

It should not own gameplay state.

Main contracts:

- `showShop(shopData, onBuyUpgrade, onClose)`
- `showBonusScreen(data, onScoreAdd, onComplete)`
- `cacheHudElements()`
- `updateHud(hudSnapshot)`
- `showGameOver(score, wave, stats)`
- `showUpgradeProgression(data, onClose)`

## Shop Modal

`showShop(...)`:

- renders card markup into `#shop-container`
- tracks temporary card selection locally
- enforces draft vs normal selection rules
- fires callbacks on confirm

The shop UI does not buy anything directly. It only reports selections back to `game.ts`.

## Bonus Screen

`showBonusScreen(...)`:

- renders the between-wave tally screen
- animates building and ammo bonus ticks
- plays bonus sounds
- calls back into the controller to add score
- calls `onComplete()` when the sequence ends

This is why the controller temporarily disables canvas pointer events during the bonus sequence.

## HUD

`cacheHudElements()` caches DOM references once.

`updateHud(...)` fills:

- score
- combo
- wave and progress
- Burj health
- launcher ammo and HP
- EMP charge
- perf overlay values

The HUD is updated from a small `HudSnapshot`, not from `GameState` directly.

## Upgrade Progression Panel

`showUpgradeProgression(...)` renders:

- a graph stage
- pan/zoom controls
- a detail side panel

This code is still DOM-string based, but it owns nontrivial interaction state:

- selected node
- viewport
- wheel zoom
- pointer panning
- pinch gestures

It reuses the same `upgrade-graph.ts` helpers as the editor.

## Cleanup Pattern

Each major UI surface maintains a cleanup closure:

- `shopCleanup`
- `bonusCleanup`
- `progressionCleanup`

Every `show*()` begins by calling the matching `hide*()` to avoid duplicated listeners and stale DOM.

## Gotchas

- The runtime UI assumes certain DOM ids exist in `index.html`.
- The UI is imperative, so forgetting cleanup produces duplicate handlers quickly.
- Shop, bonus, and progression visibility are still controlled by `game.ts`, not by `ui.ts`.
