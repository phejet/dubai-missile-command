# Codebase Review Remediation Plan

**Author:** Claude (planning). **Implementer:** another LLM. **Reviewer of results:** Claude.
**Status:** ready for implementation — Codex review round folded in (W1 file list, W3/W4/W6/W9
resolutions baked into the steps; no open "reviewer notes" remain for the implementer to adjudicate).
**Date:** 2026-05-30.

This plan addresses the eight problem areas from the codebase review. It is split into
self-contained **work items (W1–W9)**, ordered by risk-to-payoff. Each item is independently
shippable as its own commit/PR so the reviewer can sign off one at a time. Do **not** bundle
multiple work items into one commit.

---

## Ground rules for the implementer

These are non-negotiable. Violating any of them is grounds for rejection at review.

1. **This is a game. Behavior is ground truth, not the type-checker.** Several items are pure
   refactors that MUST NOT change a single gameplay value, RNG draw, or pixel. Where a step says
   "value-preserving", it means byte-identical numbers and identical evaluation order.

2. **Determinism is sacred.** After any change to `src/game-sim.ts`, `src/game-logic.ts`,
   `src/replay.ts`, or `src/types.ts`, you MUST run and pass:

   ```bash
   npx tsx src/headless/sim-runner.ts 12345     # determinism self-check, fixed seed
   npx tsx src/headless/sim-runner.ts 999
   ```

   The runner re-simulates and compares hashes; a desync is a hard failure. If the runner does not
   already print a determinism verdict, run the same seed twice and diff the final score/hash.

3. **Run the full unit suite after every work item:**

   ```bash
   npx vitest run
   ```

   And the smoke suite after items touching boot/render/controller (W1 docs excepted):

   ```bash
   npx playwright test e2e/smoke.spec.ts
   ```

4. **One concern per commit.** Commit messages: imperative, no Co-Authored-By line (repo rule).

5. **Do not "improve" things outside the work item's stated scope.** No drive-by reformatting.
   The diff blast radius is already the problem; do not widen it.

6. **If a step's premise is false** (a file/line moved, a constant already moved, a test already
   exists), STOP and report rather than forcing the change. The line numbers below are from
   2026-05-30 `main` and may drift.

7. **Feel-bearing changes:** none of these items intend to change game feel. If you discover that a
   "mechanical" move actually alters a value (e.g. two constants thought identical are not), STOP and
   flag it — do not reconcile them yourself.

---

## Tier 1 — Free money (low risk, high leverage). Do these first.

### W1 — Make the render docs describe the renderer that actually exists

**Why:** The single biggest landmine. `docs/render-split-analysis.md` describes a `src/game-render.ts`
frame compositor and `drawGame()/drawTitle()/drawGameOver()` entry points. None of that exists.
`PixiRenderer` (`src/pixi-render.ts:1350`) is the only frame path; `drawGame/drawTitle/drawGameOver`
have **zero** non-test callers. Five docs reference the phantom `game-render.ts`. New contributors
(and future LLM sessions) start in the wrong file.

**Files:**

- `docs/render-split-analysis.md` (8 references — the main offender)
- `docs/README.md` (1)
- `docs/game-state-contract.md` (1)
- `docs/testing-matrix.md` (1)
- `docs/ios-capacitor-plan.md` (1)
- `docs/editor-architecture.md` — references `drawGame(...)` (editor-architecture.md:36). Verified.
- `docs/runtime-controller.md` — references `drawGame(...)`, `drawTitle(...)`, and `drawGameOver(...)`
  (runtime-controller.md:93/98/99). Verified.
- `CLAUDE.md` — the "Architecture" section also lists `src/game-render.ts` as "frame composition
  and render-time asset caching". Fix this too.

These last two were missing from the first draft; without them the W1 acceptance grep
(`drawGame\|drawTitle\|drawGameOver`) fails on files you were never told to touch. They are in scope.

**Ground truth to document (verify each before writing):**

- Frame path: `bootGame()` → `new PixiRenderer(canvas)` (`src/boot-game.ts:270`). Also instantiated
  in `src/run-recap-death-clip.ts:171` and `src/editor-render.ts:25`.
- `PixiRenderer implements GameRenderer` (interface in `src/game-renderer.ts`, 1 small file).
  Entry methods are `renderTitle` / `renderGameplay` / `renderGameOver` (`src/pixi-render.ts`,
  around 1461–1477 per the review; confirm current line numbers).
- `art-render.ts` is **not** a renderer. It is an offscreen-canvas **sprite bakery**: it builds
  sprites that `canvas-render-resources.ts` turns into textures Pixi uploads. The only direct link
  from Pixi into it is a couple of layout/geometry helper imports (`src/pixi-render.ts` imports from
  `art-render.ts` — confirm which symbols).

**Steps:**

1. Rewrite `docs/render-split-analysis.md` end-to-end to describe: Pixi as the sole frame path; the
   three scene methods; `art-render.ts` as a sprite bakery feeding `canvas-render-resources.ts`;
   `game.ts` as the controller that calls the renderer. Remove every mention of `game-render.ts`,
   `drawGame`, `drawTitle`, `drawGameOver`, `drawShared*` as runtime entry points. If those
   `drawShared*` exports still exist in `art-render.ts` and have no callers, note them as
   "dead exports, candidates for deletion" but do NOT delete code in this docs-only item.
2. Grep-and-fix the 1-reference docs and `CLAUDE.md` so no doc points at `game-render.ts`.
3. Add a one-line "Renderer entry points" note to `docs/README.md` so the next reader lands in
   `pixi-render.ts`.

**Acceptance criteria:**

- `grep -rn "game-render" docs CLAUDE.md` returns nothing (only `game-renderer.ts` and
  `game-render**er**.ts` allowed — be careful the grep doesn't false-positive on the real file).
- `grep -rn "drawGame\|drawTitle\|drawGameOver" docs` returns nothing.
- A reader following the docs lands in `pixi-render.ts`, not a nonexistent file.

**Risk:** ~zero (docs only). No code changes. No tests needed beyond the grep checks.

---

### W2 — De-duplicate the EMP / Burj constants

**Why:** Identical magic numbers defined on both the sim and the render side. Whoever tunes one and
forgets the other gets a hit/miss visual-vs-gameplay desync that **no test will catch**.

**Confirmed duplications:**

- `EMP_RING_SPEED_INITIAL=40`, `EMP_RING_SPEED_MID=25`, `EMP_RING_SPEED_TAIL=12`
  - sim: `src/game-sim.ts:1703–1705`
  - render: `src/pixi-render.ts:397–399`
- Burj max health `7`, defined twice with different names:
  - sim: `BURJ_FIRE_MAX_HEALTH = 7` (`src/game-sim.ts:79`)
  - render: `export const BURJ_MAX_HEALTH = 7` (`src/pixi-render.ts:391`)

**Steps:**

1. In `src/game-logic.ts` (the existing home for shared geometry/constants), add canonical exports:
   `EMP_RING_SPEED_INITIAL`, `EMP_RING_SPEED_MID`, `EMP_RING_SPEED_TAIL`, and `BURJ_MAX_HEALTH`.
   Use the exact current values (40 / 25 / 12 / 7).
2. Replace the sim-side and render-side local definitions with imports from `game-logic.ts`.
3. For Burj health: pick `BURJ_MAX_HEALTH` as the single canonical name. Re-export it from
   `pixi-render.ts` if other modules import it from there today (check importers first with
   `grep -rn "BURJ_MAX_HEALTH" src`), so you don't break those import paths — but the **value** must
   originate in `game-logic.ts`. Delete `BURJ_FIRE_MAX_HEALTH`; replace its 3 uses in `game-sim.ts`
   (lines ~101/103/108) with `BURJ_MAX_HEALTH`.
4. **Before/after grep** to prove no third copy survives.

**Acceptance criteria:**

- `EMP_RING_SPEED_*` and the Burj-max-health `7` are each defined exactly once (in `game-logic.ts`).
- `grep -rn "BURJ_FIRE_MAX_HEALTH" src` returns nothing.
- Values unchanged (40/25/12/7). Determinism check passes. `npx vitest run` green.

**Risk:** Low, but it touches the sim — run the determinism check. The EMP ring radius math in
`pixi-render.ts:450–454` must read identical values afterward.

---

## Tier 2 — Structural refactors (medium risk, compiler-guided). One PR each.

### W3 — Split `GameState` into `SimState` / `RuntimeState` / `ReplayState`

**Why:** `GameState` (`src/types.ts:588`) is one interface with ~150 fields and **54** `_`-prefixed
"private by convention" fields. Persisted sim state sits next to render timers, HUD bookkeeping, RAF
accumulators, and replay-recording fields — all optional, so nothing tells you what's safe to touch
or what the lifecycle actually is.

**Target shape (type-only; runtime object stays one object):**

```ts
// SimState: deterministic gameplay state — everything the sim reads/writes each tick.
//   missiles, drones, interceptors, explosions, particles, planes, buildings, defenseSites,
//   hornets, roadrunners, lasers, phalanx, patriot*, flares, emp*, burj*, ammo, launcherHP,
//   upgrades, ownedUpgradeNodes, commander, schedule*, wave/waveTick, score, stats, etc.
// RuntimeState: render-only + HUD + RAF + browser handles (NOT read by the sim).
//   burjHitFlash*, launcherFireTick, _lowAmmoTimer, _fps*, _timeAccum, _rafDeltaMs,
//   _laserHandle, _browserLaserHandle, gameOverTimer, waveClearedTimer, _bonusScreen*, etc.
// ReplayState: recording/playback only.
//   _gameSeed, _actionLog, _replayCheckpoints*, _replay, _replayIsHuman, _replayShopTimer,
//   _replayTick, _replayShopBought, _purchaseToast, _draftOffers, etc.
export type GameState = SimState & RuntimeState & ReplayState;
```

**Steps:**

1. Read the current `GameState` block (`src/types.ts:588–739`). Classify every field into exactly
   one of the three buckets. Heuristic: if `src/game-sim.ts` reads/writes it during `simUpdate`,
   it's `SimState`; if only the renderer/HUD/`game.ts` RAF loop touches it, `RuntimeState`; if only
   `replay.ts`/recording touches it, `ReplayState`. Produce the classification as a comment block
   first so the reviewer can audit the bucketing.
2. Define the three interfaces and `GameState = SimState & RuntimeState & ReplayState`.
3. **Promotion to required is OUT of scope for this item.** Reason: `initGame()` (`src/game-sim.ts:399`)
   builds an untyped object and returns `g as unknown as GameState` (line 511); `editor-scene.ts:385`
   does the same. While that cast stands, `tsc` cannot prove any field is actually initialized, so
   "promote optionals to required" would be a lie the compiler can't check — and chasing it tempts the
   implementer into `!` non-null assertions, which is exactly the bug we're trying to remove. Keep
   every field's current optionality as-is. Reshape the buckets only.
4. Fix fallout. This is **type-only**: no runtime logic, no initializer edits, no value changes. The
   constructed state object stays byte-identical. `tsc` will lead you to every reference site; fixes
   there should be import/type-name changes only.

**Decision (resolves the original contradiction):** This is a pure type reshuffle. We do NOT remove
the `as unknown as GameState` cast and we do NOT promote fields to required here. Untangling that cast
so required-ness becomes provable is a separate, larger work item (call it **W3b**, not scheduled in
this plan) — do not fold it in.

**Acceptance criteria:**

- `GameState` is an intersection of three named, documented interfaces (`SimState & RuntimeState & ReplayState`).
- No field appears in more than one bucket. Field optionality is unchanged from today (no `?:` added or removed).
- `npx tsc --noEmit` (or the project's typecheck script) is clean.
- `npx vitest run` green; determinism check passes; smoke passes.
- **Manual before/after shape audit:** dump the key set of the object `initGame()` returns before and
  after the change and diff them — must be identical. (The compiler can't prove this because of the
  cast, so prove it by inspection.) This replaces any claim that `tsc` guarantees the shape.

**Risk:** Medium churn, low semantic risk. With promotion-to-required removed, there is no step that
can change runtime behavior — the only failure mode is mis-bucketing a field, which the audit + tests
catch.

---

### W4 — Type the sim → runtime event bridge

**Why:** `handleSimEvent(type: string, data: any)` (`src/game.ts:937`) and the sim-side
`onEvent: (type: string, data?: unknown) => void` (`src/game-sim.ts:266`) are stringly/`any`-typed.
A discriminated union turns the runtime `if (type === ...)` branches into compiler-checked
exhaustiveness.

**Complete event inventory (verified — the first draft listed only the first four):**

| Event                    | Emitted from                                          | Consumed in `handleSimEvent`?           | Routing decision                                                                   |
| ------------------------ | ----------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `sfx`                    | `game-sim.ts` (~40 sites), payload `{ name: string }` | yes (game.ts:938)                       | runtime sink                                                                       |
| `gameOver`               | `game-sim.ts:3035`                                    | yes (game.ts:962)                       | runtime sink                                                                       |
| `waveBonusStart`         | `game-sim.ts:3068`                                    | yes (game.ts:1024)                      | runtime sink                                                                       |
| `shopOpen`               | `game-sim.ts:3090`                                    | yes (game.ts:1045)                      | runtime sink                                                                       |
| `waveComplete`           | `game-sim.ts:3116`, payload `{ score, wave }`         | **no — silently ignored today**         | **typed no-op** in the union + `handleSimEvent` (explicit empty case, comment why) |
| `replay_version_warning` | `replay.ts:47`                                        | **no — never reaches `handleSimEvent`** | **separate channel** — do NOT add to the runtime `SimEvent` union                  |

**Routing decisions (resolve before coding):**

- `waveComplete` IS part of `SimEvent` (it flows through the same `onEvent` sink) but is a no-op for
  the runtime. Give it an explicit `case "waveComplete": break;` with a comment, so the exhaustiveness
  check passes AND behavior is unchanged (it's a no-op today, it stays a no-op). Do not invent new
  handling for it.
- `replay_version_warning` is a replay-layer concern, not a runtime one. Keep it on its own typed
  callback/event type (e.g. `ReplayEvent`), separate from `SimEvent`. Do NOT route it through
  `handleSimEvent`. If `replay.ts` currently calls the same `onEvent` signature, give the replay
  warning its own narrow callback param instead so the runtime union stays clean.

**Steps:**

1. In `src/types.ts` (or a small `src/sim-events.ts`), define the runtime union with **all five**
   sim-sourced kinds (the replay warning is excluded by the decision above):
   ```ts
   export type SimEvent =
     | { type: "sfx"; name: string } // confirm full payload shape from call sites
     | { type: "gameOver" /* fields from game.ts:962 branch */ }
     | { type: "waveBonusStart" /* fields from game.ts:1024 */ }
     | { type: "shopOpen" /* fields from game.ts:1045 */ }
     | { type: "waveComplete"; score: number; wave: number }; // runtime no-op, kept for exhaustiveness
   export type SimEventSink = (event: SimEvent) => void;
   ```
   Derive each payload's fields by reading both the emit sites in `game-sim*.ts` and the consuming
   branches in `game.ts` (lines 938/962/1024/1045). The `sfx` `data` is `{ name }` plus possibly
   more (e.g. position/volume) — enumerate every distinct shape actually passed.
2. **Decide the call shape.** Current emit is `onEvent("sfx", { name })` (two args). Two options:
   - (a) Keep two-arg `onEvent(type, data)` but type it as overloads / a mapped type so payloads are
     checked per-type. Lower churn — every `onEvent("sfx", {...})` call site stays as-is.
   - (b) Switch to single-arg `onEvent({ type: "sfx", name })`. Cleaner union but touches ~40+ emit
     sites in `game-sim.ts`.
     **Recommended: (a)** — a `SimEventMap` keyed by type + overloaded sink signature. It gets the
     type safety with minimal diff. Only go to (b) if (a) can't express exhaustiveness cleanly.
3. Replace `data: any` in `handleSimEvent` with the typed union and add an exhaustiveness check
   (`default: assertNever(event)`).
4. **Exhaustiveness must hold at the consumer, not just the emitter.** With option (a)'s two-arg call
   shape, the overloads only type-check the _emit_ payloads — they do not by themselves make
   `handleSimEvent` exhaustive. So inside `handleSimEvent`, first normalize `(type, data)` into a
   single discriminated `SimEvent` object, then `switch` on `.type` with `assertNever` in `default`.
   That normalization step is what gives you the compile-time "new event kind → typecheck fails until
   handled" guarantee. Skipping it leaves the consumer just as stringly-typed as before.

**Acceptance criteria:**

- No `any` in the sim-event path.
- The union covers all five sim-sourced kinds (`sfx`, `gameOver`, `waveBonusStart`, `shopOpen`,
  `waveComplete`); `replay_version_warning` lives on its own typed channel, not in `SimEvent`.
- `waveComplete` is an explicit no-op case (behavior identical to today's silent ignore).
- Adding a hypothetical new event kind would fail the typecheck until handled (exhaustiveness proven
  via `assertNever`).
- All existing emit call sites compile unchanged (if option a) or are mechanically updated (option b).
- `npx vitest run` green; smoke passes. No behavior change.

**Risk:** Low–medium. Mechanical. The only trap is missing a payload field on one of the rarer events
— enumerate carefully from the actual call sites.

---

### W5 — Carve `game-sim.ts` along subsystem lines

**Why:** `game-sim.ts` is 3,373 lines, 70+ top-level functions, with a ~184-line `update()` that
orchestrates 10 subsystems by mutation. You already proved the pattern works with
`game-sim-shop.ts` and `game-sim-upgrades.ts`. Extract the obvious subsystems.

**Target new files (mirror the existing `game-sim-*.ts` naming):**

- `src/game-sim-patriot.ts` — Patriot scheduling/launch/update (queue, reserve shots, follow-up).
- `src/game-sim-emp.ts` — EMP rings/arcs/burst/launcher flares, ring-speed curve (`empRingSpeed`).
- `src/game-sim-flare.ts` — decoy flare salvo logic, claims, lure behavior.
- `src/game-sim-burj-fire.ts` — Burj damage-fire FX layout/state.

**Steps (per subsystem — do them one at a time, separate commits):**

1. Identify the cohesive function + constant cluster for the subsystem in `game-sim.ts`. Move it
   verbatim into the new file. Keep function bodies byte-identical.
2. Export what the orchestrator (`simUpdate`) and other modules need; import back into `game-sim.ts`.
3. Shared constants moved in W2 (EMP ring speeds) already live in `game-logic.ts`; import from there,
   not from the new subsystem file, to avoid a new cross-dependency.
4. **Preserve call order inside `update()` exactly.** The orchestrator must call the extracted
   subsystem functions at the same point in the tick, with the same arguments, in the same order.
   RNG draw order must not move. This is the determinism-critical part.
5. After each extraction: determinism check on 2+ seeds, full vitest, smoke.

**Acceptance criteria:**

- `game-sim.ts` shrinks by the moved subsystems; each new file is cohesive and under ~600 lines.
- `update()` tick order and RNG draw order unchanged.
- Determinism check passes on seeds 12345 and 999 (and ideally replay validation against an existing
  fixture — see Verification). `npx vitest run` green; smoke passes.

**Risk:** **Highest in the plan.** Moving code in the sim can silently reorder evaluation or RNG
draws and desync replays. Mitigation: verbatim moves only, no logic edits, determinism check after
each commit, and validate at least one committed replay fixture still plays identically (see below).
If any seed desyncs, revert that commit and report — do not "fix" by tweaking values.

---

## Tier 3 — Hardening & hygiene.

### W6 — Typed `ov()` override registry + determinism guard

**Why:** `ov(key, fallback)` (`src/game-logic.ts:321`) reads `window.__editorOverrides` and is called
from ~83 production sites (**~83 keys, of which 77 are reachable by the naive `ov("…"` grep and 6 more
are hidden inside ternaries — see warning below**). Keys are bare strings (misspelling silently
returns fallback forever), there's no schema, and nothing prevents an override leaking into a
deterministic replay/headless run. Keys cluster under prefixes `upgrade`, `burjFire`, `flare`,
`particle`, `explosion`.

> **⚠ The collection grep is unsound — do NOT trust a single regex for the registry.** Keys also
> appear as ternary branches, e.g.
> `ov(isL2 ? "flare.salvoCountL2" : "flare.salvoCountL1", …)` (game-sim.ts:3189–3193). The pattern
> `ov("…"` misses all six of these (`salvoCount`, `salvoDrops`, `salvoSpacingTicks` × L1/L2) because
> the char after `ov(` is a variable, not a quote. Building the registry from that grep alone yields a
> registry missing exactly those keys — the editor then "develops opinions" on flare salvos and you
> lose an afternoon. Collect from BOTH patterns (or, better, do a real AST/`tsc` sweep) and reconcile.

**Steps:**

1. Build a typed key registry. Collect keys from **both** forms and merge:
   ```bash
   # direct literal keys
   grep -rhoE 'ov\("[^"]+"' src --include="*.ts" | grep -v test | sed -E 's/ov\("//;s/"$//'
   # keys hidden in ternary branches (any string literal inside an ov(...) call with a non-quote first char)
   grep -rnE 'ov\([^"]' src --include="*.ts" | grep -v test | grep -oE '"[a-z][a-zA-Z.0-9]+"'
   # then: sort -u the union of both lists
   ```
   Cross-check the merged list against the count above; if you don't land on ~83 unique keys,
   something is still being missed — stop and reconcile before generating types.
   Define a union/`const` map `OverrideKey` (or a typed schema object mapping key → value type) so
   `ov()` only accepts known keys and infers the fallback type. Misspellings become compile errors.
   Note: the ternary call sites (`ov(isL2 ? "a" : "b", …)`) type-check fine against a `keyof` registry
   as long as **both** branch keys are in it — which is exactly why both must be collected.
2. Keep the runtime behavior identical: editor override wins when present, else fallback. Do not
   change any fallback value.
3. **Determinism guard.** Add an assertion (cheap, dev/test only) that during deterministic runs
   `window.__editorOverrides` is absent/empty. Concretely: in the headless entry
   (`src/headless/sim-runner.ts` / worker) and in the replay runner, assert no overrides are set, or
   make `ov()` ignore overrides when a `deterministic` flag is on. Confirmed today there are **no**
   `ov()` calls under `src/headless`, so the path is clean by luck — make it clean by construction.
4. Optional micro-opt: hoist the `typeof window` check. Low priority; skip if it complicates the
   typed registry. Do not sacrifice clarity for a branch that runs once per read.

**Acceptance criteria:**

- `ov()` is generic over a typed key registry; an unknown key fails the typecheck.
- A deterministic run with overrides set either asserts or provably ignores them.
- Zero fallback-value changes. Determinism check passes; `npx vitest run` green.

**Risk:** Low–medium. The registry is mechanical; the determinism guard is the valuable part. Don't
let the typing effort accidentally change a default.

---

### W7 — Repo-root cleanup

**Why:** Docs already label these "legacy"; nothing was deleted. ~430KB of dead replay JSONs and four
loose scripts at the root, plus a tooling-only dependency shipped in production `dependencies`.

**Steps:**

1. **Confirm dead, then delete** the loose root scripts (`grep` for any importer/CI reference first):
   `analyze-hornets.js`, `analyze-replay.js`, `gen-sky.mjs`, `screenshot-bot.mjs`.
2. **Confirm unreferenced, then delete** the root replay fixtures: `current-typical-replay.json`,
   `emp-first-replay.json`, `novice-replay.json`, `representative-bot-replay.json`,
   `normal-bench-all.json`, `spawn-analysis-new.json`. **Caution:** before deleting any `*-replay.json`,
   grep the whole repo (tests, scripts, package.json, perf harness) for the filename. If a test or
   the perf/determinism workflow loads one as a fixture, KEEP it (or move it under `fixtures/` and
   update the reference). Per ground rule 6, if a file you were told to delete is actually in use,
   stop and report rather than deleting.
3. Move `@anthropic-ai/sdk` from `dependencies` to `devDependencies` in `package.json` (only used by
   `src/headless/balance.ts` and `src/headless/learn.ts` for offline tuning). Run `npm install` to
   update the lockfile. Verify the browser build still works: `npx vite build`.
4. Add a short "what lives at the repo root" note (to `docs/README.md` or `CLAUDE.md`) stating the
   rule, so the rot doesn't grow back.
5. Leave `perf-results/` (18MB, committed) and `replays/` (gitignored) decisions OUT of this item —
   that's a policy call for the user, not a mechanical cleanup. Flag it in the PR description and let
   the user decide; do not change `.gitignore` or delete `perf-results/` unilaterally.

**Acceptance criteria:**

- Listed dead files gone; nothing that referenced them is broken.
- `@anthropic-ai/sdk` in `devDependencies`; `npx vite build` succeeds; headless tooling still runs
  (`npx tsx src/headless/sim-runner.ts 1`).
- Full vitest + smoke green.

**Risk:** Low, but deletion is irreversible — the grep-before-delete step is mandatory, and anything
ambiguous gets surfaced to the user, not deleted.

---

### W8 — Small consistency wins

**Why:** Cheap papercut removal. Do as one PR or fold individual pieces into related items.

**Steps:**

1. **Import-extension consistency.** Today: 44 `.js`-suffixed relative imports vs 105 extensionless
   (non-test). Pick **one** convention (recommend matching whatever `tsconfig`/Vite expects most
   naturally — likely extensionless for `.ts`, but check the existing majority and the
   `moduleResolution` setting). Apply repo-wide with a scripted codemod, then eyeball the diff. This
   is noisy; keep it in its **own** commit so it doesn't drown a real change.
2. **Overlay-flag state machine.** `game.ts` has 7 boolean overlay flags (`shopOpen`, `bonusActive`,
   `progressionOpen`, `replayActive`, `showOptionsMenu`, `showPerfOverlay`, `runRecapOpen`). These
   encode mutually-exclusive-ish UI states as independent booleans → "run-recap opened on top of the
   shop" class bugs. **Plan only — do not implement blind.** Propose a single `overlay:
"none" | "shop" | "bonus" | ...` discriminated state (where states are actually exclusive) and
   leave genuinely-orthogonal toggles (e.g. `showPerfOverlay`) as separate. Write the proposed state
   chart and hand it back to the reviewer before refactoring, because this is feel/UX-bearing.
3. **`update()` end-of-tick array filtering** (`game-sim.ts` ~3161–3166 filters six arrays every
   tick). Document as a known future perf cliff (mark-and-sweep with reusable arrays). **Do not
   implement now** — it's a premature optimization at current entity counts and a determinism risk.
   Just leave a `// PERF:` note and a one-paragraph entry in the perf doc.

**Acceptance criteria:**

- Import style uniform (its own commit). Build + tests green.
- Overlay state machine: a written proposal exists; no code change without reviewer sign-off.
- Perf note added; no array-filter code change.

**Risk:** The import codemod is low-risk but noisy. The overlay refactor is UX-bearing — gated behind
reviewer approval on purpose.

---

### W9 — Close the worst test gaps

**Why:** ~6.8K test LOC vs ~27.7K source (~1:4), and it's lopsided. `game-sim.test.ts` (2,124 lines)
carries gameplay; the 7,500-line renderer surface has mostly helper tests; `game.ts` (1,567 lines,
the controller with 7 overlay flags) has **no** dedicated test.

**Test seam decision (resolves Codex's open menu).** The overlay flags (`shopOpen`, `bonusActive`,
`progressionOpen`, `runRecapOpen`, `showOptionsMenu`) are `private` fields on `class Game`
(`src/game.ts:410–416`); the headless sim harness cannot see them, and reaching in with `as any` casts
is brittle and forbidden. **Chosen seam: add a test-only read-only snapshot getter** on `Game`, e.g.

```ts
/** Test/diagnostics only. Read-only snapshot of overlay state; not part of the public API. */
get __overlayState(): { active: OverlayName | "none"; perfOverlay: boolean } { … }
```

Derive it from the existing private fields — do not duplicate state. This is the least-invasive seam:
it doesn't force the W8 overlay-state-machine refactor as a prerequisite, and it gives the test a
single honest thing to assert against. Drive the `Game` controller in **jsdom** (vitest `jsdom`
environment), not the headless harness, since these are controller/UI transitions.

**Steps:**

1. Add the `__overlayState` getter to `Game` (read-only, derived).
2. Add `src/game.test.ts` (jsdom env) covering the transition machine
   `title → playing → wave-bonus → shop → playing → game-over`. At each transition assert via
   `__overlayState` that **at most one** mutually-exclusive overlay is active (this is exactly where
   the boolean soup bites — e.g. run-recap must not be active while the shop is). Drive transitions
   through the controller's real entry points / sim events, not by poking private fields.
3. Add a couple of `pixi-render` **scene-composition** tests (not just helper math): assert each scene
   method runs without throwing against a representative `GameState` for title / gameplay / gameover,
   and that switching scenes tears down/sets up cleanly. Keep them light — the goal is catching the
   overlay-desync and scene-leak class of bug, not pixel-diffing.
4. Sequence W9 **after** W3 (state split) and W4 (typed events) — both make these tests easier and
   stronger.

**Acceptance criteria:**

- `Game` exposes a read-only `__overlayState` snapshot; no test reaches into private fields via casts.
- `src/game.test.ts` (jsdom) exercises all five major transitions and asserts at-most-one
  mutually-exclusive overlay active at each, via `__overlayState`.
- At least basic scene-composition smoke tests for the three Pixi scenes.
- New tests pass; no flakiness across 3 consecutive runs.

**Risk:** Low (additive). The trap is writing brittle DOM/pixel tests — keep them behavioral and
deterministic.

---

## Suggested sequencing

```
W1 (docs)         ─┐  independent, do immediately
W2 (constants)    ─┘  (W2 before W5 so EMP speeds already live in game-logic)
W3 (state split)  ──> enables cleaner W4, W9
W4 (typed events) ──>
W5 (sim carve-out, one subsystem per commit; highest determinism risk)
W6 (ov registry)
W7 (root cleanup)  independent of everything
W8 (consistency; overlay proposal gated)
W9 (tests; after W3/W4)
```

## Global verification checklist (run before declaring any item done)

```bash
npx tsc --noEmit                              # or the repo typecheck script
npx vitest run                                # full unit suite
npx tsx src/headless/sim-runner.ts 12345      # determinism, seed A
npx tsx src/headless/sim-runner.ts 999        # determinism, seed B
npx playwright test e2e/smoke.spec.ts         # boot/input/shop (skip for W1)
npx vite build                                # production build sanity (esp. W7)
```

For W5 specifically, additionally validate a committed replay fixture plays back identically
(use the replay runner / `npx tsx play-replay.ts <fixture>` against a known-good replay, or the
headless replay validation path) to prove RNG/tick order is preserved.

## What is explicitly OUT of scope (do not do without asking the user)

- Deleting/relocating `perf-results/` or changing `.gitignore` policy (W7 flags, user decides).
- The overlay-flag refactor itself (W8 — proposal only; UX-bearing).
- The end-of-tick array mark-and-sweep perf rework (W8 — note only).
- Any change to gameplay values, RNG, spawn tables, or upgrade balance. This plan is structural and
  documentary; it must not touch feel.
