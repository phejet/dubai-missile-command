# Render Split Analysis

This note explains how rendering is split across `src/art-render.ts`, `src/game-render.ts`, and `src/game-sim.ts`, and how those modules relate at runtime.

## Summary

- `src/art-render.ts` is the art library and sprite bakery.
- `src/game-render.ts` is the frame compositor and render orchestration layer.
- `src/game-sim.ts` owns simulation and gameplay state changes.
- `src/game.ts` is the runtime coordinator that advances simulation and calls the renderer.
- `src/game-logic.ts` provides shared geometry/constants so sim and render describe the same world.

## `art-render.ts`: reusable art primitives and prebaked assets

`src/art-render.ts` contains the low-level drawing code for shared environment pieces and units. Its responsibilities are visual, not gameplay-driven.

Core exports:

- `buildSkyAssets()` prebakes animated sky frames.
- `buildBurjAssets()` prebakes the Burj static sprite plus light-animation frames.
- `buildLauncherAssets()` prebakes launcher chassis and turret sprites.
- `buildBuildingAssets()` and `buildTitleBuildingAssets()` prebake skyline/building assets.
- `drawSharedTower()` draws a tower directly from shape/profile data.
- `drawBakedLauncher()` draws a launcher from prebaked launcher assets.
- `drawSharedLauncher()` draws the same launcher live without using prebaked assets.
- `drawFlickerWindows()` and `getLightFlicker()` provide reusable light-window animation helpers.
- `burjPath()` and `halfWidthsAt()` expose Burj geometry used by the render layer.
- `mapGameplayBuildingTower()` maps a gameplay `Building` into the art-facing `TitleTower` shape metadata.

Operationally, `art-render.ts` answers questions like:

- How do we draw this tower silhouette?
- How do we bake animated light frames for the Burj?
- What sprite bounds and offsets are needed for a launcher asset?

It does not answer questions like:

- Which missiles are alive?
- Which launcher is destroyed?
- Which objects should be drawn this frame?

## `game-render.ts`: scene composition and render-time caching

`src/game-render.ts` imports the art primitives and uses them to draw complete scenes.

Its responsibilities include:

- Asset preloading for bitmap art such as flashes, decals, and water textures.
- Runtime caches for prebaked assets keyed by scale/ground position.
- Drawing full scenes in the correct order.
- Translating `GameState` into concrete draw calls.
- Applying HUD, overlays, crosshair, camera transform, shake, and scene-specific effects.

Important entry points:

- `preloadRenderAssets()` warms caches and image loads.
- `drawGame()` renders the gameplay scene from a `GameState`.
- `drawTitle()` renders the title screen.
- `drawGameOver()` renders the game-over scene.

Important internal composition helpers:

- `drawSharedSky()` uses sky assets from `art-render.ts`.
- `drawGameplayForegroundBuildings()` renders `game.buildings`, optionally with prebaked building assets.
- `drawSharedBurj()` renders the Burj with damage overlays, decals, and lighting.
- `drawGroundStructures()` renders launchers and support structures.

The split with `art-render.ts` is deliberate:

- `art-render.ts` provides building blocks and prebaked asset construction.
- `game-render.ts` decides when and where to use those building blocks.

Examples:

- Gameplay buildings are live state from `game.buildings`, but their tower style comes from `mapGameplayBuildingTower()` in `art-render.ts`.
- Intact launchers are usually rendered with `drawBakedLauncher()` and cached launcher assets.
- Destroyed launchers fall back to `drawSharedLauncher()` in inactive mode rather than using prebaked intact art.

## `game-sim.ts`: simulation and state mutation

`src/game-sim.ts` owns the gameplay model.

Its responsibilities include:

- Creating initial `GameState` in `initGame()`.
- Spawning threats and entities.
- Advancing simulation in `update()`.
- Updating auto-systems and upgrades.
- Mutating score, health, particles, explosions, schedules, and wave progression.

It does not import render modules. That boundary is clean: simulation writes state, renderer reads it.

The renderer consumes fields that simulation maintains, including:

- `stars`
- `buildings`
- `missiles`
- `drones`
- `interceptors`
- `explosions`
- `particles`
- `planes`
- `burjDecals`
- `burjDamageFx`
- `burjHitFlashTimer`
- `launcherFireTick`
- `launcherHP`
- `crosshairX` / `crosshairY`

## Runtime flow in `game.ts`

The current runtime coordinator is `src/game.ts`, not `src/App.jsx`.

The high-level loop is:

1. Construct the `Game` controller.
2. Call `preloadRenderAssets()` and prebake gameplay building sprites.
3. Initialize simulation state with `simInitGame()`.
4. On each animation frame, accumulate real time.
5. Advance the sim in fixed ticks with `simUpdate()`.
6. Apply render interpolation.
7. Call `drawGame()` with the interpolated state.
8. Restore original state positions after rendering.

That makes `game.ts` the seam between simulation and rendering.

## Shared geometry: `game-logic.ts`

Both sim and render rely on `src/game-logic.ts` for canonical world geometry.

Shared definitions include:

- `SCENIC_BUILDING_LAYOUT`
- `LAUNCHERS`
- `BURJ_X`
- `BURJ_H`
- `GROUND_Y`
- `GAMEPLAY_SCENIC_GROUND_Y`
- `GAMEPLAY_SCENIC_LAUNCHER_Y`
- `getGameplayLauncherPosition()`
- `getGameplayBuildingBounds()`
- `getGameplayBurjHalfW()`
- `getDefenseSitePlacement()`

This is why collision logic and the scenic layer line up instead of drifting into separate realities.

## Interpolation seam

One render-adjacent concern lives in `game-sim.ts`: interpolation helpers.

These exports are used by `game.ts` before and after rendering:

- `snapshotPositions()`
- `applyInterpolation()`
- `restorePositions()`

They are not gameplay logic in the usual sense. They exist so the fixed-timestep simulation can render smoothly between ticks. Architecturally, this is the least pure part of the split, but it is still a contained and understandable seam.

## Dependency graph

```text
game-logic/types -> art-render
game-logic/types -> game-sim
art-render + game-logic + types -> game-render
game-sim + game-render + art-render -> game.ts
```

## Practical takeaway

If you are changing:

- visual asset construction or shared drawing recipes: start in `src/art-render.ts`
- frame order, scene composition, or HUD/overlay drawing: start in `src/game-render.ts`
- gameplay rules, spawning, movement, combat, or state updates: start in `src/game-sim.ts`
- the loop that ties sim and render together: start in `src/game.ts`
