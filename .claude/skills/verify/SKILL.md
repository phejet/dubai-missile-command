---
name: verify
description: Verify gameplay/sim changes by driving the real game in a headless browser and via the headless sim CLI.
---

# Verifying gameplay changes in the browser

## Launch

```bash
npm run dev   # background; URL: http://localhost:5173/dubai-missile-command/
```

Drive with Playwright using the pre-installed Chromium (remote env has no downloaded browsers):

```ts
const browser = await chromium.launch({ headless: true, executablePath: "/opt/pw-browsers/chromium" });
```

Run the script from the repo root (e.g. `npx tsx .verify-x.tmp.ts`) so `playwright` resolves; scripts outside the repo hit MODULE_NOT_FOUND.

## Drive

- Start a run by clicking the `Start Defense` button (fallback: click the canvas).
- Full live game state is at `window.__gameRef.current` (`state`, `burjHealth`, `missiles`, `drones`, `explosions`, ...). Mutate it freely from `page.evaluate` to stage scenarios — e.g. push a missile object shaped like the ones in `src/game-sim.ts` (`_hitByExplosions: new Set()` required).
- Clearing `g.missiles`/`g.drones`/`g.schedule` completes the wave and opens the shop, which pauses the sim. To keep the sim in `playing` while testing, hold the wave open instead: `g.schedule = [{ type: "missile", tick: 999999 }]; g.scheduleIdx = 0;`
- Gameplay-space anchors: `BURJ_X=460`, scenic ground ≈ y 1410, waterline ≈ y 1418, Burj body spans y ≈ 664–1404 at art scale 2.

## Headless sim surface

`npx tsx src/headless/sim-runner.ts <seed>` runs a full bot game and a determinism check — good smoke for sim-side changes (score/wave/death cause printed).

## Gotchas

- The golden-seed canary in `src/headless/sim-runner.test.ts` asserts exact score for seed 42; any sim/balance change requires regenerating it (`runGame(null, { seed: 42, maxTicks: 5000, draftMode: true })`).
- Sim changes invalidate recorded replays and perf fixtures (`perf-results/`); re-record before trusting perf comparisons.
