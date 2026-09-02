---
name: verify
description: Verify Dubai Missile Command gameplay, simulation, replay, rendering, and UI changes with focused tests, maintained Playwright coverage, and proportionate human feel-checks.
---

# Verify Changes

Choose the smallest maintained gate that proves the changed behavior, then widen coverage in
proportion to risk. Passing automation is a prerequisite for visual or feel-bearing work, not
the final verdict.

## Maintained gates

- Focused unit tests:

  ```bash
  npx vitest run <relevant-test-files>
  ```

- Browser boot, input, replay, and shop smoke:

  ```bash
  npx playwright test e2e/smoke.spec.ts
  ```

- Full browser suite:

  ```bash
  npm run test:e2e
  ```

- Headless bot game plus determinism check:

  ```bash
  npx tsx src/headless/sim-runner.ts 42
  ```

The Playwright configuration builds and starts its own production preview. Set
PW_EXECUTABLE_PATH only when the environment explicitly provides a pinned browser; do not
hardcode one machine's Chromium path into shared instructions.

## Ad-hoc browser scenarios

Use ad-hoc state staging only when maintained tests cannot express the scenario cheaply.

1. Start npm run dev and open http://localhost:5173/dubai-missile-command/.
2. Start with the Start Defense button, falling back to the canvas only when necessary.
3. Wait for window.\_\_gameRef.current before reading or staging game state.
4. Use the real state shapes from src/types.ts and src/game-sim.ts. Do not invent partial
   entities that happen to survive one frame.
5. Convert a reproduced failure into focused maintained coverage when the behavior is a
   lasting invariant.

The full live state is exposed at window.\_\_gameRef.current. Holding a wave open with a distant
scheduled spawn is preferable to clearing every threat and accidentally entering the shop.

## Replay and simulation cautions

- The seed-42 golden canary in src/headless/sim-runner.test.ts is a determinism tripwire, not a
  balance benchmark. Update it only after an intentional simulation change is understood.
- Simulation changes can invalidate replay and performance fixtures. Re-record them before
  trusting replay-driven comparisons.
- Visual, timing, audio, touch, and device behavior require a human or physical-device
  feel-check when automation cannot observe the relevant experience.

## Handoff

Report the exact gates run, the behavior they prove, anything that could not be observed, and
the concrete human feel-check still required. Do not translate “tests passed” into “the game
feels right”; that is how perfectly tested sludge reaches production.
