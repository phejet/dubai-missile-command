# Dubai Missile Command

Canvas-based missile defense game built with React + Vite.

## Quick Start

```bash
npm install
npm run dev          # starts dev server (usually http://localhost:5173)
npx vite build       # production build to dist/
```

When doing local verification, if you stop the dev server for testing or debugging, start it again before finishing and confirm the local URL.
After implementing a feature or bug fix, proactively check whether the dev server is already running. If it is not running and browser verification could matter, start `npm run dev` yourself and report the active local URL before finishing.

## Browser Smoke Tests

Use the maintained Playwright smoke suite for browser boot/input/shop-flow checks:

```bash
npx playwright test e2e/smoke.spec.ts
```

For the full browser E2E suite:

```bash
npm run test:e2e
```

These tests boot their own production preview server via `playwright.config.ts`, so they do not require `npm run dev` first.

## Running the Bot

The Playwright bot (`play-bot.ts`) auto-plays the game for testing.

```bash
# 1. Start the dev server first
npm run dev

# 2. Run the bot against the active local URL (opens a visible Chromium window)
GAME_URL=http://localhost:5173/dubai-missile-command/ npx tsx play-bot.ts
```

The bot reads game state via `window.__gameRef`, calculates leading shots, prioritizes threats, buys upgrades in the shop, and avoids hitting friendly F-15s.

## Headless Simulation

Run games headlessly for testing and bot tuning.

```bash
# Run a single headless game with determinism check
node src/headless/sim-runner.js [seed]

# Record best game as a replay file
node src/headless/record.js [--seed=N] [--tries=1000] [--out=replay.json]

# Play a replay in the browser (requires dev server running)
node play-replay.mjs replay.json
```

### Bot training

Use the `/train-bot` skill to benchmark and tune the bot. It runs batch games via `src/headless/train.js` and analyzes results to tune `src/headless/bot-config.json`.

### Key files

- `src/game-sim.js` — extracted game loop (spawning, upgrades, auto-systems)
- `src/game-logic.js` — constants, collision, injectable seeded RNG
- `src/replay.js` — replay runner (action-log based deterministic replay)
- `src/headless/sim-runner.js` — headless game runner
- `src/headless/bot-brain.js` — parameterized bot targeting/firing logic
- `src/headless/bot-config.json` — tunable bot parameters
- `src/headless/train.js` — batch training benchmark (multi-worker)
- `src/headless/game-worker.js` — worker thread for parallel game execution

### Replay system

Replays record bot actions (fire coordinates + shop purchases at tick numbers) with a seeded RNG. Drop a `replay.json` onto the game canvas or use `window.__loadReplay(data)` in the console. During replay, the shop UI shows for 2 seconds between waves and a toast displays what the bot purchased.

## Architecture

Current runtime architecture is split across:

- `src/game-sim.ts` — simulation and gameplay state mutation
- `src/art-render.ts` — shared art primitives and prebaked sprite generation
- `src/game-render.ts` — frame composition and render-time asset caching
- `src/game.ts` — runtime controller that advances sim and calls renderers

Start with [`docs/README.md`](./docs/README.md) for the current documentation map.
Focused breakdowns:

- [`docs/render-split-analysis.md`](./docs/render-split-analysis.md)
- [`docs/runtime-controller.md`](./docs/runtime-controller.md)
- [`docs/game-state-contract.md`](./docs/game-state-contract.md)
- [`docs/spawn-commander-reference.md`](./docs/spawn-commander-reference.md)
- [`docs/upgrades-shop-progression.md`](./docs/upgrades-shop-progression.md)
- [`docs/replay-system.md`](./docs/replay-system.md)
- [`docs/headless-bot-workflow.md`](./docs/headless-bot-workflow.md)

### Key constants

- `CANVAS_W=900`, `CANVAS_H=1600`, `GROUND_Y=1530`
- `BURJ_X=460`, `BURJ_H=340`
- `LAUNCHERS` at x: 60, 560, 860

### Game state (`gameRef.current`)

- `missiles`, `drones`, `interceptors`, `explosions`, `particles`, `planes`
- `defenseSites[]` — physical upgrade structures enemies can destroy
- `launcherHP[3]` — each launcher starts with 1 HP (upgradable to 2 with Launcher Kit L2), destroyed = can't fire
- `upgrades{}` — wildHornets, roadrunner, flare, ironBeam, phalanx, patriot, burjRepair, launcherKit, emp
- `stats{}` — missileKills, droneKills, shotsFired (shown on game over)

### Targeting system (`pickTarget`)

- 30% chance enemies target Burj directly
- Otherwise, targets defense sites and alive launchers; picks closest-to-missile-spawn 70% of the time, second-closest 30%
- Top-spawning missiles within 200px of their target are offset 300-500px for interceptable angles

### Upgrade systems

| Upgrade         | What it does                                          |
| --------------- | ----------------------------------------------------- |
| Wild Hornets    | FPV kamikaze drones that auto-track threats           |
| Roadrunner      | AI-guided vertical-launch interceptors                |
| Decoy Flares    | Burj launches IR decoys that lure missiles off course |
| Iron Beam       | Laser burns down threats near Burj                    |
| Phalanx CIWS    | Rapid-fire autocannon turrets                         |
| Patriot Battery | Long-range SAM with massive blast radius              |
| Launcher Kit    | Upgrades launcher HP and ammo capacity                |
| EMP Shockwave   | Charged area-of-effect pulse that damages all threats |
| Burj Repair Kit | Consumable that restores 1 Burj HP                    |

### F-15 Eagles

Friendly fighter jets that fly across screen and shoot down threats. Only direct interceptor hits (not splash damage) can destroy F-15s, penalizing -500 points.

## iOS Build (Capacitor)

Capacitor is already configured. To build and open in Xcode:

```bash
npm run ios    # builds with CAPACITOR=1, syncs to ios/, opens Xcode
```

This runs three steps in sequence:

1. `npm run build:ios` — Vite production build with `CAPACITOR=1` env flag
2. `npm run cap:sync` — copies `dist/` into `ios/App/App/public` and updates plugins
3. `npm run cap:open` — opens the Xcode workspace

From Xcode, select a simulator or device and hit Run.

## Perf Benchmarking

Use the maintained perf harness for replay-driven renderer baselines.

1. Start the LAN dev server:

```bash
npm run dev:lan -- --port 5173 --strictPort
```

The iPhone perf workflow assumes port `5173`. If Vite silently drifts to `5174+`, the live-reload shell and bench helper can end up pointing at the wrong place.

2. Create `.env.local` from `.env.local.example` and fill in:

```bash
MAC_HOSTNAME=YourMacHostName
IPHONE_UDID=00000000-0000000000000000
BUNDLE_ID=com.phejet.dubaicmd
# optional pinned baseline root for compare output
PERF_BASELINE_DIR=perf-results/baselines/<buildId>
```

`MAC_HOSTNAME` can be a LocalHostName such as `MyMac`, or a literal LAN IP if `.local` mDNS is blocked on the network.

3. Install the iPhone build you want to measure:

```bash
npm run ios:dev   # Live Reload build pointed at http://<host>:5173
npm run ios:prod  # static production build; this is the PR metric
```

If mDNS is blocked, run the sync/open step manually with an IP-based dev server URL:

```bash
CAP_DEV_SERVER=http://192.168.1.23:5173 npm run cap:sync && npm run cap:open
```

4. Run the iPhone harness from the Mac:

```bash
scripts/bench.sh perf-wave1
scripts/bench.sh perf-wave4-upgrades --warmup 1 --loop 3
scripts/bench.sh --list-devices
```

Current iPhone perf flow:

- `scripts/bench.sh` probes `http://<host>:5173/api/save-perf`.
- It posts the next benchmark request to `http://<host>:5173/api/perf-command`.
- It activates the installed app with `xcrun devicectl`.
- The live-reload iPhone shell polls `/api/perf-command`, starts the replay from whatever screen the app is already on, uploads to `/api/save-perf`, and leaves the perf summary visible on-screen after completion.
- The matching report is written under `perf-results/runs/<buildId>/...`, copied to `perf-results/latest/<replay>.json`, and compared against `PERF_BASELINE_DIR` when configured.

Important findings from the iPhone perf investigation:

- Warm `xcrun devicectl --payload-url ...` delivery was unreliable for reruns when the app was already open. Cold-start deep links work because `AppDelegate.swift` forwards the URL from `argv`, but repeat benchmark runs should now go through `/api/perf-command` instead of relying on warm deep-link delivery.
- The live-reload shell must be synced against the LAN server you actually intend to use. After JS/runtime changes, rebuild and resync before trusting device behavior:

```bash
npm run build:ios
npm run cap:sync
```

- A typo in the sink URL produces the classic red `NOT FOUND` banner. The valid save route is exactly `/api/save-perf`; `api/save-perfD` or any other variation will replay fine but never hit the save middleware.
- If the app never reaches the Mac during a run, `npm run dev:lan` will show no `[perf-save]` lines. That means the phone did not POST to `/api/save-perf`, regardless of what the on-device replay looked like.
- If `.local` name resolution is flaky on the network, use a literal LAN IP for `CAP_DEV_SERVER` and for any manual `perfSink` URLs.

5. Capture the desktop baseline separately with the browser smoke harness:

```bash
npm run perf:smoke -- perf-wave1 http://127.0.0.1:5173/
npm run perf:smoke -- perf-wave4-upgrades http://127.0.0.1:5173/
```

When benchmark replays change because the sim changed, re-record the fixtures first, then recapture both desktop and iPhone baselines and commit the new median artifacts under `perf-results/baselines/<buildId>/`.

## Deployment

GitHub Pages via Actions workflow (`.github/workflows/deploy.yml`). Pushes to `main` auto-deploy to https://phejet.github.io/dubai-missile-command/
