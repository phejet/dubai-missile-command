# Testing Matrix

The repo uses both unit-style Vitest coverage and Playwright E2E coverage.

## Commands

- `npm run test`
- `npm run test:coverage`
- `npm run test:e2e`
- `npm run typecheck`

## Unit And Integration Tests (Vitest)

### Gameplay math and shared logic

- `src/game-logic.test.ts`
- `src/wave-spawner.test.ts`
- `src/game-sim.test.ts`

These cover:

- targeting and geometry helpers
- explosion creation
- wave config and schedule generation
- MIRVs, drones, flares, auto-defense, and damage presentation

### Rendering

- `src/art-render.test.ts`
- `src/pixi-render.test.ts`

These focus on:

- asset baking
- cache behavior
- no-throw rendering contracts
- core draw function calls

### Replay And Input Helpers

- `src/replay.test.ts`
- `src/player-fire-limiter.test.ts`

These cover:

- replay lifecycle
- action application
- shop pause handling
- replay determinism helpers
- buffered fire and burst-charge behavior

### UI And Progression

- `src/ShopUI.test.ts`
- `src/ProgressionUI.test.ts`
- `src/upgrade-graph.test.ts`

These focus on:

- shop DOM rendering behavior
- progression graph states and detail markup

### Headless Bot

- `src/headless/bot-brain.test.ts`
- `src/headless/sim-runner.test.ts`

These cover:

- config resolution
- humanized presets
- target reservation behavior
- determinism
- replay round-trip
- golden-seed canaries

### Capture operations and telemetry

- `scripts/analyze-telemetry.test.mjs`
- `scripts/operator-delete-capture.test.mjs`
- `scripts/seed-retention-fixtures.test.mjs`

These cover:

- fixed-query and explicit-environment guards
- comparison/row validation and zero-write evidence
- install-aware statistics, confidence labels, and deterministic candidates
- identifier-free public artifacts and scoped private-artifact cleanup
- deletion and retention operator safety

## E2E Tests (Playwright)

### Smoke

`e2e/smoke.spec.ts` covers:

- page boot
- starting the game
- basic state shape
- firing from the canvas
- shop-state input suppression
- portrait layout behavior
- shop preview UI

### Replay

`e2e/replay.spec.ts` covers:

- replay loading and playback behavior in the browser

## Important Environment Detail

Playwright runs against:

- `npm run build`
- `npm run preview -- --host 127.0.0.1 --port 4173`

So E2E tests run against the static preview server, not the Vite dev server.

This means:

- the dev-only `/api/save-replay` middleware is not available during E2E

## Coverage Exclusions

The Vite/Vitest config excludes several scripts from coverage, especially:

- sound
- worker scripts
- LLM-assisted headless scripts
- some record/train helpers

That is intentional because those files are mostly orchestration or environment-specific tooling.

## Practical Rules

- If you change gameplay rules, run `npm run test` and the relevant headless tests.
- If you change browser UI flow or input plumbing, run `npm run test:e2e`.
- If you change replay serialization or playback logic, run both replay unit tests and replay E2E.
- If you change render-only code, render tests are useful, but smoke E2E still catches integration breakage.
- If you change telemetry acquisition, statistics, or artifacts, run the focused telemetry test
  plus the full unit, lint, and format gates; remote Staging proof must remain read-only.

## RM-08 replay inspection

- `src/operator-api.test.ts`: strict filters, cursor/fragment schemas, response projection and request generations.
- `src/operator-inspection.test.ts`: real human bonus/shop replay, summary comparisons, tolerances, cancellation and timeline targets.
- `src/operator-replay-bridge.test.ts`: same-origin opener-only, one-message launch with validated paused seek options.
- `worker/test/operator-sessions.test.ts`: SQL filters/paging, retention/status boundaries, D1-only curated details, corrupt storage, retired raw routes, and actual migrated query-plan index use.
- `e2e/operator.spec.ts`: deep-linked run outside page one, lazy inspection, filtered paging, wave/exact-tick popup, incompatible/missing evidence, and narrow layout.
- `npm run operator:bundle-check`: production manifest graph and 20 KiB gzip growth budget; reports lazy inspection dependencies separately.
- Staging acceptance: unusual retained run, private candidate handoff, list/detail under 2s and far-seek under 5s on the review machine; human usefulness proof stays separate from automated tests.
