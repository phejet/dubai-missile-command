# EMP "BOOM screen-clear" Overhaul

## Problem

The current EMP shockwave damages threats correctly but feels weightless — players described it as a "UV bug zapper, not a detonation." For a once-per-wave panic button it should be the most physically forceful effect in the game; right now it has the _weakest_ shake.

## Audit of current implementation

### Visuals

- **One Burj ring** (level 1 + 2): radius 0 → `EMP_BURJ_MAX_RADIUS = [650, 1040]`, expanding linearly at `10 * expandRate * dt` px/tick (`game-sim.ts:1447`). Reaches max in ~65 ticks (~1.1 s) at rank 1, ~43 ticks at rank 2.
- **Launcher rings** (rank 2 only): one per alive launcher, max radius 500 px, same expand rate (`game-sim.ts:2369-2382`).
- **Render** (`pixi-render.ts:3137-3160`):
  - `wash` sprite: alpha `ring.alpha * 0.2`, tinted `COL.emp` (#cc44ff)
  - `ring` sprite: alpha `ring.alpha * (0.8 + (1 - progress) * 0.18)`
  - **Initial flash**: full-canvas purple rect, alpha `(1 - progress / 0.15) * 0.18`, only during first 15% of expansion
- **Per-kill burst** (`game-sim.ts:1463-1477`): 15 violet/white sparks, speed 2-7, life 20-50 ticks. Visually identical to a normal threat death.

### Audio (`sound.ts:851-882` — `empBlast`)

- Sine 200→1200→80 Hz, gain 0.25, 0.5 s — chirp
- Sawtooth 600→100 Hz, gain 0.12, 0.4 s — buzz
- Sine 60 Hz, gain 0.3, 0.3 s — thump

### Haptics (`game-sim.ts:2385-2386`)

- `shakeTimer = 6`, `shakeIntensity = 3`

For comparison, a single building hit is `15×6` and a launcher destruction is `12×5`. **The EMP is the weakest screenshake in the game.** Worse, see Tier 0.1 below: shake is currently dead state. None of these constants matter until shake is actually rendered.

### Diagnosis

| Symptom                                             | Root cause                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No "punch" frame                                    | Flash α capped at 0.18, fades over 15% of a 1 s expansion — never reads as a flashbulb           |
| No felt impact                                      | Shake intensity 3, weakest of any major event                                                    |
| Ring looks lazy                                     | Linear 10 px/tick is _slow_ — eyes track it, brain registers "expanding circle" not "blast wave" |
| Per-kill anonymous                                  | Same 15 sparks every threat; no "the EMP did this" signature                                     |
| No chest-thump                                      | Sound graph has no sub-bass kick, no broadband noise burst                                       |
| Rank 2 launcher rings feel additive, not concussive | Same render path, same expansion rate, no muzzle flash, no extra shake                           |

## Solution overview

Re-stage the EMP as a layered **punch frame → wave of light → afterglow** composition. Implementation broken into five tiers; **Tier 0 is mandatory infra/bug-fix prerequisites** uncovered by Codex review — without it the rest is constants connected to nothing.

---

## Tier 0 — prerequisites (mandatory before any tuning)

These are bugs and missing infra that the original plan assumed were working. Verified against the codebase; all confirmed.

### 0.1 Implement screenshake in the renderer

`shakeTimer` and `shakeIntensity` are written by ~10 call sites across `game-sim.ts` / `game-logic.ts`, decremented in `game-sim.ts:2180`, and **never read by anything**. No Pixi code consumes them. The whole shake system has been dead state for the entire pixi migration.

**Fix:**

1. In `pixi-render.ts`, before composing the gameplay frame, compute a shake offset:
   ```ts
   let shakeX = 0,
     shakeY = 0;
   if (game.shakeTimer > 0 && game.shakeIntensity > 0) {
     const decay = Math.min(1, game.shakeTimer / 8); // taper last 8 ticks
     const amp = game.shakeIntensity * decay;
     shakeX = (Math.random() - 0.5) * 2 * amp;
     shakeY = (Math.random() - 0.5) * 2 * amp;
   }
   gameplayScene.position.set(shakeX, shakeY);
   ```
2. Verify pointer-event mapping is unaffected. Pixi pointer events fire in the layer's local coordinate space, so shaking the gameplay container should not break input. Confirm with a manual playtest: trigger a building-destroyed shake and tap accurately mid-shake.
3. Editor preview should _not_ shake — gate by checking we're rendering a gameplay scene, not editor.

**Why before EMP:** if shake doesn't work, every shake-using effect in the game (building hits, launcher destruction, big explosions) is also silently broken. Fixing shake fixes the whole game's haptics — EMP is just the test case.

### 0.2 Fix double-trigger of `empBlast` SFX

`fireEmp()` in `game-sim.ts:2387` emits `onEvent("sfx", { name: "empBlast" })` which routes through `handleSimEvent` → `sfxMap.empBlast` → `SFX.empBlast()` (`game.ts:705`). The controller _also_ calls `SFX.empBlast()` directly right after firing (`game.ts:1016`). Result: every manual EMP plays the sound twice, mixed phase-coherently — louder, but also masking what the sound actually is.

**Fix:** Remove the direct `SFX.empBlast()` call at `game.ts:1016`. The sim-event path is the canonical route for replay-determinism reasons (replays need to emit the event so the harness can play sounds). Manual fire takes the same path.

Cross-check: are there other duplicates? `SFX.planeIncoming()` at `game.ts:1010` does _not_ go through the event bus — `simFireF15Pair` doesn't emit a `planeIncoming` event. So that one is single-trigger. Good. EMP is the only offender.

### 0.3 Decorative ring damage guard

The current ring update calls `damageTarget(g, t, ring.damage ?? 1, ...)` (`game-sim.ts:1461`). When Tier 2.1 introduces decorative rings (cyan/magenta cosmetic layers), they would deal 1 damage by default — invisible bonus weapons.

**Fix:** Change the damage path to `if ((ring.damage ?? 0) <= 0) return;` (skip band-damage check entirely if no damage configured). Or require `damage` as non-optional and set it to 0 on cosmetic rings. The latter is more explicit.

**Even before Tier 2 lands**, harden this: if anyone in the future adds a ring without thinking, the fallback should be "no damage" not "1 damage."

---

## Tier 1 — the punch frame

**Goal:** Make the moment of fire viscerally heavy. Constant tuning + one new branch.
**Effort:** ~30 min, ~40 lines.
**Files:** `game-sim.ts`, `pixi-render.ts`.

### 1.1 Slam the screen flash

**File:** `pixi-render.ts:3143-3148`

Replace the single faded overlay with a three-stage flash driven by ring radius:

```ts
// Inside updateGameplayEmpRings, per ring:
const flashStage =
  progress < 0.04
    ? "white" // ticks 0-2:  hard white-purple α 0.85
    : progress < 0.1
      ? "purple" // ticks 3-7:  purple α 0.50
      : progress < 0.18
        ? "fade" // ticks 8-12: tail-off α 0.0
        : null;
if (flashStage === "white") {
  node.flash.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: 0xffffff, alpha: 0.85 });
} else if (flashStage === "purple") {
  node.flash.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: COL_HEX.emp, alpha: 0.5 });
} else if (flashStage === "fade") {
  const t = (0.18 - progress) / 0.08; // 1 → 0
  node.flash.rect(0, 0, CANVAS_W, CANVAS_H).fill({ color: COL_HEX.emp, alpha: 0.3 * t });
}
```

Only the **Burj ring** should trigger the flash — launcher rings (rank 2) reuse the visual but skip the full-screen overlay so we don't quadruple-flash. Detect by ring center matching `EMP_BURJ_X/Y` or by adding a `ring.kind: "burj" | "launcher"` field (preferred — explicit).

### 1.2 Crank the shake

**File:** `game-sim.ts:2385-2386` in `fireEmp()`

```ts
// Was: shakeTimer = 6, intensity = 3
g.shakeTimer = 22;
g.shakeIntensity = 10;
```

Add a 3-tick pre-frame thump at intensity 14. Easiest path: introduce a small helper that schedules a one-shot shake spike. Or just write the high value first and let the existing shake decay handle the rest:

```ts
g.shakeTimer = 22;
g.shakeIntensity = 14; // peaks for ~3 ticks of decay then settles to ~10
```

**Tier 0.1 must land first** — without renderer shake, these constants do nothing. Once shake is wired up, the existing decay (`g.shakeTimer -= dt`) handles the taper naturally; no `shakeRamp` field needed unless playtesting reveals a problem.

### 1.3 Front-load the ring expansion

**File:** `game-sim.ts:1447`

Replace `ring.radius += 10 * (ring.expandRate ?? 1) * dt;` with an age-driven curve:

```ts
ring.age = (ring.age ?? 0) + dt;
const speedCurve = (age: number) => {
  // ticks 0-3: 40 px/tick (huge initial blast)
  // ticks 4-8: 25 px/tick (still fast)
  // ticks 9+:  12 px/tick (settles)
  if (age < 3) return 40;
  if (age < 8) return 25;
  return 12;
};
ring.radius += speedCurve(ring.age) * (ring.expandRate ?? 1) * dt;
```

Add `age: number` to the `EmpRing` type in `types.ts`. Initial value 0 in `fireEmp()`.

**Rank 1 reaches max radius (650) in ~28 ticks instead of 65** — about 0.5 s vs 1.1 s. That's the difference between "shockwave" and "expanding bubble."

### 1.4 dt scrub on fire (time-freeze)

**Most impactful, riskiest.** Must live inside `update()` itself so live, replay (`replay.ts:134`), and headless (`sim-runner.js`) paths all see identical timing. A controller-level scrub diverges immediately.

**File:** `game-sim.ts` `update()` — wrap the existing dt-driven dispatch.

Add a scrub schedule to `GameState`:

```ts
// In types.ts (must be in checkpoint hash if added — see verification):
empScrubTicks: number; // 0 when idle; counts down per tick of real dt

// In fireEmp():
g.empScrubTicks = 7; // 3 ticks at scale 0, 4 ticks at scale 0.25
```

At the top of `update()`, before any sub-system update:

```ts
function scrubScale(remaining: number): number {
  if (remaining <= 0) return 1;
  if (remaining > 4) return 0; // hard freeze
  return 0.25; // quarter-speed
}

const scale = scrubScale(g.empScrubTicks);
const scaledDt = dt * scale;
g.empScrubTicks = Math.max(0, g.empScrubTicks - dt);
// then proceed with the rest of update() using scaledDt instead of dt
```

**Caveats and constraints:**

- `dt` is always `1` in current call sites (live, replay, headless all pass 1). So `g.empScrubTicks -= dt` → `-= 1` and the schedule lasts exactly 7 ticks. Predictable.
- Scaling dt to 0 pauses _everything_, including ring expansion. That's the desired feel — ring visibly explodes outward the moment time resumes.
- All the `g.shakeTimer -= dt` style decrements would also see the scaled dt, _which is what we want_: shake holds during the freeze, releases on unfreeze.
- **Replay determinism:** since the scrub is in `update()`, replays will produce identical sim-state. But if `_actionLog` / `buildReplayCheckpoint` ever hashes a frame counter that diverges from sim-tick under scrub, that's a bug. **Verify before shipping** by recording a replay with EMP fires and checking it plays back identically.

**If determinism complications surface**, skip 1.4 entirely. Tier 1.1 + 1.2 + 1.3 alone already deliver most of the impact; the scrub is the cherry on top.

---

## Tier 2 — the wave of light

**Goal:** Make the visual richer — multi-layered ring + signature kill bursts.
**Effort:** ~1–2 hrs, ~80 lines.
**Files:** `game-sim.ts`, `pixi-render.ts`, `sound.ts`.

### 2.1 Three stacked rings per blast

In `fireEmp()`, replace the single push with three concentric rings staggered by `age` offset:

```ts
const ringTriple = [
  { tint: 0xffffff, radiusMul: 1.0, ageOffset: 0 }, // white core
  { tint: 0x66ddff, radiusMul: 0.92, ageOffset: -0.12 }, // cyan mid
  { tint: 0xff66ff, radiusMul: 0.84, ageOffset: -0.24 }, // magenta outer
];
ringTriple.forEach((cfg) =>
  g.empRings.push({ ...baseRing, age: cfg.ageOffset, tint: cfg.tint, radiusMul: cfg.radiusMul }),
);
```

Add `tint?: number` and `radiusMul?: number` to `EmpRing`. Renderer uses ring.tint instead of `COL_HEX.emp`. Effective max radius = `maxRadius * radiusMul`.

**Cost:** 3× rings means 3× per-frame damage queries. Ring damage is gated by `hitSet`, so it's safe — but only the white core should actually deal damage. **Tier 0.3 must land first** so cosmetic rings without `damage` set don't silently do 1 damage each. Set `damage: 0` (or omit, after 0.3 changes the default to 0) on cyan and magenta layers; only white core gets the real damage value.

### 2.2 Ring trail (cheap thickness)

In the ring sprite render, draw 3 ghost copies at `radius * 0.96 / 0.92 / 0.88` with alpha 0.3 / 0.15 / 0.05. Pool 3 extra sprites per ring node.

Effect: the ring looks like a band 50–80 px thick instead of a 1-px outline.

### 2.3 Signature per-kill deathburst

**File:** `game-sim.ts:1463-1477`

Replace the 15-spark scatter with:

- **Inner ring**: 8 outward-streak particles at sp 10–14, life 50–80, with trails (use existing trail field if particles support it; otherwise add a light variant)
- **Outer scatter**: 15 sparks (current behaviour but life ×1.3)
- **Single bright flash sprite** at the kill site, white→purple, life 4 ticks, scale 0.5 → 1.5

```ts
// Inside ring.hitSet matching block:
spawnEmpKillBurst(g, t.x, t.y); // new helper in game-sim.ts
```

`spawnEmpKillBurst`: extract into a named function for testability. Cap with `MAX_PARTICLES`.

### 2.4 Audio kick + noise burst

**File:** `sound.ts` `empBlast()`

Prepend before the chirp:

```ts
// Sub-bass kick: 35 Hz sine, gain 0.35, 0.12 s decay
const kick = ctx.createOscillator();
kick.type = "sine";
kick.frequency.setValueAtTime(80, t);
kick.frequency.exponentialRampToValueAtTime(35, t + 0.05);
const kickGain = ctx.createGain();
kickGain.gain.setValueAtTime(0.45, t);
kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
kick.connect(kickGain);
kickGain.connect(getMaster());
kick.start(t);
kick.stop(t + 0.15);

// Filtered white noise burst: 0.05 s impact transient
const noise = createNoiseBuffer(ctx, 0.05);
const noiseSrc = ctx.createBufferSource();
noiseSrc.buffer = noise;
const filter = ctx.createBiquadFilter();
filter.type = "bandpass";
filter.frequency.value = 1200;
filter.Q.value = 0.7;
const noiseGain = ctx.createGain();
noiseGain.gain.setValueAtTime(0.25, t);
noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
noiseSrc.connect(filter);
filter.connect(noiseGain);
noiseGain.connect(getMaster());
noiseSrc.start(t);
```

(`createNoiseBuffer` may need adding if not already present; see if `sound.ts` has any noise sources.)

Net: kick gives chest-thump, noise burst gives the "sploosh" transient that the ear interprets as physical impact.

**Tier 0.2 must land first** — without removing the duplicate `SFX.empBlast()` call, every tuning change here is being heard at 2× and phase-doubled. Tasting soup with two spoons at once.

---

## Tier 3 — afterglow + theme

**Goal:** Sell the EMP as _electromagnetic_ rather than just "purple boom."
**Effort:** ~3–4 hrs.

### 3.1 Color invert / palette shift

Apply a `ColorMatrixFilter` to the gameplay container for ~10 ticks centered on the punch frame. Pixi v8 has `ColorMatrixFilter` with `.negative()` preset. Animate intensity 0 → 1 → 0 over the tick window.

**Risk:** Filters on the whole gameplay layer hit GPU performance. Profile on iPhone before shipping.

### 3.2 CRT scanline / interference glitch

Brief horizontal-band displacement filter for 8 ticks. Pixi has `DisplacementFilter`; feed it a noise texture and animate the displacement strength.

If filters are too expensive, fake it: draw 6–10 horizontal full-width strips at random Y, alpha 0.15, color `#cc44ff`, life 4–8 ticks. Cheap and reads "interference."

### 3.3 Lightning arcs

When a ring crosses a threat that gets killed, draw a jagged 4–6 segment lightning arc from the ring center to the kill site for 3–5 ticks. Use `Graphics` with width 2, white core, magenta outer glow.

```ts
function drawLightningArc(g: Graphics, x1, y1, x2, y2): void {
  const segments = 5;
  const points = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const px = x1 + (x2 - x1) * t + rand(-30, 30);
    const py = y1 + (y2 - y1) * t + rand(-30, 30);
    points.push({ x: px, y: py });
  }
  points.push({ x: x2, y: y2 });
  // Stroke a polyline through points
}
```

Spawn one arc per kill. Arc lives 4 ticks, fades alpha 1 → 0.

**Most expensive Tier 3 item; leave for last.**

### 3.4 Launcher rank 2 muzzle flares

In `fireEmp()`, when adding a launcher ring at rank 2, also push a one-shot flare effect: white flash sprite at the launcher position, scale 0 → 2, life 6 ticks. Plus a tiny shake-add (`shakeIntensity = max(current, 6)`).

---

## Tier 4 — overkill / dessert

### 4.1 Zoom-punch

Animate gameplay container scale: 1.0 → 1.04 over 3 ticks → 1.0 over 5 ticks. Pivot at canvas center.

**Risk:** Anything that scales the gameplay container will affect input mapping. Verify pointer-event coordinates still work.

---

## Recommended ship order

1. **Land Tier 0** (mandatory). Without it the rest is theatre. Each item ships as its own commit so the diff is small and reviewable.
2. **Land Tier 1.** Test in-game. Most likely you'll think it's enough.
3. If still flat: add **Tier 2.1 (multi-ring)** + **2.4 (audio kick)** — the two biggest "free" wins.
4. If you want signature: add **Tier 2.3 (deathburst)** + **Tier 3.4 (launcher flares)**.
5. Filters / lightning / zoom only if the rest still doesn't sell it.

## Verification checklist

### Tier 0

- [ ] **Pixi shake works:** trigger EMP in browser, gameplay scene visibly translates. Trigger building destruction, same. Editor preview does _not_ shake. Pointer-tap mid-shake still hits where intended.
- [ ] **No double SFX:** record audio while firing EMP manually; spectrogram or A/B against current main should show ~6 dB drop. Replay of an EMP fire should sound identical to live (i.e. event-bus path is the only path).
- [ ] **Decorative ring guard:** unit test — push an `EmpRing` with no `damage` field, run one tick, assert no threats are damaged.

### Tier 1+

- [ ] Spawn-band debug overlay still renders correctly during EMP (the flash overlay must not occlude colliders permanently — z-order check).
- [ ] **Replay determinism:** the replay system is action-log + seeded reconstruction, not serialized state playback. `buildReplayCheckpoint` does not currently hash `empRings`. If Tier 1.4 lands, add `empScrubTicks` to whatever the checkpoint hashes (or make it deterministic-by-construction so it doesn't need to). Add a regression test: record a replay containing an EMP fire, play it back, assert final game state matches.
- [ ] iPhone perf: run `scripts/bench.sh perf-wave4-upgrades` before/after. Multi-ring + filters are the most likely regression sources.
- [ ] Sim test: existing `game-sim.test.ts` covers EMP damage. After 2.1 lands, add an assertion that `empRings.length === 3` at rank 1, and that exactly one ring has `damage > 0`.
- [ ] Sound: confirm `empBlast` voice count stays under any `MAX_VOICES` budget — Tier 2.4 adds 2 oscillator sources, so peak voices during EMP roughly doubles.

## Constants — proposed values, all in one place

```ts
// game-sim.ts — EMP physics
const EMP_BURJ_MAX_RADIUS = [650, 1040]; // unchanged
const EMP_LAUNCHER_MAX_RADIUS = 500; // unchanged
const EMP_RANK2_EXPAND_RATE = 1.5; // unchanged
const EMP_SHAKE_TIMER = 22; // was 6
const EMP_SHAKE_INTENSITY = 14; // was 3 — let decay handle taper
const EMP_SCRUB_TICKS = 7; // 3 hard-freeze + 4 quarter-speed
const EMP_RING_SPEED_INITIAL = 40; // ticks 0-3
const EMP_RING_SPEED_MID = 25; // ticks 4-8
const EMP_RING_SPEED_TAIL = 12; // ticks 9+

// pixi-render.ts — flash phases
const EMP_FLASH_WHITE_PROGRESS = 0.04;
const EMP_FLASH_PURPLE_PROGRESS = 0.1;
const EMP_FLASH_FADE_PROGRESS = 0.18;
```

Keep these in one block per file; do not scatter.
