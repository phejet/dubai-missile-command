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
- `src/game-render.test.ts`

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
