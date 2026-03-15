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

## Architecture

Single-file game: `src/App.jsx` (~1600 lines). All game logic, rendering, and UI in one component.

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
| Upgrade | What it does |
|---------|-------------|
| Wild Hornets | FPV kamikaze drones that auto-track threats |
| Roadrunner | AI-guided vertical-launch interceptors |
| Decoy Flares | Burj launches IR decoys that lure missiles off course |
| Iron Beam | Laser burns down threats near Burj |
| Phalanx CIWS | Rapid-fire autocannon turrets |
| Patriot Battery | Long-range SAM with massive blast radius |

### F-15 Eagles
Friendly fighter jets that fly across screen and shoot down threats. Player is penalized -500 for hitting them.

## Deployment

GitHub Pages via Actions workflow (`.github/workflows/deploy.yml`). Pushes to `main` auto-deploy to https://phejet.github.io/dubai-missile-command/
