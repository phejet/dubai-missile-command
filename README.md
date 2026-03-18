# Dubai Missile Command

[![CI](https://github.com/phejet/dubai-missile-command/actions/workflows/ci.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/ci.yml)
[![Deploy](https://github.com/phejet/dubai-missile-command/actions/workflows/deploy.yml/badge.svg)](https://github.com/phejet/dubai-missile-command/actions/workflows/deploy.yml)

A retro-inspired missile defense game set in Dubai. Defend Burj Khalifa from waves of ballistic missiles and Shahed drones. Built with React + Canvas.

**[Play Now](https://phejet.github.io/dubai-missile-command/)**

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
npm run lint      # run ESLint
npm run format    # run Prettier (auto-fix)
```

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

- React 19 + Vite
- HTML5 Canvas (all rendering)
- Playwright (autoplay bot + replay viewer)
- Headless simulation with seeded PRNG for deterministic runs
- Worker threads for parallel game execution
- Claude API for automated bot parameter tuning
- GitHub Pages (deployment)
