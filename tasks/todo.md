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

- [ ] Add `buildPlaneAssets()` in `art-render.ts` for fuselage, nose, swept wings, twin stabilizers, nozzles, cockpit.
- [ ] Refactor `drawPlanes` in `game-render.ts` to draw baked sprite with mirror + bank transform; keep afterburner pulse and nav-light blink as live overlays.
- [ ] Warm in `preloadRenderAssets`.
- [ ] Verify: typecheck, tests, dev smoke test (F-15s flying in both directions, banking when evading).
- [ ] Commit.

## Review

_Fill in after each phase._
