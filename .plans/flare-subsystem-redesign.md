# Flare Subsystem Redesign (W5 — flare)

**Status:** design approved, ready to implement. **Decision basis:** user opted for a
first-principles rewrite, not a verbatim extraction. Turncoat (L2) kept as a control mode;
full single-ownership of controlled-threat motion.

**This changes behavior.** RNG draw order and steering change, so flare-touching replay
fixtures and perf baselines desync and must be re-recorded; existing flare unit tests get
rewritten against the new system. This is accepted scope, not a regression.

---

## Design intent (the spec, player-facing)

**L1 — Distraction.** Once/wave, Burj ejects a fan of ballistic decoys. Incoming threats
(missiles + drones) near a decoy break their attack run and chase the nearest one. On contact,
threat + decoy die in a small explosion (player gets the kill). Decoys are physical and burn
out / hit ground; a threat whose decoy dies first is left harmlessly neutralized (it already
aborted its run).

**L2 — Turncoat (adds to L1).** Bigger/longer salvo + refills launcher ammo on cast. Seduced
threats, instead of dying at the decoy, are _reprogrammed_ into friendly kamikazes that hunt
another enemy. Each turncoat claims one victim (no dogpiling). On impact both die,
combo-credited. If its victim dies first, re-acquire nearby or self-destruct.

---

## Architecture

New file `src/game-sim-flare.ts`. Owns the `Flare[]` lifecycle, seduction, all
controlled-threat motion, and impact resolution. Public surface unchanged so replay/bot/headless
callers don't move:

```ts
export function fireFlareSalvo(g, onEvent): boolean; // active-ability trigger (signature kept)
export function updateFlares(g, dt, deps): void; // single tick phase (replaces 4 scattered blocks)
```

**Dependency injection (mirror `game-sim-patriot.ts`).** The subsystem imports only pure
helpers from `game-logic.js` (`dist`, `rand`, `getRng`, `COL`, `BURJ_X`, `GROUND_Y`,
`LAUNCHERS`, `getAmmoCapacity`, `ov`). Keep `normalizeAngle` private in `game-sim-flare.ts`
unless it is promoted to `game-logic.ts` first. Everything sim-owned is injected by
`game-sim.ts`:

```ts
interface FlareDeps {
  boom: (g, x, y, r, color, big, onEvent, initialR, opts?) => void;
  destroyThreat: (g, t) => void; // = destroyRedirectedThreat (score + record + alive=false)
  recordNeutralized: (g, t) => void; // = recordThreatDestroyed (harmless self-destructs)
  onEvent: SimEventSink | null;
}
```

`fireFlareSalvo(g, onEvent)` keeps its old public signature for replay/bot/headless callers, so
L2 ammo refill uses the imported `getAmmoCapacity()` directly rather than a dependency that is only
available to `updateFlares()`.

### Single ownership of motion

Five smeared threat fields collapse to one, owned solely by the flare system:

```ts
// types.ts — replaces luredByFlare, flareTargetId, redirected, redirectTarget, lureDeathTimer
export interface FlareControl {
  mode: "seduced" | "turncoat";
  flareId?: number;          // seduced: decoy being chased
  victim?: Missile | Drone;  // turncoat: enemy being hunted
  patience: number;          // ticks until self-neutralize (was lureDeathTimer; now both kinds)
}
// on Missile and Drone:
flareControl?: FlareControl | null;
```

The missile and drone update loops each gain exactly one early-out:
`if (m.flareControl) return;` (placed at the top, before trail/nav). Controlled threats are
fully driven inside `updateFlares` — including trail push and position integration.

Controlled threats have aborted native behavior while flare-owned: MIRV/stack split logic,
waypoint/drop/dive behavior, missile acceleration, Burj/ground impact damage, and normal OOB
cleanup are skipped by the original missile/drone loops. The flare subsystem owns their
self-neutralization, contact, and expiry outcomes.

`g.flareSalvoClaims: Set<Missile|Drone>` is **removed**. "Is this victim already claimed?" is
derived by scanning live turncoats (`g.missiles`/`g.drones` where `flareControl?.mode ===
"turncoat"`) — small n, no loose top-level identity Set on GameState.

### GameState flare fields (after)

```
flares: Flare[]            // kept
nextFlareId: number        // kept
flareReadyThisWave: boolean// kept (public trigger gate)
flareSalvoQueue: FlareDrop[]// kept (staggered follow-up drops)
// flareSalvoClaims         // DELETED
```

Also drop vestigial `Flare` fields: `luresLeft` (set to 999, never read), and confirm
`anchorX`/`fanWidth` usage (`void fanWidth` today) — remove if no render reader; keep `anchorX`
only if `pixi-render.ts` reads it.

### `updateFlares` internal pipeline (fixed deterministic order)

1. **Advance salvo queue** — launch any drop whose `fireAt <= waveTick`; each launch runs a
   wide Burj-centered seduce (radius ~600).
2. **Flare physics** — integrate decoys (vel, gravity, drag), trail, life decay, ground/burnout
   death, spark particles. Filter dead.
3. **Tick seduce** — un-controlled threats within ~200px of any live flare get
   `flareControl = { mode: "seduced", flareId, patience }`.
4. **Drive controlled threats** — for each missile/drone with `flareControl`:
   - _seduced_: steer toward its flare; on contact within `hotRadius` → L1 consume (both die +
     boom) or L2 promote to turncoat (claim a victim, flare dies, keep flying). If flare gone →
     harmless self-destruct. Decrement `patience`; expire → harmless self-destruct.
   - _turncoat_: steer toward victim; on impact within `redirectAOE` → both die + boom +
     combo-credit. Victim dead → re-acquire nearest unclaimed within 80px, else self-destruct.
   - Push trail + integrate position here (loops skip these threats).

### Tuning home

All flare `ov()` keys live at the top of `game-sim-flare.ts` as a single labelled block
(physics / seduce / turncoat / salvo-L1 / salvo-L2). One obvious place to feel-tune. Keys and
default values are **carried over unchanged** except where the redesign removes a concept
(e.g. the `dt=8` launch snap-kick — see below).

---

## Deliberate feel changes (flag for playtest, not silent)

- **Launch snap-kick dropped.** Today the launch lure-pass applies an instant `dt=8`
  steerTowardPoint, snapping threats hard onto decoys. New design lets normal per-tick steering
  reel them in → softer, more readable seduction. _Watch:_ threats near Burj at cast should still
  visibly peel off within a few frames, not lazily drift.
- **Unified seduction radii.** Launch = wide (600, Burj-centered), tick = local (200,
  flare-centered). Same numbers as today, one function. No intended change; called out for audit.
- **Drone/missile patience symmetric.** Today only drones get a `lureDeathTimer` (200); missiles
  rely on flare expiry. New `patience` applies to both. _Watch:_ seduced missiles whose decoy
  outlives them shouldn't wander indefinitely.

---

## External readers to update (the field collapse touches these)

- `pixi-render.ts:3163` — `missile.redirected ? orange : missile.luredByFlare ? yellow : white`
  → `missile.flareControl?.mode === "turncoat" ? orange : missile.flareControl ? yellow : white`.
- `pixi-render.ts:3250,3258-3260` — drone lured/redirected tint + trail flag → read `flareControl`.
- `headless/bot-brain.ts:347,492` — `luredByFlare` (skip/save-ammo) → `!!flareControl`.
- `game.ts:176-177` — `some(redirected)` → `some(m => m.flareControl?.mode === "turncoat")`.

---

## Implementation steps (single commit; it's a cohesive rewrite, not stackable slices)

1. `types.ts`: add `FlareControl`; replace the 5 fields on `Missile`/`Drone` with
   `flareControl?: FlareControl | null`; remove `flareSalvoClaims` from GameState; trim vestigial
   `Flare` fields.
2. New `src/game-sim-flare.ts`: tuning block, `Flare` spawn, `updateFlares` pipeline,
   `fireFlareSalvo`, `FlareDeps`. Pure helpers from `game-logic`, everything else injected.
3. `game-sim.ts`: delete the old flare functions (`isFlareMissileTarget`, `getLiveFlare`,
   `launchFlareSalvo`, `nearestFlareForThreat`, `spawnFlareLureSparks`, `applyFlareLurePass`,
   `applyFlareTickLure`, `tryRedirectFlareThreat`, `destroyRedirectedThreat`,
   `consumeThreatAtFlare`, `reaimRedirectedThreat`, `updateRedirectedProjectiles`,
   `updateFlareSalvoQueue`, the DECOY FLARES tick block, and the inline lure steering in the
   missile/drone loops). Add `if (threat.flareControl) return;` early-outs. Call
   `updateFlares(g, dt, deps)` once where the DECOY block was. Re-export `fireFlareSalvo` from the
   new module for existing import paths.
4. Update the 4 external readers above.
5. Update initializers (`initGame`, `editor-scene.ts`) — drop `flareSalvoClaims`.
6. Update reset paths (`game-sim-shop.ts` / wave close reset) — drop `flareSalvoClaims`.
7. Rewrite the flare unit tests in `game-sim.test.ts` against the new API/fields.

## Verification

- `npx tsc --noEmit` clean.
- `npx vitest run` green (flare tests rewritten).
- `npx tsx src/headless/sim-runner.ts 12345` and `999` — runs clean and **self-consistent**
  (re-sim hashes match). Determinism within the new system is the bar; parity with old behavior is
  explicitly NOT (user-approved).
- `npx playwright test e2e/smoke.spec.ts` green.
- `npx vite build` succeeds.
- **Feel-check handoff:** start dev server, cast L1 and L2 mid-wave, watch the three flagged feel
  items above. Report URL + what to watch; do not declare "done", declare "ready to feel-check".

## Consequences to surface in the PR

- Flare-exercising replay fixtures invalid → re-record before trusting any replay-based check.
- Perf baselines touching flares → recapture.
