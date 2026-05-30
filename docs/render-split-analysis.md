# Render Split Analysis

This note explains how rendering is split across `src/pixi-render.ts`, `src/art-render.ts`, `src/canvas-render-resources.ts`, and `src/game-sim.ts`, and how those modules relate at runtime.

## Summary

- `src/pixi-render.ts` is the sole runtime frame renderer.
- `src/game-renderer.ts` defines the small renderer interface used by the controller and editor preview.
- `src/art-render.ts` is an offscreen-canvas sprite bakery and geometry helper library, not the frame renderer.
- `src/canvas-render-resources.ts` builds Pixi texture resources from those baked canvas assets.
- `src/game-sim.ts` owns simulation and gameplay state changes.
- `src/game.ts` is the runtime coordinator that advances simulation and calls the renderer.
- `src/game-logic.ts` provides shared geometry/constants so sim and render describe the same world.

## Runtime Renderer Path

The browser game enters the renderer through `PixiRenderer`:

1. `bootGame()` creates `new PixiRenderer(canvas)` and passes it into `Game`.
2. `Game` advances replay or simulation state in `src/game.ts`.
3. The RAF loop calls one of the `GameRenderer` scene methods:
   - `renderTitle()`
   - `renderGameplay(game, request)`
   - `renderGameOver(snapshot)`
4. `PixiRenderer` composes the frame through Pixi containers, sprites, meshes, particles, and text.

The same renderer class is also used by the run-recap death clip and the editor preview:

- `src/run-recap-death-clip.ts` creates a `PixiRenderer` for replay clips.
- `src/editor-render.ts` creates a `PixiRenderer` for editor gameplay previews.

## `game-renderer.ts`: Renderer Contract

`src/game-renderer.ts` is intentionally small. It defines the screen names, the game-over snapshot shape, gameplay render request options, and the `GameRenderer` interface.

That interface is the boundary the controller depends on:

- `renderTitle()` draws the title scene.
- `renderGameplay(game, request)` draws the live game or a replay state.
- `renderGameOver(snapshot)` draws the game-over scene.
- `resize(width, height)` and `destroy()` manage renderer lifecycle.

## `pixi-render.ts`: Scene Composition

`src/pixi-render.ts` implements `GameRenderer` and owns frame composition.

Its responsibilities include:

- Creating and resizing the Pixi application.
- Loading PNG bundles, smoke particle textures, and canvas-baked texture resources.
- Maintaining scene containers, meshes, sprites, particle containers, and render-time scratch state.
- Drawing title, gameplay, and game-over scenes in the correct order.
- Translating `GameState` into Pixi display objects.
- Applying HUD, overlays, crosshair, camera transform, shake, and scene-specific effects.

If you are changing frame order, scene composition, HUD rendering, or renderer lifecycle, start in `src/pixi-render.ts`.

## `art-render.ts`: Sprite Bakery And Shared Geometry

`src/art-render.ts` contains low-level offscreen canvas drawing code for shared environment pieces and units. Its responsibilities are visual recipes and baked assets, not frame orchestration.

Core exports include:

- `buildSkyAssets()` for animated sky frames.
- `buildBurjAssets()` for Burj static and light-animation frames.
- `buildLauncherAssets()` for launcher chassis and turret sprites.
- `buildBuildingAssets()` and `buildTitleBuildingAssets()` for skyline/building assets.
- `drawBakedLauncher()` for drawing a launcher from prebaked launcher assets.
- `drawFlickerWindows()` and `getLightFlicker()` for reusable light-window animation helpers.
- `burjPath()` and `halfWidthsAt()` for Burj geometry.
- `mapGameplayBuildingTower()` for mapping gameplay buildings into art-facing tower metadata.

`PixiRenderer` does not use `art-render.ts` as a frame renderer. Its direct imports from that file are layout helpers for Burj health/fire geometry. The baked canvas sprites flow through `src/canvas-render-resources.ts`, which turns them into textures Pixi can upload.

Some old direct-draw helpers still exist inside `art-render.ts`. They are dead-export candidates only if a fresh call-site audit proves they are unused; do not delete them as part of documentation cleanup.

## `canvas-render-resources.ts`: Texture Bridge

`src/canvas-render-resources.ts` is the bridge from offscreen canvas assets to Pixi textures.

It builds texture resource groups for:

- sky
- buildings
- Burj
- launchers
- defense sites
- interceptors and projectiles
- planes and effect sprites

`PixiRenderer` consumes those resources instead of asking the art bakery to draw complete frames.

## `game-sim.ts`: Simulation And State Mutation

`src/game-sim.ts` owns the gameplay model.

Its responsibilities include:

- Creating initial `GameState` in `initGame()`.
- Spawning threats and entities.
- Advancing simulation in `update()`.
- Updating auto-systems and upgrades.
- Mutating score, health, particles, explosions, schedules, and wave progression.

It does not import renderer modules. Simulation writes state; renderer reads it.

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

## Runtime Flow In `game.ts`

The current runtime coordinator is `src/game.ts`.

The high-level loop is:

1. Construct the `Game` controller with a `GameRenderer`.
2. Preload renderer assets and initialize simulation state.
3. On each animation frame, accumulate real time.
4. Advance the sim in fixed ticks with `simUpdate()`.
5. Apply render interpolation.
6. Call `renderer.renderGameplay(...)` with the interpolated state.
7. Restore original state positions after rendering.

For non-playing screens, `Game` calls `renderer.renderTitle()` or `renderer.renderGameOver(snapshot)`.

That makes `game.ts` the seam between simulation and rendering.

## Shared Geometry: `game-logic.ts`

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

## Interpolation Seam

One render-adjacent concern lives in `game-sim.ts`: interpolation helpers.

These exports are used by `game.ts` before and after rendering:

- `snapshotPositions()`
- `applyInterpolation()`
- `restorePositions()`

They exist so the fixed-timestep simulation can render smoothly between ticks.

## Dependency Graph

```text
game-logic/types -> art-render
game-logic/types -> game-sim
art-render -> canvas-render-resources -> pixi-render
game-renderer -> pixi-render
game-sim + pixi-render -> game.ts
```

## Practical Takeaway

If you are changing:

- visual asset construction or shared drawing recipes: start in `src/art-render.ts`
- Pixi texture resource creation from baked canvas assets: start in `src/canvas-render-resources.ts`
- frame order, scene composition, or HUD/overlay drawing: start in `src/pixi-render.ts`
- gameplay rules, spawning, movement, combat, or state updates: start in `src/game-sim.ts`
- the loop that ties sim and render together: start in `src/game.ts`
