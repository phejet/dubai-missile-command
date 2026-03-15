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

## Tech Stack

- React 19 + Vite
- HTML5 Canvas (all rendering)
- Playwright (autoplay bot)
- GitHub Pages (deployment)
