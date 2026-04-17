# Runtime Controller

`src/game.ts` is the browser runtime coordinator. It is the place where simulation, rendering, DOM UI, replay, input, and audio meet.

## Responsibilities

- Own the canvas and screen-level DOM nodes.
- Create and hold `gameRef.current`.
- Start normal games and replay sessions.
- Advance the simulation on a fixed timestep.
- Apply interpolation before drawing and restore authoritative positions after drawing.
- Translate sim events into audio/UI actions.
- Manage screen transitions and overlay state.

## Bootstrap Path

The `Game` constructor does the runtime setup:

1. Cache DOM references.
2. Bind pointer, keyboard, drag-drop, and button events.
3. Expose browser globals such as `window.__gameRef`.
4. Call `preloadRenderAssets()`.
5. Prebake gameplay building sprites with `buildBuildingAssets(GAMEPLAY_SCENIC_BASE_Y)`.
6. Set the initial screen to `"title"`.
7. Start the RAF loop.

## Screen Model

There are two separate state layers:

- `this.screen` controls the top-level browser screen: `"title"`, `"playing"`, or `"gameover"`.
- `game.state` inside `GameState` controls sim phases such as `"playing"`, `"shop"`, and `"gameover"`.

The controller also tracks overlay-like flags:

- `shopOpen`
- `bonusActive`
- `progressionOpen`
- `replayActive`
- `showOptionsMenu`
- `showPerfOverlay`

This is why changing `game.state` alone does not fully change the browser UI.

## Game Start And Replay Start

### `startGame()`

- Initializes audio and prewarms sound effects.
- Resets pointer capture and player-fire limiter state.
- Calls `initGame()`.
- Hides shop / bonus / progression UI.
- Marks the canvas active and switches to `"playing"`.

### `initGame()`

- Seeds the game RNG.
- Calls `simInitGame()`.
- Loads meta progression from storage.
- Applies the default starting upgrades (`wildHornets` and `emp`).
- Initializes replay recording fields such as `_actionLog`, `_replayTick`, and replay checkpoints.

### `startReplay()`

- Creates a replay runner with `createReplayRunner(...)`.
- Calls `runner.init()` to get a fresh replay state.
- Marks that state as replay state with `_replay` / `_replayIsHuman`.
- Switches the browser to `"playing"` without going through normal game init.

## Frame Loop

The RAF loop is the most important control path in the repo.

### Normal game flow

When `this.screen === "playing"` and a game exists:

1. Compute real elapsed milliseconds.
2. Convert elapsed time into `_timeAccum` in sim ticks.
3. If replay is active:
   - let the replay runner step or pause at shop boundaries
   - end the replay when the runner reports completion
4. If replay is not active and `game.state === "playing"`:
   - while `_timeAccum >= 1`, run one fixed sim tick
   - before each tick, call `snapshotPositions(game)`
   - call `simUpdate(game, 1, onEvent)`
   - increment `_replayTick`
   - append cursor actions to `_actionLog`
   - capture replay checkpoints when needed
5. Compute interpolation alpha from remaining `_timeAccum`.
6. Call `applyInterpolation(game, alpha)`.
7. Sync HUD data.
8. Call `drawGame(...)`.
9. Call `restorePositions(game)`.

### Non-playing screens

- `"title"` draws with `drawTitle(...)`
- `"gameover"` draws with `drawGameOver(...)`

## Sim Event Bridge

`handleSimEvent(type, data)` is the bridge from sim to runtime concerns.

Handled event types:

- `sfx`
- `gameOver`
- `waveBonusStart`
- `shopOpen`

That bridge is intentionally narrow. The sim raises semantic events and the runtime decides how to present them.

## UI Flow

### Shop

- Sim raises `shopOpen`.
- Controller blurs the battlefield card and calls `ui.showShop(...)`.
- Player or replay chooses upgrades.
- `closeShop()` writes a shop action into `_actionLog`, calls `simCloseShop(game)`, and removes the UI overlay.

### Bonus screen

- Sim raises `waveBonusStart`.
- Controller disables canvas pointer events and shows the animated bonus screen.
- The UI calls back into the controller to add score and mark the bonus sequence done.

### Game over

- Controller stores final score/wave/stats.
- Progression is updated and saved.
- Human runs generate a `ReplayData` payload and attempt to `POST` it to `/api/save-replay`.
- Browser screen changes to `"gameover"`.

## Input Path

Important input helpers:

- `getCanvasCoords(...)` maps DOM coordinates into game coordinates.
- `requestPlayerFire(...)` goes through the player-fire limiter.
- `releaseBufferedPlayerFire(...)` releases queued shots during sim ticks.
- `fireEmp()` is a direct controller action that calls `simFireEmp(...)`.
- `handleDrop(...)` accepts replay JSON via drag-and-drop.

The player-fire limiter exists so browser input rate is decoupled from fixed-tick sim updates.

## Browser Globals

The controller exposes a small browser-side API:

- `window.__gameRef`
- `window.__loadReplay`
- `window.__lastReplay`
- `window.__createReplayRunner`
- `window.__openShopPreview`

Bots, replay tooling, editor helpers, and manual debugging all depend on these.

## Gotchas

- `screen` and `game.state` are related but not interchangeable.
- `_replayTick` is used for replay timing and also for visual cues such as launcher muzzle flash timing.
- Replay save happens on human game over, not as a general background autosave.
- Title audio is controlled by `setScreen()`, not by the render layer.
- The UI layer is imperative DOM code, so the controller must explicitly hide and clean up overlays.
