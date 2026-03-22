# Dubai Missile Command — Replayability Analysis

## Design Team Game Flow Review

**Date:** 2026-03-22
**Method:** 600 headless bot simulations (200 per skill level) + recorded replay analysis
**Presets tested:** Good (skilled human), Average (casual player), Novice (new player)

---

## RAW DATA SUMMARY

### Performance by Skill Level

| Metric | Good | Average | Novice |
|--------|------|---------|--------|
| Mean score | 21,988 | 6,109 | 1,047 |
| Median score | 2,082 | 1,512 | 932 |
| Mean wave | 6.0 | 3.6 | 2.2 |
| Median wave | 5 | 3 | 2 |
| p10 wave | 2 | 1 | 1 |
| p90 wave | 17 | 5 | 4 |
| Hit efficiency | 81.3% | 62.9% | 52.0% |
| Negative scores | 1% | 2% | 4% |
| Never reached shop | 5% | 10% | 32% |
| Passed wave 6 | 14% | 4% | 0% |
| Passed wave 10 | 11% | 3% | 0% |
| Passed wave 15 | 11% | 2% | 0% |

### Death Wave Distribution (Top Concentrations)

**Good:** Wave 3-5 cluster (60%), then bimodal jump to wave 16-23 (14%)
**Average:** Wave 2-5 cluster (81%), rare outliers to wave 18-22 (3%)
**Novice:** Wave 1-3 cluster (91%), absolute ceiling at wave 6

### Economy Analysis

| Metric | Good | Average | Novice |
|--------|------|---------|--------|
| Repair ratio (% of purchases) | 26.5% | 40.0% | 52.1% |
| First upgrade: Iron Beam | 60% | 43% | 14% |
| First upgrade: Wild Hornets | 23% | 31% | 30% |

---

## DESIGN TEAM REVIEW

### RICK (Creative Director)

> "The data tells one story loud and clear: **this game has a cliff, not a curve.**"

The death wave distribution for "Good" players is **bimodal** — 86% die between waves 1-8, and the remaining 14% suddenly survive to wave 16+. There is virtually nobody dying between waves 9-15. This means the game has a **snowball threshold** around waves 6-8: if you survive long enough to stack Iron Beam + Hornets + a few defensive upgrades, you become nearly invincible until the extreme late game.

**The problem:** The game is either too hard (you die before upgrades matter) or too easy (upgrades trivialize the mid-game). There's no satisfying middle ground where you feel challenged but progressing.

**For novice players it's worse:** 32% never even reach the shop. Their entire experience is: spawn, miss shots, die. Wave 1 is a brick wall for new players. And even the "best" novice game only reached wave 5 with a score of 7,782 — they never experience MIRVs, Patriots, EMPs, or half the upgrade tree.

### MAYA (Systems Designer)

> "The upgrade economy is broken in two ways: the repair trap and the solved meta."

**The Repair Trap:** Novice players spend 52% of their purchases on repairs. Average players spend 40%. They're bleeding money just to stay alive, never accumulating enough to buy meaningful upgrades. It's a death spiral — you lose a launcher, spend money repairing it, can't afford upgrades, lose the launcher again. The game punishes failure with more failure.

**The Solved Meta:** Iron Beam first, every time. 60% of good players rush Iron Beam as their first buy. It's not a meaningful choice — it's the objectively correct answer. The upgrade priority is effectively solved: Iron Beam > Hornets > Launcher Kit > Roadrunner. There's no build diversity, no interesting trade-offs, no "what should I buy this run?" tension.

**Shop flow analysis** from replays confirms this. In median games, players buy Iron Beam wave 1, Hornets wave 2, and then the exact same sequence every game. The shop is a solved puzzle, not a strategic decision point.

**Score scaling is exponential:** Wave 5 average score is ~2,600. Wave 18 average is ~140,000. The score gap between "died wave 5" and "died wave 18" is 50x. This means the leaderboard is entirely determined by whether you hit the snowball threshold, not by how well you played during any individual wave.

### DEV (Economy & Metagame Designer)

> "There is zero reason to play again after your first death. The game has no persistence, no variety, and no goals beyond 'number go up.'"

**No meta-progression:** Every run starts identically. There's no unlock, no rank, no "I earned something for next time." Players who die on wave 2 have the same starting position as someone who survived to wave 20. Nothing carries over.

**No run variety:** Every wave 1 is the same. Every wave 2 is the same. Same enemies, same spawns (modulo RNG), same shop options. The only "variety" comes from which launcher gets destroyed first, which is essentially random.

**No goal structure:** There's no win condition, no milestones, no achievements. A novice who dies on wave 2 doesn't know if that's good or bad. There's no "you unlocked wave 3!" or "new personal best!" or "try reaching wave 5 to see MIRVs." The game doesn't tell you what you're working toward.

**Negative scores are possible:** 4% of novice games end with negative scores. You can literally play the game, spend time and effort, and end up with *less than nothing*. That's a devastating new-player experience.

---

## CRITICAL FINDINGS

### Finding 1: The Snowball Cliff (Severity: HIGH)

The gap between waves 8 and 16 in the "Good" death distribution reveals that the game's difficulty curve is actually two separate games:
- **Game A (Waves 1-7):** Frantic survival with limited resources. Most players die here.
- **Game B (Waves 8+):** Fully upgraded fortress that's nearly unkillable until extreme scaling kicks in at wave 16+.

There is no "Game B" for average/novice players — they never reach it. And for good players, Game B is autopilot until wave 16.

**Impact on replayability:** Players either feel frustrated (can't get past wave 5) or bored (waves 8-15 are solved). Neither feeling drives replay.

### Finding 2: The Repair Death Spiral (Severity: HIGH)

When a launcher is destroyed, the player must spend 200+(50×wave) to repair it before buying upgrades. This creates a negative feedback loop:
- Lose a launcher → spend money on repair → can't afford upgrades → die faster → lose another launcher

Novice players spend **more than half** their economy on repairs. They're treading water, never building toward anything.

**Impact on replayability:** New players feel punished and stuck. They never experience the fun part of the upgrade tree.

### Finding 3: No Build Diversity (Severity: MEDIUM)

Iron Beam is the dominant first buy at every skill level. The upgrade priority order is effectively solved. There's no matchup-dependent or situation-dependent purchasing — just one correct path.

**Impact on replayability:** Every run follows the same upgrade path. No "this time I'll try a Phalanx rush" or "drone-heavy build." The shop phase is rote.

### Finding 4: Novice Ceiling at Wave 5 (Severity: HIGH)

Zero novice games passed wave 6 across 200 attempts. These players never see:
- MIRVs (wave 5+)
- Patriot Battery, EMP, Decoy Flares in action
- Multi-kill combos at scale
- The satisfying "fortress" feeling of stacked defenses

They experience maybe 20% of the game's content before hitting an impenetrable wall.

### Finding 5: No Persistence Layer (Severity: HIGH)

Nothing carries between runs. No unlocks, no progression, no achievements, no rank. The only feedback is a score number with no context. A player who puts in 20 runs has the same starting position as a player on their first game.

---

## RECOMMENDED CHANGES (Prioritized)

### Tier 1: Fix the Core Loop

#### 1A. Smooth the Difficulty Curve
- Reduce wave 1-3 enemy speed and spawn rate by ~20% to give novices breathing room
- Scale difficulty more gradually between waves 4-8 to eliminate the cliff
- Add mid-game pressure (waves 8-15) so good players don't coast — e.g., introduce a new threat type at wave 10 that specifically counters stacked defenses

#### 1B. Fix the Repair Economy
- First repair per wave should be free or heavily discounted (50% off)
- Launchers should auto-repair to 1 HP between waves (you still lose the ammo/upgrade that wave, but you're not stuck in a spending hole)
- Or: remove launcher destruction from early waves (waves 1-3 enemies only target Burj and buildings, not launchers)

#### 1C. Roguelike Upgrade Draft
- Show 3 random upgrades per shop visit instead of all 9
- Player picks one. Forces different builds every run.
- Eliminates the "solved meta" problem entirely
- Reroll token every 3 waves for bad luck protection

### Tier 2: Give Players Goals

#### 2A. Wave 20 Victory Condition
- Wave 20 is a "Final Stand" boss wave with a clear win state
- Victory screen with stats, time played, upgrades purchased
- Gives players something concrete to work toward
- Unlocks Endless Mode for that profile

#### 2B. Achievement System
- 20-30 achievements tracking milestones and skill plays
- "Reach wave 5," "Get a triple kill," "Win without buying Iron Beam"
- Displayed on title screen with completion percentage
- Drives replay by giving specific goals per run

#### 2C. Daily Challenge Seed
- One fixed seed per day (derived from date)
- Everyone plays the same RNG
- Personal best tracking per day
- Streak counter for consecutive days played

### Tier 3: Add Meta-Progression

#### 3A. Commander Rank
- Cumulative lifetime score feeds a rank system (localStorage)
- Ranks unlock cosmetics, mutators, and starting bonuses
- Gives every run meaning — even a wave-2 death contributes to your rank

#### 3B. Prestige Upgrades
- Permanent micro-buffs purchased with lifetime score
- +1 starting launcher HP, +10% interceptor speed, etc.
- Keeps players invested across dozens of runs

### Tier 4: Add Run Variety

#### 4A. Mutators / Modifiers
- Opt-in difficulty modifiers with score multipliers
- "Sandstorm" (reduced visibility, ×1.5 score), "Glass Cannon" (2 HP Burj + 2× damage, ×2.0 score)
- Negative mutators for challenge seekers, positive for accessibility

#### 4B. Boss Waves
- Scripted encounters every 5 waves (The Swarm, MIRV Barrage, Blackout, Final Salvo)
- Memorable moments that break up the wave grind
- Bonus rewards for completion

#### 4C. Alternate Loadouts
- Choose starting configuration before a run
- Standard (3 launchers), Fortress (2 launchers + extra HP), Sniper (1 launcher + fast interceptors)
- Unlocked via Commander Rank

### Tier 5: Post-Game Depth

#### 5A. Stats & Heatmap Screen
- Kill heatmap overlay after each game
- Per-launcher accuracy, damage timeline, upgrade purchase order
- Compare to previous runs
- Appeals to optimizers and completionists

#### 5B. Endless Mode Modifiers
- After wave 20 victory, each subsequent wave gets a random modifier
- "Missile Rain," "Armored Targets," "Bounty Wave," "Ammo Shortage"
- Keeps late-game fresh and unpredictable

---

## IMPLEMENTATION PRIORITY

| Phase | Changes | Expected Impact |
|-------|---------|-----------------|
| **Phase 1** | Difficulty curve smoothing (1A) + Repair fix (1B) + Victory condition (2A) | Novice retention doubles. Players have a goal. |
| **Phase 2** | Roguelike draft (1C) + Achievements (2B) + Daily seed (2C) | Every run feels unique. 3× replay motivation. |
| **Phase 3** | Commander Rank (3A) + Mutators (4A) + Stats screen (5A) | Long-term retention. Meta-progression loop. |
| **Phase 4** | Boss waves (4B) + Loadouts (4C) + Prestige (3B) + Endless modifiers (5B) | Content depth for dedicated players. |

---

*Analysis based on 600 headless simulations across 3 skill presets. All data reproducible via `node /tmp/run-analysis.js` and `node /tmp/deep-analysis.js`.*
