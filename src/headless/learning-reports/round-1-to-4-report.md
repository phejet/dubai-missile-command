# Bot Learning Report — Rounds 1–4

## Overview

Four rounds of automated analysis using Claude Sonnet took the bot from dying on wave 1 to consistently reaching wave 12, with a max of wave 17. Each round benchmarked ~10 seconds of headless games, sent results + code to Sonnet for analysis, then applied suggested changes.

| Metric            | Round 1 (baseline) | Round 2 | Round 3 | Round 4 | Round 4b (bugfix) |
| ----------------- | ------------------ | ------- | ------- | ------- | ----------------- |
| Games benchmarked | 7,323              | 2,185   | 132     | 178     | 318               |
| Median wave       | 1                  | 3       | 4       | 11      | 12                |
| Mean wave         | 1.43               | 2.58    | 4.42    | 10.66   | 10.82             |
| P10 wave          | 1                  | 2       | 3       | 6       | 6                 |
| P90 wave          | 2                  | 3       | 8       | 15      | 15                |
| Max wave          | 4                  | 5       | 12      | 17      | 17                |
| Median score      | 850                | 1,375   | 2,475   | 10,950  | 35,725            |
| Mean score        | 807                | 1,478   | 3,632   | 12,463  | 36,637            |
| Max score         | 3,175              | 4,050   | 36,225  | 54,000  | 130,700           |
| Min score         | -350               | -350    | 450     | 1,150   | 3,750             |
| Mean kills        | 11.4               | 42.4    | 134.3   | 571.5   | 582.8             |
| Efficiency        | 1.018              | 0.595   | 0.809   | 0.930   | 0.947             |

> Games per benchmark decreased across rounds because each game lasted longer (more waves survived = more ticks per game).

---

## Round 1: Baseline → First Tuning

### Before (Baseline)

- Median wave: **1** — most games didn't survive past wave 1
- 10.9 shots fired per game, 11.4 kills — very few actions taken
- Some games went negative score (hitting F-15 friendlies)

### Sonnet Analysis

1. **Cooldowns too conservative** — `cooldownNormal=200` meant the bot fired once every 200 ticks. The game spawns a new missile every 120 ticks, so the bot fired _slower than enemies spawned_.
2. **Lead shot intentionally undershoots** — `timeScaleFactor=0.75` aimed at 75% of where targets would be, systematically missing.
3. **Drones completely ignored until diving** — horizontal drones dropped free bombs before the bot engaged them.
4. **Plane avoidance suppressed all firing** — any plane within 55px of the target cancelled the shot entirely with no fallback, potentially suppressing 32% of game time.
5. **Can't afford upgrades** — Phalanx (900) was first priority but wave 1 typically earns ~850. Flare (600) was last despite being the only affordable option.
6. **Urgency vs clustering tied** — a single urgent missile scored the same as a cluster of distant ones.

### Changes Applied

```
Config:
  cooldownNormal:      200 → 80
  cooldownHighThreat:   80 → 25
  cooldownLowAmmo:     400 → 200
  maxInFlightBase:       3 → 5
  maxInFlightHigh:       6 → 10
  highThreatThreshold:   4 → 2
  timeScaleFactor:    0.75 → 0.98
  leadShot iterations:   3 → 4
  planeAvoidance radius: 55 → 35
  upgradePriority: flare first, patriot last

Code (bot-brain.js):
  - Engage non-diving drones past center canvas [300, 600]
  - Urgency weight: (4 - priority) → (4 - priority) * 3
  - Plane avoidance: try fallback targets instead of cancelling shot
```

### After

- Median wave: **3** (+2 waves)
- Mean kills: **42.4** (4x increase)
- Efficiency dropped to 0.595 (expected — much more aggressive firing)
- No more negative scores from plane hits

---

## Round 2: Firing Rate → Strategic Depth

### Before

- Median wave 3, max wave 5
- Bot fires 69.7 shots per game but only 42.4 kills (27 wasted shots)
- Efficiency 0.595 — lots of misses

### Sonnet Analysis

1. **Upgrade buying was greedy** — `while (buyUpgrade(g, key))` bought all levels of one upgrade before moving to the next. Flare L1+L2 consumed entire budget; Roadrunner and Iron Beam never purchased.
2. **Drones engaged too late** — `droneEngageRange [300, 600]` intercepted drones right at the bomb-drop threshold, not before it.
3. **No ammo check before firing** — if closest launcher was empty, `fireInterceptor` was a no-op but bot burned its cooldown anyway.
4. **Urgency weight still too weak** — `*3` let clusters of low-priority threats beat a single urgent missile.
5. **Iron Beam undervalued** — higher DPS than Wild Hornets at close range, should be bought earlier.

### Changes Applied

```
Config:
  cooldownNormal:       80 → 60
  cooldownHighThreat:   25 → 20
  cooldownLowAmmo:     200 → 300
  maxInFlightBase:       5 → 4  (slight tightening)
  maxInFlightHigh:      10 → 7
  highThreatThreshold:   2 → 3
  lowAmmoThreshold:     10 → 15
  clusterRadius:        70 → 85
  urgentY threshold:   350 → 380
  minThreatY:           80 → 60
  planeAvoidance:       35 → 30
  droneEngageRange: [300,600] → [150,750]
  leadShot iterations:   4 → 5, timeScale: 0.98 → 0.97
  upgradePriority: flare, ironBeam, wildHornets... (ironBeam moved to 2nd)

Code (bot-brain.js):
  - Ammo check: early return if no launcher has ammo
  - Urgent fast-path: skip cluster scoring for priority-0 threats
  - Urgency weight: *3 → *8

Code (sim-runner.js):
  - Round-robin upgrade buying: one level per pass, not greedy drain
```

### After

- Median wave: **4** (+1)
- Max wave: **12** (up from 5!)
- Mean kills: **134.3** (3x increase)
- Efficiency recovered to 0.809
- P90 wave jumped to 8

---

## Round 3: Targeting Precision → Jet Drone Era

### Before

- Median wave 4, max wave 12
- Big variance: p10=3, p90=8 — RNG-dependent

### Sonnet Analysis

1. **Diving drones gated by Y threshold** — `if (d.diving && d.y > minThreatY)` excluded drones that just started diving from high altitude. All diving drones should be priority 0 immediately.
2. **Bomb-type missiles treated as regular missiles** — drone bombs can't be lured by flares and drop nearly vertically, but got the same low priority as high-altitude missiles.
3. **No jet drone awareness in cooldown** — Shahed-238 jets have multi-HP and need double-tapping, but the bot used the same cooldown regardless.
4. **Upgrade priority wrong for early game** — Flare L1's lure chance is only 0.45% per tick, unreliable. Iron Beam provides immediate DPS.
5. **Drone engagement still too late for left-movers** — left-to-right drones engaged at x=150 but bomb threshold is x=315, barely any buffer.

### Changes Applied

```
Config:
  cooldownNormal:       60 → 50
  cooldownHighThreat:   20 → 15
  maxInFlightBase:       4 → 5
  maxInFlightHigh:       7 → 8
  highThreatThreshold:   3 → 2
  lowAmmoThreshold:     15 → 8
  clusterRadius:        85 → 100
  droneEngageRange: [150,750] → [80,820]
  leadShot iterations:   5 → 8, timeScale: 0.97 → 0.96
  upgradePriority: ironBeam first, flare demoted to 5th

Code (bot-brain.js):
  - All diving drones priority 0 regardless of Y position
  - Bombs elevated to priority 0-1 (never priority 2)
  - Jet drone fast-cooldown: 40% reduction when Shahed-238 present
```

### After

- Median wave: **11** (from 4!)
- Max wave: **17**
- Mean kills: **571.5** (4x increase)
- Efficiency jumped to 0.930
- Min score now 1,150 (no bad games)

---

## Round 4b: Defense Site Re-Buy Bug Fix

### Discovery

User noticed the bot was buying "Patriots all 3 upgrades multiple times" during replay. Investigation revealed:

1. When a defense site is destroyed mid-wave, `destroyDefenseSite()` sets `g.upgrades[key] = 0`
2. The site's `savedLevel` preserves the original level for restoration at wave start
3. But the shop opens with `g.upgrades[key] = 0`, so the bot sees level 0 and re-buys all levels
4. `closeShop()` would have restored the level anyway via `savedLevel` — the money was completely wasted

### Fix

Moved defense site restoration from `closeShop()` to the shop-opening logic — sites are restored _before_ the shop opens, so the bot sees the correct upgrade levels.

```js
// Before shop opens, restore destroyed defense sites
g.defenseSites.forEach((site) => {
  if (!site.alive && site.savedLevel) {
    site.alive = true;
    g.upgrades[site.key] = site.savedLevel;
  }
});
```

### Impact

- Median score: **35,725** (from 10,950 — **3.3x increase** from one bug fix!)
- Max score: **130,700** (from 54,000)
- This single fix was more impactful than any parameter tuning round
- The bot was bleeding thousands of points per game re-buying destroyed upgrades

---

## Additional Bug Fix: Jet Drone Stuck in Air

### Discovery

User reported jet drones getting "stuck in the air with a red circle around them."

### Root Cause

When a Shahed-238 entered diving state but `pickTarget()` returned null (no valid target), `diveTarget` remained undefined. The movement check `if (d.diving && d.diveTarget)` was false, so the drone fell through to horizontal-only movement, floating in place indefinitely. The Shahed-136 code already handled this with a fallback to Burj coordinates.

### Fix

```js
// Before (broken):
const t = pickTarget(g, d.x);
if (t) d.diveTarget = t;

// After (fixed):
const t = pickTarget(g, d.x);
d.diveTarget = t || { x: BURJ_X, y: CITY_Y };
```

### Impact

Minimal gameplay impact (pickTarget rarely returns null in practice), but fixed a visual bug where jet drones would hover indefinitely with their red nav light blinking.

---

## Key Learnings

### What Mattered Most (in order of impact)

1. **Bug fixes > parameter tuning** — The defense site re-buy fix (3.3x score) dwarfed all config changes combined.
2. **Firing rate was the #1 bottleneck** — Reducing cooldowns from 200 to 50 ticks was the single biggest parameter change.
3. **Lead shot accuracy** — Changing timeScaleFactor from 0.75 to 0.96 stopped the bot from systematically undershooting.
4. **Upgrade buying strategy** — Round-robin instead of greedy drain ensured diverse defenses.
5. **Threat prioritization** — Urgent fast-path and bomb priority elevation prevented the bot from ignoring imminent threats.

### What Sonnet Was Good At

- Reading game code and understanding complex system interactions (ammo, cooldowns, upgrade economics)
- Suggesting code changes, not just config tweaks (urgent fast-path, bomb priority, jet drone cooldown)
- Identifying unused config values (`droneEngageRange` was dead config in the baseline)
- Correctly diagnosing why the bot died (firing rate < spawn rate in round 1)

### What Sonnet Missed

- The defense site re-buy bug (biggest single fix, 3.3x score) was found by the **user** watching a replay, not by Sonnet — despite Sonnet reading the full game-sim.js code each round
- The jet drone stuck-in-air bug was also spotted by the **user** during visual replay
- Sonnet sometimes suggested changes in opposite directions across rounds (e.g., highThreatThreshold went 4→2→3→2)
- Some suggestions had minimal impact (e.g., clusterRadius changes)
- Sonnet couldn't observe visual/behavioral bugs that were obvious in replay playback

### Architecture Decisions That Enabled This

- **Seeded RNG** — deterministic games made benchmarks reproducible
- **Headless simulation** — ~300 games in 10 seconds for reliable statistics
- **Action-log replay** — visual verification caught bugs that stats couldn't
- **Separated game-sim.js** — Sonnet could read and reason about game logic without React/rendering noise

---

## Final Config

```json
{
  "targeting": {
    "minThreatY": 60,
    "maxInFlightBase": 5,
    "maxInFlightHigh": 8,
    "highThreatThreshold": 2,
    "cooldownLowAmmo": 300,
    "cooldownHighThreat": 15,
    "cooldownNormal": 50,
    "lowAmmoThreshold": 8,
    "clusterRadius": 100,
    "missileYThresholds": { "urgent": 380, "medium": 200 },
    "droneEngageRange": [80, 820]
  },
  "leadShot": { "iterations": 8, "timeScaleFactor": 0.96 },
  "planeAvoidance": { "radius": 30 },
  "upgradePriority": ["ironBeam", "wildHornets", "phalanx", "roadrunner", "flare", "patriot"]
}
```

## Config Evolution Across Rounds

| Parameter           | Baseline    | Round 1   | Round 2   | Round 3  |
| ------------------- | ----------- | --------- | --------- | -------- |
| cooldownNormal      | 200         | 80        | 60        | 50       |
| cooldownHighThreat  | 80          | 25        | 20        | 15       |
| cooldownLowAmmo     | 400         | 200       | 300       | 300      |
| maxInFlightBase     | 3           | 5         | 4         | 5        |
| maxInFlightHigh     | 6           | 10        | 7         | 8        |
| highThreatThreshold | 4           | 2         | 3         | 2        |
| lowAmmoThreshold    | 10          | 10        | 15        | 8        |
| clusterRadius       | 70          | 70        | 85        | 100      |
| minThreatY          | 80          | 80        | 60        | 60       |
| urgentY             | 350         | 350       | 380       | 380      |
| droneEngageRange    | [200,700]\* | [300,600] | [150,750] | [80,820] |
| leadShot iterations | 3           | 4         | 5         | 8        |
| timeScaleFactor     | 0.75        | 0.98      | 0.97      | 0.96     |
| planeAvoidance      | 55          | 35        | 30        | 30       |
| 1st upgrade         | phalanx     | flare     | flare     | ironBeam |

\* Baseline `droneEngageRange` existed in config but was dead code — the original bot-brain only engaged diving drones. Round 1 added horizontal drone engagement using the range values.
