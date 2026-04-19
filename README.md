# Dubai Missile Command

[![Build](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-build.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-build.yml)
[![Lint](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-lint.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-lint.yml)
[![Format](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-format.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-format.yml)
[![Tests](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-test.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-test.yml)
[![E2E Tests](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-e2e.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci-e2e.yml)
[![Deploy](https://github.com/phejet/dubai-missile-command/actions/workflows/deploy.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/deploy.yml)

A retro-inspired missile defense game set in Dubai. Defend Burj Khalifa from waves of ballistic missiles and Shahed drones. Built with TypeScript + Canvas, with a React-based internal editor and a Capacitor iOS wrapper.

**[Play Now](https://phejet.github.io/dubai-missile-command/)** · **[Editor](https://phejet.github.io/dubai-missile-command/editor.html)**

## Gameplay

- Click to launch interceptors from ground launchers
- Destroy incoming missiles and kamikaze drones
- Earn score to buy automated defense systems between waves
- Protect the Burj Khalifa at all costs

### Defense Systems

| Upgrade         | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| Wild Hornets    | Ukrainian FPV drone swarm — autonomous kamikaze interceptors |
| Roadrunner      | Anduril AI-guided vertical-launch interceptors               |
| Decoy Flares    | IR decoys launched from Burj that lure missiles off course   |
| Iron Beam       | High-energy laser that burns down nearby threats             |
| Phalanx CIWS    | Rapid-fire close-in autocannon turrets                       |
| Patriot Battery | Long-range SAM with massive blast radius                     |

### F-15 Eagles

Friendly fighter jets periodically fly across the battlefield, shooting down threats. Avoid hitting them — friendly fire costs -500 score.

## Development

```bash
npm install
npm run dev       # start dev server
npm run build     # production build
npm run build:ios # iOS/Capacitor-friendly build with relative asset paths
npm run lint      # run ESLint
npm run format    # run Prettier (auto-fix)
```

### iPhone App

The repo now includes a Capacitor iOS project under `ios/App/`.

```bash
# Build web assets for Capacitor
npm run build:ios

# Sync web assets into the native iOS project
npx cap sync ios

# Open the Xcode project
npx cap open ios
```

In Xcode:

- Select a simulator or connected iPhone
- Enable `Automatically manage signing`
- Choose your Apple developer team
- Press Run

The iOS project uses Swift Package Manager. CocoaPods is not required in the current setup.

### Perf Benchmarking

The replay-driven perf harness measures the current renderer on desktop Chromium and on an installed iPhone build.

1. Start the LAN dev server:

```bash
npm run dev:lan
```

2. Create `.env.local` from `.env.local.example` and fill in:

```bash
MAC_HOSTNAME=YourMacHostName
IPHONE_UDID=00000000-0000000000000000
BUNDLE_ID=com.phejet.dubaicmd
# optional pinned baseline root for compare output
PERF_BASELINE_DIR=perf-results/baselines/<buildId>
```

`MAC_HOSTNAME` can be a LocalHostName such as `MyMac`, or a literal LAN IP if `.local` mDNS is blocked.

3. Install the iPhone build you want to measure:

```bash
npm run ios:dev   # Live Reload build for fast iteration
npm run ios:prod  # static production build; use this for committed baselines
```

If mDNS is blocked, run the sync/open step manually with an IP-based server URL:

```bash
CAP_DEV_SERVER=http://192.168.1.23:5173 npm run cap:sync && npm run cap:open
```

4. Run the Mac-side harness:

```bash
scripts/bench.sh perf-wave1
scripts/bench.sh perf-wave4-upgrades --warmup 1 --loop 3
scripts/bench.sh --list-devices
```

The harness probes `http://<host>:5173/api/save-perf`, launches the installed app with `xcrun devicectl`, waits for the saved report matching its `runId`, copies the selected run to `perf-results/latest/<replay>.json`, and prints baseline deltas when `PERF_BASELINE_DIR` points at a pinned baseline directory.

5. Capture desktop baselines with the Chromium smoke harness:

```bash
npm run perf:smoke -- perf-wave1 http://127.0.0.1:5173/
npm run perf:smoke -- perf-wave4-upgrades http://127.0.0.1:5173/
```

If the benchmark replay fixtures change because the sim changed, re-record the fixtures first, then recapture both desktop and iPhone baselines and commit the new median artifacts under `perf-results/baselines/<buildId>/`.

### Autoplay Bot

A Playwright bot that plays the game automatically for testing:

```bash
npm run dev                  # start dev server first
# update GAME_URL in play-bot.mjs to match your port
node play-bot.mjs            # opens Chromium and plays
```

### Headless Simulation & Training

Run thousands of games headlessly (~770 games/sec) for automated bot tuning:

```bash
# Single headless game with determinism check
node src/headless/sim-runner.js [seed]

# Learning loop — benchmark, Sonnet analysis, apply changes, repeat
node src/headless/learn.js --rounds=3 --duration=10000 [--dry-run]

# Game balance analysis — get design suggestions from Claude
node src/headless/balance.js [--focus=all|enemies|upgrades|mechanics|visual]

# Batch training — runs games with worker threads, tunes config only
node src/headless/train.js --games=100 --iterations=10 [--dry-run]

# Record best game as a replay file
node src/headless/record.js [--seed=N] [--tries=1000] [--out=replay.json]
```

Four rounds of Sonnet-driven optimization took the bot from wave 1 to wave 17. See the full [Bot Learning Report](src/headless/learning-reports/round-1-to-4-report.md).

### Replay System

Replay recorded bot games in the browser with full visual playback:

```bash
# Start dev server, then launch replay in Chromium
npm run dev
node play-replay.mjs replay.json
```

You can also drag-and-drop a `replay.json` file onto the game canvas, or load via console: `window.__loadReplay(data)`.

## Tech Stack

- TypeScript + Vite
- HTML5 Canvas (all rendering)
- Capacitor iOS wrapper for local device deployment
- React 19 for the internal editor tooling only
- Playwright (autoplay bot + replay viewer)
- Headless simulation with seeded PRNG for deterministic runs
- Worker threads for parallel game execution
- Claude API for automated bot parameter tuning
- GitHub Pages (deployment)
