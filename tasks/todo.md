# Offload Remaining Live Render to art-render

Move all remaining procedural sprite work out of `src/game-render.ts` and into `src/art-render.ts` as baked asset recipes. Keep only animation-dominated effects (explosions, beams, rings, decoy flares) live.

## Phase 1 — Upgrade projectile sprites

- [ ] Add `wildHornet`, `roadrunner`, `patriotSam` kinds to the projectile sprite bakery in `art-render.ts` (extend `buildInterceptorSpriteAssets` or sibling).
- [ ] Update `drawUpgradeProjectiles` in `game-render.ts` to call `drawBakedProjectileSprite`; keep live overlays for the Patriot flame pulse.
- [ ] Warm new sprite kinds in `preloadRenderAssets`.
- [ ] Verify: `npm run typecheck`, `npm run test`, dev-server smoke test (spawn each upgrade, see projectiles).
- [ ] Commit.

## Phase 2 — Defense site structures

- [ ] Add `buildDefenseSiteAssets()` in `art-render.ts` returning keyed bundle: `patriotTEL`, `phalanxBase`, `wildHornetsHive[level 1..3]`, `roadrunnerContainer[level 1..3]`, `flareDispenser[level 1..3]`, `empEmitter[level 1..3]`.
- [ ] Add cache + `getDefenseSiteAssets()` in `game-render.ts`.
- [ ] Refactor each block in `drawGroundStructures` to draw baked sprite + live overlays (rotating Phalanx barrel, EMP charge arcs + ready pulse, flare warm glow, system labels).
- [ ] Warm in `preloadRenderAssets`.
- [ ] Verify: typecheck, tests, dev smoke test (buy every upgrade at every level; visuals unchanged).
- [ ] Commit.

## Phase 3 — F-15 airframe

- [ ] Add `buildPlaneAssets()` in `art-render.ts` for fuselage, nose, swept wings, twin stabilizers, nozzles, cockpit.
- [ ] Refactor `drawPlanes` in `game-render.ts` to draw baked sprite with mirror + bank transform; keep afterburner pulse and nav-light blink as live overlays.
- [ ] Warm in `preloadRenderAssets`.
- [ ] Verify: typecheck, tests, dev smoke test (F-15s flying in both directions, banking when evading).
- [ ] Commit.

## Review

_Fill in after each phase._
