# Spawn Commander Reference

`src/wave-spawner.ts` is the wave planning layer. It turns a wave number plus commander history into a deterministic spawn schedule.

## Main API

- `getWaveConfig(wave)`
- `createCommander(style)`
- `commanderPickTactics(commander, wave)`
- `generateWaveSchedule(wave, commander)`
- `computeAliveThreatValue(g)`
- `advanceSpawnSchedule(g, dt, spawnFn)`
- `isWaveFullySpawned(g)`

## Threat Value Budget

The planner works in threat-value units, not just raw counts.

Current values:

- `missile`: `1.5`
- `drone136`: `1`
- `drone238`: `2.5`
- `mirv`: `3`
- `stack2`: `3`
- `stack3`: `4.5`

`generateWaveSchedule()` starts by picking counts per type inside configured min/max ranges, then clamps the result back down to the wave budget by reducing the highest-value types first.

## Wave Config Model

### Waves 1-8

Waves 1-8 come from the explicit `WAVE_TABLE`.

Each row defines:

- `budget`
- `cap`
- min/max ranges per spawn type

### Waves 9+

Later waves use formulas:

- budget: `105 + w*40 + w*w*8` where `w = wave - 8`
- configured cap: `35 + w*10 + w*w*2`

Those formulas are intentionally steep to keep late pressure rising.

## Commander Styles

Supported styles:

- `balanced`
- `aggressive`
- `methodical`
- `adaptive`

Styles do not hard-code tactics directly. They bias tactic categories with weights:

- `direction`
- `altitude`
- `formation`
- `special`

## Tactic Selection

`commanderPickTactics()`:

- unlocks tactics by wave
- applies style weights
- optionally downweights or excludes recently used tactics
- picks 1 tactic on waves 3-4
- picks 1 or 2 tactics on wave 5+
- resolves excluded combinations such as `LEFT_FLANK + RIGHT_FLANK -> PINCER`

Special style behavior:

- `adaptive` excludes tactics used in the last 2 waves
- `methodical` deprioritizes recently used direction tactics

Commander history is appended once a wave schedule is generated.

## Tactic Effects

Some tactics directly change spawn overrides:

- `LEFT_FLANK`
- `RIGHT_FLANK`
- `PINCER`
- `TOP_BARRAGE`
- `LOW_APPROACH`
- `HIGH_APPROACH`

Other tactics change schedule timing or composition behavior:

- `DRONE_SWARM` compresses drone intervals
- `MISSILE_RAIN` compresses missile intervals
- `MIRV_STRIKE` pushes MIRVs earlier
- `MIXED_AXIS` forces drones from one side and missiles from above

## Schedule Generation

`generateWaveSchedule()` does four main things:

1. pick type counts inside min/max ranges
2. clamp total threat value back to budget
3. generate jittered tick lists per type
4. sort all entries and attach per-entry overrides

The output is:

- `schedule: SpawnEntry[]`
- `concurrentCap`
- `tactics`

Fast late-wave variants are represented as spawn overrides, not new spawn types:

- `variant: "fast"`
- `speedMul`

The spawned missile or drone keeps those fields so the simulation can move it faster and the renderer can draw hotter trails/accent glows.

## Spawn Tick Logic

Missiles, drones, MIRVs, and stacked missiles use different tick spacing.

Notable details:

- missile/drone intervals have late-wave floors
- spacing uses jitter, so schedules are deterministic per RNG seed but not perfectly uniform
- MIRVs are distributed across the same overall time span as the rest of the wave

## Runtime Advancement

`advanceSpawnSchedule()` is what the sim calls every tick.

It:

- looks at `schedule[scheduleIdx]`
- stops if the next entry is not due yet
- stops if spawning the next entry would push alive threat value over `concurrentCap`
- spawns the next entry through `spawnFn(...)`
- increments `scheduleIdx`
- increments `waveTick`

`isWaveFullySpawned()` only checks that the schedule has been exhausted. It does not check whether existing threats are dead.

## Effective Concurrent Cap

`generateWaveSchedule()` returns the configured concurrent cap from `getWaveConfig()`. `SATURATION` can raise it modestly for that wave, but it remains capped well below the full wave budget.

Schedules are split into attack groups with short tick gaps between groups. Those lulls are intentional: they give the player room to reload and recover without lowering the total wave budget.

## Practical Rules

- If you add a new spawn type, update `THREAT_VALUES`, type ranges, schedule generation, and alive-value accounting together.
- If you tune wave pressure, check both the budget logic and the effective concurrent cap path.
- If you change tactic availability or exclusion rules, verify commander history interactions and replay wave-plan logging.
