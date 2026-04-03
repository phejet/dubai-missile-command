# Spawn Commander Analysis: Pre vs Post

**Commits compared:**

- Pre: `3fbe3b1` — Shahed-238 aerodynamic trajectory, proximity fuse, and bugfixes
- Post: `89edbc1` → current `main` — Add spawn commander with threat-value wave tables

---

## Background

Commit `89edbc1` replaced the old timer-based spawning system with a **Spawn Commander** that pre-generates a wave schedule using a threat-value budget. This analysis benchmarks and compares the two approaches across spawn dynamics, difficulty curves, and bot performance.

---

## Spawning Architecture

### Pre-spawn-commander (timer-based)

Spawning was driven by three independent timers that fired on elapsed tick intervals:

| Parameter                     | Formula                                  | Wave 1 | Wave 6 | Wave 12 |
| ----------------------------- | ---------------------------------------- | ------ | ------ | ------- |
| `waveTarget` (total missiles) | `8 + wave×4 + late×2`                    | 12     | 32     | 64      |
| `spawnInterval` (ticks/burst) | `max(22, 120 - wave×8 - late×2)`         | 112    | 72     | 22      |
| `droneInterval` (ticks/event) | `max(36, 160 - wave×20 - late×4)`        | 140    | 40     | 36      |
| Missiles per burst            | `min(1 + ⌊wave/2⌋, 3)`                   | 1      | 3      | 3       |
| Drones per event              | `min(wave≤2 ? 2 : 1+⌊wave/3⌋, 4)`        | 2      | 3      | 4       |
| Jet drone chance              | `wave≥3 ? min(1, 0.2+(wave-3)×0.16) : 0` | 0%     | 68%    | 100%    |
| MIRV target                   | `wave≥5 ? min(1+⌊(wave-4)/2⌋, 6) : 0`    | 0      | 2      | 5       |
| MIRV interval (ticks)         | `max(250, 600-(wave-5)×50)`              | —      | 350    | 100     |

**Key properties:**

- Drone timer only fires while `waveMissiles < waveTarget`, so at late waves where missiles spawn very fast, the drone window closes early — causing counter-intuitive drone count _drops_ at waves 9–12.
- No concurrency cap: all alive threats co-existed simultaneously; the screen could flood if the bot fell behind.
- No tactical variety: direction, altitude, and formation were all randomized per-entity with no wave-level strategy.

### Post-spawn-commander (budget-based schedule)

Each wave has a pre-generated **schedule** (list of `{tick, type, overrides}` entries) constrained by a threat-value budget:

| Threat     | Value |
| ---------- | ----- |
| `missile`  | 1.5   |
| `drone136` | 1.0   |
| `drone238` | 2.5   |
| `mirv`     | 3.0   |

**Wave table (explicit budgets, waves 1–8):**

| Wave | Budget | Cap | Missiles | Drone136 | Drone238 | MIRV  |
| ---- | ------ | --- | -------- | -------- | -------- | ----- |
| 1    | 18     | 10  | [3–8]    | [6–12]   | 0        | 0     |
| 2    | 26     | 14  | [5–11]   | [7–14]   | 0        | 0     |
| 3    | 36     | 16  | [6–12]   | [7–15]   | [1–3]    | 0     |
| 4    | 50     | 20  | [8–17]   | [6–12]   | [3–8]    | 0     |
| 5    | 65     | 24  | [10–21]  | [6–12]   | [4–9]    | [1–3] |
| 6    | 82     | 28  | [14–27]  | [5–11]   | [5–11]   | [2–5] |
| 7    | 100    | 34  | [16–30]  | [4–9]    | [6–12]   | [3–8] |
| 8    | 125    | 40  | [20–36]  | [4–9]    | [7–15]   | [4–9] |

Wave 9+: exponential formula — `budget = 105 + w×40 + w²×8`, `cap = 35 + w×10 + w²×2`.

**Commander styles:** `balanced`, `aggressive`, `methodical`, `adaptive` — each biases tactic selection (flanking, saturation, MIRV-first, etc.) with history-aware adaptation.

---

## Per-Wave Spawn Data

### Pre-spawn-commander (deterministic simulation)

| Wave | waveTarget | spawnInt | droneInt | Missiles | Drone136 | Drone238 | MIRV | Total | ThreatVal |
| ---- | ---------- | -------- | -------- | -------- | -------- | -------- | ---- | ----- | --------- |
| 1    | 12         | 112      | 140      | 12       | 18       | 0        | 0    | 30    | 36.0      |
| 2    | 16         | 104      | 120      | 16       | 12       | 0        | 0    | 28    | 36.0      |
| 3    | 20         | 96       | 100      | 20       | 14       | 4        | 0    | 38    | 54.0      |
| 4    | 24         | 88       | 80       | 24       | 10       | 6        | 0    | 40    | 61.0      |
| 5    | 28         | 80       | 60       | 28       | 12       | 14       | 1    | 55    | 92.0      |
| 6    | 32         | 72       | 40       | 32       | 18       | 39       | 1    | 90    | 166.5     |
| 7    | 36         | 64       | 36       | 36       | 10       | 53       | 1    | 100   | 199.5     |
| 8    | 40         | 56       | 36       | 40       | 0        | 63       | 1    | 104   | 220.5     |
| 9    | 46         | 46       | 36       | 46       | 0        | 80       | 1    | 127   | 272.0     |
| 10   | 52         | 36       | 36       | 52       | 0        | 68       | 1    | 121   | 251.0     |
| 11   | 58         | 26       | 36       | 58       | 0        | 56       | 1    | 115   | 230.0     |
| 12   | 64         | 22       | 36       | 64       | 0        | 52       | 1    | 117   | 229.0     |

**Threat value growth (wave-over-wave):**
`+0%, +50%, +13%, +51%, +81%, +20%, +11%, +23%, -8%, -8%, -0%`

Notable: waves 9–12 see threat value _decrease_ despite higher waveTarget — jets spawn in fewer groups as the missile timer accelerates and closes the drone window.

### Post-spawn-commander (200-sample mean [p10–p90])

| Wave | Budget | Cap | Missiles     | Drone136    | Drone238     | MIRV        | Total         | ThreatVal           |
| ---- | ------ | --- | ------------ | ----------- | ------------ | ----------- | ------------- | ------------------- |
| 1    | 18     | 18  | 5.4 [3–8]    | 8.2 [6–11]  | 0            | 0           | 13.6 [11–15]  | 16.2 [12.5–18.0]    |
| 2    | 26     | 26  | 7.7 [5–11]   | 10.1 [7–13] | 0            | 0           | 17.8 [14–21]  | 21.6 [17.0–25.5]    |
| 3    | 36     | 36  | 8.9 [6–12]   | 11.2 [7–15] | 1.9 [1–3]    | 0           | 22.0 [17–26]  | 29.3 [23.5–34.5]    |
| 4    | 50     | 50  | 12.7 [9–17]  | 8.9 [6–12]  | 5.4 [3–8]    | 0           | 27.1 [22–32]  | 41.5 [33.5–49.0]    |
| 5    | 65     | 65  | 15.3 [10–21] | 9.0 [6–12]  | 6.3 [4–9]    | 1.9 [1–3]   | 32.5 [27–39]  | 53.4 [44.5–63.5]    |
| 6    | 82     | 82  | 20.4 [15–26] | 8.2 [5–11]  | 7.7 [5–11]   | 3.5 [2–5]   | 39.8 [33–46]  | 68.4 [56.5–80.0]    |
| 7    | 100    | 100 | 22.8 [17–29] | 6.5 [4–9]   | 9.0 [6–12]   | 5.5 [3–8]   | 43.8 [38–50]  | 79.7 [68.5–93.0]    |
| 8    | 125    | 125 | 28.8 [21–35] | 6.4 [4–9]   | 11.0 [8–15]  | 6.5 [4–9]   | 52.6 [44–61]  | 96.5 [81.0–111.5]   |
| 9    | 153    | 153 | 29.4 [22–37] | 7.1 [4–10]  | 12.7 [9–16]  | 6.0 [4–8]   | 55.2 [47–64]  | 100.9 [87.0–114.5]  |
| 10   | 217    | 217 | 35.7 [27–44] | 8.7 [6–12]  | 17.0 [13–21] | 7.3 [5–10]  | 68.7 [59–78]  | 126.7 [109.5–143.5] |
| 11   | 297    | 297 | 42.2 [33–52] | 9.8 [6–13]  | 21.0 [16–26] | 9.2 [7–12]  | 82.2 [71–92]  | 153.2 [133.0–172.5] |
| 12   | 393    | 393 | 48.6 [38–59] | 11.7 [8–16] | 25.2 [20–31] | 10.7 [7–14] | 96.2 [85–109] | 179.7 [158.0–203.0] |

**Threat value growth (wave-over-wave):**
`+33%, +36%, +42%, +29%, +28%, +17%, +21%, +5%, +26%, +21%, +17%`

Consistently positive. Smooth and monotonic.

---

## Difficulty Curve Comparison

```
ThreatValue by wave:

Old:  36  36  54  61  92  167 200 221 272 251 230 229
New:  16  22  29  42  53   68  80  97 101 127 153 180

Ratio (old/new):
      2.3x 1.7x 1.9x 1.5x 1.7x 2.4x 2.5x 2.3x 2.7x 2.0x 1.5x 1.3x
```

The old system spawns **1.3–2.7× more threat value** per wave than the new system, despite a lower raw count at late waves because of the 100% jet composition. The new system intentionally controls this via budget — early waves are substantially easier to allow players to build up defenses.

### Key differences in difficulty shape

| Property                    | Pre-spawn                     | Post-spawn                               |
| --------------------------- | ----------------------------- | ---------------------------------------- |
| Wave 1–2 threat value       | 36 (high)                     | 16–22 (low)                              |
| Early jet exposure (w3)     | 20% random chance             | Explicit drone238 appears                |
| First MIRV wave             | 5 (1 MIRV)                    | 5 (avg 1.9 MIRVs)                        |
| MIRV cap                    | 6 max                         | Unbounded (scales with budget)           |
| Late-wave drone count       | Decreases (9→12)              | Increases monotonically                  |
| Threat value at wave 12     | 229 (declining from peak 272) | 180 (still climbing)                     |
| Threat value direction late | **Declining** after wave 9    | **Always rising**                        |
| Tactical variety            | None                          | 10 tactics, commander styles             |
| Concurrency control         | None (floods possible)        | Budget-capped concurrent screen pressure |

---

## Bot Benchmark Results (200 games each, seeds 12345–12544)

### Pre-spawn-commander

```
Score:   mean=140,920  median=169,460  p10=2,247  p90=263,948
Waves:   mean=14.5     median=18       p10=4      p90=21
Kills:   1,662/game    Shots: 907/game    Efficiency: 1.558 kills/shot
```

**Wave distribution — strongly bimodal:**

```
Wave  1:   2  (1%)
Wave  2:   3  (1.5%)
Wave  3:  10  (5%)
Wave  4:  14  (7%)
Wave  5:  13  (6.5%)
Wave  6:  18  (9%)
Wave  7:   1  (0.5%)
Wave  8:   1  (0.5%)   ← 31% die here (waves 1–8)
                       ← 0% in waves 9–14 (middle waves skipped!)
Wave 15:   4  (2%)
Wave 16:   7  (3.5%)
Wave 17:  15  (7.5%)
Wave 18:  30  (15%)
Wave 19:  30  (15%)
Wave 20:  24  (12%)
Wave 21:  16  (8%)
Wave 22:  11  (5.5%)
Wave 23:   1  (0.5%)   ← 69% survive past wave 14
```

**Score variance: p10/p90 ratio = 117×**

### Post-spawn-commander

```
Score:   mean=103,495  median=101,042  p10=71,398  p90=146,160
Waves:   mean=14.5     median=15       p10=14      p90=16
Kills:   1,214/game    Shots: 808/game    Efficiency: 1.490 kills/shot
```

**Wave distribution — tight unimodal:**

```
Wave  5:   1  (0.5%)
Wave  7:   1  (0.5%)
Wave  9:   1  (0.5%)
Wave 11:   1  (0.5%)
Wave 13:  12  (6%)
Wave 14:  80  (40%)   ← mode
Wave 15:  72  (36%)
Wave 16:  29  (14.5%)
Wave 17:   2  (1%)
Wave 18:   1  (0.5%)
```

**Score variance: p10/p90 ratio = 2.0×**

---

## Analysis & Conclusions

### 1. Bimodal → Unimodal: the lottery problem is fixed

The old system created a **survivor-bias lottery**: if you made it through waves 1–8 (where 30+ threats spawn against 0 upgrades), you accumulated enough defensive infrastructure to coast for many more waves — hence the complete gap between waves 9–14 and the cluster at 18–22. The new system's budget-controlled early waves (13–18 threats, modest threat values) let all players build defenses and reach a similar wave ceiling, producing a tight cluster at 13–16.

### 2. The drone-window collapse bug

In the old system, drone count **decreases** at waves 9–12 due to an emergent interaction: as `spawnInterval` accelerates (hitting floor 22 ticks), missiles fill `waveMissiles` to `waveTarget` faster, which closes the condition gate for drone spawning. Waves 9–12 spawn fewer drones than wave 8 despite higher `waveTarget`. The new system has no such interaction — drone238 and drone136 scale independently with the budget.

### 3. MIRV availability

Old system: 1 MIRV max per wave for waves 5–6, slowly scaling to 6. The MIRV timer (250–600 ticks) is rarely triggered more than once.
New system: waves 5–8 average 1.9–6.5 MIRVs with explicit count ranges, and wave 9+ continues scaling. MIRV pressure is qualitatively higher and budget-controlled.

### 4. Late-game difficulty inversion fixed

Old: threat value peaks at wave 9 (272) then **declines** to 229 by wave 12 — the game got easier as players upgraded defenses. Combined with unlimited concurrency, this meant once you were ahead, you stayed ahead.
New: threat value increases monotonically all the way through — the game never gets easier late. The exponential wave 9+ formula ensures pressure always escalates.

### 5. Tactical structure vs statistical noise

The new system's commander layer adds wave-level intent (flanking, MIRV-first, saturation, pincer) that the old system never had. This means:

- Threats come from predictable directions within a wave (testable and counterable by skilled players)
- Difficulty variance is now _intentional_ (commander style) rather than _emergent_ (timer accidents)
- Replay data captures commander decisions for debugging

### 6. Performance comparison

| Metric                   | Pre-spawn | Post-spawn | Change        |
| ------------------------ | --------- | ---------- | ------------- |
| Median score             | 169,460   | 101,042    | -40%          |
| p10 score                | 2,247     | 71,398     | **+31.8×**    |
| p90 score                | 263,948   | 146,160    | -45%          |
| Score variance (p10/p90) | 117×      | 2×         | **-98%**      |
| Median wave              | 18        | 15         | -3 waves      |
| p10 wave                 | 4         | 14         | **+10 waves** |
| Kills/game               | 1,662     | 1,214      | -27%          |

The post-spawn version trades peak score potential for dramatically better consistency. The bot (and by extension, players) no longer faces a near-guaranteed early death in 31% of runs.
