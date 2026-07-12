# Docs Index

This folder holds repo-specific notes for future maintenance, not player-facing docs.

## Core Architecture

- [`render-split-analysis.md`](./render-split-analysis.md) — how `pixi-render`, `art-render`, canvas texture resources, and `game-sim` divide responsibilities.
- [`runtime-controller.md`](./runtime-controller.md) — how `src/game.ts` drives screens, input, simulation, replay, and drawing.
- [`game-state-contract.md`](./game-state-contract.md) — field-level map of `GameState`, including runtime-only and replay-only fields.
- [`ui-architecture.md`](./ui-architecture.md) — DOM UI layer used by the runtime instead of React.
- [`editor-architecture.md`](./editor-architecture.md) — React editor tooling, fake scene preview, and upgrade-graph editing flow.
- [`audio-event-contract.md`](./audio-event-contract.md) — event names and payloads that bridge sim/runtime/audio.

## Gameplay Systems

- [`spawn-commander-reference.md`](./spawn-commander-reference.md) — wave budgets, tactic selection, schedule generation, and spawn advancement.
- [`upgrades-shop-progression.md`](./upgrades-shop-progression.md) — upgrade node graph, shop flow, draft flow, and progression state.
- [`replay-system.md`](./replay-system.md) — replay data model, runner lifecycle, checkpoints, and save flow.
- [`replay-divergence-root-cause-plan.md`](./replay-divergence-root-cause-plan.md) — proven root cause of human-replay divergence at the wave-end boundary, plus the phased fix/diagnostic/guard plan.

## Tooling And Workflow

- [`headless-bot-workflow.md`](./headless-bot-workflow.md) — headless simulation, bot decisions, worker-based training, and LLM-assisted scripts.
- [`build-targets.md`](./build-targets.md) — Vite targets, Capacitor differences, replay save endpoint, CI, and deploy behavior.
- [`testing-matrix.md`](./testing-matrix.md) — what is covered by unit tests vs E2E, and how to run each layer.
- [`script-inventory.md`](./script-inventory.md) — top-level and headless scripts, grouped by purpose and trust level.
- [`performance-notes.md`](./performance-notes.md) — known perf cliffs and constraints for future optimization.
- [`death-clip-webcontent-kill-handover.md`](./death-clip-webcontent-kill-handover.md) — proven root cause of the iPhone death-clip "kick to title" bug (WebContent memory kill), diagnostics-log + jetsam evidence, and the open ~2GB memory-leak hunt.
- [`overlay-state-machine-proposal.md`](./overlay-state-machine-proposal.md) — proposed replacement for controller overlay boolean state.

Repo-root files should be maintained entrypoints, project config, or committed fixtures with active consumers; one-off generated analysis output belongs under a named artifacts folder or outside the repo.

## Historical Analysis

- [`spawn-commander-analysis.md`](./spawn-commander-analysis.md) — benchmark comparison of old and new spawn systems.
- [`draft-mode-analysis.md`](./draft-mode-analysis.md) — draft-mode balance sweep across bot presets.
- [`ios-capacitor-plan.md`](./ios-capacitor-plan.md) — iOS wrapper implementation notes.

## Suggested Reading Order

1. `runtime-controller.md`
2. `game-state-contract.md`
3. `render-split-analysis.md`
4. `spawn-commander-reference.md`
5. `upgrades-shop-progression.md`
6. `replay-system.md`

Renderer entry points live on `PixiRenderer` in `src/pixi-render.ts`: `renderTitle()`, `renderGameplay(...)`, and `renderGameOver(...)`.
