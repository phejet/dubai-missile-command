# Editor Architecture

The internal editor is a separate React app used for effects tuning and upgrade-graph layout work.

Relevant files:

- `src/editor-main.tsx`
- `src/EditorApp.tsx`
- `src/editor-scene.ts`
- `src/editor-params.ts`
- `src/upgrade-graph.ts`

## Split From Main Game

- `src/main.ts` boots the actual game runtime.
- `src/editor-main.tsx` boots the editor only for `editor.html`.

The shipped game is not React-driven. React is used here only for tooling.

## Two Editor Modes

`EditorApp` maintains two main views:

- `effects` — canvas preview plus parameter overrides
- `graph` — interactive upgrade-graph layout editor

## Effects Preview Path

The effects preview does not run the full runtime controller.

Instead it:

1. creates a fake scene with `createEditorScene()`
2. optionally creates a "play" scene with fresh explosions
3. advances simplified effect physics with a local `simTick(...)`
4. draws that scene through `drawGame(...)`

This is intentionally lighter than running the full game.

## Override Injection

`editor-params.ts` defines parameter groups and default values.

Those overrides are pushed into:

- `window.__editorOverrides`

Render and gameplay helper code that uses `ov(...)` can read those live override values.

This is the contract that keeps the editor and render code connected.

## Editor Scene

`createEditorScene()` builds a frozen, hand-authored `GameState` snapshot with:

- sample missiles and drones
- sample interceptors
- sample explosions and particles
- standard buildings and Burj state

It is a curated preview state, not a replay or a saved live run.

## Upgrade Graph Mode

The graph view reuses the same graph helpers as the runtime progression panel.

Capabilities:

- fit and clamp viewport
- zoom and pan
- node selection
- position overrides per node

The layout override keys match the pattern:

- `upgradeGraph.<nodeId>.x`
- `upgradeGraph.<nodeId>.y`

## Practical Rules

- If you add a new `ov(...)` parameter in render code, add it to `editor-params.ts` if it should be tunable.
- If you add a new upgrade node, check both the runtime graph panel and the editor graph mode.
- The editor is a tooling target, so do not assume its state flow matches the gameplay runtime.
