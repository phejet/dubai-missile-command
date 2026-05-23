# Lessons

## 2026-05-23

- When asked what skills are available in this repo, include both the Codex session skills and repo-local `.claude/skills/*.md`; the local Claude skills are part of the project workflow even if they are not exposed as Codex skill entries.
- For Codex skill troubleshooting, verify with `codex debug prompt-input` before blaming file layout. Codex docs say symlinked skill folders are supported; if a skill is loaded but not visible in `/`, the issue is the app composer/indexer layer, not the skill directory.
- A skill can be invocable by typing `$skill-name` exactly even when `$` autocomplete does not suggest it. Treat exact `$name` resolution, `$` autocomplete, and `/` slash-menu visibility as separate UI behaviors.
- Per current Codex docs, repo-scoped Codex skills belong under `.agents/skills/<skill-name>/SKILL.md`; `~/.codex/skills` is not the documented user-skill root. Codex supports symlinked skill folders in those scanned locations, so link the whole skill folder, not just an individual `SKILL.md`.
- When reporting balance numbers, avoid `a -> b` notation if the user may read it as a range; say `base X, upgraded Y` explicitly.

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

## 2026-04-25

- Passing Pixi smoke tests are not enough for effect-heavy renderer work. When porting particles or explosions, inspect a screenshot from an actual detonation path before calling it done; placeholder circles can pass every structural test and still look broken.

## 2026-04-26

- For editor/browser rendering changes, verify the full browser surface the user will see, not just renderer dataset flags or a narrow canvas crop. A "ready" Pixi flag can still hide a blank or white preview.
- Fallback renderers are product UI, not debugging doodles. If fallback is visible to the user, route through the same real art path or it will ship as a placeholder wearing a false moustache.
- Editor fixture scenes need composition review, not just asset correctness. Avoid placing preview threats directly on landmark silhouettes unless testing that overlap deliberately.
- Mock entities must include discriminator fields, not just matching subtype names. A `subtype: "shahed136"` without `type: "drone"` still renders as the default threat path.
- When a shared sprite looks different across screens, compare the full render stack. Gameplay can add post-sprite overlays that title/editor paths will not inherit from the asset itself.
- In Pixi, never draw a pulsing/scaled `Graphics` primitive at absolute world coordinates unless you want it to scale around `(0,0)` like a drunk compass. Draw local geometry around `(0,0)` and set `position` to the world anchor.
- When porting Canvas damage effects to Pixi, do not replace gradients with large opaque circles or rectangles. If Pixi lacks the same gradient primitive, use localized strokes, small glows, and shape language that preserves the original art intent.
- Preserve Canvas clip semantics during Pixi ports. If the old renderer called `clip()` before decals or flashes, the Pixi version needs an equivalent mask or the same art becomes giant unbounded UI sludge.

## 2026-05-01

- For subjective visual checks after a focused rendering fix, ask the user to inspect the running game before doing extra screenshot spelunking.

## 2026-05-04

- For variant behavior, encode the intended trajectory geometry in tests. "Straight to target" is not "horizontal" unless the target y equals the spawn y, because apparently trigonometry remains undefeated.
- When implementing visual altitude bands, use the actual landmark bounds the user named rather than a broad collision-safe range. "Can hit the Burj" and "flies at the Burj tip to mid-Burj" are different requirements, astonishingly.
- When replacing a threat class in a specific wave, assert both absence and replacement presence. Otherwise stack carriers can lurk in wave 1 wearing a starter-wave trench coat.
- When tuning variant speed, test relative velocity between variants so the multiplier cannot quietly become a global prop-drone buff.
- For spawn geometry, constrain the actual trajectory slope, not just spawn zones. Edge spawns plus nearest-edge targets create vertical nonsense even when each input looks individually reasonable.
- Do not multiply small sprite detail markers by both effect scale and enemy scale unless the desired output is a glowing clown nose visible from orbit.
- When smoothing difficulty, audit all unlock gates on the same wave, not just the budget row. A spike can come from count, variant mix, tactic availability, and fast modifiers all landing together.

## 2026-05-07

- When asked to review a specific branch plan, list the exact `.plans` filenames first and confirm the intended file before giving architectural judgment. Branch names are not plan names, despite their heroic attempts at cosplay.

## 2026-05-11

- When the user asks for a world object to become UI, style the object itself first and the UI second. A health display mounted on a flat placeholder base still reads as HUD chrome, not diegetic game art.
- For subjective visual styling changes, run structural tests and then ask the user to visually check the running game. Do not burn time on extra screenshot archaeology unless the user asks for it or a render is obviously broken.
- Diegetic health styling still has to be readable at gameplay scale. If architectural slits or tiny details make state unclear, keep the stronger segmented read and use color, framing, and hit effects to integrate it.
- Keep non-informational foundation mass subordinate to the readable health bay; oversized shoulders make the base feel heavy without adding gameplay signal.

## 2026-05-12

- For graphics and game-feel work, prioritize a running feel-check build over extra headless/browser automation once structural tests pass. Automated probes are useful plumbing checks, not proof that the art reads well.
- Do not make `CRITICAL` a post-death label. In this game it should mean a playable last stand: the Burj is still alive, the player can still act, and the screen state creates urgency before failure.
- When increasing clipped fire on a narrow silhouette, do not just scale flame tongues taller. The mask will chop them into ugly shards; make the core/band fire read larger and keep tongue height moderate.

## 2026-05-13

- Before giving local editor/game URLs, verify the exact running port and route with HTTP. A stale port note is not a URL; it is a tiny productivity tax wearing a hat.
- In an editor panel, "include X" usually means make X adjustable unless the user explicitly asks for a readout. Read-only values in tuning sections need a reason, not just vibes and a border.
- When visual feedback says an effect is too subtle, treat the screenshot as the failing test. Check the default editor values and the visual hierarchy between competing layers; particle counts can be correct while the visible read is still wrong.
- For fire visuals, bigger sprites are usually the lazy failure mode. Use smaller overlapping, irregular, rotated tongues with separate hot cores; a single large symmetric flame reads as clip art no matter how expensive the renderer is.
- Damage art needs continuity around the source of an effect. If flames emerge from a tower that still looks pristine immediately around the emitter, the viewer reads it as pasted-on VFX instead of structural damage.
- For environmental effects, direction controls should encode a coherent physical direction. If the user chooses wind to the right, particle drift should be rightward-only with magnitude variation, not a symmetric left/right jitter masquerading as weather.
- When damage should cover whole tower sections, do not compose it from small per-band strips. Bake a full overlay and reveal it with a section mask so coverage is structural instead of decorative soot confetti.
- Before reporting an editor URL, fetch the page body or title, not just headers. A stale server can return `200 OK` while serving the game entrypoint at the editor path, because apparently HTTP status codes have chosen chaos.
- For animated damage overlays, keep ember positions stable between frames and animate brightness/size. Randomizing positions per frame reads as blinking noise, not heat.
- For Burj scorch embers, keep glow spots tiny at gameplay scale. Large radial halos read as blobs pasted onto the tower instead of hot windows or small exposed fires.
- For Burj building-fire smoke, keep one smoke particle family for visual coherence and adjust tint/color for material read. Mixing white puff PNGs with black smoke PNGs looks mismatched instead of like believable gray smoke.
