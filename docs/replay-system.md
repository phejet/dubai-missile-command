# Replay System

The replay system records action logs plus a seed, then re-simulates the run in the browser.

Relevant files:

- `src/replay.ts`
- `src/replay-debug.ts`
- `src/game.ts`
- `vite-replay-plugin.ts`
- `play-replay.ts`

## Replay Philosophy

This is action-log replay, not full-state playback.

Inputs:

- RNG seed
- ordered player/bot actions
- current game code

Outputs:

- the run is deterministically reconstructed by simulating from tick 0

This means replays are sensitive to gameplay code drift.

## Replay Data Format

`ReplayData` contains:

- `seed`
- `actions`
- optional `draftMode`
- optional `checkpoints`
- optional `finalTick`
- optional `isHuman`
- optional metadata such as `_buildId` and `_savedAt`

Supported action types:

- `fire`
- `cursor`
- `emp`
- `shop`
- `wave_plan`

`wave_plan` is informational for analysis/UI, not required for action playback.

## Human Replay Recording

Human runs are recorded in `src/game.ts`.

Important runtime fields:

- `_actionLog`
- `_replayTick`
- `_replayCheckpoints`
- `_gameSeed`

During gameplay:

- fire actions are appended when shots are fired
- cursor actions are appended every 3 ticks
- shop purchases are appended when the shop closes
- checkpoints are recorded at start, shop boundaries, and game over

On human game over:

- a `ReplayData` object is assembled
- stored on `window.__lastReplay`
- optionally posted to `/api/save-replay`

## Replay Runner Lifecycle

`createReplayRunner(replayData, onEvent)` returns an object with:

- `init()`
- `step()`
- `resumeFromShop()`
- `isShopPaused()`
- `isFinished()`
- `getState()`
- `getTick()`
- `cleanup()`

`init()` seeds the RNG, creates a fresh sim state, and enables draft mode when needed.

`step()`:

- applies all actions for the current tick
- performs limited cursor interpolation toward the next cursor/fire action
- calls `update(g, 1, onEvent)`
- increments the replay tick

## Shop Pause Behavior

Replay playback pauses when the sim enters `g.state === "shop"`.

Flow:

1. runner finds the next `shop` action
2. runner stores the bought items in `_replayShopBought`
3. runner reports `shopPaused`
4. `game.ts` displays the toast/UI timing
5. `resumeFromShop()` applies purchases and calls `closeShop(g)`

Important detail:

- stale combat actions recorded before the shop are discarded before shop handling

## Checkpoints

`buildReplayCheckpoint(g, tick, reason)` creates a compact deterministic signature of the current run.

It hashes:

- top-level score/wave/health/ammo data
- upgrade levels
- alive counts
- encoded alive entity lists

Checkpoints are for debugging:

- replay mismatch analysis
- determinism canaries
- regression hunting

They are not the playback mechanism itself.

## Save Flow

The dev-only replay save endpoint comes from `vite-replay-plugin.ts`.

Behavior:

- route: `/api/save-replay`
- only available through the Vite dev server
- injects `_buildId` and `_savedAt`
- writes JSON files under `replays/`
- prunes older files beyond the configured limit

This endpoint does not exist in static preview or GitHub Pages builds.

## Runtime And Tooling Entry Points

- `window.__loadReplay(data)` loads a replay in the browser
- `window.__createReplayRunner` exposes the runner factory
- `play-replay.ts` launches a local browser and calls `__loadReplay(...)`

## Gotchas

- `draftMode` is inferred if missing, based on shop action shape.
- Replays only stay valid while gameplay code stays compatible enough with the original action log.
- The replay runner resets RNG back to `Math.random` in `cleanup()`, so forgetting cleanup can leak deterministic RNG into later runtime behavior.
