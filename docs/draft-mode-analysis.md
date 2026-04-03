# Draft Mode Balance Sweep

**Methodology:** 300 games per preset, seeds 99999–100298. Same seeds used for both normal and draft runs for direct comparison.
**Previous results** (for context): see [`spawn-commander-analysis.md`](./spawn-commander-analysis.md).

---

## Draft Rules

| Rule                    | Normal mode                      | Draft mode                           |
| ----------------------- | -------------------------------- | ------------------------------------ |
| Shop offering           | All non-maxed upgrades available | **3 random upgrades drawn per wave** |
| Purchases per wave      | Buy as many as score allows      | **Exactly 1 item**                   |
| Item cost               | Scales by level (532–7,966)      | **0 (free)**                         |
| Repairs (launcher/site) | Deducted from score              | Free, before draft pick, not counted |

The draft pool is drawn from all upgrade keys (`wildHornets`, `roadrunner`, `flare`, `ironBeam`, `phalanx`, `patriot`, `burjRepair`, `launcherKit`, `emp`) that are not yet at max level. The bot picks its highest-priority item from whichever 3 it is offered. If none of the 3 match its priority list, it skips.

---

## Previous Results (Normal Mode, Seeds 12345–12544, 200 games — `perfect` only)

From the spawn-commander analysis:

| Metric              | Post-spawn-commander (normal)              |
| ------------------- | ------------------------------------------ |
| Score mean / median | 103,495 / 101,042                          |
| Score p10 / p90     | 71,398 / 146,160                           |
| Wave mean / median  | 14.5 / 15                                  |
| Wave p10 / p90      | 14 / 16                                    |
| Efficiency          | 1.490 kills/shot                           |
| Wave distribution   | Tight unimodal: 95% cluster in waves 13–16 |

---

## Normal Mode Baseline (All Presets, Seeds 99999–100298, 300 games)

| Preset      | Score mean | Score median | Score p10 | Score p90 | Wave mean | Wave median | Wave p10 | Wave p90 | Efficiency |
| ----------- | ---------- | ------------ | --------- | --------- | --------- | ----------- | -------- | -------- | ---------- |
| **perfect** | 108,323    | 106,250      | 75,822    | 153,210   | 14.7      | 15          | 14       | 16       | 1.513      |
| **good**    | 83,856     | 86,390       | 36,548    | 126,164   | 13.7      | 14          | 12       | 15       | 1.420      |
| **average** | 69,916     | 75,926       | 3,727     | 124,068   | 12.5      | 14          | 6        | 15       | 1.305      |
| **novice**  | 56,487     | 68,034       | 2,101     | 115,410   | 11.3      | 14          | 5        | 15       | 1.189      |

**Wave distributions (normal):**

```
perfect:   Wave 14: 114 ████████████████████████  Wave 15: 109 ██████████████████████  Wave 16: 50 ██████████
good:      Wave 14: 126 ████████████████████████  Wave 15:  89 █████████████████        Wave 13: 31 ██████
average:   Wave 14: 117 ████████████████████████  Wave 15:  58 ████████████             Wave 13: 26 █████
novice:    Wave 14:  88 █████████████████         Wave 15:  60 ████████████             Wave  6: 27 █████
```

All presets converge to a near-identical wave ceiling (14–15) in normal mode. Skill level only affects the probability of early death (p10 varies from 75k to 2k) — if you survive the early waves, everyone reaches the same wall.

---

## Draft Mode Results (All Presets, Seeds 99999–100298, 300 games)

| Preset      | Score mean | Score median | Score p10 | Score p90 | Wave mean | Wave median | Wave p10 | Wave p90 | Efficiency |
| ----------- | ---------- | ------------ | --------- | --------- | --------- | ----------- | -------- | -------- | ---------- |
| **perfect** | 73,995     | 72,178       | 24,618    | 130,788   | 9.9       | 10          | 7        | 13       | 1.011      |
| **good**    | 46,756     | 39,684       | 16,466    | 86,238    | 8.4       | 8           | 6        | 11       | 0.887      |
| **average** | 39,470     | 32,404       | 11,182    | 84,086    | 7.8       | 8           | 5        | 11       | 0.837      |
| **novice**  | 31,535     | 23,720       | 4,912     | 73,018    | 7.1       | 7           | 4        | 11       | 0.768      |

**Wave distributions (draft):**

```
perfect:   Wave 11: 62 ████████████  Wave 12: 45 █████████  Wave 10: 44 ████████  Wave 7: 36 ███████
good:      Wave  8: 53 ██████████    Wave  7: 50 ██████████ Wave 10: 50 ██████████ Wave 6: 38 ███████
average:   Wave  6: 58 ████████████  Wave  8: 54 ███████████ Wave 7: 45 █████████  Wave 9: 31 ██████
novice:    Wave  7: 54 ██████████    Wave  8: 47 █████████  Wave  5: 43 ████████   Wave 6: 43 ████████
```

Draft mode breaks the single-ceiling phenomenon. Each preset dies at a **distinctly different wave**, making draft a much better differentiator of skill. The distributions also no longer converge — they stay separated across the full range.

---

## Draft vs Normal: Delta Table

| Preset  | Median score Δ  | Score p10 Δ    | Score variance (p10/p90) | Median wave Δ | Efficiency Δ     |
| ------- | --------------- | -------------- | ------------------------ | ------------- | ---------------- |
| perfect | -32% (106k→72k) | -68% (76k→25k) | 2.0× → 5.3×              | -5 (15→10)    | -33% (1.51→1.01) |
| good    | -54% (86k→40k)  | -55% (37k→16k) | 3.5× → 5.2×              | -6 (14→8)     | -38% (1.42→0.89) |
| average | -57% (76k→32k)  | +200% (4k→11k) | 33× → 7.5×               | -6 (14→8)     | -36% (1.31→0.84) |
| novice  | -65% (68k→24k)  | +134% (2k→5k)  | 55× → 15×                | -7 (14→7)     | -35% (1.19→0.77) |

---

## Draft Pick Frequency (All Presets Combined)

How often each upgrade was the bot's top pick from its offered 3:

| Upgrade      | perfect | good  | average | novice | avg       |
| ------------ | ------- | ----- | ------- | ------ | --------- |
| Iron Beam    | 25.7%   | 28.4% | 28.2%   | 28.6%  | **27.7%** |
| Wild Hornets | 23.7%   | 23.3% | 25.6%   | 24.4%  | **24.3%** |
| Launcher Kit | 20.9%   | 20.0% | 19.8%   | 19.3%  | **20.0%** |
| Roadrunner   | 14.6%   | 13.2% | 12.7%   | 13.8%  | **13.6%** |
| Phalanx      | 8.8%    | 8.1%  | 8.2%    | 8.3%   | **8.4%**  |
| Emp          | ~2%     | ~3%   | ~2%     | ~2%    | **~2%**   |
| Patriot      | ~2%     | ~2%   | ~2%     | ~2%    | **~2%**   |
| Flare        | ~1%     | ~1%   | ~1%     | ~1%    | **~1%**   |
| Burj Repair  | ~1%     | ~1%   | ~1%     | ~1%    | **~1%**   |

The top 5 are remarkably stable across all skill levels — this reflects the fixed `upgradePriority` list. **Iron Beam and Wild Hornets together account for ~52% of all picks.** The bottom 4 upgrades (EMP, Patriot, Flare, BurjRepair) collectively appear in <7% of picks — these are almost never the top choice when 3 options are offered.

> **Observation:** EMP, Patriot, Flare, and BurjRepair are effectively dead weight in draft pools. If they appear in a draft offer, the bot (and likely human players) will almost always take one of the other items instead. Draft pools containing these 4 exclusively would force a useless pick. Worth considering forcing higher-value item diversity in the pool generator.

---

## Analysis & Conclusions

### 1. Draft mode is substantially harder — 32–65% score reduction

The restriction to one upgrade per wave dramatically limits defensive buildup. In normal mode, a perfect bot buys 3–6 items per shop visit (spending all available score). In draft mode it buys exactly one. By wave 5 in normal mode, the bot may have ironBeam L1 + wildHornets L1 + launcherKit L1; in draft mode it has just one of those.

### 2. Draft mode creates a meaningful skill gradient

In normal mode, all presets hit the same wave ceiling (~14–15) — the upgrade wall is identical regardless of targeting quality. In draft mode, the ceiling is **strongly skill-dependent**:

| Preset  | Normal median wave | Draft median wave |
| ------- | ------------------ | ----------------- |
| perfect | 15                 | **10**            |
| good    | 14                 | **8**             |
| average | 14                 | **8**             |
| novice  | 14                 | **7**             |

The 5-wave spread across presets in draft mode (7→10) vs 1-wave spread in normal mode (14→15) means draft mode is a far better difficulty differentiator.

### 3. Draft mode reduces variance for weak bots, increases it for strong ones

- **Novice normal:** p10/p90 ratio = 55× — massive early-death lottery
- **Novice draft:** p10/p90 ratio = 15× — floor raised, ceiling lowered
- **Perfect normal:** p10/p90 ratio = 2× — tight cluster
- **Perfect draft:** p10/p90 ratio = 5.3× — more variance (depends on which 3 items are offered)

Draft mode makes the game more _predictable_ for weak players (less luck in surviving early waves because wave 1 difficulty is the same for everyone) but more _luck-dependent_ for skilled players (whether you get Iron Beam early matters a lot).

### 4. The efficiency drop points to ammo/firepower bottleneck

Normal perfect: 1.513 kills/shot → Draft perfect: 1.011 kills/shot (−33%)

This drop is not from worse targeting — the same bot logic runs. It comes from the bot having fewer auto-systems (Wild Hornets, Roadrunner, Iron Beam) to extend effective kill range. More threats survive to close range, requiring reactive shots that miss more often. The bot also has lower ammo capacity (less `launcherKit` by mid-game).

### 5. Difficulty curve: early vs late pressure

Normal mode concentrates all deaths around wave 14–15 because upgrades accumulate fast enough to handle waves 1–13, then the wave-9+ exponential formula finally overwhelms. Draft mode shifts the break point to waves 7–11 — upgrades never accumulate fast enough to handle the wave 5–8 budget surge (budget doubles from 65 to 125 over waves 5–8), and the bot reaches its breaking point earlier.

This creates a **front-loaded difficulty curve** in draft mode that feels more intense in the early-to-mid game and less punishing in the very late game (you rarely reach wave 12+ to feel the late exponential pressure).

### 6. Suggested tuning directions

| Finding                                          | Suggestion                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| EMP/Patriot/Flare/BurjRepair almost never picked | Consider excluding from draft pool, OR making them "always offered" as guaranteed options to create interesting hard choices |
| Perfect bot hits ceiling at wave 10              | Draft mode with a free 3-item pick may be too restrictive — a 2-item pick would halve the deficit                            |
| Novice variance still high (15×)                 | Early wave difficulty is still too swingy; consider always offering `launcherKit` in waves 1–2                               |
| Skill gradient (7→10) is good but narrow         | 4 discrete skill levels separated by only 3 waves; may need more granularity                                                 |
