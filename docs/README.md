# Docs Index

This folder holds repo-specific notes for future maintenance, not player-facing docs.

## Core Architecture

- [`render-split-analysis.md`](./render-split-analysis.md) — how `art-render`, `game-render`, and `game-sim` divide responsibilities.
- [`runtime-controller.md`](./runtime-controller.md) — how `src/game.ts` drives screens, input, simulation, replay, and drawing.
- [`game-state-contract.md`](./game-state-contract.md) — field-level map of `GameState`, including runtime-only and replay-only fields.
- [`ui-architecture.md`](./ui-architecture.md) — DOM UI layer used by the runtime instead of React.
- [`editor-architecture.md`](./editor-architecture.md) — React editor tooling, fake scene preview, and upgrade-graph editing flow.
- [`audio-event-contract.md`](./audio-event-contract.md) — event names and payloads that bridge sim/runtime/audio.

## Gameplay Systems

- [`spawn-commander-reference.md`](./spawn-commander-reference.md) — wave budgets, tactic selection, schedule generation, and spawn advancement.
- [`upgrades-shop-progression.md`](./upgrades-shop-progression.md) — upgrade node graph, shop flow, draft flow, and progression state.
- [`replay-system.md`](./replay-system.md) — replay data model, runner lifecycle, checkpoints, and save flow.

## Tooling And Workflow

- [`headless-bot-workflow.md`](./headless-bot-workflow.md) — headless simulation, bot decisions, worker-based training, and LLM-assisted scripts.
- [`build-targets.md`](./build-targets.md) — Vite targets, Capacitor differences, replay save endpoint, CI, and deploy behavior.
- [`testing-matrix.md`](./testing-matrix.md) — what is covered by unit tests vs E2E, and how to run each layer.
- [`script-inventory.md`](./script-inventory.md) — top-level and headless scripts, grouped by purpose and trust level.

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
