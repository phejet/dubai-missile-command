# Browser replay: zero shots in wave 2 — resolved postmortem

## Resolution

Fixed by commit `b741a2c` (`Fix replay stale action draining`).

The replay runner now drains actions whose recorded ticks are already behind the current replay tick instead of requiring exact tick equality. That lets stale same-tick markers like `wave_plan@562` advance after realtime browser pauses shift the runner to tick 563.

## Symptom

When playing back a recorded replay in the browser via `__loadReplay(...)`, wave 1 plays normally but wave 2 fires zero shots. Bot dies in wave 2 from total inactivity.

Reproduction: replay `/tmp/avg-typical.json` (seed 57, preset `average`, draft mode, 1097 actions / 85 fires across 5 waves).

## What's confirmed

### Recording is honest

Three independent paths agree on the original outcome (wave 5 / score 7862 / 85 shots / 21 fires in wave 2):

| Path                                                        | Wave | Score | Shots | W2 fires |
| ----------------------------------------------------------- | ---: | ----: | ----: | -------: |
| Original headless `runGame` recording (seed 57, avg preset) |    5 | 7,862 |    85 |       21 |
| Headless rerun (brain re-decides)                           |    5 | 7,862 |    85 |       21 |
| Headless action-log replay via `createReplayRunner`         |    5 | 7,862 |    85 |       21 |
| **Browser headed replay**                                   |    2 | (low) |    13 |    **0** |

So the desync is entirely on the browser side. The shared `createReplayRunner` works fine when driven by the headless loop.

### Wave 1 → wave 2 transition tick observation (browser headed poll)

```
@4.75s tick=562 state=playing wave=1 shots=13  bonusS=true  bonusD=false
@7.17s tick=563 state=shop    wave=1 shots=13  bonusS=true  bonusD=true
@8.15s tick=565 state=playing wave=2 shots=13   ← shop closed, replay continues
@8.42s tick=596 state=playing wave=2 shots=13   ← past expected fire at tick 605
@...   tick=1394 state=gameover ... shots=13    ← never fires another shot
```

vs. headless replay (same JSON):

```
STATE CHANGE @tick=562 playing->shop
SHOP PAUSED at tick=562 wave=1
SHOP RESUMED at tick=562 wave=2
shot fired @tick=606 wave=2 shots=13->14    ← fires normally
```

Note: **headless never enters bonus pause** for this replay. Browser does.

### Replay structure around the boundary

At tick 562 there are _two_ zero-tick-gap actions in the recording: the `shop` purchase, immediately followed by the `wave_plan` marker for wave 2. Wave 2 fires start at tick 605.

```json
{ tick: 562, type: "shop",      bought: ["launcherArmorKit"] }
{ tick: 562, type: "wave_plan", wave: 2 }
{ tick: 605, type: "fire", x: ..., y: ... }
```

## Root cause

`createReplayRunner.step()` only processed actions where `actions[actionIdx].tick === tick` (strict equality). It never advanced past actions whose tick was already behind the current tick.

**Browser path**:

1. Wave 1 completes. `update()` sets `g._bonusScreenStarted=true` inside `step()`. `step()` then increments `tick` from 561→562 and returns with `bonusPaused=true`.
2. Bonus screen UI shows for ~500ms (auto-complete). RAF loop spins but does not call `step()`. Tick stays at 562.
3. `_bonusScreenDone=true` → `resumeFromBonusScreen()`.
4. Next `step()`: `update()` opens shop (`g.state="shop"`), `tick++` to 563, return.
5. Next `step()`: shop branch finds `shop@562`, `actionIdx++` past it (now points at `wave_plan@562`), `tick = Math.max(563, 562) = 563`, pauses.
6. After 1000ms, `resumeFromShop()` closes shop, sets `state="playing"`.
7. Next `step()`: `tick=563`. Check `actions[actionIdx].tick === 563` → `wave_plan@562 === 563` is **false**. Exit fire-action loop. `update()`, `tick++` → 564. Repeat.
8. `actionIdx` is now **permanently stuck** on `wave_plan@562` because every subsequent tick is `> 562`, so the strict-equality match never fires. All wave 2 fires sit behind a wave_plan that never gets advanced past.

**Headless path** (same code, works because):

- The test loop's `if (isBonusPaused) { _bonusScreenDone=true; resumeFromBonusScreen(); continue }` collapses the bonus pause into a single iteration. No real-time elapses, no extra step() between bonus done and shop open. The shop pause therefore triggers at tick **562**, not 563. After resume, the next `step()` runs at tick 562, matches `wave_plan@562`, advances `actionIdx`, then proceeds.

The browser path's extra `step()` between bonus end and shop open is what pushes tick one ahead of the wave_plan marker, leaving it permanently orphaned and blocking the action queue.

## Files / lines of interest

- `src/replay.ts` — stale action draining in the replay action loop.
- `src/game.ts` — browser RAF replay branch runs one `step()` per RAF and can introduce realtime pause gaps.
- `src/game-sim.ts` — wave-complete → bonus screen → shop open transition.

## Fix

The accepted fix was to relax replay action processing from exact tick equality to `<= tick` for non-shop actions. Stale markers get drained instead of jamming the queue, while shop actions still pause at the correct boundary.

This was the most surgical option: stale ticks should not gate future ticks.

## Repro commands

```bash
# Capture a typical average-preset game (seed 57)
npx tsx -e '
import { writeFileSync } from "fs";
import { runGame } from "./src/headless/sim-runner.js";
const r = runGame(null, { seed: 57, preset: "average", record: true, draftMode: true });
writeFileSync("/tmp/avg-typical.json", JSON.stringify({
  seed: 57, actions: r.actions, draftMode: true, preset: "average",
}));
console.log(`wave=${r.wave} score=${r.score} actions=${r.actions.length}`);
'

# Focused replay regression
npx vitest run src/replay.test.ts

# Browser replay smoke
npx playwright test e2e/replay.spec.ts
```
