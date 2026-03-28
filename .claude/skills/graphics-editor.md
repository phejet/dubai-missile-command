---
name: graphics-editor
description: Launch and use the graphics editor to tweak game visual effects
user_invocable: true
---

# Graphics Editor

Opens the graphics editor page for visually tweaking game rendering parameters.

## Usage

1. Make sure the dev server is running (`npm run dev`)
2. Open `http://localhost:5173/dubai-missile-command/editor.html` in a browser
3. Use sliders and checkboxes to adjust visual effects in real-time
4. Click **Export** to copy changed values to clipboard and console

## Reading exported values

When the user exports values from the editor, read the JSON output. Each key maps to a specific location in the game source code:

### Parameter → Code mapping

**Explosions** (`src/game-render.js`):

- `explosion.lightIntensity` → `ex.alpha * 0.12` in light casting section
- `explosion.lightRadiusMul` → `r * 4` in light casting section
- `explosion.flashThreshold` → `ex.alpha > 0.85` in interceptor flash
- `explosion.ringFadeRate` → `ringAlpha -= 0.25 * dt` in `src/game-sim.js`
- `explosion.ringExpandRate` → `ringRadius += 14 * dt` in `src/game-sim.js`

**Particles** (`src/game-logic.js` `createExplosion`):

- `particle.dotCountLight` → light dot count (currently 6)
- `particle.dotCountHeavy` → heavy dot count (currently 10)
- `particle.debrisCount` → debris shard count (currently 16)
- `particle.sparkCountLight` → light spark count (currently 8)
- `particle.sparkCountHeavy` → heavy spark count (currently 14)
- `particle.debrisGravity` → debris gravity (currently 0.15)
- `particle.debrisDrag` → debris drag (currently 0.96)
- `particle.sparkDrag` → spark drag (currently 0.93)

**Burj** (`src/game-render.js` Burj rendering):

- `burj.coronaAlpha` → aura gradient first stop alpha
- `burj.uplightAlpha` → uplight gradient first stop alpha
- `burj.outlineGlowRadius` → outline glow base radius
- `burj.basePoolRadius` → ground light pool outer radius
- `burj.basePoolAlpha` → ground light pool first stop alpha

**Sky** (`src/game-render.js`):

- `sky.nebulaOpacity` → nebula image overlay globalAlpha
- `sky.starTwinkleSpeed` → star twinkle sine frequency
- `sky.vignetteAlpha` → vignette outer edge alpha

**Glow** (`src/game-render.js`):

- `glow.scale` → GLOW_SCALE multiplier for all shadow blur
- `glow.enabled` → master glow on/off

## Applying values

After reading exported JSON, update the hardcoded values in the corresponding source files. The `ov()` helper in `game-render.js` provides runtime overrides — update the fallback values to make changes permanent.

## Adding new parameters

1. Add parameter definition to `src/editor-params.js` in the appropriate group
2. Wire the override in the rendering code using `ov("key", defaultValue)`
3. The editor UI auto-generates controls from the parameter definitions
