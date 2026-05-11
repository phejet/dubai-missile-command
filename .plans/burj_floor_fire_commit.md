# Burj floor-fire — commit & extend

Status: the floor-fire approach lands. This plan moves the static parts of the
damage into baked sprites, raises HP from 5 to 6, and adds a terminal
"burning-but-standing + flashing CRITICAL" state.

## Where we are (current behavior)

- `BURJ_BRIGHT_BANDS` is the source of truth for the tower's white setback
  stripes (`art-render.ts:2879`). Five lowest entries (ht 0.11–0.59) are
  hijacked as HP1..HP5 anchors by `getPixiBurjBaseHealthLayout` in
  `pixi-render.ts:577`.
- Per-frame `updateBurjBaseHealthBar` (`pixi-render.ts:~2536`) skips drawing
  for active floors (their baked brightBand glow IS the active state) and
  draws fire on lost floors via `drawBurjFloorFire`.
- `drawBurjFloorFire` currently does both static _and_ dynamic work each
  frame: char backing + glowing wreckage core + ember segments (static-ish)
  AND flame tongues, drips, smoke, ignition flash (truly dynamic). The
  static parts should move into a baked sprite.

## Goals

1. **Bake damaged-band sprites.** Six small textures, one per HP band,
   containing only the static damage (char backing + dim red glow core).
   The fire overlay shrinks to just animated parts: tongues, embers, drips,
   smoke, ignition flash.
2. **HP 5 → 6.** Anchor to the lowest 6 brightBands (ht 0.11–0.75). The top
   architectural band at ht=0.88 stays as plain unrelated architecture.
3. **Burning-but-standing terminal state.** At `burjHealth === 0`, all six
   bands burn, the tower sprite stays standing (no wreckage swap), and a
   flashing red `CRITICAL` indicator pulses near/over the tower for the
   duration of the existing `gameOverTimer` window (60 ticks).

## Tasks

### 1. Bake damaged-band textures

- New helper `drawBurjDamagedBandSprite(ctx, halfW, thickness)` in
  `art-render.ts` that draws onto a Canvas:
  - Char backing rect spanning `±halfW × 1.08` and band height + ~3px
    overshoot top, ~3.5px overshoot bottom; near-black fill (`#07050a`
    at 0.95 + inner `#1a0c08` at 0.78).
  - Dim crimson wreckage core (`#6e1a0a` / `#c83a1c` / `#ff8a30` /
    `#ffd968`) layered in narrower-and-shorter passes inside the char.
  - 4–5 fixed-position broken-stripe embers along the band's midline —
    static here, no flicker. (Flicker happens at runtime via alpha on a
    layered Graphics overlay; see §3.)
- Pipeline:
  - Add `damagedBandSprites: Texture[]` (length 6) to `PixiBurjAssets` in
    `pixi-textures.ts`.
  - Sources baked via the same `createSpriteCanvas` path used by
    `buildBurjAssets` — one canvas per band, sized exactly to char-rect
    footprint at the chosen `artScale` (2 for gameplay).
  - Cache like the other baked assets in `canvas-render-resources.ts` and
    `pixi-textures.ts`. Cache key includes `artScale` and the
    `BURJ_BRIGHT_BANDS` band index.

### 2. Wire damaged-band sprites into the scene

- In `setupGameplayScene` (around `pixi-render.ts:1569`), add 6 Sprite
  nodes inside `burjContainer` (so they scale 2× with the tower). Position
  each sprite to overlay the corresponding bright stripe in canonical
  coords; the texture already carries the overshoot.
- Place them above the baked `burjAnim` brightBand sprite but below
  `damageMask`-clipped layers? — verify: we want the damage to cover the
  bright stripe but NOT be clipped by the impact damageMask, since the
  band damage is independent of impact craters. Add them outside the
  `damageMask` if needed.
- Store sprite refs on the scene state (e.g.
  `state.burjDamagedBandSprites: Sprite[]`). Each frame, set
  `sprite.visible = floorIndex >= health` (treat HP=0 as "all visible").
- Remove the equivalent static draws from `drawBurjFloorFire` — leave
  only flame tongues, ember flicker, drips, smoke, and the just-lost
  ignition flash.

### 3. HP 5 → 6

- `BURJ_MAX_HEALTH = 6` in `pixi-render.ts:336`.
- `getPixiBurjBaseHealthLayout` already reads `BURJ_BRIGHT_BANDS[index]`
  with `length: BURJ_MAX_HEALTH` so this picks up the 6th band (ht=0.75)
  for free. Sanity-check the resulting `frameY/frameH` covers all six.
- Update initial / cap values:
  - `burjHealth: 5` → `6` in `game-sim.ts:202`, `editor-scene.ts:305`,
    `game.ts:106`.
  - `Math.min(5, g.burjHealth + 1)` → `Math.min(6, ...)` in
    `game-sim-shop.ts:133` (burj repair kit).
  - Update mock values in `ShopUI.test.ts:34` and `ui.test.ts:12`.
- Update the `getPixiBurjBaseHealthLayout` test in `pixi-render.test.ts`
  to assert `maxHealth === 6` and `floors.length === 6`, and that the top
  floor's `ht` corresponds to band 5 (ht=0.75) by checking its `y` is
  roughly `towerBaseY - 340 × 0.75 × 2 = towerBaseY − 510`.

### 4. Burning-but-standing terminal state + CRITICAL flash

The current path on Burj death: `applyBurjHitDamage` sets
`burjAlive = false` at HP ≤ 0 and emits a `boom`. The sim then starts a
60-tick `gameOverTimer` (`game-sim.ts:2318`). After 60 ticks → state
flips to `"gameover"`.

We want: during those 60 ticks, the tower remains visually standing with
**all 6 bands burning** and a **flashing red CRITICAL** indicator.

- **Remove the early return** in `updateBurjBaseHealthBar` for `!burjAlive`.
  Instead, when `!burjAlive && gameOverTimer > 0`, render fire on every
  floor (treat `health = 0`, so every floor is lost). Skip rendering
  entirely once `state === "gameover"` to avoid double-drawing on the
  game-over screen.
- **Keep the tower sprite up.** Audit what currently changes at
  `burjAlive=false`:
  - `drawBurjWreckage` exists at `pixi-render.ts:1033` — find where it's
    triggered. If the renderer swaps to wreckage when `burjAlive=false`,
    delay that swap until `gameOverTimer === 0` (so the tower stays for
    the burning-standing window, and wreckage shows only on the game-over
    transition or screen).
  - Confirm `damageMask`-clipped layers don't visually collapse the tower.
- **CRITICAL indicator.** New per-frame Graphics in the gameplay overlay
  layer. Active condition: `!burjAlive && gameOverTimer > 0` (or
  alternative: `health <= 0 || critical_flag`). Visuals:
  - Centered "CRITICAL" text label above the tower (around `BURJ_X,
GAMEPLAY_TOWER_BASE_Y - BURJ_H × 2 - 60`). Bright red `#ff2a20` with
    a darker red drop shadow.
  - Alpha pulses at ~2.5 Hz: `0.35 + 0.65 × |sin(sceneTime × 5)|`.
  - Optional: short red screen-edge vignette pulse synchronized to the
    flash. Skip for the first pass; iterate if it reads weak.
  - Optional SFX hook: emit `"alarm"` event from the sim when burj first
    dies, looped until `gameOverTimer === 0`. Leave wiring to a follow-up
    if there's no existing alarm SFX.

### 5. Cleanup

- After §1+§2 land, `drawBurjFloorFire` should be ~⅓ shorter. Verify and
  trim dead code.
- Confirm the existing 60-tick `boom` at `applyBurjHitDamage:139` still
  reads okay with the tower still standing — it's a small 90px explosion
  at mid-height which should look like the _last hit_ rather than the
  tower collapsing. If it's now jarring, downsize or relocate.

## Open questions to confirm before coding

1. **HP=0 final state — does the player ever recover?** Assumption:
   no. HP=0 → game over after 60 ticks, same as today; we just change
   the _visual_ of those 60 ticks. If the user wants HP=0 to be a
   non-terminal "you must repair fast or die" state, that's a bigger
   game-logic change.
2. **CRITICAL placement.** Above the tower vs HUD vs both. Default:
   above the tower, where the player's eye is already focused.
3. **Damaged sprite cache scope.** One texture per band per artScale,
   or one shared texture stretched per band? Default: one per band per
   artScale, since baked detail benefits from native size and we only
   have 6 of them.

## Files touched

- `src/art-render.ts` — `drawBurjDamagedBandSprite`, possibly export.
- `src/canvas-render-resources.ts` — bake/cache damaged sprites.
- `src/pixi-textures.ts` — extend `PixiBurjAssets` with the textures.
- `src/pixi-render.ts` — bump `BURJ_MAX_HEALTH`, wire sprites into scene,
  trim `drawBurjFloorFire`, add CRITICAL indicator, drop early-return on
  death.
- `src/game-sim.ts`, `src/editor-scene.ts`, `src/game.ts`,
  `src/game-sim-shop.ts` — HP initial + repair cap.
- `src/ShopUI.test.ts`, `src/ui.test.ts`, `src/pixi-render.test.ts` —
  test mocks + assertions.

## Verification

- `npx vitest run` — full suite must pass.
- `npx tsc --noEmit` — clean.
- `npm run dev` and eyeball:
  - Full HP (6): 6 bright stripes lit normally, no fire, no CRITICAL.
  - Take 1–5 hits: damaged sprites appear on the lost bands' positions
    with fire overlay; baked stripe is fully obscured.
  - Burj death (last hit): all 6 bands ignite within one frame, tower
    stays standing, CRITICAL pulses red overhead for 60 ticks, then
    game-over screen appears.
  - Repair kit purchase at HP=5: regenerates to HP=6 (the new max), top
    band re-lights, fire on band 5 extinguishes.
- Replay determinism unchanged — no sim logic moved.

## Out of scope (for follow-up)

- Alarm SFX wiring.
- Screen-edge red vignette during CRITICAL.
- Tower-shake or screen-shake on Burj death.
- Tuning fire constants (handled iteratively after the bake lands).
