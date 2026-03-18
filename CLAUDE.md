# Dubai Missile Command

Canvas-based missile defense game built with React + Vite.

## Quick Start

```bash
npm install
npm run dev          # starts dev server (usually http://localhost:5173)
npx vite build       # production build to dist/
```

## Running the Bot

The Playwright bot (`play-bot.mjs`) auto-plays the game for testing.

```bash
# 1. Start the dev server first
npm run dev

# 2. Update GAME_URL in play-bot.mjs to match the dev server port

# 3. Run the bot (opens a visible Chromium window)
node play-bot.mjs
```

The bot reads game state via `window.__gameRef`, calculates leading shots, prioritizes threats, buys upgrades in the shop, and avoids hitting friendly F-15s.

## Headless Simulation & Training

Run thousands of games headlessly at ~770 games/sec for bot tuning.

```bash
# Run a single headless game with determinism check
node src/headless/sim-runner.js [seed]

# Learn: benchmark → Sonnet analysis → apply changes → repeat
node src/headless/learn.js --rounds=3 --duration=10000 [--dry-run]

# Train: batch-run games with worker threads, then tune config only
node src/headless/train.js --games=100 --iterations=10 [--dry-run]

# Record best game as a replay file
node src/headless/record.js [--seed=N] [--tries=1000] [--out=replay.json]

# Play a replay in the browser (requires dev server running)
node play-replay.mjs replay.json
```

### Key files

- `src/game-sim.js` — extracted game loop (spawning, upgrades, auto-systems)
- `src/game-logic.js` — constants, collision, injectable seeded RNG
- `src/replay.js` — replay runner (action-log based deterministic replay)
- `src/headless/sim-runner.js` — headless game runner
- `src/headless/bot-brain.js` — parameterized bot targeting/firing logic
- `src/headless/bot-config.json` — tunable bot parameters
- `src/headless/learn.js` — full learning loop (benchmark + Sonnet analysis + code/config patches)
- `src/headless/train.js` — batch training loop with Claude API tuning
- `src/headless/game-worker.js` — worker thread for parallel game execution

### Replay system

Replays record bot actions (fire coordinates + shop purchases at tick numbers) with a seeded RNG. Drop a `replay.json` onto the game canvas or use `window.__loadReplay(data)` in the console. During replay, the shop UI shows for 2 seconds between waves and a toast displays what the bot purchased.

## Architecture

Game logic is split across `src/game-sim.js` (simulation) and `src/App.jsx` (rendering + React UI).

### Key constants

- `CANVAS_W=900`, `CANVAS_H=640`, `GROUND_Y=570`
- `BURJ_X=460`, `BURJ_H=340`
- `LAUNCHERS` at x: 60, 550, 860

### Game state (`gameRef.current`)

- `missiles`, `drones`, `interceptors`, `explosions`, `particles`, `planes`
- `defenseSites[]` — physical upgrade structures enemies can destroy
- `launcherHP[3]` — each launcher has 2 HP, destroyed = can't fire
- `upgrades{}` — wildHornets, roadrunner, flare, ironBeam, phalanx, patriot
- `stats{}` — missileKills, droneKills, shotsFired (shown on game over)

### Targeting system (`pickTarget`)

- 30% chance enemies target Burj directly
- 70% target defense sites and alive launchers, sorted by proximity to spawn
- Missiles spawn biased away from target (min 200px offset) for interceptable angles

### Upgrade systems

| Upgrade         | What it does                                          |
| --------------- | ----------------------------------------------------- |
| Wild Hornets    | FPV kamikaze drones that auto-track threats           |
| Roadrunner      | AI-guided vertical-launch interceptors                |
| Decoy Flares    | Burj launches IR decoys that lure missiles off course |
| Iron Beam       | Laser burns down threats near Burj                    |
| Phalanx CIWS    | Rapid-fire autocannon turrets                         |
| Patriot Battery | Long-range SAM with massive blast radius              |

### F-15 Eagles

Friendly fighter jets that fly across screen and shoot down threats. Player is penalized -500 for hitting them.

## Deployment

GitHub Pages via Actions workflow (`.github/workflows/deploy.yml`). Pushes to `main` auto-deploy to https://phejet.github.io/dubai-missile-command/
