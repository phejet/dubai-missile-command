# Game State Contract

`GameState` in `src/types.ts` is the central shared contract between sim, runtime controller, replay, render, bot logic, and editor tooling.

## Ownership Rule Of Thumb

- `src/game-sim.ts` owns authoritative gameplay state and most mutations.
- `src/game.ts` owns browser/runtime-only fields and some replay bookkeeping.
- `src/game-render.ts` mostly reads state; interpolation helpers temporarily rewrite positions for drawing.
- Headless bot code reads the same state and attaches a few bot-only fields.

## Main Field Groups

## Core Run State

- `state`
- `score`
- `wave`
- `stats`
- `time`
- `waveComplete`

These are the top-level values most systems care about.

## Player Launchers

- `ammo`
- `launcherHP`
- `launcherFireTick`
- `launcherReloadUntilTick`
- `crosshairX`
- `crosshairY`

Invariants:

- these are always 3-element tuples
- index `0..2` maps directly to `LAUNCHERS`
- player burst capacity is controlled by the runtime fire limiter; Double Magazine doubles that burst pool rather than per-wave ammo

## Active Combat Arrays

- `missiles`
- `drones`
- `interceptors`
- `explosions`
- `particles`
- `planes`

Auto-defense arrays:

- `hornets`
- `roadrunners`
- `laserBeams`
- `phalanxBullets`
- `patriotMissiles`
- `flares`
- `empRings`

These arrays are sim-owned and render-consumed.

## Scenic And Damage State

- `buildings`
- `buildingDestroyFx`
- `stars`
- `burjAlive`
- `burjHealth`
- `burjDecals`
- `burjDamageFx`
- `burjHitFlashTimer`
- `burjHitFlashMax`
- `burjHitFlashX`
- `burjHitFlashY`
- `shakeTimer`
- `shakeIntensity`

Some of these are gameplay-visible and some exist mainly to support presentation.

## Upgrade And Meta State

- `upgrades`
- `ownedUpgradeNodes`
- `metaProgression`
- `defenseSites`

Important rule:

- `ownedUpgradeNodes` is the real progression source of truth.
- `upgrades` is a derived runtime summary, except `burjRepair` which is maintained separately.

## Wave Commander State

- `commander`
- `schedule`
- `scheduleIdx`
- `waveTick`
- `concurrentCap`
- `waveTactics`

These fields back the spawn-commander system. They are advanced every sim tick and reinitialized on wave transitions.

## Timers For Auto Systems

- `planeTimer`
- `planeInterval`
- `hornetTimer`
- `roadrunnerTimer`
- `ironBeamTimer`
- `phalanxTimer`
- `patriotTimer`
- `flareTimer`
- `nextFlareId`
- `empCharge`
- `empChargeMax`
- `empReady`

These timers belong to sim, but the HUD and bot logic read some of them.

## Draft / Shop / Bonus Runtime Fields

- `_draftMode`
- `_draftOffers`
- `_bonusScreenStarted`
- `_bonusScreenDone`
- `_waveStartMissileKills`
- `_waveStartDroneKills`

These are runtime helpers, not durable save data.

## Replay / Recording Fields

- `_gameSeed`
- `_actionLog`
- `_replayTick`
- `_replayCheckpoints`
- `_replayCheckpointLastTick`
- `_replayCheckpointLastHash`
- `_replay`
- `_replayIsHuman`
- `_replayShopBought`
- `_replayShopTimer`
- `_purchaseToast`

Important rule:

- the replay format is `ReplayData`, not a serialized full `GameState`
- checkpoints are for debugging/determinism checks, not for authoritative playback

## Browser / Controller Fields

- `_showColliders`
- `_showUpgradeRanges`
- `_editorMode`
- `_lowAmmoTimer`
- `_rafDeltaMs`
- `_rafFps`
- `_fpsFrames`
- `_fpsAccum`
- `_fpsDisplay`
- `_timeAccum`

These are controller- or tooling-owned values layered onto the gameplay state object.

## Audio / Handle Fields

- `_laserHandle`
- `_browserLaserHandle`

These are runtime handles and must never be treated as serializable game state.

## Bot-Only Fields

- `_botHumanState`
- `_botTargetReservations` on the broader runtime object shape used by headless bot code

These exist only because the bot shares the same state object.

## Per-Entity Scratch Fields

Several entity types carry render/interpolation scratch fields:

- `_px`, `_py`
- `_ox`, `_oy`
- `_pcx`, `_pcy`
- `_ocx`, `_ocy`

Those are temporary interpolation fields. They should not be relied on for gameplay logic and should not be persisted.

## Practical Rules

- If a field starts with `_`, assume it is runtime-only unless a specific doc says otherwise.
- If you need to persist upgrade ownership, persist `ownedUpgradeNodes` or progression state, not `upgrades` alone.
- If you need deterministic playback, serialize `ReplayData`, not `GameState`.
- If you add a new combat entity, check render, replay checkpointing, headless bot logic, and interpolation helpers.
