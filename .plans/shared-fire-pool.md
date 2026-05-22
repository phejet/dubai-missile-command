# Plan: Shared Fire Pool (collapse "primed launcher")

## Design intent

After the two-launcher refactor the _player_ fires through a single
shared burst pool (`playerFireState` in `Game`), but the _bot / replay /
sim-runner_ path still routes through `fireInterceptor`'s per-launcher
reload gate (`launcherReloadUntilTick[idx]`). The mental model is split:
the human has no "primed launcher" concept; the bot still does.

Goal: one model everywhere. The shared pool is the sole rate-limit;
side-by-tap only chooses the _origin_ of the shot, never gates it.
`launcherReloadUntilTick` and `launcherFireTick` stop being load-bearing
gameplay state — at most they survive as render-only ticks for muzzle
flash decay.

---

## Phase 0 — Discovery & invariants

### 0.1 Every reader of per-launcher reload / fire state

- `launcherReloadUntilTick`
  - Written: `src/game-logic.ts:304` (every `fireInterceptor` call).
  - Read: `src/game-logic.ts:291` (the gate we're killing).
  - Also reset to zeros in `src/game-sim-shop.ts:332` (`prepareWaveStart`)
    and initialized in `src/game-sim.ts:377`.
  - **Verify**: search for any other reader. `getLauncherReadiness`
    (`src/game-logic.ts:577-582`) is the suspect — find its callers (HUD?
    bot lead calc? render?).

- `launcherFireTick`
  - Written: `src/game-logic.ts:303`.
  - Suspected reader: `src/pixi-render.ts` muzzle flash decay.
  - **Action**: grep before deciding. If render-only, keep the field but
    mark it explicitly render-state. If unused, delete.

### 0.2 Bot fire-rate knobs in `src/headless/bot-config.json`

Current values (post two-launcher commit):

- `cooldownNormal: 24` — main rate gate; tuned against per-launcher reload.
- `cooldownLowAmmo: 60` — slow-down when ammo is scarce.
- `cooldownHighThreat: 10` — speed-up under pressure.
- `fireRecoveryTicks: 8` — tick window after firing.
- `clusterRadius: 50` — area-deduplication.

Need to decide which survive once the shared pool is the sole rate-limit.
See Phase 4.

### 0.3 Action-log shape

- `FireAction.ignoreLauncherReload` (`src/types.ts:671-677`) — currently
  `true` for player-recorded actions, default-false for bot-recorded.
- After this refactor: vestigial. Keep the field as ignored-on-read for
  v3 replay back-compat; drop from new recordings.

### 0.4 HUD coupling (per the open question)

- `src/ui.ts` (and `HudSnapshot`): does it render per-launcher reload
  bars? Per-launcher ammo pips are correct (per-side magazines stay).
  Per-launcher _reload_ indicators contradict the new model and must
  collapse to a single "burst pool" pip / bar.
- Verify before touching the sim. If HUD already shows shared readiness,
  Phase 5 is a no-op.

### 0.5 Pool ownership decision

The `playerFireState` struct (`src/player-fire-limiter.ts:7`) currently
lives on the `Game` class and is **not serialized with replay
checkpoints**. It carries two distinct concerns on one struct:

- **Charge / refill state** — `burstCharges`, `burstChargeCap`,
  `nextRechargeTick`, `regenStreak`. Deterministic sim state.
- **`bufferedShot`** — input UX state. The "queue a tap until the pool
  refills" feature only exists during live play; recorded replays log
  successful fires only.

Move only the charge half onto `GameState`. The buffered shot stays
owned by `Game` / input code (or is explicitly excluded from
checkpoints + hashes). Moving the whole struct as-is would let an
in-flight buffered tap during recording diverge from replay state and
poison checkpoint hashes — a UI convenience leaking into determinism is
exactly the bug shape this plan exists to avoid.

Split the type accordingly:

- `FireChargeState` on `GameState` — the four charge fields above.
- `BufferedPlayerShot` — stays on `Game`, excluded from checkpoints.

Rename the charge-only state to `fireChargeState` (the "player"
adjective no longer fits now that bot and player share the rate-limit).

### 0.6 `getLauncherBurstChargeCap` is already correct

- `src/game-logic.ts:547-561`. Returns `Math.max(floor, naturalCap)`
  with floor 3 / 6 (Double Mag). Pool cap should call this with
  `activeLauncherCount`. No change needed for the cap itself.

### 0.7 Pool refill cadence

- `syncPlayerFireLimiter(state, tick, cap, reloadTicks)` —
  `src/player-fire-limiter.ts`. Refills `1 charge per reloadTicks`,
  capped at `cap`.
- `getLauncherReloadTicks(g)` — single value (rapid-reload-aware).
- Current behavior is correct for the unified model. No math change.

---

## Phase 1 — Move pool onto `GameState`

### Step 1.1 — Split the limiter type, then add `fireChargeState`

Order matters: split before renaming. A pure rename without the split
quietly drags input buffering into sim state.

1. In `src/player-fire-limiter.ts`, split `PlayerFireLimiterState`:
   - `FireChargeState` — `burstCharges`, `burstChargeCap`,
     `nextRechargeTick`, `regenStreak`. Sim state.
   - `BufferedPlayerShot | null` — separate field/type owned by
     `Game`. Not on `GameState`.
2. Rename charge-only helpers to match: `syncPlayerFireLimiter` →
   `syncFireChargeState`, `getPlayerBurstChargeCount` →
   `getFireChargeCount`, `spendPlayerBurstCharge` → `spendFireCharge`.
   `bufferPlayerFire` / `getBufferedPlayerFire` /
   `consumeBufferedPlayerFire` stay (input-side), but operate on the
   `Game`-owned buffer field instead of the old combined struct.
3. `src/types.ts:531+` — add `fireChargeState: FireChargeState` to
   `GameState`. Import from `src/player-fire-limiter.ts`.

### Step 1.2 — Initialize & reset

- `src/game-sim.ts:374-380` (`initGame`) — initialize with
  `createFireChargeState()` (factory in `player-fire-limiter.ts`;
  add if missing).
- `src/game-sim-shop.ts:328+` (`prepareWaveStart`) — reset pool so
  every wave starts with a full charge bar.
- `src/editor-scene.ts:366-368` — fake state needs the field too.

### Step 1.3 — Re-wire `Game`

- `src/game.ts` — delete `this.playerFireState` (the combined struct).
  Replace with a small `private bufferedPlayerShot: BufferedPlayerShot
| null = null` field for queued taps.
- `requestPlayerFire`, `releaseBufferedPlayerFire`, `handlePointerDown`:
  charge sync/spend goes through `game.fireChargeState`; buffered-shot
  storage goes through `this.bufferedPlayerShot`.

### Step 1.4 — Replay snapshot includes the pool

- `src/replay-debug.ts:77-79, 111-113` — checkpoint serializer adds
  `fireChargeState: { ...g.fireChargeState }`. Safe to include only
  _after_ Phase 1.1 split — otherwise the snapshot leaks `bufferedShot`
  and poisons checkpoint hashes.
- Length-agnostic; no hash math change beyond version bookkeeping
  (see 6.5).

---

## Phase 2 — Make `fireInterceptor` the single chokepoint

### Step 2.1 — Pool consumption inside `fireInterceptor`

Replace the per-launcher reload gate at `src/game-logic.ts:280-321`:

```ts
export function fireInterceptor(g: GameState, targetX: number, targetY: number, tick = g._replayTick ?? 0): boolean {
  const selectedIdx = targetX < CANVAS_W / 2 ? 0 : 1;
  const fallbackIdx = selectedIdx === 0 ? 1 : 0;
  const bestIdx = g.launcherHP[selectedIdx] > 0 ? selectedIdx : g.launcherHP[fallbackIdx] > 0 ? fallbackIdx : -1;
  if (bestIdx === -1) return false;

  const l = getGameplayLauncherPosition(bestIdx);
  const dx = targetX - l.x;
  const dy = targetY - l.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return false;

  const activeLauncherCount = countAliveLaunchers(g);
  const cap = getLauncherBurstChargeCap(g, activeLauncherCount);
  const reloadTicks = getLauncherReloadTicks(g);
  syncFireChargeState(g.fireChargeState, tick, cap, reloadTicks);
  if (getFireChargeCount(g.fireChargeState) <= 0) return false;
  if (!spendFireCharge(g.fireChargeState, tick, reloadTicks)) return false;

  // … existing geometry + interceptor push, but **drop the writes to**:
  //   g.launcherFireTick[bestIdx]
  //   g.launcherReloadUntilTick[bestIdx]
  // (or keep launcherFireTick if render needs it; see 2.3)
  return true;
}
```

Notes:

- The `ignoreLauncherReload` parameter is **removed**. No caller needs
  to bypass anything because there's no per-launcher gate left.
- `countAliveLaunchers(g)` — small helper, or inline. Already exists
  in `Game.getActiveLauncherCount`; lift to `game-logic.ts`.
- Order is load-bearing: pick side → validate geometry (`len < 1`
  rejects clicks exactly on the launcher) → only then drain the pool.
  Reversing pool-spend and geometry would let a degenerate click pay
  a charge without producing an interceptor.

### Step 2.2 — Caller cleanup

- `src/game.ts:907` — drop the `true` arg.
- `src/game.ts:924-958` (`requestPlayerFire`, `releaseBufferedPlayerFire`):
  remove the `syncPlayerFireLimiter` / `getPlayerBurstChargeCount` /
  `spendPlayerBurstCharge` calls. The bookkeeping is inside
  `fireInterceptor` now. Keep the _buffered shot_ logic — that's a
  player UX feature (queue tap until pool refills) and lives at the
  call site.
- `src/replay.ts:117` — drop `!!action.ignoreLauncherReload`.
- `src/headless/sim-runner.ts:178`, `src/headless/shot-audit.ts:143` —
  signature shrinks; no logic change.
- Add a non-firing sync helper `syncFireChargeForTick(g, tick)` that
  advances refill state without attempting a shot. Call it from
  `fireInterceptor`, from buffered-fire release, and from HUD snapshot
  construction. Without this helper the displayed charge bar sits
  stale between taps — time would only advance when someone clicked,
  which is the kind of HUD bug players notice and engineers don't.

### Step 2.3 — Render coupling on `launcherFireTick`

Three options:

1. **Keep** `launcherFireTick` as render-only state, written inside
   `fireInterceptor` after the pool spend. Add a one-line comment that
   it's render-only.
2. **Delete** it; have the renderer compute muzzle decay from the
   pool's `lastSpendTick` plus a per-side flag.
3. **Delete** it; render reads `interceptors[]` with a small "young"
   threshold for muzzle flash.

Decision: option (1) is the smallest diff. Phase 0.1 might reveal that
nothing actually reads it, in which case go with option (2)/(3).

---

## Phase 3 — Delete dead state

### Step 3.1 — Remove from `GameState`

- `src/types.ts:534-537`:
  - `launcherReloadUntilTick: [number, number]` → **delete**.
  - `launcherFireTick: [number, number]` → delete or downgrade to
    render-only per Phase 2.3.
  - `ammo: [number, number]` → **keep** (real per-side magazines).

### Step 3.2 — Initializer sweep

- `src/game-sim.ts:374-380`, `src/game-sim-shop.ts:328-333`,
  `src/editor-scene.ts:366-368`, `src/game.ts:109-114` HUD default —
  remove the obsolete fields.

### Step 3.3 — Test fixture sweep

- `src/game-logic.test.ts:34-47` — drop `launcherFireTick` /
  `launcherReloadUntilTick` from `makeGameState`.
- `src/ui.test.ts:14-22` — drop the corresponding HUD fixture entries.
- `src/headless/bot-brain.test.ts` — fixtures.
- Anywhere else that pokes the deleted fields.

---

## Phase 4 — Bot retune

### Step 4.1 — Decide which cooldowns survive

Recommendation:

- **Keep** a conservative global `cooldownNormal` at first. The shared pool is
  now the hard rate-limit, but the bot cooldown also feeds target reservation
  windows and anti-waste behavior. Removing it in the same change makes the
  retune harder to diagnose.
- **Trim or remove** `cooldownLowAmmo`, `cooldownHighThreat`, and
  `fireRecoveryTicks` only after the canary and small training batch show the
  bot is not over-firing.
- **Keep** a single cluster-suppression cooldown: "don't tap within
  `clusterRadius` of a previous tap inside the last N ticks." Rename
  to `clusterCooldownTicks` (~12-18 ticks) to make intent clear.
- Pool size & refill cadence become the primary gameplay tuning surface;
  cooldown remains a bot-behavior knob until proven redundant.

Cleanup target for a later diff: once retraining proves reservations
plus cluster suppression are enough, remove `cooldownNormal`. One axis
at a time — the bot is hard enough to debug without changing six knobs
in the same pass.

### Step 4.2 — Sanity-run + canary update

- `npx tsx src/headless/sim-runner.ts 42` → new score/wave; update
  `src/headless/sim-runner.test.ts:196-202` golden-seed canary to the
  new value. Treat it as a moving floor, not a stable contract.

### Step 4.3 — Full retrain

- `/train-bot` skill (`node src/headless/train.js`).
- Target: median wave-reached ≥ post-two-launcher baseline.
- If retrain shows the bot under-firing → reduce `clusterCooldownTicks`
  or raise pool refill rate. Over-firing → opposite.

---

## Phase 5 — HUD audit

### Step 5.1 — Collapse per-launcher reload UI (if present)

- Search `src/ui.ts` and any pixi HUD render for per-launcher reload
  visualization (progress bar, blinking pip, etc.).
- Replace with a single "burst pool" indicator. Ammo pips per side
  remain.
- If no per-launcher reload UI exists, this phase is a no-op.

### Step 5.2 — `HudSnapshot` shape

- `src/ui.ts:HudSnapshot` — drop anything tied to `launcherReloadUntilTick`.
- Add `fireChargeCount` / `fireChargeCap` if the HUD needs to render the
  pool.
- `src/game.ts:buildHudSnapshot` — update accordingly.
- Before building the snapshot, call the shared non-firing sync helper so
  passive recharge is visible even when the player is not actively tapping.

---

## Phase 6 — Verification

### 6.1 New tests

In `src/game-logic.test.ts`:

- "consecutive taps from the same side drain the shared pool, not just
  one launcher": rapid-tap left → assert pool decreases, not
  per-launcher state (since it's gone).
- "tap left then right both fire if pool has charges": proves the pool
  gates, not per-launcher reload.
- "pool refills at reloadTicks cadence regardless of which side last
  fired": fire from left, advance tick by `reloadTicks`, fire from
  right — both succeed.
- "burst cap floor preserved": with `launcherHP=[1,1]`, pool cap is 3.

In `src/replay.test.ts`:

- "v2 replay with `ignoreLauncherReload: true` actions plays without
  throwing on the new schema" (ignored field is tolerated).

### 6.2 Tests to delete

- `src/game-logic.test.ts:269-273` — "does not fall back to the
  opposite origin when the selected launcher is reloading". The
  per-launcher reload it asserts against no longer exists.
- Any other test referencing `launcherReloadUntilTick` /
  `launcherFireTick` semantically (i.e. not just as fixture noise).

### 6.3 Headless sim canary

- `npx tsx src/headless/sim-runner.ts 42` → record new score/wave;
  update test.
- `node src/headless/train.js` smoke pass (small batch) before full
  retrain.

### 6.4 Manual smoke

- `npm run dev`. Waves 1-3 desktop:
  - Rapid-tap left side: shots come out at pool's rate, not per-launcher
    rate.
  - Tap left → right alternating: both fire, pool drains regardless of
    side.
  - HUD shows shared readiness, not per-launcher reload bars.
- iOS path can wait until after retraining.

### 6.5 Replay version

- Already on v3. Adding `fireChargeState` to checkpoints **bumps shape**
  and changes the firing model.
- Recommendation: **bump to v4 unconditionally**. This repo already has v3
  replay fixtures under `public/replays/`, and the writer currently emits v3.
  Do not leave this as a maybe. Maybe is where compatibility bugs go to breed.
- Re-record or migrate committed perf replay fixtures after the implementation.

---

## Phase 7 — Risk register

1. **Render coupling on `launcherFireTick`.** If muzzle flash silently
   relies on it and we delete the field, the flash disappears. Phase
   0.1 must find this before Phase 3.1.

2. **Bot trigger-happiness without cooldowns.** The pool's refill rate
   may not be slow enough to prevent the bot from spamming the same
   cluster. Mitigation: `clusterCooldownTicks` (Phase 4.1) and/or a
   conservative pool refill rate. Validate with `/train-bot`.

3. **Perf baseline re-record.** Same workflow as the two-launcher
   refactor: re-record after this lands. Flag in commit message.

4. **Replay v3 fixtures.** Any v3 replay recorded between the
   two-launcher commit and this one will have written checkpoints
   without `fireChargeState`. Loading should fall back to a freshly
   initialized pool rather than throw. Phase 6.1 covers this in tests.

5. **HUD desync.** If HUD still shows per-launcher reload bars after
   the gate is gone, players see contradictory feedback. Phase 5
   prevents this; do not skip if HUD has per-launcher reload UI.

6. **`launcherReloadUntilTick` is referenced outside the sim.** E.g.
   editor inspector, debug overlays, save serialization. Phase 0.1
   grep needs to be thorough; broken references will be type-errors
   after Phase 3.1, so `npx tsc --noEmit` is the safety net.

7. **`fireInterceptor` signature change breaks call sites.** Removing
   `ignoreLauncherReload` is a breaking API change. Fine because all
   callers are in this repo; TS will catch them. Just don't forget
   `src/headless/bench-draft.ts` (mentioned in original plan but not
   touched in the two-launcher commit).

---

## Critical files

- `src/game-logic.ts` — `fireInterceptor` gate removal, pool consumption.
- `src/types.ts` — `GameState` shape, `fireChargeState` field,
  `FireAction.ignoreLauncherReload` deprecation note.
- `src/player-fire-limiter.ts` — rename, factory export.
- `src/game.ts` — drop class field, route through `game.fireChargeState`.
- `src/game-sim.ts`, `src/game-sim-shop.ts`, `src/editor-scene.ts` —
  init + wave reset.
- `src/replay.ts`, `src/replay-debug.ts` — drop `ignoreLauncherReload`
  read, snapshot includes pool.
- `src/headless/bot-config.json` — cooldown trim.
- `src/pixi-render.ts` — muzzle flash input decision (Phase 2.3).
- `src/ui.ts` (and any HUD render file) — single readiness indicator.
