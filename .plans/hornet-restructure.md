# Hornet Restructure — Magazine + Second Site + Per-Rank Identity

## Context

Hornets currently follow the old salvo model: every 2.5s (L1/L2) or 1.75s (L3) a clump of 2/3/5 drones launches together, then the launcher sits empty until the next cycle. Rank-ups are pure number bumps — `count` and `interval` change, but the upgrade _feels_ the same at every rank. With Roadrunner now on the magazine model, hornets should distinguish themselves cleanly. The trinity goal:

- **Patriot** — salvo, dumb, heavy. Drama and area denial. _Untouched in this plan._
- **Roadrunner** — magazine, smart (hold-fire + spread), precision. _Already done._
- **Hornets** — magazine, dumb fire-and-forget, **spatial** (two sites at L2+), high cadence swarm. Becomes smart only at L3 (one retarget per drone).

Each hornet rank gains a _different axis_ instead of bigger numbers:

| Rank                      | New capability                                                       | Identity gain                             |
| ------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| **L1 (Wild Hornets)**     | Single site, magazine of 2, ~1 drone/sec sustained, fire-and-forget  | "I have hornets"                          |
| **L2 (Trident FPV Cell)** | Adds a second hornet site mirrored on the right; ~2 drones/sec total | Spatial — "now I cover the whole map"     |
| **L3 (Sky Hunter Mesh)**  | One retarget per drone — surviving the first dead target             | Intelligence — "now my swarm has a brain" |

## Spatial layout (Option A — even spacing on the right band)

Current right-side ground real estate, x-coords on a 900-wide canvas (hw = collision half-width):

```
…553 Phalanx(hw=10) … 678 Roadrunner(hw=30) … 772 LauncherKit(hw=30) … 860 R-gun
```

Inserting a second hornet site at the perfect mirror of L1 (x=694) collides with Roadrunner. The cleanest layout, **evenly spaced** across the right band (from Phalanx's right edge at x=563 to the R-gun at x=860), is:

| Site                         | Old x |   New x |   Δ |
| ---------------------------- | ----: | ------: | --: |
| Phalanx                      |   553 |     553 |   0 |
| **wildHornetsRight** _(new)_ |     — | **622** | new |
| Roadrunner                   |   678 |     711 | +33 |
| LauncherKit                  |   772 |     800 | +28 |
| R-gun                        |   860 |     860 |   0 |

This yields ~29 px gaps between every site on the right band. Note: this is slightly tighter than the current Roadrunner ↔ LauncherKit gap (~34 px), but still visually serviceable and avoids a much uglier perfect-mirror squeeze.

**Trade-off acknowledged:** x=622 is not the perfect mirror of L1 hornets at x=206 (true mirror around Burj@460 would be x=694). The compromise reads as "two hornet outposts flanking Burj" rather than pixel-mirror — visually still symmetric enough to communicate the upgrade. Sticking to perfect mirror would require either ~5 px gaps everywhere or shrinking LauncherKit's footprint, both worse.

If a different layout emerges as obviously better during implementation (e.g., shrinking LauncherKit to a gun-mounted icon to free real estate), revisit then — but **start with the evenly-spaced layout above**.

## Files to modify

### Site placement & destruction model

1. **`src/game-logic.ts:187`** — `getDefenseSitePlacement`:
   - Update `roadrunner` x: 678 → **711**.
   - Update `launcherKit` x: 772 → **800**.
   - Add new case `wildHornetsRight`: `{ x: 622, y: GAMEPLAY_SUPPORT_SITE_Y, hw: 30, hh: 24 }`.
   - Leave `wildHornets` (left) at x=206 unchanged.

2. **`src/pixi-render.ts:953`** — `GAMEPLAY_DEFENSE_SITE_PLACEMENTS`:
   - Add `wildHornetsRight: requireDefenseSitePlacement("wildHornetsRight")`.

3. **`src/pixi-render.ts:2741-2749`** — hive render call:
   - After the existing `wildHornets` render, add a parallel `wildHornetsRight` render gated on `game.upgrades.wildHornets >= 2`. Use the same `wildHornetsHive[hornetLevel - 1]` asset — both sites look like the same equipment.
   - Also update the standalone first-call render at `src/pixi-render.ts:2004` (where the L1 site is drawn during the shop preview) if there's a similar block — verify during implementation.

4. **`src/game-sim-shop.ts:103-125`** — `reviveOrRegisterDefenseSite(g, key)`:
   - Introduce a separate defense-site key type instead of abusing `UpgradeKey`:
     ```ts
     type HornetSiteKey = "wildHornets" | "wildHornetsRight";
     type DefenseSiteKey = UpgradeKey | "wildHornetsRight";
     ```
   - Update `reviveOrRegisterDefenseSite` to accept a `DefenseSiteKey` or plain `string`, but keep saved upgrade level mapped through the owning family:
     ```ts
     const familyKey = key === "wildHornetsRight" ? "wildHornets" : key;
     const savedLevel = familyKey in g.upgrades ? g.upgrades[familyKey as UpgradeKey] : undefined;
     ```
   - When `applyNodeSideEffects` fires for `tridentFpvCell` (L2 node id), call `reviveOrRegisterDefenseSite(g, "wildHornetsRight")`.
   - Inline warning: do **not** extend `UpgradeKey` just to include `wildHornetsRight`. `UpgradeKey` defines the real `g.upgrades` record; putting a synthetic pad in there pollutes typing and makes `g.upgrades[key]` lie. The right hornet pad is a defense site owned by the `wildHornets` family, not an upgrade family.

5. **`src/game-sim-shop.ts:301-330`** — `prepareWaveStart`:
   - Revive both hornet sites (the existing loop `for (const site of g.defenseSites) { if (!site.alive) site.alive = true; }` already does this generically — verify it does the right thing for the synthetic `wildHornetsRight` key).
   - Init/reset per-site hornet magazine state (see state model below).
   - Inline implementation note: do this explicitly at wave start, not only lazily inside `updateAutoSystems`. Otherwise ammo, reload timers, or launch cooldown can leak between waves and the advertised opener silently dies. The intended shape is:
     ```ts
     syncHornetSitesForLevel(g, { reset: true });
     ```
     where reset means: active sites exist, each starts with full ammo, `reloadTimer = 0`, `launchCooldown = 0`, and inactive/future site entries are removed or ignored consistently.

### State model — per-site magazines

6. **`src/types.ts`** — replace `hornetTimer: number` (currently at line ~591 just before `roadrunnerAmmo`) with:

   ```ts
   hornetSites: Array<{
     key: "wildHornets" | "wildHornetsRight";
     ammo: number;
     reloadTimer: number;
     launchCooldown: number;
   }>;
   ```

   Use an array (not named fields) so the count can grow if a future rank adds a third site without another schema migration.

   Inline typing note: keep `HornetSiteKey` separate from `UpgradeKey`. That gives the sim a clean vocabulary for physical launch pads without pretending every pad is a shop upgrade.

7. **`src/game-sim.ts:440`** — `initGame()`:
   - Drop `hornetTimer: 360`.
   - Add `hornetSites: []`. Populated by `prepareWaveStart` based on `g.upgrades.wildHornets`.

8. **`src/editor-scene.ts:349`** — mirror the same change in the editor mock.

9. **`src/EditorApp.tsx`** — update editor hardcodes:
   - `EDITOR_DEFAULTS`: move `upgrade.roadrunner.x` 678 → **711** and `upgrade.launcherKit.x` 772 → **800**.
   - Upgrade showcase `siteDefs`: add `wildHornetsRight` at x=622, move Roadrunner and LauncherKit to their new positions.
   - Inline warning: the editor has its own coordinates. If this is skipped, gameplay and editor overlays disagree while both look "technically rendered", which is the most annoying kind of wrong.

### Launch loop rewrite

10. **`src/game-sim.ts:1545-1573`** — replace the salvo block with a per-site magazine loop:

```ts
// ── WILD HORNETS ──
// Per-site progressive magazine: each launch site reloads one drone at a time.
if (g.upgrades.wildHornets > 0) {
  const lvl = g.upgrades.wildHornets;
  const capacity = 2; // per site, all ranks
  const reloadPerSlot = 60; // 1s per slot, all ranks
  const launchGap = 24; // 0.4s between this site's launches
  const blastR = [25, 30, 40][lvl - 1];
  const retargetBudget = lvl >= 3 ? 1 : 0;
  const SITE_KEYS = lvl >= 2 ? (["wildHornets", "wildHornetsRight"] as const) : (["wildHornets"] as const);

  // Ensure hornetSites has one entry per active key. This is a defensive sync;
  // prepareWaveStart owns the full wave-opener reset.
  for (const key of SITE_KEYS) {
    if (!g.hornetSites.some((s) => s.key === key)) {
      g.hornetSites.push({ key, ammo: capacity, reloadTimer: 0, launchCooldown: 0 });
    }
  }

  for (const siteState of g.hornetSites) {
    if (!SITE_KEYS.includes(siteState.key)) continue; // L2 not bought yet → skip right site
    const siteAlive = isSiteAlive(g, siteState.key);
    if (siteAlive && siteState.ammo < capacity) {
      siteState.reloadTimer += dt;
      while (siteState.reloadTimer >= reloadPerSlot && siteState.ammo < capacity) {
        siteState.ammo++;
        siteState.reloadTimer -= reloadPerSlot;
      }
    }
    if (siteState.ammo >= capacity) siteState.reloadTimer = 0;
    if (siteState.launchCooldown > 0) {
      siteState.launchCooldown = Math.max(0, siteState.launchCooldown - dt);
    }

    if (siteAlive && siteState.ammo > 0 && siteState.launchCooldown <= 0 && allThreats.length > 0) {
      const target = pickHornetLaunchTarget(allThreats, g.hornets, lvl, siteState.key);
      if (target) {
        const placement = getDefenseSitePlacement(siteState.key);
        g.hornets.push({
          x: (placement?.x ?? 206) + rand(-12, 12),
          y: (placement?.y ?? GROUND_Y) - 20,
          targetRef: target,
          speed: rand(3.73, 5.6),
          trail: [],
          alive: true,
          blastRadius: blastR,
          wobble: rand(0, Math.PI * 2),
          life: 240,
          maxLife: 240,
          retargetsRemaining: retargetBudget,
        });
        siteState.ammo--;
        siteState.launchCooldown = launchGap;
        if (onEvent) onEvent("sfx", { name: "hornetBuzz" });
      }
    }
  }
}
```

Notes:

- Removed `pickHornetLaunchTargets` (plural). Replaced with `pickHornetLaunchTarget` (singular, site-aware) below.
- Each site fires independently. With cap=2 and launch-gap=24 at L1, the wave opener fires 2 drones 0.4s apart; sustained rate is then ~1 drone/sec per site. L2 doubles this (2 drones/sec total across both sites). Throughput stays per-site identical between L1 and L2 — L2's value is **coverage**, not per-site rate.
- The loop may defensively create missing site state, but it must not be the only initialization path. The wave-start reset is the source of truth.

11. **`src/game-sim.ts:940-996`** — replace `pickHornetLaunchTargets` (plural) with `pickHornetLaunchTarget` (singular) that takes a `siteKey` and biases by distance:

    ```ts
    function pickHornetLaunchTarget(
      allThreats: Threat[],
      activeHornets: Hornet[],
      lvl: number,
      siteKey: "wildHornets" | "wildHornetsRight",
    ): Threat | null {
      const aliveThreats = allThreats.filter((t) => t.alive);
      if (aliveThreats.length === 0) return null;

      const placement = getDefenseSitePlacement(siteKey);
      const siteX = placement?.x ?? 206;

      const assignmentCounts = getHornetAssignmentCounts(activeHornets);
      const activeTargets = Array.from(assignmentCounts.keys());

      // Prefer unassigned threats (existing logic).
      const unassigned = aliveThreats.filter((t) => !assignmentCounts.has(t));
      const pool = unassigned.length > 0 ? unassigned : aliveThreats;

      const localHalf =
        siteKey === "wildHornets"
          ? pool.filter((target) => target.x < BURJ_X)
          : pool.filter((target) => target.x >= BURJ_X);
      const spatialPool = localHalf.length > 0 ? localHalf : pool;

      const scored = spatialPool
        .map((target) => {
          const assigned = assignmentCounts.get(target) || 0;
          const distanceFromSite = Math.abs(target.x - siteX);
          // Spatial bias: after the hard same-half preference above, distance
          // breaks ties so each site still favors nearby threats. Magnitude tuned so a
          // threat at the opposite end of the canvas (~600 px away) gets a ~-80
          // penalty — comparable to a "single existing assignment" penalty (-75).
          const spatialPenalty = (distanceFromSite / 600) * 80;
          return {
            target,
            score:
              hornetTargetScore(target, lvl, assigned) +
              getSpreadBonus(target, activeTargets, 340, 0.16) -
              spatialPenalty,
          };
        })
        .sort((a, b) => b.score - a.score);

      const topScore = scored[0].score;
      const topBand = scored.filter((s) => s.score >= topScore - 25);
      return topBand[randInt(0, topBand.length - 1)].target;
    }
    ```

    Keep the existing `pickHornetTarget` and `pickHornetRetargetTarget` helpers as-is — they're used by the retarget path (next section).

    Inline behavior note: the same-half filter makes the L2 promise real: each site owns its side when possible and only crosses over when its local side has no viable threat. If playtest feels too rigid, soften this back into pure scoring, but then weaken the tests and feel-check wording accordingly.

### Retarget budget at L3

12. **`src/types.ts`** — `Hornet` type:

    ```ts
    retargetsRemaining: number;
    ```

13. **`src/game-sim.ts:1599-1619`** — gate the retarget block on `h.retargetsRemaining > 0`:

    ```ts
    if (!t || !t.alive) {
      if (h.retargetsRemaining <= 0) {
        // L1/L2: fire-and-forget — crash when the assigned target is gone.
        h.alive = false;
        boom(g, h.x, h.y, h.blastRadius * 0.5, COL.hornet, false, onEvent, h.blastRadius * 0.2);
        return;
      }
      const newT = pickHornetRetargetTarget(
        h,
        allThreats,
        g.hornets.filter((other) => other !== h),
        g.upgrades.wildHornets,
      );
      if (newT) {
        h.targetRef = newT;
        h.retargetsRemaining--;
      } else {
        // Still no target after retarget attempt — drift, life timer will expire.
        h.wobble += 0.15 * dt;
        h.trail.push({ x: h.x, y: h.y });
        if (h.trail.length > 12) h.trail.shift();
        h.y -= h.speed * 0.5 * dt;
        h.x += Math.sin(h.wobble) * 0.8 * dt;
        return;
      }
    }
    if (h.targetRef && h.targetRef.alive && h.targetRef.y > h.y + HORNET_DIVE_SLACK) {
      // Live target slipped below the hornet. Do not pop L1/L2 midair here;
      // preserve the old "no dive" safety by drifting until a valid path exists
      // or life expires. L3 intelligence is about recovering from dead targets,
      // not magically solving every below-target geometry problem.
      h.wobble += 0.15 * dt;
      h.trail.push({ x: h.x, y: h.y });
      if (h.trail.length > 12) h.trail.shift();
      h.y -= h.speed * 0.5 * dt;
      h.x += Math.sin(h.wobble) * 0.8 * dt;
      return;
    }
    ```

    Reasoning for "crash on dead target" rather than "drift forward and timeout": at L1/L2 the dumb fire-and-forget identity is explicit. Crashing on target death gives instant visual feedback ("my hornet just died because its target died — that's the cost of L1/L2"). Drifting until life timeout would mask the difference between ranks.

    Inline warning: do not gate this whole block on `t.y > h.y + HORNET_DIVE_SLACK`. That condition can be true for a still-live target that has simply slipped below the hornet. Popping dumb hornets in that case would look like random self-destruction, which is funny only in the same way a lab fire is educational.

### Shop / upgrade copy

14. **`src/game-sim-upgrades.ts:128-163`** — refresh `statLine` descriptions to reflect the new model:
    - L1 (wildHornets): `"1 site · 2-drone magazine · 1/sec · 25 blast"`
    - L2 (tridentFpvCell): `"2 sites (L+R coverage) · 2 drones/sec · 30 blast"`
    - L3 (skyHunterMesh): `"2 sites · drones retarget once · 40 blast"`

    Costs unchanged unless playtest says otherwise. L2's value proposition is now spatial coverage (genuinely big), L3's is a categorical capability (smart drones).

### Tests

15. **`src/game-sim.test.ts`** — current hornet spread test (line ~1138) asserts salvo behavior (`g.hornetTimer = 0`, ticks once, expects 2 hornets). Rewrite as **two** tests:

    a. **L1 single-site magazine** — pre-load `g.hornetSites = [{ key: "wildHornets", ammo: 2, reloadTimer: 0, launchCooldown: 0 }]`, tick 30 frames (past launch-gap of 24), assert 2 hornets exist with distinct targets (existing spread-bonus picker still fans out).

    b. **L2 dual-site spatial bias** — buy L2, pre-load both sites with ammo=2, tick 30 frames, assert at least one hornet originated from each site (check spawn `x` coords near 206 and 622), and that targets were picked from the site's "half" of the canvas (left-site hornet's target.x < 460, right-site hornet's target.x ≥ 460, given symmetric threat placement).

16. **`src/game-sim.test.ts`** — new **L3 retarget test**: spawn L3 hornet aimed at threat T1, kill T1, advance one tick, assert hornet has retargeted to T2 (must exist nearby) and `retargetsRemaining` decremented to 0. Kill T2, advance one tick, assert hornet is dead (no second retarget).

    Also add a regression test for live below-target geometry: L1/L2 hornet with a live target below `HORNET_DIVE_SLACK` should drift/timeout behavior, not immediate dead-target crash. Yes, it is a tiny semantic trapdoor; step around it deliberately.

17. **`src/headless/sim-runner.test.ts:197-202`** — golden-seed canary at `seed=42, maxTicks=5000, draftMode=true`. This will drift again because hornet behavior changed and the bot trajectory shifts. Update the expected score after running once with the new code (same pattern as the Roadrunner change — capture actual, paste in).

## Tuning constants (one place to iterate from)

All in the `WILD HORNETS` block in `src/game-sim.ts`. These are the dials a designer touches during playtest:

```ts
const capacity = 2; // drones per site magazine
const reloadPerSlot = 60; // ticks (1.0s) to reload one slot
const launchGap = 24; // ticks (0.4s) between this site's launches
const blastR = [25, 30, 40][lvl - 1];
const retargetBudget = lvl >= 3 ? 1 : 0;
// Spatial bias weight (in pickHornetLaunchTarget):
const SPATIAL_PENALTY_WEIGHT = 80; // larger = stricter zoning between left/right sites
```

If hornets feel too dense (or too sparse) early, bump `reloadPerSlot` first. If the two sites are fighting over the same targets at L2, bump `SPATIAL_PENALTY_WEIGHT` to 100-120. If the L2 opener feels insufficient, bump `capacity` to 3.

## Throughput math sanity check

|       Rank |   Sustained drones/sec | Wave opener (drones in first ~0.5s) | Per drone blast |
| ---------: | ---------------------: | ----------------------------------: | --------------: |
| Current L1 |                   0.80 |                    2 (in one salvo) |              25 |
| Current L2 |                   1.20 |                    3 (in one salvo) |              30 |
| Current L3 |                   2.86 |                    5 (in one salvo) |              40 |
| **New L1** |                   1.00 |                      2 (0.4s apart) |              25 |
| **New L2** |                   2.00 | 4 (2 per site, 0.4s apart per site) |              30 |
| **New L3** | 2.00 + retarget budget | 4 (2 per site, 0.4s apart per site) |              40 |

L3 net throughput drops slightly vs current (2.0 vs 2.86) because L3 no longer adds rate — but each hornet now potentially gets a second life via retarget, raising effective kill-per-hornet. The trade is: fewer hornets but each one more valuable. If playtest shows L3 feels weaker than L2 in raw kill counts, bump L3 to `capacity: 3` per site (4 drones/sec sustained, retargeted).

## Open decisions for implementation time

- **Defense-site typing** for `wildHornetsRight`: use a separate physical site key, not `UpgradeKey`. Shorter code is not cleaner if it makes `g.upgrades.wildHornetsRight` a thing. That path contains snakes and TypeScript will helpfully label them `undefined`.
- **Visual asset for the right site**: start with the same sprite as the left. If L2 needs to _feel_ visually distinct, swap in a tinted variant or add a small "2" decal — but only after the mechanics ship.
- **Bot config** (`src/headless/bot-config.json`): the bot already buys upgrades by node id; doesn't care about per-site magazines. No expected changes unless a balance scan shows the new hornets are now mis-prioritized vs Roadrunner.
- **Replay determinism**: as with the Roadrunner change, RNG consumption pattern shifts (per-drone launches now interleave instead of clumping). Pre-existing replays exercising hornet waves will desync; new replays remain deterministic with themselves.

## Verification

1. **Type + unit tests:**

   ```bash
   npx tsc --noEmit
   npx vitest run
   ```

   Confirm all updated tests pass and the golden-seed canary value has been refreshed.

2. **Headless determinism:**

   ```bash
   node src/headless/sim-runner.js 42
   node src/headless/sim-runner.js 42    # same score both runs
   ```

3. **Browser feel-check** (`npm run dev`, then `http://localhost:5173/dubai-missile-command/`):
   - **L1**: buy Wild Hornets. Wave opener should fire 2 drones from the left site, ~0.4s apart. Sustained drip ~1/sec from one site only.
   - **L2**: buy Trident FPV Cell. Verify a **second hornet building appears at x≈622** (right of Phalanx, left of Roadrunner). Verify Roadrunner and LauncherKit sit at their new positions (711, 800). Wave opener fires 4 drones — 2 per site, 0.4s apart per site. Left site engages left-half threats, right site engages right-half threats; only when one side is empty does the other cross over.
   - **L3**: buy Sky Hunter Mesh. Visible test: aim a hornet at a missile that's about to be killed by a launcher round. The hornet should briefly fly past, then visibly _veer_ to a new target instead of crashing. After one retarget, if that second target also dies, the hornet drops.
   - **Site destruction**: deliberately let a missile hit the new right hornet site. Confirm:
     - The right site stops launching; the left site keeps producing.
     - In-flight right-site hornets keep flying (existing in-flight update is site-independent).
     - The right site rebuilds at wave start (revive in `prepareWaveStart`).
   - **No regressions**: Patriot still salvos every interval; Roadrunner still magazine-fires per the previous plan; Phalanx and Iron Beam unchanged.

4. **Editor / overlay hardcode sweep:**
   - Confirm editor upgrade defaults in `src/EditorApp.tsx` (`EDITOR_DEFAULTS` and `siteDefs`) use Roadrunner x=711, LauncherKit x=800, and the new `wildHornetsRight` site.
   - Confirm Pixi range overlay fallback coordinates in `src/pixi-render.ts` point at the new Roadrunner and LauncherKit pads instead of the old coordinates.

5. **iPhone deploy** (optional, after browser sign-off): `npm run ios:deploy`.
