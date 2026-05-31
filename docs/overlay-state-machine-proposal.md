# Overlay State Machine Proposal

`src/game.ts` currently tracks primary UI surfaces with several booleans:
`shopOpen`, `bonusActive`, `progressionOpen`, `runRecapOpen`, `showOptionsMenu`,
plus mode/toggle flags such as `replayActive` and `showPerfOverlay`. The booleans
work, but they allow impossible combinations unless every transition remembers to
clear every other flag. That is how a shop ends up wearing a recap panel as a hat.

## Proposed Shape

Keep top-level screen state separate:

```ts
type GameScreen = "title" | "playing" | "gameover";
```

Replace the mutually exclusive overlay booleans with one primary overlay:

```ts
type PrimaryOverlay = "none" | "shop" | "bonus" | "progression" | "options" | "runRecap";
```

Keep genuinely orthogonal state outside that union:

- `replayActive`: replay execution mode, not an overlay.
- `showPerfOverlay`: diagnostic HUD toggle that can sit above normal play.
- `showColliders`: diagnostic render toggle.
- `showUpgradesTable`: debug/options detail panel, unless later UX work folds it
  into `PrimaryOverlay`.

## State Chart

Allowed primary overlays by screen:

| Screen     | Allowed primary overlays                     |
| ---------- | -------------------------------------------- |
| `title`    | `none`, `progression`, `options`             |
| `playing`  | `none`, `bonus`, `shop`, `options`           |
| `gameover` | `none`, `runRecap`, `progression`, `options` |

Replay playback should use the same overlay chart as normal play. `replayActive`
only changes automation rules: shop and bonus can auto-advance, and replay
completion can finalize the run without accepting player input.

## Transition Rules

- `setScreen(next)` should clear any primary overlay not allowed on `next`.
- Opening a primary overlay should close the previous primary overlay through one
  helper, not through repeated hand-written boolean clearing.
- Closing `shop` should return to `none` and call `simCloseShop(game)`.
- Completing `bonus` should return to `none`; replay bonus completion can remain
  auto-driven.
- Opening `runRecap` should only be valid on `gameover`.
- `showPerfOverlay`, `showColliders`, and replay mode should not clear or replace
  the primary overlay.

## Migration Sketch

1. Add `private overlay: PrimaryOverlay = "none"` and derive legacy getters only
   for tests or incremental migration if needed.
2. Add `setOverlay(next: PrimaryOverlay)` that owns DOM cleanup/setup boundaries.
3. Convert `openShop`, bonus callbacks, progression open/close, options
   open/close, and run-recap open/close to call `setOverlay`.
4. Remove the old booleans after transition tests prove at most one primary
   overlay is active.

This proposal is intentionally not implemented in W8. It changes UX control flow,
so it needs reviewer sign-off and feel-checking instead of being slipped in as
"cleanup", the traditional disguise of half the bugs in history.
