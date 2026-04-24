# Lessons

## 2026-04-17

- Trust the runtime entrypoints over stale prose. The live game is driven by `src/game.ts` and `src/main.ts`, not by old references to `App.jsx`.
- When mapping architecture, check `src/game.ts`, `src/types.ts`, and Vite entrypoints first. In this repo, those three files tell the truth faster than high-level docs.
- Treat `GameState` as a shared systems contract, not just sim state. It carries gameplay, render interpolation scratch fields, replay bookkeeping, editor flags, controller HUD data, and bot-only runtime fields.
- Before using a script, inspect whether it still targets current filenames and current constants. Several utility and LLM-assist scripts still reference `.js` outputs, `App.tsx`, or old dimensions.
- Distinguish `npm run dev` from preview/build behavior. The `/api/save-replay` endpoint exists only in the Vite dev server via `vite-replay-plugin.ts`.
- Headless tooling defaults can quietly change the question being asked. `runGame()` and several training/recording scripts default to draft-mode assumptions, so benchmark results are not directly comparable unless mode is verified.
- The spawn system has two notions of pressure: configured `cap` in wave config and the live `concurrentCap` actually returned by `generateWaveSchedule()`. Verify which one is in force before drawing balance conclusions.
- Replay is action-log + seed reconstruction, not serialized state playback. Any gameplay-code drift can invalidate old replays even if the file format still loads.
- The render split is worth preserving: `art-render.ts` for reusable art recipes and prebaked assets, `game-render.ts` for frame composition, `game-sim.ts` for rules/state mutation.
- The DOM UI layer is imperative and cleanup-sensitive. If UI behavior gets strange, check `ui.ts` cleanup closures and `game.ts` screen/overlay state before blaming render code.
- After implementing a feature, do not wait to be asked about the dev server. Check whether `npm run dev` is already up; if not, start it yourself and report the local URL.

## 2026-04-19

- Benchmark fixtures need semantic validation, not just file existence. For perf replays, inspect action-type mix and upgrade/shop activity before blessing a file as `stress`, `lategame`, or `particle-spam`.
- A replay with high passive destruction but zero `fire` actions is not a valid particle benchmark in this game. The particle benchmark must exercise interceptor-driven explosions and, ideally, upgraded FX systems that amplify particle load.
- Profiling instrumentation must be validated for visual side effects, not just data output. If a trace path changes what the player sees, the measurement is contaminated and the capture mode is wrong.
- For reviews, anchor on the current worktree diff before inspecting commits. If the request says "uncommitted changes," verify with `git status --short` and review `git diff`, not the last commit like some caffeinated amateur.

## 2026-04-20

- Keep progress updates to one short sentence unless the user explicitly asks for a running narration. Repeating status in multiple themed sentences is noise, not help.
- Global AGENTS tone rules do not matter if higher-priority instructions demand frequent updates, so configure both: ask for terse progress messages and fewer interim updates.

## 2026-04-22

- When the user changes the acceptance criteria mid-debugging, stop optimizing the old fix and reframe the implementation around the new steady-state workflow.

## 2026-04-23

- When a device build might be stale, add an unmistakable visible marker in the UI before drawing conclusions about whether the new bundle is running.
- When the user excludes a scratch or handover file from a commit, keep it out of staged history instead of assuming "all changes" means literally everything.
- If local CI-equivalent format fails on ignored generated files, update `.prettierignore` to match generated artifacts instead of dismissing it as harmless.

## 2026-04-24

- When recreating canvas text in DOM, size and wrap against the game stage, not the browser viewport. CSS `vw` plus a constrained phone shell can turn "MISSILE COMMAND" into a typographic car crash.
