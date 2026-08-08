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
- [`wild-hornets-targeting-analysis.md`](./wild-hornets-targeting-analysis.md) — hornet launch/guidance/magazine behaviour judged against role consistency and player legibility, with the other auto-defense systems' roles mapped alongside; measured counterfactual fixes, a SkyMesh loiter proposal, and an appendix of superseded claims and negative results.
- [`replay-system.md`](./replay-system.md) — replay data model, runner lifecycle, checkpoints, and save flow.
- [`replay-flight-recorder-design.md`](./replay-flight-recorder-design.md) — measured design for gzip-embedding completed human replays in crash-resilient diagnostics exports, including archive protocol, durability boundaries, extraction, retention, and a later partial-run journal.
- [`replay-capture-assembly-plan.md`](./replay-capture-assembly-plan.md) — the original capture envelope and local assembly work. Its unified wire contract is superseded by the session/report split below.
- [`capture-worker-backend-plan.md`](./capture-worker-backend-plan.md) — the original Worker backend plan. Its validation, abuse-control, and deployment layers carry forward; its unified storage contract is superseded below.
- [`capture-session-report-split-plan.md`](./capture-session-report-split-plan.md) — schema-2 session uploads and deliberate problem reports, content-addressed replay storage, retention, and Worker/Vite route parity. Roadmap step 5, implemented locally; provisioning pending.
- [`authenticated-capture-ingestion.md`](./authenticated-capture-ingestion.md) — proposed fail-closed App Attest authorization, automation/replay exclusion, build-channel routing, environment operations, approval flow, and adversarial verification required before remote ingestion.
- [`replay-divergence-root-cause-plan.md`](./replay-divergence-root-cause-plan.md) — proven root cause of human-replay divergence at the wave-end boundary, plus the phased fix/diagnostic/guard plan.
- [`hornet-blast-investigation-2026-07-26.md`](./hornet-blast-investigation-2026-07-26.md) — investigation log for the hornet rework and the explosion damage-model fix: replay-instrumented findings, the hypotheses that were disproved (including two probe artifacts and a wrong balance prediction), and why explosion damage no longer uses the growth animation.

## Tooling And Workflow

- [`headless-bot-workflow.md`](./headless-bot-workflow.md) — headless simulation, bot decisions, worker-based training, and LLM-assisted scripts.
- [`build-targets.md`](./build-targets.md) — Vite targets, Capacitor differences, replay save endpoint, CI, and deploy behavior.
- [`testing-matrix.md`](./testing-matrix.md) — what is covered by unit tests vs E2E, and how to run each layer.
- [`script-inventory.md`](./script-inventory.md) — top-level and headless scripts, grouped by purpose and trust level.
- [`performance-notes.md`](./performance-notes.md) — known perf cliffs and constraints for future optimization.
- [`death-clip-webcontent-kill-handover.md`](./death-clip-webcontent-kill-handover.md) — proven root cause of the iPhone death-clip "kick to title" bug (WebContent memory kill), diagnostics-log + jetsam evidence, and the open ~2GB memory-leak hunt.
- [`webcontent-leak-instrumented-findings-2026-07-12.md`](./webcontent-leak-instrumented-findings-2026-07-12.md) — quantified kill pattern (wave depth vs kill point), native memory probe design, and the instrumented run isolating two leak rates (~50 MB/wave in play, ~15 MB/s during clip playback).
- [`webcontent-memory-limit-proof-2026-07-19.md`](./webcontent-memory-limit-proof-2026-07-19.md) — direct iOS kernel proof that the infinite death-window run hit WebContent's 2,048 MB hard limit, cross-log timing, measured residual growth, and the next isolation experiments.
- [`overlay-state-machine-proposal.md`](./overlay-state-machine-proposal.md) — proposed replacement for controller overlay boolean state.

Repo-root files should be maintained entrypoints, project config, or committed fixtures with active consumers; one-off generated analysis output belongs under a named artifacts folder or outside the repo.

## Forward-Looking Plans (`.plans/`)

Exploratory design work that has not been implemented normally lives in `.plans/`.
Cross-system plans promoted for durable security/architecture review may live here with
an explicit status, as `authenticated-capture-ingestion.md` does.

- [`../.plans/replay-upload-backend-status.md`](../.plans/replay-upload-backend-status.md) — map of the Cloudflare replay/diagnostics upload design across its three plan documents: what is already built, what is still paper, the unresolved D1-vs-KV scope conflict, and the branch/PR sweep behind those conclusions.

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
