# Plan: Split `src/art-render.ts` (3022 LOC) into focused modules

## Context

`src/art-render.ts` is the Canvas2D primitive bakery — every sprite/texture the Pixi renderer consumes is drawn here once at boot, then handed to Pixi as a `Texture`. The file mixes five unrelated subjects:

| Concern               | Lines (approx) | Rough contents                                                                                |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------- |
| Types + utilities     | 21–209, 2086–2235, 2909–2926 | Interfaces, palette, hash01, getLightFlicker, drawFlickerWindows, createSpriteCanvas, createStubCanvasContext |
| Launchers             | 211–640        | turret/chassis/effects + `buildLauncherAssets` + `drawBakedLauncher`                          |
| Projectiles           | 641–1530       | 17 `drawXLocal` functions for missiles/drones/bombs/interceptors + 3 sprite-asset builders + `drawBakedProjectileSprite` |
| Effects (glows/rings) | 1531–1735      | `buildExplosionGlowAssets`, `buildEmpRingAssets`, `buildEffectSpriteAssets`, `drawBakedStaticSprite` |
| Defense sites + planes | 1738–2020     | TEL, Phalanx, Hornet hive, Roadrunner container, Flare, EMP, F-15 + `buildPlaneAssets`, `buildDefenseSiteAssets` |
| Environment           | 2237–3022      | shared tower drawing, building assets, Burj geometry + bake, sky/stars                        |

External consumers are minimal:

- `src/canvas-render-resources.ts:2,27,43` — single consumer of the public API. It already re-exports the types it needs from art-render.
- `src/art-render.test.ts:13` — imports specific builders for unit tests.

That means the split is a **mechanical move** as long as the import sites in `canvas-render-resources.ts` and the test file are updated atomically.

## Goal

Replace `art-render.ts` with a `src/art/` directory that mirrors the five concerns above plus a shared `art-core.ts`. **Public surface as observed by `canvas-render-resources.ts` is unchanged.** No drawing behavior changes. Pixel-level visual output identical to current.

## Non-goals

- No new sprite styles, no palette tweaks, no resolution changes.
- No removing the unused `export` modifier from `burjLeftSections` / `burjRightSections` / `halfWidthsAt` (review finding "**A nice-to-have**") — that's deferred to its own one-line diff so this refactor stays purely structural.
- No deletion of `art-render.ts` after the move; instead it becomes a thin re-export barrel that consumers can keep importing from. We can remove it in a later cleanup once nothing imports it.

## Proposed file tree

```
src/art/
├── art-core.ts          # types + shared utilities
├── art-launcher.ts      # launcher drawing + bake
├── art-projectiles.ts   # all threat/interceptor/upgrade projectile sprites
├── art-effects.ts       # explosion glow, EMP rings, generic effect sprites
├── art-defense-sites.ts # static defense structures + F-15 + planes
└── art-environment.ts   # sky, stars, buildings, towers, Burj
```

`src/art-render.ts` stays as a barrel:

```ts
// src/art-render.ts (after split)
export * from "./art/art-core";
export * from "./art/art-launcher";
export * from "./art/art-projectiles";
export * from "./art/art-effects";
export * from "./art/art-defense-sites";
export * from "./art/art-environment";
```

| New file                       | Symbols moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Approx LOC |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `art/art-core.ts`              | Interfaces (`SkyAssets`, `BurjAssets`, `BuildingAssets`, `LauncherAssets`, `ProjectileSpriteAsset`, `ThreatSpriteAssets`, `InterceptorSpriteAssets`, `UpgradeProjectileSpriteAssets`, `StaticSpriteAsset`, `PlaneAssets`, `DefenseSiteAssets`, `ExplosionGlowAssets`, `EmpRingAssets`, `EffectSpriteAssets`, `TitleTower`, `SharedLauncherOptions`, `ThreatSpriteKind`, `InterceptorSpriteKind`, `UpgradeProjectileKind`); `TITLE_SKYLINE_TOWERS`; `hash01`; `createSpriteCanvas`; `createStubCanvasContext`; `getLightFlicker`; `drawFlickerWindows`; `getStarTwinkleProfile` | ~280       |
| `art/art-launcher.ts`          | `getLauncherReadyLightAlpha`, `getLauncherChargeAlpha`, `getLauncherMuzzleBlink`, `getLauncherPalette`, `drawLauncherChassisLocal`, `drawLauncherTurretLocal`, `drawLauncherTurretEffectsLocal`, `getLauncherBakeResolution`, `buildLauncherAssets`, `drawBakedLauncher`                                                                                                                                                                                                                                                                                                          | ~430       |
| `art/art-projectiles.ts`       | `getProjectileBakeResolution`, `getProjectileFramePhase`, `buildProjectileSpriteAsset`; the 17 `drawXLocal` functions (default missile, fast, mirv, mirv-warhead, bomb, stack-child, stack-carrier, shahed136, shahed136-dive, shahed238, player-interceptor, f15-interceptor, wild-hornet, roadrunner, patriot-sam); `buildUpgradeProjectileSpriteAssets`, `buildThreatSpriteAssets`, `buildInterceptorSpriteAssets`, `drawBakedProjectileSprite`                                                                                                                                  | ~890       |
| `art/art-effects.ts`           | `buildStaticSpriteAsset`, `buildEffectSpriteAsset`, `drawCenteredRadialGlow`, `buildExplosionGlowAssets`, `buildEmpRingAssets`, `buildEffectSpriteAssets`, `drawBakedStaticSprite`                                                                                                                                                                                                                                                                                                                                                                                              | ~200       |
| `art/art-defense-sites.ts`     | `drawPatriotTELLocal`, `drawPhalanxBaseLocal`, `drawWildHornetsHiveLocal`, `drawRoadrunnerContainerLocal`, `drawFlareDispenserLocal`, `drawEmpEmitterLocal`, `drawF15AirframeLocal`, `buildPlaneAssets`, `buildDefenseSiteAssets`                                                                                                                                                                                                                                                                                                                                               | ~280       |
| `art/art-environment.ts`       | `drawSharedTower`, `mapGameplayBuildingTower`, `buildTowerAssets`, `buildBuildingAssets`, `buildTitleBuildingAssets`, `burjLeftSections`, `burjRightSections`, `burjPath`, `halfWidthsAt`, `toBurjLocalX`, `toBurjLocalY`, `getBurjSpriteBounds`, `getBurjBakeResolution`, `drawBurjStaticSprite`, `drawBurjAnimFrame`, `buildBurjAssets`, `drawStaticBackground`, `drawBakedStars`, `buildSkyAssets`                                                                                                                                                                              | ~940       |

## Phased execution

Each phase is a separate commit. Each phase preserves byte-identical visual output and existing import sites.

### Phase 0 — Capture visual baseline

Goal: pixel-level comparison after each phase.

1. Boot the game and the editor; capture title + first-frame gameplay screenshots:

```bash
npm run dev          # leave running on :5173
npx tsx screenshot-bot.mjs   # if the script supports headless title+wave1, use it
# Otherwise, manually capture two PNGs from the browser:
#  - title screen
#  - first frame after pressing Start
# Save as /tmp/art-baseline-title.png and /tmp/art-baseline-wave1.png
```

2. Run the existing visual test:

```bash
npx playwright test e2e/smoke.spec.ts
```

3. Run the unit tests for art-render:

```bash
npm test -- art-render.test.ts
```

4. **Gate:** all green. Save the screenshots — they are the contract for "no behavior change."

### Phase 1 — Create the barrel + extract `art-core.ts`

Goal: smallest possible move; prove the barrel re-export pattern works.

1. Create `src/art/` directory.
2. Create `src/art/art-core.ts`. Move only:
   - All `interface` and `type` declarations from art-render.ts:21–166.
   - `TITLE_SKYLINE_TOWERS` (line 209).
   - `hash01` (line 211).
   - `createSpriteCanvas` (line 2909) and its `createStubCanvasContext` helper (line 2112).
   - `getLightFlicker` (line 2148).
   - `drawFlickerWindows` (line 2165).
   - `getStarTwinkleProfile` (line 2086).
3. In `art-render.ts`, **replace** the moved declarations with a re-export from `./art/art-core`. Leave everything else untouched.
4. **Verify:**
   - `npm run typecheck` — clean.
   - `npm run lint` — clean.
   - `npm test -- art-render.test.ts` — green.
   - `npm test` — full suite green; same test counts as Phase 0.
   - Re-take title + wave-1 screenshots; visually compare. Pixel-diff with `compare -metric AE /tmp/art-baseline-title.png /tmp/art-after-p1-title.png /tmp/diff.png` if ImageMagick is available; otherwise eyeball.
5. Commit.

### Phase 2 — Extract `art-launcher.ts`

1. Create `src/art/art-launcher.ts`. Move the launcher block (211–640 minus the helpers already moved to core in Phase 1).
2. Replace in `art-render.ts` with `export * from "./art/art-launcher"`.
3. **Verify:** same checklist as Phase 1 plus an explicit screenshot diff of the title (launchers visible) and gameplay (launchers actively firing during a recorded replay).
4. Commit.

### Phase 3 — Extract `art-projectiles.ts`

This is the largest phase by symbol count.

1. Create `src/art/art-projectiles.ts`. Move all 17 projectile drawers + 3 sprite-asset builders + `drawBakedProjectileSprite`.
2. Replace in `art-render.ts` with `export * from "./art/art-projectiles"`.
3. **Verify:**
   - All gates from Phase 1.
   - Run a recorded replay (the one captured in Phase 0) and confirm visual identity for at least one full wave. Save a screenshot mid-wave for the diff.
4. Commit.

### Phase 4 — Extract `art-effects.ts`

1. Create `src/art/art-effects.ts`. Move the glow/ring/effect builders.
2. Replace in `art-render.ts` with `export * from "./art/art-effects"`.
3. **Verify:** same gates plus a screenshot diff that includes an explosion in-frame.
4. Commit.

### Phase 5 — Extract `art-defense-sites.ts`

1. Create `src/art/art-defense-sites.ts`. Move the 7 site drawers + plane assets + `buildDefenseSiteAssets`.
2. Replace in `art-render.ts` with `export * from "./art/art-defense-sites"`.
3. **Verify:** screenshot diff with at least one site and one F-15 visible (e.g., wave 4 with Phalanx purchased).
4. Commit.

### Phase 6 — Extract `art-environment.ts`

The biggest LOC chunk and the most visually complex (Burj geometry).

1. Create `src/art/art-environment.ts`. Move all sky/star/building/tower/Burj symbols.
2. Replace in `art-render.ts` with `export * from "./art/art-environment"`.
3. At this point `art-render.ts` should be ~10 lines: just six barrel re-exports.
4. **Verify:**
   - Title screenshot diff (skyline + Burj prominent).
   - Wave-1 gameplay screenshot diff.
   - Day/night cycle: spot-check a few seconds of replay if star twinkle / tower lights are visible.
5. Commit.

### Phase 7 — Optional barrel removal

Goal: remove the indirection now that the split is stable.

1. Update `src/canvas-render-resources.ts:2,27,43` and `src/art-render.test.ts:13` to import directly from the new `src/art/*` files.
2. Delete `src/art-render.ts`.
3. **Verify:** all gates green. Screenshot diffs unchanged.
4. Commit.

This phase is optional — if you prefer keeping `art-render.ts` as a stable import path for any future external code, skip Phase 7 entirely.

## Failure modes to watch for

- **`createStubCanvasContext` location.** It's defined far from the type interfaces (line 2112) but used by `buildSkyAssets` and others. Check `grep -n createStubCanvasContext src/art-render.ts` before Phase 1 to confirm callers all live in `art-environment.ts` (currently true). If a caller turns out to be elsewhere, the function still goes in `art-core.ts` — the import path just changes.
- **Cross-file private helpers.** Several `getLauncherPalette`, `getProjectileFramePhase` style helpers are private (no `export`). After moving they need to be exported from their new home and imported by their callers — but **ideally they have only one caller in their new module** so they stay private. Check this for each helper before moving. If a helper is called from two future modules, prefer to move it to `art-core.ts` and export it.
- **`TITLE_SKYLINE_TOWERS = [...SCENIC_BUILDING_LAYOUT]`** depends on `SCENIC_BUILDING_LAYOUT` (imported from `game-logic` per the `import` block at the top of art-render.ts). The constant goes in `art-core.ts`; verify the `game-logic` import comes with it.
- **Test file extension quirk.** `art-render.test.ts:13` uses `from "./art-render.js"` (intentional ESM-resolution form for `.ts` files). Preserve the `.js` extension when updating test imports in Phase 7.
- **Visual regressions are silent.** The unit tests mostly check that the bake produces a non-empty canvas with expected dimensions — they don't catch a misdrawn turret. Screenshots are the only real safety net. **Don't skip the screenshot diff at any phase**, especially Phases 2, 3, and 6.

## Rollback

Each phase is one commit + the barrel re-export means consumers never break mid-phase. `git revert <phase-commit>` is clean. If Phase 7 is also done and a regression surfaces later, restoring `art-render.ts` is just a `git revert`.

## Estimated effort

- Phase 0: 20 min (capture baselines).
- Phase 1: 45 min (smallest, but introduces the barrel pattern — get this right).
- Phase 2: 30 min.
- Phase 3: 1 h (largest move).
- Phase 4: 30 min.
- Phase 5: 30 min.
- Phase 6: 1 h (Burj geometry is dense; double-check imports).
- Phase 7 (optional): 20 min.

Total: ~4.5 h elapsed, all reversible per phase.
