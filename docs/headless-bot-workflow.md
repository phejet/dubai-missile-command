# Headless Bot Workflow

The headless stack exists to benchmark gameplay, tune the bot, record replays, and run bulk experiments without a browser render loop.

Main files:

- `src/headless/sim-runner.ts`
- `src/headless/bot-brain.ts`
- `src/headless/game-worker.ts`
- `src/headless/train.ts`
- `src/headless/record.ts`
- `src/headless/bench.ts`
- `src/headless/bench-draft.ts`
- `src/headless/bench-report.ts`
- `src/headless/learn.ts`
- `src/headless/learn-local.ts`
- `src/headless/balance.ts`
- `src/headless/analyze-with-llm.ts`

## Core Entry Point: `runGame(...)`

`runGame(botConfig, options)` in `sim-runner.ts` is the canonical single-run entry point.

It:

- resolves the bot config and preset
- seeds the gameplay RNG
- seeds a separate bot-decision RNG
- initializes `GameState`
- optionally enables draft mode
- simulates ticks until game over or timeout
- optionally records replay actions

Important detail:

- gameplay randomness and bot randomness are separated on purpose

## Default Assumptions

Current headless defaults lean toward draft-mode evaluation:

- `runGame()` defaults `draftMode` to `true`
- `record.ts` records draft-mode runs
- `train.ts` runs draft-mode batches

If a benchmark looks "too hard", check whether draft mode was silently enabled.

## Bot Brain Responsibilities

`bot-brain.ts` owns:

- config preset resolution
- target leading
- target reservation and de-duplication
- humanization behavior for weaker presets
- shop priority and repair decisions

Important concepts:

- `resolveBotConfig(...)` deep-merges preset overrides
- `leadTarget(...)` chooses a launcher-aware intercept point
- `reserveBotTarget(...)` prevents overcommitting multiple shots to the same threat
- `botDecideAction(...)` returns the next aim/fire point or `null`
- `botDecideUpgrades(...)` returns repair and purchase priority decisions

## Worker-Based Batch Runs

`game-worker.ts` is deliberately tiny:

- receives seeds/config via worker data
- calls `runGame(...)` repeatedly
- posts structured results back

`train.ts` and some benchmarks shard work across workers using this file.

## Common Scripts

Use `npx tsx <file>` for TypeScript scripts unless you have a built JS sibling.

Typical scripts:

- `src/headless/sim-runner.ts` — single deterministic run
- `src/headless/train.ts` — repeated worker-thread batch training with JSONL logging
- `src/headless/record.ts` — record the best or specified run as replay JSON
- `src/headless/bench.ts` — fixed-seed benchmark for post-spawn-commander comparisons
- `src/headless/bench-draft.ts` — draft-mode sweep across presets
- `src/headless/bench-report.ts` — deterministic benchmark output as JS

## LLM-Assisted Scripts

These scripts call external LLM APIs and should be treated carefully:

- `learn.ts`
- `learn-local.ts`
- `balance.ts`
- `analyze-with-llm.ts`

Important warning:

- several prompts and file-path assumptions in these scripts have drifted
- `learn.ts` still reads `bot-brain.js` / `game-sim.js`
- `balance.ts` still references `App.tsx`

They can still be useful, but review them before trusting their output.

## Analysis Helpers

Less-central scripts exist for one-off inspection:

- `tools/analyze-hornets.js`
- `tools/analyze-replay.js`
- `src/headless/spawn-analysis-new.ts`
- `tools/analysis-output/normal-bench-all.json`
- `tools/analysis-output/spawn-analysis-new.json`

These are analysis artifacts and probes, not part of the gameplay runtime.

## Practical Rules

- If you change gameplay logic, rerun `sim-runner` determinism checks and replay round-trip tests.
- If you change bot targeting, inspect both reservation logic and humanization branches.
- If you change shop or draft semantics, check `runGame()`, `record.ts`, and `bench-draft.ts` together.
