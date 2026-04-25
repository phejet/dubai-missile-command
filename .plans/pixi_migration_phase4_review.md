# Phase 4 Review — Pixi Gameplay Static Layers

Scope: uncommitted changes to `src/pixi-render.ts` (+798 lines) and `src/pixi-textures.ts` (+/-28 lines) implementing Step 4 of `.plans/pixi_migration_plan.md` (port sky, water, city, Burj, ground structures + defense sites to Pixi).

Gates: `npm run typecheck`, `npm run lint`, `npm test` all green (14 files / 224 tests).

## Real bugs / concerns

1. **`updateBurjDamageFx` allocates+destroys `Graphics` every frame** (`src/pixi-render.ts:752-770`). Decals are pooled by id (correct); damageFx churn GC and rebuild GPU buffers per frame. This is the one pattern that actively contradicts the perf premise of the migration. Pool damageFx the same way as decals — keyed by `fx.seed` or a stable index.

2. **Wasted initial sky bake.** `buildGameplayScene` calls `getGameplaySkyAssets([], GAMEPLAY_SCENIC_GROUND_Y)` with a fresh empty array. The first `updateGameplayScene` immediately rebakes with `game.stars` (different reference → cache miss at `src/canvas-render-resources.ts:191`). Either pass the real stars up front or lazy-init the sky on first `update`.

3. **`loadPixiPngBundles` awaits sequentially** (`src/pixi-assets.ts:86-91`). Swap the for-loop for `Promise.all(bundleNames.map(loadPixiPngBundle))`. Currently adds an extra round-trip to boot per bundle.

4. **Per-frame `cssHexToNumber(COL.*)`** in `updateGameplayDefenseSites`. Regex + `parseInt` for every site every frame (5 static sites + up to 3 phalanx turrets + all live `defenseSites`). Precompute a `COL_HEX` lookup at module load.

## Code quality

5. `GAMEPLAY_LAUNCHER_SCALE = 0.8 + 3 * 0.06` duplicates `DEFAULT_GAMEPLAY_LAUNCHER_SCALE` already exported from `src/canvas-render-resources.ts:72`. Import it.

6. Defense-site placements hardcoded twice — once as initial `x, y` args in `buildGameplayScene`, again as `?? 334` / `?? GAMEPLAY_SUPPORT_SITE_Y` fallbacks inside `updateGameplayDefenseSites`. `getDefenseSitePlacement` never returns `null` for the cases called, so the fallbacks are dead code. Compute once.

7. `phalanxNodes` array duplicates entries already stored in `defenseSiteNodes` under `"phalanx:${index}"` keys. Pick one representation.

8. `latestGame` is a long-lived reference. On `destroy()` or a screen transition away from `playing`, null it out — otherwise a late-arriving `renderIfReady` (fired by async init completion) could render a stale state.

## Noteworthy (not bugs, but call out)

9. **The title burj silently changed in this diff.** `burjContainer.scale.set(2)` + `burjStatic.position.set(offset.x - BURJ_X, offset.y - TITLE_TOWER_BASE_Y)` rewires the title scene to match 2D's `withAnchorScale` behavior. The previous title code (commit `a424671`) drew the burj unscaled — effectively half-size. This fixes it, but it's a title-visuals change buried in a "gameplay static layers" commit. Mention in the commit message.

10. **`resolution` fix in `pixi-textures.ts`** is a real correctness fix. High-DPI bakes (`resolutionScale > 1` — the burj at `artScale=2`, launchers at `launcherScale > 1`) were previously rendering at their physical pixel size (2x intended), because Pixi defaulted `resolution` to 1 on `Texture.from({ resource: canvas })`. Passing `resolution: source.resolutionScale` through is the right fix.

11. No gameplay scene tests. Step 5 of the migration plan mentions the pattern (mock `GameState` → `renderGameplay` → assert container `children.length` / positions). Phase 4 is a reasonable place to start that scaffolding. Not blocking.

## Math verified correct

- **Burj / decals / damageFx / hitFlash transforms.** 2D runs all burj decoration inside `withAnchorScale(burjX, burjBaseY, 2)` and applies `/artScale` to world coords inside (`src/game-render.ts:868-869`). Pixi achieves the same with container `scale.set(2)` + `(p - anchor)/2` local positions. World pixels match. Decal `sprite.width = 48 * decal.scale` inside the 2× container renders at `96 * decal.scale` physical pixels, matching 2D's `drawImage(..., 48, 48)` inside the 2× ctx.
- **Launcher aim clamp.** `Math.min(-0.2, Math.max(angle, -Math.PI + 0.2))` is byte-identical to `src/game-render.ts:2195-2196`.
- **`_replayTick || 0` muzzle-flash on tick 0** — full flash shows for every alive launcher on frame 1. Exists in 2D too (same computation); pre-existing quirk, not this diff's fault.

## Verdict

Ship after fixing (1) damageFx pooling. Everything else is cleanup, minor perf nits, or improvements already landed (9, 10) that I'd merge as-is. The transforms are correct, the diff is a faithful port of the 2D static-layer stack into retained-mode Pixi, and the eager bakes in `buildGameplayScene` are actually the right call for a perf-gated migration — better to pay at boot than on first wave spawn.

## Resolution

- Fixed the blocking damage-FX churn by pooling `Graphics` per `burjDamageFx.id` and destroying only removed ids.
- Also addressed the cleanup/perf nits: lazy gameplay sky initialization, parallel PNG bundle loading, precomputed color numbers, shared launcher scale import, single Phalanx node registry, and stale `latestGame` clearing on non-gameplay screens and destroy.
- Kept the title Burj and texture-resolution fixes noted above.
- Verified with `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `VITE_RENDERER_MODE=pixi npx playwright test e2e/smoke.spec.ts`.
