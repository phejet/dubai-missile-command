# Script Inventory

This repo has a mix of production-adjacent scripts, benchmark tooling, and one-off probes.

Use this file to decide which scripts are trustworthy enough to reach for first.

## Rule Of Thumb

Most automation sources are TypeScript ESM files. Prefer:

- `npx tsx <script>.ts`

Older notes and some legacy probes still reference `.js` or `.mjs` names.

## Daily-Use Or Primary Scripts

### Browser/runtime

- `src/main.ts` — main game entrypoint
- `src/editor-main.tsx` — editor entrypoint
- `play-replay.ts` — quick browser replay launcher against local dev server

### Headless

- `src/headless/sim-runner.ts` — single-run deterministic simulation
- `src/headless/train.ts` — worker-thread batch training
- `src/headless/record.ts` — replay recorder
- `src/headless/bench.ts` — fixed benchmark
- `src/headless/bench-draft.ts` — preset sweep in draft mode
- `src/headless/bench-report.ts` — structured benchmark output

## LLM-Assisted Tooling

- `src/headless/learn.ts`
- `src/headless/learn-local.ts`
- `src/headless/balance.ts`
- `src/headless/analyze-with-llm.ts`

These are useful, but review them before trusting them.

Known drift:

- `learn.ts` still reads `bot-brain.js` and `game-sim.js`
- `balance.ts` still references `App.tsx`
- some prompts still describe old architecture/constants

Treat them as experimental helpers, not authoritative workflow.

## Root-Level Utility Probes

- `play-bot.ts`
- `screenshot-bot.mjs`
- `analyze-hornets.js`
- `analyze-replay.js`
- `gen-sky.mjs`

These are ad hoc utilities.

Known caveats:

- `play-bot.ts` contains hardcoded gameplay assumptions that can drift from live constants
- `screenshot-bot.mjs` still assumes an old `900x640` scaling path in one branch
- `analyze-hornets.js` and `analyze-replay.js` import `.js` source paths and are best treated as legacy unless matching built files exist

Use them, but inspect them first.

## Analysis Artifacts

- `normal-bench-all.json`
- `spawn-analysis-new.json`
- `src/headless/LLM-ANALYSIS.md`
- `src/headless/learning-reports/round-1-to-4-report.md`

These are outputs and notes, not runnable workflow entrypoints.

## Browser Automation / QA

- Playwright E2E under `e2e/`
- `play-replay.ts`
- `play-bot.ts`
- `screenshot-bot.mjs`

The E2E tests are the maintained automation path. The standalone scripts are convenience tools.

## Practical Rules

- Reach for `sim-runner.ts`, `train.ts`, `record.ts`, and the Playwright suites first.
- Treat root-level JS/MJS utilities as convenience probes that may need quick maintenance before use.
- If a script reads stale filenames or constants, fix the script or route through the maintained entrypoints instead.
