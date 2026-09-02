---
name: graphics-editor
description: Launch and use the Dubai Missile Command graphics editor to tune Pixi effects, inspect startup sprites, and refine upgrade-graph layout.
---

# Graphics Editor

Use the repo's separate React editor for visual tuning. It previews the current Pixi renderer
with a curated fake game state; it does not run the full gameplay controller.

## Launch

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/dubai-missile-command/editor.html
```

## Choose the surface

- **Effects** — tune parameters from src/editor-params.ts against the Pixi gameplay preview.
  Use Play/Pause, Show Upgrades, Colliders, Burj damage, and Pulse Hit to stage the effect.
- **Sprites** — inspect the prebaked startup sprite catalog by asset family and display scale.
- **Upgrade Graph** — pan, zoom, select nodes, simulate ownership/objective gates, and drag node
  positions without changing gameplay progression.

## Apply exported values

Export copies JSON to the clipboard and console. When values differ from defaults, only the
changed keys are exported.

For an effect key:

1. Find its definition in src/editor-params.ts.
2. Locate the owning runtime fallback with a focused search such as:

   ```bash
   rg 'ov\("explosion.lightIntensity"' src
   ```

3. Update the runtime fallback at its real owner and the matching editor default together.
   Current owners include src/pixi-render.ts, src/game-logic.ts, and focused simulation
   modules such as src/game-sim-burj-fire.ts.
4. Re-open the editor and confirm Reset returns to the new permanent value.

For layout exports, update the matching position owner in src/EditorApp.tsx or
src/upgrade-graph.ts. Do not paste editor overrides into an unrelated renderer merely because
the value is visual.

## Verification

Run:

```bash
npx vitest run src/editor-render.test.ts src/upgrade-graph.test.ts
npx playwright test e2e/editor.spec.ts
```

Then hand the visual result back for a human feel-check. Tests prove the editor and renderer
still communicate; they do not prove the effect looks right.
