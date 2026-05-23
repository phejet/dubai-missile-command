---
name: train-bot
description: Run headless bot training, analyze results, capture replays, and tune Dubai Missile Command bot config and bot brain behavior.
---

# Train Bot

Run headless bot training, analyze results, and tune `src/headless/bot-config.json` (and optionally `src/headless/bot-brain.ts`).

## Run a benchmark

```bash
# Default preset (resolves to "perfect")
npx tsx src/headless/train.ts --games=200 --iterations=5

# Specific preset
npx tsx src/headless/train.ts --games=200 --iterations=3 --preset=good
npx tsx src/headless/train.ts --games=200 --iterations=3 --preset=average
npx tsx src/headless/train.ts --games=200 --iterations=3 --preset=novice
```

Workers default to `min(8, cpus())`; override with `--workers=N`. Each iteration logs to `src/headless/training-log.jsonl` and prints score / wave / efficiency / death-cause aggregates.

The four presets in `bot-config.json` are: `perfect`, `good`, `average`, `novice`. Each preset specifies `upgradePriority` and (for non-`perfect`) a `humanization` block.

## Capture replays for inspection

```bash
# Record best-of-N games as replay JSON
npx tsx src/headless/record.ts [--seed=N] [--tries=1000] [--out=replay.json] [--preset=good]
```

Replays can be played back in the browser by dropping the JSON onto the canvas, or via `node play-replay.mjs <file>` while the dev server is running.

## Inspect leading accuracy

When tuning targeting, watch out for a known failure mode where a bad leading model causes most shots to miss. Useful checks:

- `efficiency` (kills / shots fired) in the train aggregate. `<0.5` for `perfect` preset is suspicious.
- Eyeball replays: are interceptors detonating ahead of, behind, or on top of fast threats?
- `src/headless/bot-brain.test.ts` covers `leadTarget` analytically — extend it when you change the model.

## Verify upgrade priority is current

`src/headless/bot-config.json` `upgradePriority` keys must be valid upgrade family ids from `src/types.ts` `UpgradeKey`. The shop resolves a family id to the next eligible node via `resolveRequestedUpgradeNodeId`, so listing the family is enough to chain through tier 1/2/3 over a run.

Current valid keys: `wildHornets`, `roadrunner`, `flare`, `ironBeam`, `phalanx`, `patriot`, `burjRepair`, `launcherKit`, `emp`.

## Bot-brain anatomy

Key entry points in `src/headless/bot-brain.ts`:

- `leadTarget(...)` — iterative aim solver, accel-aware. Used for missiles + horizontal drones.
- `leadShahed238Target(...)` — waypoint-aware lead for jets (uses path index, not raw vx/vy).
- `botDecideAction(...)` — picks the next fire target each tick. Threats get a priority (0–3) based on type/altitude/diving and are demoted when already covered by an in-flight interceptor.
- `botDecideUpgrades(...)` — returns `{ repairs, priority }`. Repair queue covers destroyed launchers and defense sites; `priority` is the preset's `upgradePriority` (filtered when `burjHealth >= 5`).

EMP firing lives in `sim-runner.ts` (not the brain): triggers when ≥ `emp.minImminentThreats` are below `emp.impactY` and within `emp.impactRadius` of the Burj.

## Iteration loop

1. Capture a baseline (`train.ts`) per preset. Note efficiency and median wave.
2. Record one or two games per preset (`record.ts`) and skim the action log.
3. Adjust `bot-config.json` (and brain code if needed). Keep edits per-iteration small so the cause of any regression is obvious.
4. Re-run, compare deltas, commit if improved.
5. Run unit tests after brain code changes:

   ```bash
   npx vitest run src/headless/
   ```

6. Run a determinism check on a known seed:

   ```bash
   npx tsx src/headless/sim-runner.ts 42
   ```
