# Tower Health Fire Visual Plan

Snapshot baseline: `997d9d7` (`Snapshot Burj fire health visuals`)

## Goal

The Burj is on fire because it has been hit. The fire is mood and atmosphere, not a precise HP readout. Three other channels already carry that load:

- **Hit flash** (per-hit feedback) — bloom + ember kick at the impact, decays in ~1s
- **CRITICAL banner** (1 HP state) — already implemented
- **End-of-wave card** (precise HP number) — already implemented

The visual target is the **left** reference variant from the latest comparison sheet:

- localized upper-spire fire
- natural smoke plume rising above the damage
- sparse embers around the damaged region
- strong orange internal glow
- no rectangular clipped flames
- lower tower and surrounding battlefield remain clear

Gameplay signalling first, decoration second. Pretty fire that hides threats is sabotage with a particle budget.

## Design Rules

1. Clip only structural damage (scorch, window glow) to the Burj silhouette.
2. Do not clip flame tongues, smoke, or embers to floor rectangles.
3. Damage maps to **intensity at a fixed upper-spire region**, not to vertical extent. The fire never creeps down the silhouette.
4. The tower tip/beacon remains readable through the fire until the death transition.
5. Smoke stays low alpha and drifts upward, never an opaque wall over incoming threats.
6. Fresh-hit flashes may be explosive; persistent damage is restrained.
7. Tuning constants live in the `burjFire.*` override path so the editor drives the feel-check loop. Add `burjFire.anchorHeightMin` so the upper-region clamp is editable.
8. **Live flame particles only spawn from the topmost damaged band.** Lower lost bands carry scorch + internal glow only, never flame.
9. Flame tongues are composed of two sprites per anchor: a normal-blend orange body and a smaller additive yellow-white core. The core is what produces the "strong orange internal glow."

## Visual Layers

Four layers, each with its own clipping rule.

### 1. Internal Scorch And Glow (clipped)

Purpose: structural damage texture inside the silhouette.

- Drawn inside the Burj mask.
- One subtle scorch + warm window glow per lost HP segment, confined to the upper-spire region.
- Warm orange/red dominant; restrained soot. Goal is "glowing from within," not "blackened chunk."
- Freshly lost band gets a short brighter pulse driven by the hit-flash timer.

### 2. Flame Tongues (unmasked)

Purpose: live fire at the spire.

- 2–4 anchor points, all on the **topmost** damaged band only.
- Anchors clamped to the upper-spire region via `burjFire.anchorHeightMin`.
- Per anchor, two sprites:
  - **body**: larger, normal blend, orange, ~0.5 alpha
  - **core**: smaller, additive blend, yellow-white, ~0.7 alpha
- Vertically oriented, anchored near the base, scale/alpha/sway per-particle.
- Restrained density — overlapping sprites must not fuse into a single glowing slab.

### 3. Smoke (unmasked)

Purpose: tall plume that sells "this thing is burning."

- Spawn exclusively from the topmost damaged band.
- Narrow lateral spawn (~`halfW * 0.2`), strong vertical rise, long life. Goal is a tall narrow plume, not a wide pillar.
- Fade in fast, grow, fade out slowly.
- Two sublayers:
  - **warm sublayer**: short-lived, orange-tinted, near the fire base. Lit-from-below look.
  - **cool plume**: longer-lived, gray (darker at lower HP), rising past the warm layer into the sky.
- Alpha capped so threats over the plume remain visible.
- Smoke container sits in the unmasked gameplay particle layer **above** the Burj node so the rising plume isn't clipped at the spire tip.

### 4. Embers And Sparks (unmasked)

Purpose: arcade motion at the fire region.

- Sparse square-ish embers around the topmost damaged band.
- Small upward flicks, sustained at low density; fresh hits inject an outward spray.
- Density scales gently with severity tier, never enough to clutter threat readability.

## Health Mapping (Four Tiers)

Precise HP is not communicated through the fire — it's read off the wave-end card. The fire communicates a **felt tier**, of which there are four:

| Tier         | HP  | Persistent fire                                                                                       |
| ------------ | --- | ----------------------------------------------------------------------------------------------------- |
| **Pristine** | 7   | No fire, no smoke, no embers.                                                                         |
| **Wounded**  | 6–5 | Small torch at the spire tip, faint smoke wisp, occasional ember. Subtle scorch on damaged section.   |
| **Burning**  | 4–2 | Sustained spire flame (body + core), darker plume, ongoing embers, visible warm scorch on the spire.  |
| **Critical** | 1   | Existing CRITICAL banner + max-tier flame, heaviest plume, ember spray. Banner does the discrete cue. |

Every tier lives at the same vertical region (upper spire). What changes between tiers is **intensity**: flame rate/size, smoke density and darkness, ember count. Vertical extent never changes.

Within a tier, HP transitions (e.g. 5 → 4 within Wounded, 4 → 3 within Burning) shift intensity smoothly but do not need to be individually distinguishable — the hit flash itself is the per-hit feedback, and the wave-end card carries the number.

Death (`0 HP`) is its own transition state and uses its own collapse treatment, not handled by this plan.

## Per-Hit Reaction

Every hit, regardless of tier, kicks the persistent fire up briefly and decays back to the tier baseline. Driven by `burjHitFlashTimer` / `burjHitFlashMax`.

For the duration of the flash:

- bright orange-white bloom on the newly lost band (already exists)
- outward ember spray (already partially exists)
- flame rate / smoke rate multiplied (~3–4×) then decays back
- flame body size temporarily boosted (~+50%)

Punchier than persistent fire. Decays back into the tier baseline in ~1 second.

## Implementation Plan

### Step 1: Anchor Helper

Add a helper in `src/art-render.ts` (next to `getBurjBaseHealthFloorLayout`) that, given `burjHealth`, returns:

- the **topmost** damaged band rectangle (for clipped scorch and as the spawn region for flame/smoke/ember anchors)
- the list of **older** damaged band rectangles (clipped scorch + window glow only — no flame anchors)
- 2–4 deterministic flame anchor points inside the topmost band, clamped to `anchorHeightMin`
- a single smoke anchor at the top of the topmost band
- a deterministic seed per anchor

Deterministic per band index + game seed, not random per frame.

### Step 2: Rework Render Composition

In `src/pixi-render.ts`:

- Keep scorch / window glow masked to the Burj.
- Remove any full-rectangle fire fills that read as clipped.
- Confirm layer order:
  1. tower static sprite
  2. clipped scorch / internal glow
  3. tower animated lights / details
  4. unmasked flame tongues (body + additive core)
  5. unmasked embers
  6. unmasked smoke — above flames _in z-order_ so the plume rises past the spire without being clipped
- Verify smoke container is in the gameplay particle layer, above the Burj node.

### Step 3: Tune Sim Particle Spawning

In `src/game-sim.ts` (`updateBurjFireParticles`):

- Replace the per-floor loop with a single topmost-band emitter for flames, smoke, and embers. Older lost bands contribute nothing to particle spawning.
- Drive emitter rates from the tier (Wounded / Burning / Critical) plus a per-hit multiplier from `burjHitFlashTimer`.
- Confirm overrides exist for:
  - `burjFire.flameRate`, `burjFire.flameLife`, `burjFire.flameSize`, `burjFire.flameAlphaMul`
  - `burjFire.smokeRate`, `burjFire.smokeAlphaMul`, `burjFire.smokeGrowth`
  - `burjFire.emberRate`
  - `burjFire.hotspotSpread`, `burjFire.anchorHeightMin` _(new)_
  - `burjFire.hitFlashFlameMul`, `burjFire.hitFlashSmokeMul` _(new — drive the per-hit kick)_

Cap aggregate spawn rate so smoke/flame never fully obscure threats near the Burj.

### Step 4: Per-Hit Kick

The hit flash already paints a bloom. Extend it so during `burjHitFlashTimer > 0` the sim multiplies flame and smoke rates (`hitFlashFlameMul`, `hitFlashSmokeMul`) and bumps flame body size. Decay is the existing timer; no new state needed.

### Step 5: Editor Support

The `burjFire.*` overrides are mostly wired already. Confirm controls for the full set above, including the two new keys (`anchorHeightMin`, `hitFlashFlameMul`/`hitFlashSmokeMul`) and a "preview Burj HP" slider so all four tiers can be feel-checked without playing a real wave.

## Verification Plan

### Automated

```bash
npm run typecheck
npx vitest run src/art-render.test.ts src/pixi-render.test.ts
```

Browser smoke if preview binding works:

```bash
npx playwright test e2e/smoke.spec.ts
```

New focused tests:

- at 7 HP, no fire/smoke/ember particles spawn
- flame and smoke particles only spawn within the topmost damaged band's region (anchor y above the rest of the silhouette)
- particle rates increase monotonically across tier boundaries (Pristine → Wounded → Burning → Critical)
- `burjHitFlashTimer > 0` produces a measurable spike in flame/smoke spawn rate that decays with the timer
- critical state is driven by HP = 1, not post-death

### Browser/Visual

Run the dev server and inspect each tier:

- 7 HP (pristine)
- 5 HP (wounded — torch + wisp)
- 3 HP (burning — sustained flame + plume + embers)
- 1 HP (critical — banner + max fire)
- fresh hit moment versus persistent state (hit at 5 HP should briefly look like burning, then settle back)
- threats spawning at the top and crossing near the plume
- mobile portrait viewport
- CanvasRenderer fallback path

Acceptance:

- no rectangular clipped flames
- fire stays at the upper-spire region across all tiers; lower body and skyline stay clean
- tier change is felt within ~1 second when crossing a boundary
- threats remain readable over and near the tower
- critical state feels urgent but playable
- no Pixi render-loop errors or full-screen flicker

## Open Questions

- Smoke drift direction — deterministic per run, or always lean slightly right for composition? (Lean toward deterministic-per-run with a small fixed bias.)
- Mobile critical state — suppress some smoke on small viewports to preserve threat readability?
