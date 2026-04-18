# Offload Remaining Live Render to art-render

Move all remaining procedural sprite work out of `src/game-render.ts` and into `src/art-render.ts` as baked asset recipes. Keep only animation-dominated effects (explosions, beams, rings, decoy flares) live.

## Phase 1 — Upgrade projectile sprites

- [x] Add `wildHornet`, `roadrunner`, `patriotSam` kinds to the projectile sprite bakery in `art-render.ts` (`buildUpgradeProjectileSpriteAssets`).
- [x] Update `drawUpgradeProjectiles` in `game-render.ts` to call `drawBakedProjectileSprite`; Patriot flame left as live overlay.
- [x] Warm new sprite kinds in `preloadRenderAssets`; cache + test hooks wired up.
- [x] Verified: `npm run test:render-toggle` OK, `buildUpgradeProjectileSpriteAssets` test passes, pre-existing typecheck/wave-spawner failures unchanged.
- [x] Committed as `219624f`.

## Phase 2 — Defense site structures

- [x] Added `buildDefenseSiteAssets()` in `art-render.ts` with `patriotTEL`, `phalanxBase`, `wildHornetsHive[1..3]`, `roadrunnerContainer[1..3]`, `flareDispenser[1..3]`, `empEmitter[1..3]`. New `StaticSpriteAsset` type + `buildStaticSpriteAsset` helper + `drawBakedStaticSprite` helper.
- [x] Added `_defenseSiteAssets` singleton + `getDefenseSiteAssets()` + test hook in `game-render.ts`.
- [x] Rewrote each block in `drawGroundStructures` to call `drawBakedStaticSprite` + keep live overlays (rotating Phalanx barrel, EMP charge arcs + ready pulse, flare warm glow, system labels).
- [x] Warmed in `preloadRenderAssets`.
- [x] Verified: new `buildDefenseSiteAssets` test passes, `npm run test:render-toggle` OK.
- [ ] Commit.

## Phase 3 — F-15 airframe

- [x] Added `buildPlaneAssets()` in `art-render.ts` returning `{ f15Airframe }` baked StaticSpriteAsset (fuselage, nose, wings, stabilizers, nozzles, cockpit).
- [x] Refactored `drawPlanes` in `game-render.ts` to drawImage the baked airframe inside the existing translate/mirror/bank/scale stack; afterburner pulse + nav-light blink stay as live overlays in the same unit space.
- [x] Warmed `_planeAssets` in `preloadRenderAssets` with a test hook (`__getPlaneAssetsForTest`).
- [x] Verified: new `buildPlaneAssets` test passes, `npm run test:render-toggle` OK.
- [ ] Commit.

## Review

Three phases shipped, one commit each:

- **`219624f`** — projectile sprite bakery extended with `wildHornet` / `roadrunner` / `patriotSam`; `drawUpgradeProjectiles` now calls `drawBakedProjectileSprite` with the Patriot flame as a live overlay.
- **`d2b1fed`** — `StaticSpriteAsset` + `buildStaticSpriteAsset` + `drawBakedStaticSprite` introduced to support non-animated bakes. `buildDefenseSiteAssets()` prebakes the Patriot TEL, Phalanx base, and per-level Hornets hive / Roadrunner container / flare dispenser / EMP emitter. `drawGroundStructures` keeps only animation-dependent overlays live (rotating Phalanx barrel, EMP charging arcs + ready pulse, flare warm glow, system labels).
- **Phase 3** — `buildPlaneAssets()` prebakes the F-15 airframe. `drawPlanes` draws the baked sprite inside the existing transform stack and keeps afterburner + nav-light blink live.

Outcome: every procedural asset recipe now lives in `art-render.ts`. `game-render.ts` is left with frame composition, HUD, animation-dominated effects (explosions/beams/rings/decoy flares), bitmap loaders, and the cache/preload layer.
