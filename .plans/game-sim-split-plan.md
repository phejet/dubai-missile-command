# Plan: Split `src/game-sim.ts` (2358 LOC) into focused modules

## Context

`src/game-sim.ts` has accreted into a 2358-line file that mixes six distinct concerns:

1. Threat spawning (missiles, drones, MIRV, planes) and the geometry helpers that pick spawn coordinates / targets.
2. Targeting helpers for every auto-defense weapon (hornets, roadrunner, patriot, phalanx, flares).
3. The 500+ LOC `updateAutoSystems` function (game-sim.ts:912–1430) which fires all seven weapon systems each tick.
4. Per-entity physics + collision (`updateMissiles` 1434–1628, `updateDrones` 1630–1853, `updateInterceptors` 1854–1907, `updateExplosions` 1908–2018, `updatePlanes` 2019–2100).
5. The top-level tick orchestrator `update` (2101–2278) and `fireEmp` (2279–2300).
6. Snapshot serialization for render interpolation + the `createGameSim` factory (2301–2356).

External consumers are small and stable:

- `src/game.ts:37` imports `initGame`, `update`, `createGameSim`, plus a few spawn helpers.
- `src/replay.ts:11` imports the same surface for replay determinism.
- `src/replay-bootstrap.ts:1`, `src/debug-starts.ts:1` re-export shop wrappers.
- `src/headless/sim-runner.ts:2` imports `initGame, update, buyUpgrade, buyDraftUpgrade, closeShop, fireEmp`.
- `game-sim.ts:2358` re-exports `buyUpgrade, buyDraftUpgrade, closeShop, draftPick3, repairLauncher, repairSite` from `./game-sim-shop`.

The file's public API is **small**. Internal structure is what's overgrown.

## Goal

End state: `game-sim.ts` shrinks to ~700–900 LOC orchestrator. Three new sibling files take the bulk. **Public import surface unchanged.** No behavior changes. Tests + replays + e2e all green.

## Non-goals

- No simulation behavior change. No tuning. No rename of public exports.
- No de-duplication of flare-lure logic (the separate `applyFlareLure` extraction is finding **F** in the review and is intentionally deferred so it lands in its own diff).
- No move of `game-sim-shop.ts` or `game-sim-upgrades.ts` — those are already well-factored.

## Proposed split

| New file                       | Source range in game-sim.ts                          | Approx LOC |
| ------------------------------ | ---------------------------------------------------- | ---------- |
| `src/sim/threat-spawner.ts`    | 223–612 (spawn helpers + 6 spawn entry points)       | ~400       |
| `src/sim/auto-defense.ts`      | 614–1432 (target pickers + entire `updateAutoSystems`) | ~820     |
| `src/sim/threat-update.ts`     | 1434–1853 (`updateMissiles` + `updateDrones`)        | ~420       |
| `src/game-sim.ts` (remaining)  | 1–222, 1854–2356 (orchestrator + interceptors/explosions/planes + snapshot/factory) | ~700 |

Why these three boundaries and not, say, "one file per weapon":

- **threat-spawner** is everything that creates a new threat. It's stateless w.r.t. the rest of the sim — it reads `g.missiles`, `g.drones`, `LAUNCHERS`, etc., and pushes new entities. Clean cut.
- **auto-defense** is everything that picks a target and fires a friendly weapon. The pickers (`pickHornetTarget`, `pickPatriotTargets`, etc.) are only called from `updateAutoSystems`; moving them together prevents re-importing.
- **threat-update** is the two physics/collision routines that share the lure-flare and EMP-stagger logic. They're the longest sibling pair in the file. Splitting them later (when finding **F** lands the shared `applyFlareLure`) is easy.
- Interceptor / explosion / plane updates are short and tightly coupled to the orchestrator's event emission; leaving them in `game-sim.ts` keeps the diff smaller.

## Phased execution

Each phase is a separate commit. Each phase ends with a green gate.

### Phase 0 — Snapshot the current behavior

Goal: build a tripwire that catches accidental behavior change.

1. Run the deterministic seeds and record both the spawn-schedule output and a full replay-to-completion. The intent is to be able to byte-compare these after each phase.

```bash
npx tsx src/headless/sim-runner.ts 1 > /tmp/sim-1-before.txt
npx tsx src/headless/sim-runner.ts 42 > /tmp/sim-42-before.txt
node src/headless/record.js --seed=1 --tries=50 --out=/tmp/replay-1-before.json
```

2. Capture baseline test counts:

```bash
npm test 2>&1 | tail -20    # record file count + test count
npx playwright test e2e/replay.spec.ts e2e/smoke.spec.ts
```

3. **Gate:** all green. Note the test counts — they must not change across the refactor.

### Phase 1 — Extract `threat-spawner.ts`

Goal: smallest, lowest-risk move. No control-flow changes.

1. Create `src/sim/threat-spawner.ts`.
2. Move these symbols (preserve order, comments, types):
   - Helpers: `wrapAngle`, `missileTargetCandidates`, `isMissileAnglePlayable`, `resolveMissileApproach`, `pickSeparatedSpawnY`, `getSplitCandidateTargets`, `pickSplitTargetsWide`, `getShahed136LevelFlightYRange`.
   - Public spawners: `spawnMirv`, `spawnMirvWithOverrides` (private), `spawnPlane`, `spawnMissile`, `spawnStackedMissile`, `spawnDroneOfType`, `spawnDrone`.
3. In `game-sim.ts`, replace the moved bodies with a re-export so external import sites don't change:

```ts
export { spawnMissile, spawnStackedMissile, spawnDroneOfType, spawnDrone, spawnMirv, spawnPlane }
  from "./sim/threat-spawner";
```

4. `game-sim.ts` itself imports any spawners it still calls directly.
5. **Verify:**
   - `npm run typecheck` — no new errors.
   - `npm run lint` — no new errors.
   - `npm test` — same file/test count as Phase 0; all green.
   - `npx tsx src/headless/sim-runner.ts 1 > /tmp/sim-1-after.txt && diff /tmp/sim-1-before.txt /tmp/sim-1-after.txt` — empty diff.
   - Same for seed 42.
   - `npx playwright test e2e/replay.spec.ts e2e/smoke.spec.ts` — green.
6. Commit.

### Phase 2 — Extract `auto-defense.ts`

Goal: move the largest function and its helpers.

1. Create `src/sim/auto-defense.ts`.
2. Move:
   - Type-internal helpers: `isSiteAlive`, `isThreatDamaged`, `getNearestThreatDistance`, `getSpreadBonus`.
   - Hornet pickers: `getHornetAssignmentCounts`, `hornetTargetScore`, `pickHornetTarget`, `pickHornetLaunchTargets`, `pickHornetRetargetTarget`.
   - Roadrunner pickers: `roadrunnerThreatScore`, `pickRoadrunnerTargets`.
   - Patriot pickers: `patriotTargetPriority`, `pickPatriotTargets`.
   - Flare helpers: `normalizeAngle`, `isFlareMissileTarget`, `getLiveFlare`, `steerTowardPoint`, `detonateFlare`, `launchFlareBurst`.
   - The big one: `updateAutoSystems` (912–1432).
3. Re-export `updateAutoSystems` from `game-sim.ts` (it's currently exported and may be referenced — leave the re-export in place so `headless/sim-runner.ts` and any future callers don't break).
4. **Tricky bit — flare helpers are used by `updateMissiles` and `updateDrones` too** (see game-sim.ts:1443, 1652 — `getLiveFlare`, `steerTowardPoint`, `detonateFlare`). After the move, these need to be imported by Phase 3's `threat-update.ts`. To keep Phase 2 self-contained, also export `getLiveFlare`, `steerTowardPoint`, `detonateFlare` from `auto-defense.ts` (don't re-export from `game-sim.ts` — that would imply they're public).
5. **Verify:** same checklist as Phase 1. Diff the sim-runner output for two seeds — must be byte-identical.
6. Commit.

### Phase 3 — Extract `threat-update.ts`

Goal: move `updateMissiles` and `updateDrones`.

1. Create `src/sim/threat-update.ts`.
2. Move:
   - `updateMissiles` (1434–1628).
   - `updateDrones` (1630–1853).
3. These import the flare helpers exposed in Phase 2 (`getLiveFlare`, `steerTowardPoint`, `detonateFlare`).
4. They're called only by the orchestrator `update` (game-sim.ts:2101). They aren't currently `export`ed, so no public surface changes — just import them locally in `game-sim.ts`.
5. **Verify:** same checklist as Phase 1. Run the byte-diff on two seeds.
6. Commit.

### Phase 4 — Verify and document

1. Re-run the full gate:

```bash
npm run typecheck
npm run lint
npm test
npx playwright test e2e/replay.spec.ts e2e/smoke.spec.ts
npx tsx src/headless/sim-runner.ts 1 | diff - /tmp/sim-1-before.txt
npx tsx src/headless/sim-runner.ts 42 | diff - /tmp/sim-42-before.txt
```

2. Replay the recorded `replay-1-before.json` (in the browser via `window.__loadReplay`) and confirm it still completes deterministically.
3. Update `CLAUDE.md`'s "Architecture" section to list the three new files under `src/sim/`.
4. Update `docs/game-state-contract.md` if it mentions specific game-sim line numbers.
5. Commit doc changes.

## Failure modes to watch for

- **Hidden mutation order.** `updateAutoSystems` modifies `g.hornets`, `g.roadrunners`, etc. before `updateMissiles` runs. The orchestrator at game-sim.ts:2101 calls them in a specific order — preserve it exactly.
- **RNG sequencing.** Anything that calls `g.rand()` must be moved without changing the call order, or replays will desync. The byte-diff of two seeds is the canonical check; don't skip it.
- **Closures over private state.** If a moved function references a module-scoped `let` (none should exist — verify via grep), that closure breaks across files. `grep -n "^let\|^const " src/game-sim.ts | grep -v "^const [A-Z_]"` finds candidates.
- **Test imports.** `src/game-sim.test.ts` may import internal helpers via `./game-sim`. After each phase, re-run `npm test` and look at any failure — most likely it'll be a missing re-export.

## Rollback

Each phase is one commit. `git revert <phase-commit>` undoes it cleanly. The byte-diff on `sim-runner` output is the early warning — if a phase produces a different output, revert and re-investigate before proceeding.

## Estimated effort

- Phase 0: 15 min (record baselines, commit nothing).
- Phase 1: 45 min including verification.
- Phase 2: 1.5 h (largest move; flare-helper export needs care).
- Phase 3: 30 min.
- Phase 4: 15 min.

Total: ~3.5 h elapsed, all reversible per phase.
